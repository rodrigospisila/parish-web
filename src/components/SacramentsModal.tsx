import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { DateInput } from './DateInput';
import SacramentCertificateDialog from './SacramentCertificateDialog';
import { useAuth } from '../contexts/AuthContext';
import { confirm } from '../services/notification.service';
import { civilDateInputValue, formatCivilDate } from '../utils/dateFormat';

const API_URL = import.meta.env.VITE_API_URL;

type SacramentType =
  | 'BAPTISM'
  | 'FIRST_COMMUNION'
  | 'CONFIRMATION'
  | 'MARRIAGE'
  | 'HOLY_ORDERS'
  | 'ANOINTING_OF_THE_SICK';

type RecordKind = 'RECORD' | 'INFORMED';

const SACRAMENT_LABELS: Record<SacramentType, string> = {
  BAPTISM: 'Batismo',
  FIRST_COMMUNION: 'Primeira Eucaristia',
  CONFIRMATION: 'Crisma',
  MARRIAGE: 'Matrimônio',
  HOLY_ORDERS: 'Ordem',
  ANOINTING_OF_THE_SICK: 'Unção dos Enfermos',
};

interface Sacrament {
  id: string;
  type: SacramentType;
  date: string;
  place?: string | null;
  minister?: string | null;
  notes?: string | null;
  book?: string | null;
  page?: string | null;
  term?: string | null;
  /** RECORD = assento do livro; INFORMED = só informado (sem certidão). Servidor antigo: ausente = RECORD */
  recordKind?: RecordKind;
  /** Nome da pessoa no assento (personSnapshot quando o cadastro foi anonimizado) */
  personName?: string;
}

interface Props {
  memberId: string;
  memberName: string;
  /**
   * `laySacramentRecords` da comunidade do membro, se a tela souber. Define o
   * tipo inicial do registro para o coordenador de comunidade.
   */
  communityAllowsLayRecords?: boolean;
  onClose: () => void;
}

interface SacramentForm {
  type: SacramentType;
  date: string;
  place: string;
  minister: string;
  notes: string;
  book: string;
  page: string;
  term: string;
  recordKind: RecordKind;
}

const EMPTY_FORM: SacramentForm = {
  type: 'BAPTISM',
  date: '',
  place: '',
  minister: '',
  notes: '',
  book: '',
  page: '',
  term: '',
  recordKind: 'INFORMED',
};

/** Mínimo do motivo da retificação (mesma regra do backend) */
const RECTIFICATION_MIN = 10;

/** Campos cuja mudança num assento (RECORD) é retificação — exigem motivo */
const RECTIFICATION_FIELDS: Array<keyof SacramentForm> = [
  'type',
  'date',
  'place',
  'minister',
  'book',
  'page',
  'term',
  'recordKind',
];

const kindOf = (s: Sacrament): RecordKind => s.recordKind ?? 'RECORD';
const hasNumbering = (s: Pick<Sacrament, 'book' | 'page' | 'term'>) => !!(s.book?.trim() && s.page?.trim() && s.term?.trim());

const formFromSacrament = (s: Sacrament): SacramentForm => ({
  type: s.type,
  date: civilDateInputValue(s.date),
  place: s.place ?? '',
  minister: s.minister ?? '',
  notes: s.notes ?? '',
  book: s.book ?? '',
  page: s.page ?? '',
  term: s.term ?? '',
  recordKind: kindOf(s),
});

/**
 * Histórico sacramental do membro.
 *
 * - Assento (RECORD): livro/folha/termo e certidão; não se apaga (só o
 *   administrador do sistema) — corrige-se por RETIFICAÇÃO com motivo.
 * - Informado (INFORMED): sacramento recebido em outro lugar, contado pela
 *   família/pastoral — selo "Informado", sem certidão.
 * - Coordenador de comunidade só registra/retifica/emite se a comunidade
 *   permitir (Community.laySacramentRecords); senão o servidor recusa (403) e a
 *   mensagem aparece aqui.
 */
const SacramentsModal: React.FC<Props> = ({ memberId, memberName, communityAllowsLayRecords, onClose }) => {
  const { user } = useAuth();
  const role = String(user?.role ?? '');
  /**
   * Tipo inicial de um registro novo: Assento para a secretaria (PARISH_ADMIN+)
   * e para o coordenador de comunidade liberada (laySacramentRecords); Informado
   * para os demais — inclusive o coordenador quando a tela não sabe a regra.
   */
  const defaultKind: RecordKind =
    ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN'].includes(role) ||
    (role === 'COMMUNITY_COORDINATOR' && communityAllowsLayRecords === true)
      ? 'RECORD'
      : 'INFORMED';
  const emptyForm: SacramentForm = { ...EMPTY_FORM, recordKind: defaultKind };
  // Mesmos papéis do POST/PATCH /sacraments (coordenador depende da comunidade)
  const canRecord = ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN', 'COMMUNITY_COORDINATOR'].includes(role);
  // Assento não se apaga: só a plataforma remove (registro feito por engano)
  const canDelete = role === 'SYSTEM_ADMIN';

  const [items, setItems] = useState<Sacrament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState<SacramentForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<Sacrament | null>(null);
  const [editForm, setEditForm] = useState<SacramentForm>(EMPTY_FORM);
  const [reason, setReason] = useState('');
  const [editError, setEditError] = useState('');

  const [certificateFor, setCertificateFor] = useState<Sacrament | null>(null);

  const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
  const apiMessage = (err: any, fallback: string) => {
    const message = err?.response?.data?.message;
    return Array.isArray(message) ? message.join(', ') : message || fallback;
  };

  /**
   * Coordenador em comunidade sem `laySacramentRecords`: o assento (RECORD)
   * volta 403, mas o registro "Informado" é permitido — a mensagem diz isso.
   */
  const withLayHint = (err: any, kind: RecordKind, message: string) =>
    err?.response?.status === 403 && kind === 'RECORD' && role === 'COMMUNITY_COORDINATOR'
      ? `${message.replace(/\.$/, '')}. Você pode registrar como "Informado" (sem livro e sem certidão); o assento fica com a secretaria.`
      : message;

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${API_URL}/sacraments`, {
        headers: authHeader(),
        params: { memberId },
      });
      setItems(res.data);
    } catch (err: any) {
      setError(apiMessage(err, 'Erro ao carregar sacramentos'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  /** Corpo comum de criação/edição: data civil AAAA-MM-DD (o backend ancora no dia) */
  const payloadOf = (data: SacramentForm) => ({
    type: data.type,
    date: data.date,
    place: data.place.trim(),
    minister: data.minister.trim(),
    notes: data.notes.trim(),
    recordKind: data.recordKind,
    // Numeração só existe no assento
    book: data.recordKind === 'RECORD' ? data.book.trim() : '',
    page: data.recordKind === 'RECORD' ? data.page.trim() : '',
    term: data.recordKind === 'RECORD' ? data.term.trim() : '',
  });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await axios.post(`${API_URL}/sacraments`, { memberId, ...payloadOf(form) }, { headers: authHeader() });
      setForm(emptyForm);
      load();
    } catch (err: any) {
      setError(withLayHint(err, form.recordKind, apiMessage(err, 'Erro ao registrar sacramento')));
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (s: Sacrament) => {
    setEditing(s);
    setEditForm(formFromSacrament(s));
    setReason('');
    setEditError('');
  };

  // Assento (RECORD) com mudança em campo do registro = retificação
  const original = editing ? formFromSacrament(editing) : null;
  const isRectification =
    !!editing &&
    kindOf(editing) === 'RECORD' &&
    !!original &&
    RECTIFICATION_FIELDS.some((field) => String(editForm[field]).trim() !== String(original[field]).trim());

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setEditError('');
    if (isRectification && reason.trim().length < RECTIFICATION_MIN) {
      setEditError(`Informe o motivo da retificação (pelo menos ${RECTIFICATION_MIN} caracteres).`);
      return;
    }
    setSaving(true);
    try {
      await axios.patch(
        `${API_URL}/sacraments/${editing.id}`,
        { ...payloadOf(editForm), ...(isRectification ? { rectificationReason: reason.trim() } : {}) },
        { headers: authHeader() },
      );
      setEditing(null);
      load();
    } catch (err: any) {
      setEditError(withLayHint(err, editForm.recordKind, apiMessage(err, 'Erro ao salvar')));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (s: Sacrament) => {
    const ok = await confirm.action(
      'Remover registro sacramental',
      `Remover o registro de ${SACRAMENT_LABELS[s.type]} de ${memberName}? Assento sacramental normalmente não se apaga — use a retificação. Remova só registro feito por engano.`,
      'Remover',
    );
    if (!ok) return;
    try {
      await axios.delete(`${API_URL}/sacraments/${s.id}`, { headers: authHeader() });
      load();
    } catch (err: any) {
      setError(apiMessage(err, 'Erro ao remover'));
    }
  };

  /** Campos do formulário (criação e edição compartilham o mesmo layout) */
  const renderFields = (
    data: SacramentForm,
    setData: (next: SacramentForm) => void,
    prefix: string,
  ) => (
    <>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor={`${prefix}-type`}>Tipo</label>
          <select
            id={`${prefix}-type`}
            value={data.type}
            onChange={(e) => setData({ ...data, type: e.target.value as SacramentType })}
          >
            {(Object.keys(SACRAMENT_LABELS) as SacramentType[]).map((t) => (
              <option key={t} value={t}>
                {SACRAMENT_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor={`${prefix}-date`}>Data</label>
          <DateInput id={`${prefix}-date`} required value={data.date} onChange={(value) => setData({ ...data, date: value })} />
        </div>
      </div>
      <div className="form-group">
        <label htmlFor={`${prefix}-kind`}>Registro</label>
        <select
          id={`${prefix}-kind`}
          value={data.recordKind}
          onChange={(e) => setData({ ...data, recordKind: e.target.value as RecordKind })}
        >
          <option value="INFORMED">Informado (recebido em outro lugar / sem livro) — não gera certidão</option>
          <option value="RECORD">Assento do livro de registro desta paróquia</option>
        </select>
        {role === 'COMMUNITY_COORDINATOR' && communityAllowsLayRecords !== true && (
          <small style={{ color: '#888' }}>
            Como coordenador, use "Informado" — o assento do livro só é aceito se a paróquia liberou esta comunidade.
          </small>
        )}
      </div>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor={`${prefix}-place`}>Local</label>
          <input
            id={`${prefix}-place`}
            type="text"
            maxLength={200}
            value={data.place}
            onChange={(e) => setData({ ...data, place: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label htmlFor={`${prefix}-minister`}>Ministro/celebrante</label>
          <input
            id={`${prefix}-minister`}
            type="text"
            maxLength={120}
            value={data.minister}
            onChange={(e) => setData({ ...data, minister: e.target.value })}
          />
        </div>
      </div>
      {data.recordKind === 'RECORD' && (
        <div className="form-row">
          <div className="form-group">
            <label htmlFor={`${prefix}-book`}>Livro</label>
            <input
              id={`${prefix}-book`}
              type="text"
              maxLength={40}
              value={data.book}
              onChange={(e) => setData({ ...data, book: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label htmlFor={`${prefix}-page`}>Folha</label>
            <input
              id={`${prefix}-page`}
              type="text"
              maxLength={40}
              value={data.page}
              onChange={(e) => setData({ ...data, page: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label htmlFor={`${prefix}-term`}>Termo</label>
            <input
              id={`${prefix}-term`}
              type="text"
              maxLength={40}
              value={data.term}
              onChange={(e) => setData({ ...data, term: e.target.value })}
            />
          </div>
        </div>
      )}
      <div className="form-group">
        <label htmlFor={`${prefix}-notes`}>Observações</label>
        <input
          id={`${prefix}-notes`}
          type="text"
          maxLength={2000}
          value={data.notes}
          onChange={(e) => setData({ ...data, notes: e.target.value })}
        />
      </div>
    </>
  );

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={`Sacramentos de ${memberName}`}>
      <div className="modal-content" style={{ maxWidth: 720 }}>
        <h2>Sacramentos — {memberName}</h2>
        <p style={{ fontSize: 13, color: '#666' }}>
          <strong>Assento</strong> é o registro do livro desta paróquia (com livro, folha e termo, gera certidão).
          {' '}<strong>Informado</strong> é o sacramento recebido em outro lugar, contado pela família — não gera certidão.
          {role === 'COMMUNITY_COORDINATOR' &&
            ' Registrar e emitir certidão como coordenador depende de a comunidade permitir (padrão: só a secretaria paroquial).'}
        </p>

        {error && <div className="error-message">{error}</div>}

        {loading ? (
          <p>Carregando...</p>
        ) : items.length === 0 ? (
          <p>Nenhum sacramento registrado.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Sacramento</th>
                <th style={{ textAlign: 'left' }}>Data</th>
                <th style={{ textAlign: 'left' }}>Local</th>
                <th style={{ textAlign: 'left' }}>Livro/folha/termo</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {items.map((s) => {
                const informed = kindOf(s) === 'INFORMED';
                return (
                  <tr key={s.id}>
                    <td>
                      {SACRAMENT_LABELS[s.type] ?? s.type}{' '}
                      {informed && (
                        <span
                          className="status-badge gray"
                          title="Informado pela família/pastoral, sem assento no livro desta paróquia — não gera certidão"
                          style={{ marginLeft: 4 }}
                        >
                          Informado
                        </span>
                      )}
                    </td>
                    <td>{formatCivilDate(s.date)}</td>
                    <td>{s.place || '-'}</td>
                    <td>
                      {informed
                        ? '—'
                        : [s.book && `L. ${s.book}`, s.page && `fl. ${s.page}`, s.term && `nº ${s.term}`]
                            .filter(Boolean)
                            .join(', ') || 'sem numeração'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {canRecord && !informed && (
                        <button
                          type="button"
                          className="btn-small"
                          onClick={() => setCertificateFor(s)}
                          title="Emitir certidão (ou declaração para conferência, se faltar livro/folha/termo)"
                        >
                          📄 Certidão
                        </button>
                      )}
                      {canRecord && (
                        <button
                          type="button"
                          className="btn-small"
                          style={{ marginLeft: 4 }}
                          onClick={() => openEdit(s)}
                          title={informed ? 'Editar o registro informado' : 'Retificar o assento (pede o motivo)'}
                        >
                          {informed ? 'Editar' : 'Retificar'}
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          className="btn-icon danger"
                          style={{ marginLeft: 4 }}
                          onClick={() => handleRemove(s)}
                          title="Remover (só administrador do sistema)"
                          aria-label={`Remover ${SACRAMENT_LABELS[s.type] ?? s.type}`}
                        >
                          🗑️
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {editing ? (
          <form onSubmit={handleSaveEdit}>
            <h3 style={{ fontSize: 15 }}>
              {kindOf(editing) === 'RECORD' ? 'Retificar assento' : 'Editar registro informado'} —{' '}
              {SACRAMENT_LABELS[editing.type] ?? editing.type}
            </h3>
            {renderFields(editForm, setEditForm, 'sac-edit')}
            {kindOf(editing) === 'RECORD' && (
              <div className="form-group">
                <label htmlFor="sac-edit-reason">
                  Motivo da retificação{isRectification ? ' *' : ''}
                </label>
                <textarea
                  id="sac-edit-reason"
                  rows={2}
                  maxLength={500}
                  required={isRectification}
                  minLength={isRectification ? RECTIFICATION_MIN : undefined}
                  placeholder="Ex.: data transcrita errada do livro; conferido no Livro 3, fl. 12"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <small style={{ color: '#888' }}>
                  Obrigatório (mín. {RECTIFICATION_MIN} caracteres) ao mudar tipo, data, local, ministro, livro, folha,
                  termo ou o tipo de registro. Fica no histórico de auditoria com o antes e o depois.
                </small>
              </div>
            )}
            {editError && <div className="error-message">{editError}</div>}
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setEditing(null)} disabled={saving}>
                Cancelar
              </button>
              <button type="submit" className="btn-submit" disabled={saving}>
                {saving ? 'Salvando…' : isRectification ? 'Salvar retificação' : 'Salvar'}
              </button>
            </div>
          </form>
        ) : canRecord ? (
          <form onSubmit={handleAdd}>
            <h3 style={{ fontSize: 15 }}>Registrar sacramento</h3>
            {renderFields(form, setForm, 'sac')}
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={onClose}>
                Fechar
              </button>
              <button type="submit" className="btn-submit" disabled={saving}>
                {saving ? 'Registrando…' : 'Registrar'}
              </button>
            </div>
          </form>
        ) : (
          <div className="modal-actions">
            <button type="button" className="btn-cancel" onClick={onClose}>
              Fechar
            </button>
          </div>
        )}
      </div>

      {certificateFor && (
        <SacramentCertificateDialog
          path={`/sacraments/${certificateFor.id}/certificate.pdf`}
          personName={certificateFor.personName || memberName}
          sacramentLabel={SACRAMENT_LABELS[certificateFor.type] ?? certificateFor.type}
          hasNumbering={hasNumbering(certificateFor)}
          onClose={() => setCertificateFor(null)}
        />
      )}
    </div>
  );
};

export default SacramentsModal;

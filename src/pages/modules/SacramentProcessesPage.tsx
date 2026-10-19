import React, { useState, useEffect, useCallback } from 'react';
import TitleIcon from '../../components/TitleIcon';
import { DateInput } from '../../components/DateInput';
import SacramentCertificateDialog from '../../components/SacramentCertificateDialog';
import api, { getErrorMessage } from '../../services/api';
import { formatCivilDate } from '../../utils/dateFormat';
import { notify } from '../../services/notification.service';
import './ModulePages.css';

interface ChecklistItem {
  label: string;
  done: boolean;
}

interface SacramentProcess {
  id: string;
  type: string;
  status: string;
  scheduledDate?: string | null;
  celebrant?: string | null;
  documentsChecklist?: ChecklistItem[] | null;
  member: { id: string; fullName: string };
  communityId: string;
  /** Assento gerado na celebração + numeração (livro/folha/termo) */
  sacramentId?: string | null;
  book?: string | null;
  page?: string | null;
  term?: string | null;
}

/** Certidão só com livro + folha + termo e assento gravado; senão sai a declaração para conferência */
const hasNumbering = (process: SacramentProcess) =>
  !!(process.sacramentId && process.book?.trim() && process.page?.trim() && process.term?.trim());

interface Community {
  id: string;
  name: string;
}

interface Member {
  id: string;
  fullName: string;
}

const SACRAMENT_LABELS: Record<string, string> = {
  BAPTISM: 'Batismo',
  FIRST_COMMUNION: 'Primeira Eucaristia',
  CONFIRMATION: 'Crisma',
  MARRIAGE: 'Matrimônio',
  HOLY_ORDERS: 'Ordem',
  ANOINTING_OF_THE_SICK: 'Unção dos Enfermos',
};

const COLUMNS: Array<{ status: string; label: string }> = [
  { status: 'REQUESTED', label: 'Solicitado' },
  { status: 'DOCUMENTS', label: 'Documentos' },
  { status: 'COURSE', label: 'Preparação' },
  { status: 'SCHEDULED', label: 'Agendado' },
  { status: 'CELEBRATED', label: 'Celebrado' },
  { status: 'CANCELLED', label: 'Cancelado' },
];

const NEXT_STATUS: Record<string, string | null> = {
  REQUESTED: 'DOCUMENTS',
  DOCUMENTS: 'COURSE',
  COURSE: 'SCHEDULED',
  SCHEDULED: null, // avança via "Celebrar"
  CELEBRATED: null,
  CANCELLED: null,
};

/** Decisão sobre o sacramento já INFORMADO (409 SACRAMENT_INFORMED_DECISION_REQUIRED do celebrate) */
const INFORMED_DECISION_REQUIRED = 'SACRAMENT_INFORMED_DECISION_REQUIRED';
type InformedResolution = 'RECORD_INFORMED' | 'CONDITIONAL';
const INFORMED_RESOLUTION_LABELS: Record<InformedResolution, string> = {
  RECORD_INFORMED: 'Lavrar o assento sobre o registro informado',
  CONDITIONAL: 'Celebrar sob condição (cân. 845 §2 e 869)',
};
const DECISION_REASON_MIN = 10;

const SacramentProcessesPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [processes, setProcesses] = useState<SacramentProcess[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ type: 'BAPTISM', memberId: '', communityId: '', scheduledDate: '', celebrant: '' });

  const [checklistProcess, setChecklistProcess] = useState<SacramentProcess | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [newItem, setNewItem] = useState('');

  const [celebrateProcess, setCelebrateProcess] = useState<SacramentProcess | null>(null);
  const [celebrateForm, setCelebrateForm] = useState({ date: '', minister: '', book: '', page: '', term: '', place: '' });
  /**
   * 409 SACRAMENT_INFORMED_DECISION_REQUIRED: o membro já tem o sacramento
   * irrepetível só INFORMADO. O servidor manda a mensagem e as opções; a
   * celebração é reenviada com a decisão (`informedResolution`) e o motivo.
   */
  const [informedDecision, setInformedDecision] = useState<{ message: string; options: InformedResolution[] } | null>(
    null,
  );
  const [decisionChoice, setDecisionChoice] = useState<InformedResolution | ''>('');
  const [decisionReason, setDecisionReason] = useState('');
  const [decisionError, setDecisionError] = useState('');
  const [celebrating, setCelebrating] = useState(false);

  /** Fecha o modal de celebração e limpa a decisão pendente */
  const closeCelebrate = () => {
    setCelebrateProcess(null);
    setInformedDecision(null);
    setDecisionChoice('');
    setDecisionReason('');
    setDecisionError('');
  };

  // Certidão (2ª via) com finalidade opcional
  const [certificateProcess, setCertificateProcess] = useState<SacramentProcess | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [processesRes, communitiesRes, membersRes] = await Promise.all([
        api.get('/sacrament-processes'),
        api.get('/communities'),
        api.get('/members'),
      ]);
      setProcesses(processesRes.data);
      setCommunities(communitiesRes.data);
      setMembers(membersRes.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar processos'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/sacrament-processes', {
        type: createForm.type,
        memberId: createForm.memberId,
        communityId: createForm.communityId,
        // Data civil AAAA-MM-DD: o backend ancora no fuso de Brasília
        scheduledDate: createForm.scheduledDate || undefined,
        celebrant: createForm.celebrant || undefined,
      });
      notify.success('Processo aberto!');
      setShowCreateModal(false);
      setCreateForm({ type: 'BAPTISM', memberId: '', communityId: '', scheduledDate: '', celebrant: '' });
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao abrir processo'));
    }
  };

  const handleStatus = async (process: SacramentProcess, status: string) => {
    try {
      await api.patch(`/sacrament-processes/${process.id}/status`, { status });
      notify.success('Etapa atualizada!');
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao atualizar etapa'));
    }
  };

  const openChecklist = (process: SacramentProcess) => {
    setChecklistProcess(process);
    setChecklist(Array.isArray(process.documentsChecklist) ? process.documentsChecklist : []);
    setNewItem('');
  };

  const handleSaveChecklist = async () => {
    if (!checklistProcess) return;
    try {
      await api.patch(`/sacrament-processes/${checklistProcess.id}/checklist`, { documentsChecklist: checklist });
      notify.success('Checklist salvo!');
      setChecklistProcess(null);
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao salvar checklist'));
    }
  };

  const handleCelebrate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!celebrateProcess || celebrating) return;
    setDecisionError('');
    // Decisão pedida pelo servidor: opção e motivo obrigatórios antes de reenviar
    if (informedDecision) {
      if (!decisionChoice) {
        setDecisionError('Escolha uma das opções.');
        return;
      }
      if (decisionReason.trim().length < DECISION_REASON_MIN) {
        setDecisionError(`Informe o motivo (pelo menos ${DECISION_REASON_MIN} caracteres).`);
        return;
      }
    }
    setCelebrating(true);
    try {
      await api.patch(`/sacrament-processes/${celebrateProcess.id}/celebrate`, {
        date: celebrateForm.date || undefined,
        minister: celebrateForm.minister || undefined,
        book: celebrateForm.book || undefined,
        page: celebrateForm.page || undefined,
        term: celebrateForm.term || undefined,
        place: celebrateForm.place || undefined,
        ...(informedDecision && decisionChoice
          ? { informedResolution: decisionChoice, resolutionReason: decisionReason.trim() }
          : {}),
      });
      notify.success('Sacramento celebrado e registrado no livro!');
      closeCelebrate();
      setCelebrateForm({ date: '', minister: '', book: '', page: '', term: '', place: '' });
      fetchData();
    } catch (error: any) {
      const data = error?.response?.data;
      if (error?.response?.status === 409 && data?.code === INFORMED_DECISION_REQUIRED) {
        const options: InformedResolution[] = (Array.isArray(data.options) ? data.options : []).filter(
          (option: unknown): option is InformedResolution =>
            typeof option === 'string' && option in INFORMED_RESOLUTION_LABELS,
        );
        setInformedDecision({ message: getErrorMessage(error, 'Decisão necessária para celebrar.'), options });
        // Opção que deixou de valer (ex.: batismo de outra denominação só aceita "sob condição")
        setDecisionChoice((current) =>
          current && options.includes(current) ? current : options.length === 1 ? options[0] : '',
        );
        return;
      }
      if (informedDecision) setDecisionError(getErrorMessage(error, 'Erro ao registrar celebração'));
      else notify.error(getErrorMessage(error, 'Erro ao registrar celebração'));
    } finally {
      setCelebrating(false);
    }
  };

  const checklistProgress = (process: SacramentProcess) => {
    const items = Array.isArray(process.documentsChecklist) ? process.documentsChecklist : [];
    if (!items.length) return null;
    const done = items.filter((i) => i.done).length;
    return `${done}/${items.length} docs`;
  };

  if (loading) return <div className="module-page"><div className="loading">Carregando...</div></div>;

  return (
    <div className="module-page">
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center' }}><TitleIcon name="cruz" /> Preparação de Sacramentos</h1>
        <div className="header-actions">
          <button className="btn-primary" onClick={() => setShowCreateModal(true)}>+ Novo Processo</button>
        </div>
      </div>

      <div className="kanban">
        {COLUMNS.map((column) => {
          const cards = processes.filter((p) => p.status === column.status);
          return (
            <div key={column.status} className="kanban-column">
              <h4>{column.label} <span>{cards.length}</span></h4>
              {cards.map((process) => (
                <div key={process.id} className="kanban-card">
                  <strong>{process.member.fullName}</strong>
                  <span className="status-badge blue">{SACRAMENT_LABELS[process.type] ?? process.type}</span>
                  {process.scheduledDate && (
                    <p style={{ margin: '0.3rem 0 0 0', color: '#666' }}>
                      📅 {formatCivilDate(process.scheduledDate)}
                    </p>
                  )}
                  {checklistProgress(process) && (
                    <p style={{ margin: '0.3rem 0 0 0', color: '#666' }}>📋 {checklistProgress(process)}</p>
                  )}
                  <div className="kanban-actions">
                    {process.status !== 'CELEBRATED' && process.status !== 'CANCELLED' && (
                      <>
                        <button className="btn-small" onClick={() => openChecklist(process)}>Docs</button>
                        {NEXT_STATUS[process.status] && (
                          <button className="btn-small" onClick={() => handleStatus(process, NEXT_STATUS[process.status]!)}>
                            Avançar →
                          </button>
                        )}
                        {process.status === 'SCHEDULED' && (
                          <button className="btn-small success" onClick={() => setCelebrateProcess(process)}>Celebrar</button>
                        )}
                        <button className="btn-small danger" onClick={() => handleStatus(process, 'CANCELLED')}>Cancelar</button>
                      </>
                    )}
                    {process.status === 'CELEBRATED' && (
                      <button
                        className="btn-small"
                        onClick={() => setCertificateProcess(process)}
                        title={hasNumbering(process) ? 'Emitir a certidão' : 'Sem livro/folha/termo: sai a declaração para conferência'}
                      >
                        📄 {hasNumbering(process) ? 'Certidão (2ª via)' : 'Declaração'}
                      </button>
                    )}
                    {process.status === 'CANCELLED' && (
                      <button className="btn-small" onClick={() => handleStatus(process, 'REQUESTED')}>Reabrir</button>
                    )}
                  </div>
                </div>
              ))}
              {cards.length === 0 && <p style={{ color: '#999', fontSize: '0.85rem', textAlign: 'center' }}>vazio</p>}
            </div>
          );
        })}
      </div>

      {showCreateModal && (
        <div className="module-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Novo Processo de Sacramento</h2>
            <form onSubmit={handleCreate}>
              <div className="form-row">
                <div className="form-group">
                  <label>Sacramento *</label>
                  <select value={createForm.type} onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })}>
                    {Object.entries(SACRAMENT_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Comunidade *</label>
                  <select required value={createForm.communityId} onChange={(e) => setCreateForm({ ...createForm, communityId: e.target.value })}>
                    <option value="">Selecione</option>
                    {communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Membro *</label>
                <select required value={createForm.memberId} onChange={(e) => setCreateForm({ ...createForm, memberId: e.target.value })}>
                  <option value="">Selecione</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Data prevista</label>
                  <DateInput value={createForm.scheduledDate} onChange={(value) => setCreateForm({ ...createForm, scheduledDate: value })} />
                </div>
                <div className="form-group">
                  <label>Celebrante</label>
                  <input type="text" placeholder="Ex.: Pe. João" value={createForm.celebrant} onChange={(e) => setCreateForm({ ...createForm, celebrant: e.target.value })} />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowCreateModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Abrir processo</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {checklistProcess && (
        <div className="module-modal-overlay" onClick={() => setChecklistProcess(null)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Checklist de documentos — {checklistProcess.member.fullName}</h2>
            <div className="checklist" style={{ marginBottom: '1rem' }}>
              {checklist.map((item, index) => (
                <label key={index}>
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={(e) => {
                      const next = [...checklist];
                      next[index] = { ...item, done: e.target.checked };
                      setChecklist(next);
                    }}
                  />
                  {item.label}
                  <button
                    type="button"
                    className="btn-small danger"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => setChecklist(checklist.filter((_, i) => i !== index))}
                  >
                    remover
                  </button>
                </label>
              ))}
              {checklist.length === 0 && <p style={{ color: '#888' }}>Nenhum documento no checklist (ex.: certidão de nascimento, comprovante de batismo...).</p>}
            </div>
            <div className="inline-form" style={{ marginBottom: '1rem' }}>
              <input
                type="text"
                style={{ flex: 1 }}
                placeholder="Novo documento exigido"
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
              />
              <button
                type="button"
                className="btn-small success"
                onClick={() => {
                  if (!newItem.trim()) return;
                  setChecklist([...checklist, { label: newItem.trim(), done: false }]);
                  setNewItem('');
                }}
              >
                Adicionar
              </button>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setChecklistProcess(null)}>Cancelar</button>
              <button type="button" className="btn-submit" onClick={handleSaveChecklist}>Salvar checklist</button>
            </div>
          </div>
        </div>
      )}

      {celebrateProcess && (
        <div className="module-modal-overlay" onClick={closeCelebrate}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Celebrar {SACRAMENT_LABELS[celebrateProcess.type] ?? celebrateProcess.type} — {celebrateProcess.member.fullName}</h2>
            <p style={{ color: '#666', marginTop: '-0.75rem', marginBottom: '1rem', fontSize: '0.9rem' }}>
              Gera o registro sacramental oficial com numeração de livro/folha/termo e habilita a certidão em PDF.
            </p>
            <form onSubmit={handleCelebrate}>
              <div className="form-row">
                <div className="form-group">
                  <label>Data da celebração</label>
                  <DateInput value={celebrateForm.date} onChange={(value) => setCelebrateForm({ ...celebrateForm, date: value })} />
                </div>
                <div className="form-group">
                  <label>Ministro</label>
                  <input type="text" placeholder="Ex.: Pe. João" value={celebrateForm.minister} onChange={(e) => setCelebrateForm({ ...celebrateForm, minister: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Livro</label>
                  <input type="text" value={celebrateForm.book} onChange={(e) => setCelebrateForm({ ...celebrateForm, book: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Folha</label>
                  <input type="text" value={celebrateForm.page} onChange={(e) => setCelebrateForm({ ...celebrateForm, page: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Termo</label>
                  <input type="text" value={celebrateForm.term} onChange={(e) => setCelebrateForm({ ...celebrateForm, term: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Local</label>
                  <input type="text" value={celebrateForm.place} onChange={(e) => setCelebrateForm({ ...celebrateForm, place: e.target.value })} />
                </div>
              </div>
              {informedDecision && (
                <div
                  role="alert"
                  style={{ border: '1px solid #e0b252', background: '#fff8e6', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem' }}
                >
                  <p style={{ margin: '0 0 0.75rem', color: '#5c4400', fontSize: '0.9rem' }}>{informedDecision.message}</p>
                  {informedDecision.options.length > 0 ? (
                    <>
                      <div className="form-group">
                        <label>Como prosseguir *</label>
                        {informedDecision.options.map((option) => (
                          <label key={option} style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 'normal' }}>
                            <input
                              type="radio"
                              name="informed-resolution"
                              value={option}
                              checked={decisionChoice === option}
                              onChange={() => setDecisionChoice(option)}
                              style={{ width: 'auto' }}
                            />
                            {INFORMED_RESOLUTION_LABELS[option]}
                          </label>
                        ))}
                      </div>
                      <div className="form-group">
                        <label htmlFor="informed-resolution-reason">Motivo *</label>
                        <textarea
                          id="informed-resolution-reason"
                          rows={2}
                          maxLength={500}
                          required
                          minLength={DECISION_REASON_MIN}
                          placeholder="Ex.: assento conferido no Livro 3, fl. 12, nunca lavrado no sistema"
                          value={decisionReason}
                          onChange={(e) => setDecisionReason(e.target.value)}
                        />
                        <small style={{ color: '#888' }}>
                          Obrigatório (mín. {DECISION_REASON_MIN} caracteres). Fica no histórico de auditoria.
                        </small>
                      </div>
                    </>
                  ) : (
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#5c4400' }}>
                      Nenhuma opção disponível: cancele o processo.
                    </p>
                  )}
                  {decisionError && <div className="error-message">{decisionError}</div>}
                </div>
              )}
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={closeCelebrate}>Cancelar</button>
                <button
                  type="submit"
                  className="btn-submit"
                  disabled={celebrating || (!!informedDecision && informedDecision.options.length === 0)}
                >
                  {celebrating ? 'Registrando…' : informedDecision ? 'Confirmar e registrar' : 'Registrar celebração'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {certificateProcess && (
        <SacramentCertificateDialog
          path={`/sacrament-processes/${certificateProcess.id}/certificate.pdf`}
          personName={certificateProcess.member.fullName}
          sacramentLabel={SACRAMENT_LABELS[certificateProcess.type] ?? certificateProcess.type}
          hasNumbering={hasNumbering(certificateProcess)}
          onClose={() => setCertificateProcess(null)}
        />
      )}
    </div>
  );
};

export default SacramentProcessesPage;

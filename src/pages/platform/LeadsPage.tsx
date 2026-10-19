import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import TitleIcon from '../../components/TitleIcon';
import api from '../../services/api';
import { notify } from '../../services/notification.service';
import { formatPhoneDisplay, whatsappNumber } from '../../utils/phone';
import { useDebouncedValue } from '../../utils/useDebouncedValue';
import { dataHoraBR, haQuanto, mensagemDeErro } from './platformShared';
import '../modules/ModulePages.css';
import './PlatformPages.css';

/**
 * Leads (saas-implantacao-18): paróquias interessadas — pedido de
 * demonstração do site, reivindicações e contatos manuais. Lista com filtro
 * por situação; a situação e as notas são editadas aqui (PATCH).
 */

type LeadStatus = 'NEW' | 'CONTACTED' | 'DEMO_SCHEDULED' | 'WON' | 'LOST';

interface Lead {
  id: string;
  source: string;
  status: LeadStatus;
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  parishName?: string | null;
  city?: string | null;
  state?: string | null;
  parishId?: string | null;
  /** Paróquia do território ligada ao lead (managed = já tem gestão no Parish) */
  parish?: { id: string; name: string; city?: string | null; state?: string | null; managed?: boolean } | null;
  message?: string | null;
  notes?: string | null;
  consentAt?: string | null;
  createdAt: string;
  updatedAt?: string;
}

const STATUS: LeadStatus[] = ['NEW', 'CONTACTED', 'DEMO_SCHEDULED', 'WON', 'LOST'];
const STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: 'Novo',
  CONTACTED: 'Contatado',
  DEMO_SCHEDULED: 'Demonstração marcada',
  WON: 'Virou cliente',
  LOST: 'Perdido',
};
const STATUS_TONE: Record<LeadStatus, string> = { NEW: 'yellow', CONTACTED: 'blue', DEMO_SCHEDULED: 'blue', WON: 'green', LOST: 'gray' };
const SOURCE_LABEL: Record<string, string> = {
  DEMO_REQUEST: 'Pedido de demonstração',
  CLAIM: 'Reivindicação',
  SITE: 'Site',
  SUGGESTION: 'Sugestão',
  MANUAL: 'Manual',
};

const asList = (data: any): Lead[] => {
  const arr = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  return arr.filter((l: any) => l && typeof l.id === 'string');
};

const PAGE = 50;

const LeadsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const inicial = searchParams.get('status');
  const [status, setStatus] = useState<LeadStatus | ''>(inicial && (STATUS as string[]).includes(inicial) ? (inicial as LeadStatus) : '');
  const [lista, setLista] = useState<Lead[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [contagens, setContagens] = useState<Partial<Record<LeadStatus, number>>>({});
  const [busca, setBusca] = useState('');
  const buscaDebounced = useDebouncedValue(busca.trim(), 400);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [editando, setEditando] = useState<{ lead: Lead; status: LeadStatus; notes: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  /** Primeira página (ou a próxima, com `mais`), já ordenada do mais novo para o mais antigo. */
  const carregar = useCallback(
    async (mais = false) => {
      setCarregando(true);
      setErro('');
      try {
        const { data } = await api.get('/platform/leads', {
          params: {
            ...(status ? { status } : {}),
            ...(buscaDebounced ? { search: buscaDebounced } : {}),
            limit: PAGE,
            offset: mais ? lista.length : 0,
          },
        });
        const novos = asList(data);
        setLista((prev) => (mais ? [...prev, ...novos.filter((n) => !prev.some((p) => p.id === n.id))] : novos));
        setTotal(typeof data?.total === 'number' ? data.total : null);
        if (data?.counts && typeof data.counts === 'object') setContagens(data.counts);
      } catch (e) {
        if (!mais) setLista([]);
        setErro(mensagemDeErro(e, 'Não foi possível carregar os leads.'));
      } finally {
        setCarregando(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, buscaDebounced],
  );

  useEffect(() => {
    void carregar(false);
  }, [carregar]);

  const filtrar = (s: LeadStatus | '') => {
    setStatus(s);
    const next = new URLSearchParams(searchParams);
    if (s) next.set('status', s);
    else next.delete('status');
    setSearchParams(next, { replace: true });
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editando) return;
    setSalvando(true);
    try {
      const body: { status?: LeadStatus; notes?: string } = {};
      if (editando.status !== editando.lead.status) body.status = editando.status;
      if (editando.notes.trim() !== (editando.lead.notes ?? '').trim()) body.notes = editando.notes.trim();
      if (Object.keys(body).length === 0) {
        setEditando(null);
        return;
      }
      const { data } = await api.patch(`/platform/leads/${encodeURIComponent(editando.lead.id)}`, body);
      const atualizado: Lead = data && typeof data === 'object' && typeof data.id === 'string' ? data : { ...editando.lead, ...body };
      setLista((prev) =>
        prev
          .map((l) => (l.id === atualizado.id ? { ...l, ...atualizado } : l))
          // Saiu do filtro atual: some da lista
          .filter((l) => !status || l.status === status),
      );
      notify.success('Lead atualizado.');
      setEditando(null);
    } catch (err) {
      notify.error(mensagemDeErro(err, 'Não foi possível salvar o lead.'));
    } finally {
      setSalvando(false);
    }
  };

  /** Troca rápida de situação direto na linha. */
  const mudarStatus = async (lead: Lead, s: LeadStatus) => {
    if (s === lead.status) return;
    try {
      await api.patch(`/platform/leads/${encodeURIComponent(lead.id)}`, { status: s });
      setLista((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status: s } : l)).filter((l) => !status || l.status === status));
    } catch (err) {
      notify.error(mensagemDeErro(err, 'Não foi possível mudar a situação.'));
    }
  };

  return (
    <div className="module-page platform-page">
      <div className="page-header">
        <h1>
          <TitleIcon name="membros" /> Leads
        </h1>
        <div className="header-actions">
          <button type="button" className="pf-btn" onClick={() => void carregar(false)} disabled={carregando}>
            {carregando ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </div>
      <p className="pf-nota">Paróquias interessadas. Só entre em contato com quem autorizou (o pedido do site exige o consentimento).</p>

      <div className="pf-filtros">
        <div className="pf-chips" role="group" aria-label="Situação">
          <button type="button" className={`pf-chip${status === '' ? ' on' : ''}`} aria-pressed={status === ''} onClick={() => filtrar('')}>
            Todos
          </button>
          {STATUS.map((s) => (
            <button key={s} type="button" className={`pf-chip${status === s ? ' on' : ''}`} aria-pressed={status === s} onClick={() => filtrar(s)}>
              {STATUS_LABEL[s]}
              {typeof contagens[s] === 'number' ? ` (${contagens[s]})` : ''}
            </button>
          ))}
        </div>
        <div className="pf-busca">
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar nome, e-mail, paróquia, cidade ou telefone"
            aria-label="Buscar leads"
            maxLength={80}
          />
        </div>
      </div>

      {erro && (
        <p className="pf-erro">
          {erro}{' '}
          <button type="button" className="pf-link" onClick={() => void carregar(false)}>
            tentar de novo
          </button>
        </p>
      )}

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Quando</th>
              <th scope="col">Quem</th>
              <th scope="col">Contato</th>
              <th scope="col">Paróquia</th>
              <th scope="col">Origem</th>
              <th scope="col">Situação</th>
              <th scope="col" aria-label="Ações" />
            </tr>
          </thead>
          <tbody>
            {carregando && lista.length === 0 && (
              <tr>
                <td colSpan={7} className="pf-vazio">
                  Carregando…
                </td>
              </tr>
            )}
            {!carregando && lista.length === 0 && (
              <tr>
                <td colSpan={7} className="pf-vazio">
                  Nenhum lead nesta situação.
                </td>
              </tr>
            )}
            {lista.map((l) => {
              const wa = whatsappNumber(l.phone);
              return (
                <tr key={l.id}>
                  <td title={dataHoraBR(l.createdAt)}>
                    {haQuanto(l.createdAt)}
                    <span className="pf-sub">{dataHoraBR(l.createdAt)}</span>
                  </td>
                  <td>
                    <strong className="pf-nome">{l.name}</strong>
                    {l.role && <span className="pf-sub">{l.role}</span>}
                    {l.message && (
                      <span className="pf-sub pf-lead-msg" title={l.message}>
                        “{l.message}”
                      </span>
                    )}
                    {l.notes && <span className="pf-sub pf-lead-nota">Nota: {l.notes}</span>}
                  </td>
                  <td>
                    {l.email && (
                      <a href={`mailto:${l.email}`} className="pf-sub">
                        {l.email}
                      </a>
                    )}
                    {l.phone &&
                      (wa ? (
                        <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="pf-sub">
                          {formatPhoneDisplay(l.phone)}
                        </a>
                      ) : (
                        <span className="pf-sub">{formatPhoneDisplay(l.phone)}</span>
                      ))}
                    {!l.consentAt && <span className="pf-sub pf-urgente">sem consentimento registrado</span>}
                  </td>
                  <td>
                    {l.parish?.name ?? l.parishName ?? '—'}
                    {(l.parish?.city || l.city || l.state) && (
                      <span className="pf-sub">
                        {[l.parish?.city ?? l.city, l.parish?.state ?? l.state].filter(Boolean).join('/')}
                      </span>
                    )}
                    {l.parish && <span className="pf-sub">{l.parish.managed ? 'já usa o Parish' : 'no território, sem gestão'}</span>}
                  </td>
                  <td>{SOURCE_LABEL[l.source] ?? l.source}</td>
                  <td>
                    <select
                      aria-label={`Situação de ${l.name}`}
                      className={`pf-lead-status status-badge ${STATUS_TONE[l.status] ?? 'gray'}`}
                      value={l.status}
                      onChange={(e) => void mudarStatus(l, e.target.value as LeadStatus)}
                    >
                      {STATUS.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="pf-direita">
                    <button type="button" className="pf-btn pf-btn-mini" onClick={() => setEditando({ lead: l, status: l.status, notes: l.notes ?? '' })}>
                      Notas
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {total !== null && lista.length < total && (
        <div className="pf-paginacao">
          <span className="pf-mudo">
            {lista.length} de {total}
          </span>
          <button type="button" className="pf-btn pf-btn-mini" onClick={() => void carregar(true)} disabled={carregando}>
            {carregando ? 'Carregando…' : 'Carregar mais'}
          </button>
        </div>
      )}

      {editando && (
        <div className="module-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && !salvando && setEditando(null)}>
          <form className="module-modal" onSubmit={salvar} role="dialog" aria-modal="true" aria-labelledby="pf-lead-titulo">
            <h2 id="pf-lead-titulo">{editando.lead.name}</h2>
            <div className="form-group">
              <label htmlFor="pf-lead-status">Situação</label>
              <select id="pf-lead-status" value={editando.status} onChange={(e) => setEditando({ ...editando, status: e.target.value as LeadStatus })}>
                {STATUS.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="pf-lead-notas">Notas (próximo passo, motivo da perda...)</label>
              <textarea id="pf-lead-notas" rows={5} maxLength={2000} value={editando.notes} onChange={(e) => setEditando({ ...editando, notes: e.target.value })} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setEditando(null)} disabled={salvando}>
                Cancelar
              </button>
              <button type="submit" className="btn-submit" disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default LeadsPage;

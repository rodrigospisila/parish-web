import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import TitleIcon from '../../components/TitleIcon';
import api, { getErrorMessage } from '../../services/api';
import { notify, confirm } from '../../services/notification.service';
import { useAuth } from '../../contexts/AuthContext';
import { useCoordinatedPastoralIds } from '../../hooks/useCoordinatedPastoralIds';
import './ModulePages.css';

interface SwapRow {
  id: string;
  status: string;
  message?: string | null;
  createdAt: string;
  requesterName?: string | null;
  /** Convidado (troca direcionada); null = troca ABERTA à pastoral */
  targetId?: string | null;
  targetName?: string | null;
  assignment?: {
    role: string;
    communityPastoralId?: string | null;
    schedule?: { id: string; title: string; date: string } | null;
  } | null;
}

interface MyAssignment {
  id: string;
  role: string;
  status: string;
  schedule: { id: string; title: string; date: string };
}

/** Quem pode receber o convite de troca desta escala (GET /swaps/candidates) */
interface SwapCandidate {
  memberId: string;
  fullName: string;
}

/**
 * Estado da lista de convidáveis: 'unavailable' = servidor antigo (rota não
 * existe) — some o "Convidar alguém" e fica só "Deixar aberto à pastoral".
 */
type CandidatesState = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

const SWAP_STATUS: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Pendente', color: 'yellow' },
  ACCEPTED: { label: 'Aceita', color: 'green' },
  REJECTED: { label: 'Recusada', color: 'red' },
  CANCELLED: { label: 'Cancelada', color: 'gray' },
  EXPIRED: { label: 'Expirada', color: 'gray' },
};

/** Papéis com escopo para moderar qualquer troca das escalas que alcançam */
const SWAP_MODERATOR_ROLES = ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN', 'COMMUNITY_COORDINATOR'];

const SwapsPage: React.FC = () => {
  const { user } = useAuth();
  const coordinatedIds = useCoordinatedPastoralIds();
  const [loading, setLoading] = useState(true);
  const [requested, setRequested] = useState<SwapRow[]>([]);
  const [invited, setInvited] = useState<SwapRow[]>([]);
  const [hasMemberRecord, setHasMemberRecord] = useState(true);
  const [myAssignments, setMyAssignments] = useState<MyAssignment[]>([]);
  const [candidates, setCandidates] = useState<SwapCandidate[]>([]);
  const [candidatesState, setCandidatesState] = useState<CandidatesState>('idle');

  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestForm, setRequestForm] = useState({ assignmentId: '', targetMemberId: '', message: '' });

  const fetchData = useCallback(async () => {
    try {
      const [swapsRes, mineRes] = await Promise.all([
        api.get('/swaps/mine'),
        api.get('/schedules/my-assignments'),
      ]);
      setRequested(swapsRes.data.requested ?? []);
      setInvited(swapsRes.data.invited ?? []);
      setHasMemberRecord(Boolean(swapsRes.data.memberId));
      setMyAssignments(mineRes.data.upcoming ?? []);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar trocas'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Convidáveis dependem da escala escolhida (mesma pastoral/função). GET /members
  // não serve: para o fiel ele devolve só o próprio cadastro.
  useEffect(() => {
    const assignmentId = requestForm.assignmentId;
    setCandidates([]);
    if (!assignmentId) {
      setCandidatesState((current) => (current === 'unavailable' ? current : 'idle'));
      return;
    }
    let alive = true;
    setCandidatesState((current) => (current === 'unavailable' ? current : 'loading'));
    api
      .get<SwapCandidate[]>('/swaps/candidates', { params: { assignmentId } })
      .then(({ data }) => {
        if (!alive) return;
        setCandidates((Array.isArray(data) ? data : []).filter((c) => c?.memberId && c?.fullName));
        setCandidatesState('ready');
      })
      .catch((error) => {
        if (!alive) return;
        setCandidatesState(axios.isAxiosError(error) && error.response?.status === 404 ? 'unavailable' : 'error');
      });
    return () => {
      alive = false;
    };
  }, [requestForm.assignmentId]);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/swaps', {
        assignmentId: requestForm.assignmentId,
        targetMemberId: requestForm.targetMemberId || undefined,
        message: requestForm.message || undefined,
      });
      notify.success('Pedido de troca enviado!');
      setShowRequestModal(false);
      setRequestForm({ assignmentId: '', targetMemberId: '', message: '' });
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao pedir troca'));
    }
  };

  const act = async (swapId: string, action: 'accept' | 'reject' | 'cancel') => {
    const messages = { accept: 'Troca aceita — a escala agora é sua!', reject: 'Convite recusado.', cancel: 'Pedido cancelado.' };
    try {
      await api.patch(`/swaps/${swapId}/${action}`);
      notify.success(messages[action]);
      fetchData();
    } catch (error: any) {
      // Conflito global: você já serve em outra escala no mesmo dia/horário
      if (
        action === 'accept' &&
        error?.response?.status === 409 &&
        error?.response?.data?.code === 'GLOBAL_CONFLICT'
      ) {
        const proceed = await confirm.action(
          '⚠ Você já está escalado neste dia',
          `${error.response.data.message || 'Conflito de agenda detectado.'} Aceitar a troca mesmo assim?`,
          'Aceitar mesmo assim',
        );
        if (proceed) {
          try {
            await api.patch(`/swaps/${swapId}/accept`, { overrideConflict: true });
            notify.success(messages.accept);
            fetchData();
          } catch (retryError) {
            notify.error(getErrorMessage(retryError, 'Não foi possível aceitar a troca'));
          }
        }
        return;
      }
      notify.error(getErrorMessage(error, 'Não foi possível concluir — verifique conflitos de horário'));
    }
  };

  /**
   * Recusar (regra do backend): o CONVIDADO da troca direcionada ou a
   * coordenação com escopo. Troca ABERTA recusada por fiel dá 403 — para ele
   * basta não assumir a escala.
   */
  const canReject = (swap: SwapRow) => {
    if (swap.targetId) return true; // em "Convites para mim", troca direcionada = convite para mim
    if (SWAP_MODERATOR_ROLES.includes(user?.role ?? '')) return true;
    const pastoralId = swap.assignment?.communityPastoralId;
    return user?.role === 'PASTORAL_COORDINATOR' && !!pastoralId && !!coordinatedIds?.has(pastoralId);
  };

  const formatDateTime = (value?: string) =>
    value ? new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  const scheduleLabel = (swap: SwapRow) => {
    const schedule = swap.assignment?.schedule;
    if (!schedule) return '(escala removida)';
    return `${schedule.title} — ${formatDateTime(schedule.date)}${swap.assignment?.role ? ` · ${swap.assignment.role}` : ''}`;
  };

  if (loading) return <div className="module-page"><div className="loading">Carregando...</div></div>;

  return (
    <div className="module-page">
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center' }}><TitleIcon name="trocas-escala" /> Trocas de Escala</h1>
        <div className="header-actions">
          <button className="btn-primary" onClick={() => setShowRequestModal(true)} disabled={!hasMemberRecord}>
            + Pedir troca
          </button>
        </div>
      </div>

      {!hasMemberRecord && (
        <div className="privacy-note">
          Seu usuário ainda não está vinculado a um cadastro de membro — peça à secretaria para vincular
          e você poderá pedir e aceitar trocas.
        </div>
      )}

      <div className="detail-section" style={{ marginBottom: '2rem' }}>
        <h4 style={{ color: '#555', textTransform: 'uppercase', fontSize: '0.9rem' }}>Convites para mim / abertos à pastoral</h4>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr><th>Escala</th><th>Quem pediu</th><th>Mensagem</th><th>Status</th><th>Ações</th></tr>
            </thead>
            <tbody>
              {invited.map((swap) => {
                const st = SWAP_STATUS[swap.status] ?? { label: swap.status, color: 'gray' };
                return (
                  <tr key={swap.id}>
                    <td><strong>{scheduleLabel(swap)}</strong></td>
                    <td>{swap.requesterName ?? '—'}</td>
                    <td>{swap.message || '—'}</td>
                    <td><span className={`status-badge ${st.color}`}>{st.label}</span></td>
                    <td className="actions-cell">
                      {swap.status === 'PENDING' && (
                        <>
                          <button className="btn-small success" onClick={() => act(swap.id, 'accept')}>Aceitar</button>
                          {canReject(swap) && (
                            <button
                              className="btn-small danger"
                              onClick={() => act(swap.id, 'reject')}
                              title={swap.targetId ? undefined : 'Encerra o pedido aberto para toda a pastoral'}
                            >
                              {swap.targetId ? 'Recusar' : 'Encerrar pedido'}
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {invited.length === 0 && <div className="empty-state">Nenhum convite de troca para você.</div>}
        </div>
      </div>

      <div className="detail-section">
        <h4 style={{ color: '#555', textTransform: 'uppercase', fontSize: '0.9rem' }}>Meus pedidos</h4>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr><th>Escala</th><th>Convidado</th><th>Mensagem</th><th>Status</th><th>Ações</th></tr>
            </thead>
            <tbody>
              {requested.map((swap) => {
                const st = SWAP_STATUS[swap.status] ?? { label: swap.status, color: 'gray' };
                return (
                  <tr key={swap.id}>
                    <td><strong>{scheduleLabel(swap)}</strong></td>
                    <td>{swap.targetName ?? 'Aberto à pastoral'}</td>
                    <td>{swap.message || '—'}</td>
                    <td><span className={`status-badge ${st.color}`}>{st.label}</span></td>
                    <td className="actions-cell">
                      {swap.status === 'PENDING' && (
                        <button className="btn-small warning" onClick={() => act(swap.id, 'cancel')}>Cancelar pedido</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {requested.length === 0 && <div className="empty-state">Você não pediu nenhuma troca.</div>}
        </div>
      </div>

      {showRequestModal && (
        <div className="module-modal-overlay" onClick={() => setShowRequestModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Pedir troca de escala</h2>
            <form onSubmit={handleRequest}>
              <div className="form-group">
                <label>Minha escala *</label>
                <select
                  required
                  value={requestForm.assignmentId}
                  onChange={(e) => setRequestForm({ ...requestForm, assignmentId: e.target.value, targetMemberId: '' })}
                >
                  <option value="">Selecione</option>
                  {myAssignments.map((assignment) => (
                    <option key={assignment.id} value={assignment.id}>
                      {assignment.schedule.title} — {formatDateTime(assignment.schedule.date)} ({assignment.role})
                    </option>
                  ))}
                </select>
                {myAssignments.length === 0 && (
                  <small style={{ color: '#888' }}>Você não tem escalas futuras para trocar.</small>
                )}
              </div>
              {candidatesState !== 'unavailable' && (
                <div className="form-group">
                  <label>Convidar alguém (opcional)</label>
                  <select
                    value={requestForm.targetMemberId}
                    disabled={candidatesState !== 'ready' || candidates.length === 0}
                    onChange={(e) => setRequestForm({ ...requestForm, targetMemberId: e.target.value })}
                  >
                    <option value="">Deixar aberto à pastoral</option>
                    {candidates.map((c) => <option key={c.memberId} value={c.memberId}>{c.fullName}</option>)}
                  </select>
                  {candidatesState === 'idle' && (
                    <small style={{ color: '#888' }}>Escolha a escala para ver quem pode ser convidado.</small>
                  )}
                  {candidatesState === 'loading' && <small style={{ color: '#888' }}>Carregando quem pode cobrir…</small>}
                  {candidatesState === 'ready' && candidates.length === 0 && (
                    <small style={{ color: '#888' }}>Ninguém disponível para convite direto — o pedido fica aberto à pastoral.</small>
                  )}
                  {candidatesState === 'error' && (
                    <small style={{ color: '#888' }}>Não foi possível carregar a lista — o pedido pode ficar aberto à pastoral.</small>
                  )}
                </div>
              )}
              <div className="form-group">
                <label>Mensagem</label>
                <textarea
                  rows={3}
                  placeholder="Ex.: Preciso viajar neste fim de semana, alguém cobre?"
                  value={requestForm.message}
                  onChange={(e) => setRequestForm({ ...requestForm, message: e.target.value })}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowRequestModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Enviar pedido</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SwapsPage;

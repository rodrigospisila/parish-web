import React, { useState, useEffect, useCallback } from 'react';
import TitleIcon from '../../components/TitleIcon';
import api, { getErrorMessage } from '../../services/api';
import { notify, confirm } from '../../services/notification.service';
import './ModulePages.css';

interface SwapRow {
  id: string;
  status: string;
  message?: string | null;
  createdAt: string;
  requesterName?: string | null;
  targetName?: string | null;
  assignment?: {
    role: string;
    schedule?: { id: string; title: string; date: string } | null;
  } | null;
}

interface MyAssignment {
  id: string;
  role: string;
  status: string;
  schedule: { id: string; title: string; date: string };
}

interface Member {
  id: string;
  fullName: string;
}

const SWAP_STATUS: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Pendente', color: 'yellow' },
  ACCEPTED: { label: 'Aceita', color: 'green' },
  REJECTED: { label: 'Recusada', color: 'red' },
  CANCELLED: { label: 'Cancelada', color: 'gray' },
  EXPIRED: { label: 'Expirada', color: 'gray' },
};

const SwapsPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [requested, setRequested] = useState<SwapRow[]>([]);
  const [invited, setInvited] = useState<SwapRow[]>([]);
  const [hasMemberRecord, setHasMemberRecord] = useState(true);
  const [myAssignments, setMyAssignments] = useState<MyAssignment[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

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
    api.get('/members').then((res) => setMembers(res.data)).catch(() => undefined);
  }, [fetchData]);

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
                          <button className="btn-small danger" onClick={() => act(swap.id, 'reject')}>Recusar</button>
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
                  onChange={(e) => setRequestForm({ ...requestForm, assignmentId: e.target.value })}
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
              <div className="form-group">
                <label>Convidar alguém (opcional)</label>
                <select
                  value={requestForm.targetMemberId}
                  onChange={(e) => setRequestForm({ ...requestForm, targetMemberId: e.target.value })}
                >
                  <option value="">Deixar aberto à pastoral</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
                </select>
              </div>
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

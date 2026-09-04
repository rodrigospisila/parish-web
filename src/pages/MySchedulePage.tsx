import React, { useCallback, useEffect, useState } from 'react';
import TitleIcon from '../components/TitleIcon';
import api, { getErrorMessage } from '../services/api';
import { notify } from '../services/notification.service';

interface MyAssignment {
  id: string;
  role: string;
  status: 'PENDING' | 'CONFIRMED' | 'DECLINED';
  schedule: {
    id: string;
    title: string;
    date: string;
    event?: { title?: string; location?: string; community?: { name?: string } } | null;
  };
}

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  PENDING: { label: 'Aguardando resposta', color: '#b45309', bg: '#fffbeb' },
  CONFIRMED: { label: 'Confirmado', color: '#15803d', bg: '#f0fdf4' },
  DECLINED: { label: 'Recusado', color: '#b91c1c', bg: '#fef2f2' },
};

const miniBtn: React.CSSProperties = {
  border: '1.5px solid #cbd5e1',
  background: '#fff',
  borderRadius: 8,
  padding: '0.35rem 0.7rem',
  fontSize: '0.8rem',
  fontWeight: 700,
  cursor: 'pointer',
  color: '#334155',
};

/**
 * Minha Escala: as escalas em que o usuário está servindo, com as mesmas ações
 * do app — confirmar presença, recusar e pedir troca (aberta à pastoral).
 */
const MySchedulePage: React.FC = () => {
  const [upcoming, setUpcoming] = useState<MyAssignment[]>([]);
  const [past, setPast] = useState<MyAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [swapFor, setSwapFor] = useState<MyAssignment | null>(null);
  const [swapMessage, setSwapMessage] = useState('');
  const [swapSending, setSwapSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/schedules/my-assignments');
      setUpcoming(res.data?.upcoming ?? []);
      setPast(res.data?.past ?? []);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar suas escalas'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const respond = async (assignment: MyAssignment, action: 'confirm' | 'decline') => {
    if (action === 'decline' && !window.confirm('Recusar esta escala? A coordenação será avisada para buscar um substituto.')) {
      return;
    }
    setBusyId(assignment.id);
    try {
      await api.patch(`/schedules/assignments/${assignment.id}/${action}`);
      notify.success(action === 'confirm' ? 'Presença confirmada!' : 'Escala recusada — a coordenação foi avisada.');
      await load();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Não foi possível responder'));
    } finally {
      setBusyId(null);
    }
  };

  const sendSwap = async () => {
    if (!swapFor || swapSending) return;
    setSwapSending(true);
    try {
      await api.post('/swaps', { assignmentId: swapFor.id, message: swapMessage.trim() || undefined });
      notify.success('Pedido de troca enviado — os colegas da pastoral podem assumir a vaga.');
      setSwapFor(null);
      setSwapMessage('');
      await load();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Não foi possível pedir a troca'));
    } finally {
      setSwapSending(false);
    }
  };

  const renderRow = (assignment: MyAssignment, withActions: boolean) => {
    const status = STATUS_LABEL[assignment.status] ?? STATUS_LABEL.PENDING;
    const date = new Date(assignment.schedule.date);
    const busy = busyId === assignment.id;
    return (
      <div
        key={assignment.id}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.9rem', flexWrap: 'wrap',
          background: '#fff', border: '1px solid #e4ebf4', borderRadius: 12,
          padding: '0.8rem 1rem',
        }}
      >
        <div style={{ minWidth: 64, textAlign: 'center' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#1a2b3c' }}>
            {String(date.getUTCDate()).padStart(2, '0')}/{String(date.getUTCMonth() + 1).padStart(2, '0')}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{date.getUTCFullYear()}</div>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <strong style={{ color: '#1a2b3c' }}>{assignment.schedule.title || assignment.schedule.event?.title || 'Escala'}</strong>
          <div style={{ fontSize: '0.82rem', color: '#64748b' }}>
            {assignment.role ? `Função: ${assignment.role}` : ''}
            {assignment.schedule.event?.community?.name ? ` · ${assignment.schedule.event.community.name}` : ''}
            {assignment.schedule.event?.location ? ` · ${assignment.schedule.event.location}` : ''}
          </div>
        </div>
        <span
          style={{
            fontSize: '0.75rem', fontWeight: 700, borderRadius: 999, padding: '0.25rem 0.7rem',
            background: status.bg, color: status.color, whiteSpace: 'nowrap',
          }}
        >
          {status.label}
        </span>
        {withActions && (
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {assignment.status !== 'CONFIRMED' && (
              <button
                type="button"
                style={{ ...miniBtn, borderColor: '#16a34a', color: '#15803d' }}
                disabled={busy}
                onClick={() => void respond(assignment, 'confirm')}
              >
                ✓ Confirmar
              </button>
            )}
            {assignment.status !== 'DECLINED' && (
              <button
                type="button"
                style={{ ...miniBtn, borderColor: '#fca5a5', color: '#b91c1c' }}
                disabled={busy}
                onClick={() => void respond(assignment, 'decline')}
              >
                Recusar
              </button>
            )}
            {assignment.status !== 'DECLINED' && (
              <button
                type="button"
                style={miniBtn}
                disabled={busy}
                onClick={() => {
                  setSwapMessage('');
                  setSwapFor(assignment);
                }}
              >
                ↔ Pedir troca
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  if (loading) return <div className="loading">Carregando...</div>;

  return (
    <div className="members-page">
      <div className="page-header">
        <h1>
          <TitleIcon name="escala" /> Minha Escala
        </h1>
        <p>As escalas em que você está servindo — confirme presença, recuse ou peça troca por aqui mesmo.</p>
      </div>

      <h3 style={{ margin: '0 0 0.6rem' }}>Próximas ({upcoming.length})</h3>
      {upcoming.length === 0 ? (
        <div className="empty-state">Nenhuma escala futura — quando a coordenação escalar você, aparece aqui.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: 920 }}>
          {upcoming.map((assignment) => renderRow(assignment, true))}
        </div>
      )}

      {past.length > 0 && (
        <>
          <h3 style={{ margin: '1.4rem 0 0.6rem' }}>Anteriores ({past.length})</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: 920, opacity: 0.75 }}>
            {past.slice(0, 10).map((assignment) => renderRow(assignment, false))}
          </div>
        </>
      )}

      {swapFor && (
        <div className="module-modal-overlay" onClick={() => !swapSending && setSwapFor(null)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <h2>↔ Pedir troca</h2>
            <p style={{ margin: '0 0 0.6rem', fontSize: '0.9rem', color: '#475569' }}>
              <strong>{swapFor.schedule.title || swapFor.schedule.event?.title || 'Escala'}</strong>
              {' · '}
              {new Date(swapFor.schedule.date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
              {swapFor.role ? ` · ${swapFor.role}` : ''}
            </p>
            <p style={{ margin: '0 0 0.6rem', fontSize: '0.82rem', color: '#64748b' }}>
              O pedido fica aberto aos colegas da pastoral — quem aceitar assume a vaga e a coordenação é avisada.
            </p>
            <div className="form-group">
              <label>Mensagem (opcional)</label>
              <textarea
                rows={3}
                maxLength={300}
                placeholder="Ex.: estarei viajando neste fim de semana…"
                value={swapMessage}
                onChange={(e) => setSwapMessage(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-cancel" disabled={swapSending} onClick={() => setSwapFor(null)}>
                Cancelar
              </button>
              <button type="button" className="btn-submit" disabled={swapSending} onClick={() => void sendSwap()}>
                {swapSending ? 'Enviando…' : 'Enviar pedido'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MySchedulePage;

import React, { useEffect, useState } from 'react';
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

/**
 * Minha Escala (leitura): as escalas em que o usuário está servindo, para
 * papéis sem acesso à gestão de Escalas. Responder/trocar continua no app.
 */
const MySchedulePage: React.FC = () => {
  const [upcoming, setUpcoming] = useState<MyAssignment[]>([]);
  const [past, setPast] = useState<MyAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/schedules/my-assignments')
      .then((res) => {
        setUpcoming(res.data?.upcoming ?? []);
        setPast(res.data?.past ?? []);
      })
      .catch((error) => notify.error(getErrorMessage(error, 'Erro ao carregar suas escalas')))
      .finally(() => setLoading(false));
  }, []);

  const renderRow = (assignment: MyAssignment) => {
    const status = STATUS_LABEL[assignment.status] ?? STATUS_LABEL.PENDING;
    const date = new Date(assignment.schedule.date);
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
        <p>As escalas em que você está servindo. Para confirmar presença ou pedir troca, use o aplicativo.</p>
      </div>

      <h3 style={{ margin: '0 0 0.6rem' }}>Próximas ({upcoming.length})</h3>
      {upcoming.length === 0 ? (
        <div className="empty-state">Nenhuma escala futura — quando a coordenação escalar você, aparece aqui.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: 860 }}>{upcoming.map(renderRow)}</div>
      )}

      {past.length > 0 && (
        <>
          <h3 style={{ margin: '1.4rem 0 0.6rem' }}>Anteriores ({past.length})</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: 860, opacity: 0.75 }}>
            {past.slice(0, 10).map(renderRow)}
          </div>
        </>
      )}
    </div>
  );
};

export default MySchedulePage;

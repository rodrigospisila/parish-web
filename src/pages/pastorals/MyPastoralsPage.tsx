import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../../contexts/AuthContext';
import { notify } from '../../services/notification.service';
import './PastoralsPage.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface GlobalPastoral {
  id: string;
  name: string;
  colorHex?: string;
}

interface Community {
  id: string;
  name: string;
}

interface PastoralMember {
  id: string;
  name: string;
  role: string;
}

interface Meeting {
  id: string;
  title: string;
  startDate: string;
  location?: string;
}

interface MyPastoral {
  id: string;
  globalPastoral: GlobalPastoral;
  community: Community;
  members: PastoralMember[];
  description?: string;
  status: string;
  meetingDay?: string;
  meetingTime?: string;
}

const MyPastoralsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [pastorals, setPastorals] = useState<MyPastoral[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };

      // Buscar pastorais do coordenador
      const pastoralsRes = await axios.get(`${API_URL}/pastorals/community`, {
        headers,
      });

      // Filtrar apenas as pastorais do coordenador
      const myPastorals = pastoralsRes.data.filter((pastoral: any) =>
        currentUser?.pastoralIds?.includes(pastoral.id)
      );

      setPastorals(myPastorals);

      // Buscar reuniões próximas
      if (myPastorals.length > 0) {
        const eventsRes = await axios.get(`${API_URL}/events`, {
          headers,
        });

        const upcomingMeetings = eventsRes.data
          .filter((event: any) =>
            event.eventPastorals?.some((ep: any) =>
              myPastorals.some((p: MyPastoral) => p.id === ep.communityPastoralId)
            ) && event.type === 'PASTORAL_MEETING'
          )
          .filter((event: any) => new Date(event.startDate) > new Date())
          .slice(0, 5)
          .sort((a: any, b: any) => 
            new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
          );

        setMeetings(upcomingMeetings);
      }
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      notify.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  // 'COORDINATOR' (em ingles) e o valor gravado pelo backend quando o vinculo de
  // coordenador vem do cadastro de Usuario (role PASTORAL_COORDINATOR). 'Coordenador'
  // e o rotulo em portugues usado quando o vinculo e criado manualmente. As duas
  // formas precisam ser tratadas como equivalentes na exibicao.
  const getLeaders = (pastoral: MyPastoral) => {
    return pastoral.members
      .filter((m) => m.role === 'Coordenador' || m.role === 'COORDINATOR' || m.role === 'Vice-Coordenador')
      .map((m) => m.name)
      .join(' • ') || 'Coordenação não definida';
  };

  if (loading) return <div className="loading">Carregando...</div>;

  return (
    <div className="pastorals-page">
      <div className="page-header">
        <h1>📋 Minhas Pastorais</h1>
        <p>Resumo de suas pastorais e próximas atividades</p>
      </div>

      {/* Resumo Rápido */}
      <div className="community-pastoral-stat-grid">
        <div className="community-pastoral-stat-card community-pastoral-stat-card--blue">
          <span className="community-pastoral-stat-label">Pastorais</span>
          <strong className="community-pastoral-stat-value">{pastorals.length}</strong>
        </div>
        <div className="community-pastoral-stat-card community-pastoral-stat-card--violet">
          <span className="community-pastoral-stat-label">Próximas reuniões</span>
          <strong className="community-pastoral-stat-value">{meetings.length}</strong>
        </div>
        <div className="community-pastoral-stat-card community-pastoral-stat-card--amber">
          <span className="community-pastoral-stat-label">Total de membros</span>
          <strong className="community-pastoral-stat-value">
            {pastorals.reduce((acc, p) => acc + p.members.length, 0)}
          </strong>
        </div>
      </div>

      {/* Pastorais */}
      <section className="community-pastoral-section">
        <div className="community-pastoral-section-header">
          <div className="community-pastoral-section-heading">
            <h2>Suas Pastorais</h2>
            <p>Lista de pastorais para as quais você é coordenador</p>
          </div>
        </div>

        {pastorals.length === 0 ? (
          <div className="community-pastoral-empty-state">
            <strong>Nenhuma pastoral vinculada</strong>
            <p>Você ainda não foi designado como coordenador de nenhuma pastoral.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1.25rem' }}>
            {pastorals.map((pastoral) => {
              const accentColor = pastoral.globalPastoral.colorHex || '#3498db';
              const leaders = getLeaders(pastoral);
              const isActive = pastoral.status === 'ACTIVE';

              return (
                <article
                  key={pastoral.id}
                  onClick={() => navigate(`/admin/pastorals/community/${pastoral.id}`)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    background: '#fff',
                    borderRadius: '16px',
                    border: '1px solid #e8edf3',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    transition: 'box-shadow 0.2s, transform 0.2s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 24px rgba(0,0,0,0.12)';
                    (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
                    (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
                  }}
                >
                  {/* Faixa colorida de topo */}
                  <div style={{ height: '5px', background: accentColor }} />

                  <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
                    {/* Cabeçalho */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                        <div style={{
                          width: '42px', height: '42px', borderRadius: '12px', flexShrink: 0,
                          background: `${accentColor}20`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '1.25rem', fontWeight: '700', color: accentColor,
                        }}>
                          {pastoral.globalPastoral.name.charAt(0)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: '700', color: '#1a2b3c', lineHeight: 1.3 }}>
                            {pastoral.globalPastoral.name}
                          </h3>
                          <span style={{
                            fontSize: '0.78rem', color: '#64748b', marginTop: '2px', display: 'block',
                          }}>
                            📍 {pastoral.community.name}
                          </span>
                        </div>
                      </div>
                      <span style={{
                        flexShrink: 0, fontSize: '0.72rem', fontWeight: '700', letterSpacing: '0.04em',
                        padding: '0.3rem 0.7rem', borderRadius: '999px', textTransform: 'uppercase',
                        background: isActive ? '#dcfce7' : '#f1f5f9',
                        color: isActive ? '#15803d' : '#64748b',
                        border: `1px solid ${isActive ? '#bbf7d0' : '#e2e8f0'}`,
                      }}>
                        {isActive ? 'Ativa' : 'Inativa'}
                      </span>
                    </div>

                    {/* Descrição */}
                    {pastoral.description && (
                      <p style={{ margin: 0, fontSize: '0.88rem', color: '#64748b', lineHeight: 1.55,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}>
                        {pastoral.description}
                      </p>
                    )}

                    {/* Stats */}
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                      <div style={{
                        flex: 1, background: '#f8fafc', borderRadius: '10px', padding: '0.65rem 0.75rem',
                        border: '1px solid #e8edf3', display: 'flex', flexDirection: 'column', gap: '2px',
                      }}>
                        <span style={{ fontSize: '1.25rem', fontWeight: '700', color: '#1a2b3c' }}>
                          {pastoral.members.length}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.04em' }}>
                          Membros
                        </span>
                      </div>
                      {pastoral.meetingDay && (
                        <div style={{
                          flex: 2, background: '#f8fafc', borderRadius: '10px', padding: '0.65rem 0.75rem',
                          border: '1px solid #e8edf3', display: 'flex', flexDirection: 'column', gap: '2px',
                        }}>
                          <span style={{ fontSize: '0.88rem', fontWeight: '700', color: '#1a2b3c' }}>
                            {pastoral.meetingDay}
                            {pastoral.meetingTime && ` · ${pastoral.meetingTime}`}
                          </span>
                          <span style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.04em' }}>
                            Dia de reunião
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Coordenação */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '0.6rem',
                      padding: '0.6rem 0.75rem', borderRadius: '10px',
                      background: leaders === 'Coordenação não definida' ? '#fef9ec' : '#eff6ff',
                      border: `1px solid ${leaders === 'Coordenação não definida' ? '#fde68a' : '#bfdbfe'}`,
                    }}>
                      <span style={{ fontSize: '0.9rem' }}>
                        {leaders === 'Coordenação não definida' ? '⚠️' : '👤'}
                      </span>
                      <div>
                        <span style={{ fontSize: '0.72rem', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Coordenação
                        </span>
                        <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: '600',
                          color: leaders === 'Coordenação não definida' ? '#92400e' : '#1e40af',
                        }}>
                          {leaders}
                        </p>
                      </div>
                    </div>

                    {/* Botão */}
                    <button
                      onClick={e => { e.stopPropagation(); navigate(`/admin/pastorals/community/${pastoral.id}`); }}
                      style={{
                        marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        gap: '0.4rem', padding: '0.65rem 1rem', borderRadius: '10px', border: 'none',
                        background: accentColor, color: '#fff', fontWeight: '700', fontSize: '0.88rem',
                        cursor: 'pointer', transition: 'opacity 0.15s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                    >
                      Ver detalhes
                      <span style={{ fontSize: '1rem' }}>→</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Próximas Reuniões */}
      <section className="community-pastoral-section">
        <div className="community-pastoral-section-header">
          <div className="community-pastoral-section-heading">
            <h2>Próximas Reuniões</h2>
            <p>Reuniões de suas pastorais nos próximos dias</p>
          </div>
          <div className="community-pastoral-action-group">
            <button
              onClick={() => navigate('/admin/events')}
              className="add-button"
            >
              Ver todos os eventos
            </button>
          </div>
        </div>

        {meetings.length === 0 ? (
          <div className="community-pastoral-empty-state">
            <strong>Nenhuma reunião próxima</strong>
            <p>Não há reuniões agendadas para suas pastorais nos próximos dias.</p>
          </div>
        ) : (
          <div className="community-pastoral-collection-list">
            {meetings.map((meeting) => (
              <article key={meeting.id} className="community-pastoral-collection-card">
                <div className="community-pastoral-collection-header">
                  <h3>{meeting.title}</h3>
                  <span className="community-pastoral-mini-badge is-blue">Reunião</span>
                </div>

                <div className="community-pastoral-detail-list community-pastoral-detail-list--compact">
                  <div className="community-pastoral-detail-item">
                    <span className="community-pastoral-detail-label">Data e Hora</span>
                    <span className="community-pastoral-detail-value">
                      {new Date(meeting.startDate).toLocaleDateString('pt-BR', {
                        weekday: 'short',
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  {meeting.location && (
                    <div className="community-pastoral-detail-item">
                      <span className="community-pastoral-detail-label">Local</span>
                      <span className="community-pastoral-detail-value">
                        {meeting.location}
                      </span>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Ações Rápidas */}
      <section className="community-pastoral-section">
        <div className="community-pastoral-section-header">
          <div className="community-pastoral-section-heading">
            <h2>Ações Rápidas</h2>
            <p>Acesso rápido às principais operações</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          {[
            { icon: '⛪', label: 'Ver todas as pastorais', desc: 'Acesse o gerenciamento completo', path: '/admin/pastorals/community', color: '#3b82f6' },
            { icon: '📅', label: 'Criar novo evento', desc: 'Agende reuniões ou atividades', path: '/admin/events', color: '#8b5cf6' },
            { icon: '📋', label: 'Escala de ministérios', desc: 'Gerencie as escalas', path: '/admin/schedules', color: '#f59e0b' },
          ].map(({ icon, label, desc, path, color }) => (
            <button
              key={path}
              onClick={() => navigate(path)}
              style={{
                padding: '1.1rem 1.25rem', background: '#fff', border: '1px solid #e8edf3',
                borderRadius: '14px', cursor: 'pointer', textAlign: 'left',
                boxShadow: '0 1px 4px rgba(0,0,0,0.05)', transition: 'box-shadow 0.2s, transform 0.2s',
                display: 'flex', gap: '1rem', alignItems: 'center',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)';
                (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)';
                (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
              }}
            >
              <div style={{
                width: '40px', height: '40px', borderRadius: '10px', flexShrink: 0,
                background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem',
              }}>
                {icon}
              </div>
              <div>
                <strong style={{ display: 'block', fontSize: '0.92rem', color: '#1a2b3c', fontWeight: '700' }}>{label}</strong>
                <span style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '2px', display: 'block' }}>{desc}</span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};

export default MyPastoralsPage;

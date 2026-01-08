import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './SchedulesPage.css';

const API_URL = import.meta.env.VITE_API_URL;

interface Parish {
  id: string;
  name: string;
}

interface Community {
  id: string;
  name: string;
  parish?: Parish;
}

interface Event {
  id: string;
  title: string;
  type: string;
  startDate: string;
  community: Community;
}

interface PastoralInfo {
  name: string;
  role?: string;
}

interface EligibleMember {
  id: string;
  fullName: string;
  email?: string;
  phone?: string;
  photoUrl?: string;
  pastorals: PastoralInfo[];
}

interface EligibleMembersResponse {
  eventId: string;
  eventTitle: string;
  community: { id: string; name: string };
  pastorals: { id: string; name: string; role?: string; isLeader: boolean }[];
  hasPastorals: boolean;
  members: EligibleMember[];
}

interface Member {
  id: string;
  fullName: string;
  email?: string;
  phone?: string;
}

interface Assignment {
  id: string;
  role: string;
  checkedIn: boolean;
  checkedInAt?: string;
  confirmed?: boolean;
  confirmedAt?: string;
  member: Member;
}

interface Schedule {
  id: string;
  title: string;
  description?: string;
  date: string;
  event: {
    id: string;
    title: string;
    type: string;
    community?: Community;
  };
  assignments: Assignment[];
  _count: {
    assignments: number;
  };
}

const SchedulesPage: React.FC = () => {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [eligibleMembers, setEligibleMembers] = useState<EligibleMember[]>([]);
  const [eligibleMembersInfo, setEligibleMembersInfo] = useState<EligibleMembersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingEligible, setLoadingEligible] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);
  const [filterEventId, setFilterEventId] = useState('');
  const [filterCommunityId, setFilterCommunityId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [communities, setCommunities] = useState<Community[]>([]);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    date: '',
    eventId: '',
  });

  const [assignmentForm, setAssignmentForm] = useState({
    role: '',
    memberId: '',
    scheduleId: '',
  });

  const serviceRoles = [
    'Leitor',
    'Ministro da Eucaristia',
    'Acólito',
    'Coroinha',
    'Músico',
    'Cantor',
    'Recepcionista',
    'Sacristão',
    'Comentarista',
    'Cerimoniário',
    'Outro',
  ];

  const eventTypeLabels: Record<string, string> = {
    MASS: 'Missa',
    RETREAT: 'Retiro',
    FORMATION: 'Formação',
    MEETING: 'Reunião',
    CELEBRATION: 'Celebração',
    PILGRIMAGE: 'Peregrinação',
    ADORATION: 'Adoração',
    ROSARY: 'Terço',
    CONFESSION: 'Confissão',
    OTHER: 'Outro',
    PASTORAL_MEETING: 'Reunião de Pastoral',
    PASTORAL_ACTIVITY: 'Atividade de Pastoral',
    SACRAMENT: 'Sacramento',
    COMMUNITY_EVENT: 'Evento Comunitário',
    VISITATION: 'Visitação',
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token');
      const [schedulesRes, eventsRes, membersRes, communitiesRes] = await Promise.all([
        axios.get(`${API_URL}/schedules`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${API_URL}/events`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${API_URL}/members`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${API_URL}/communities`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      setSchedules(schedulesRes.data);
      setEvents(eventsRes.data);
      setMembers(membersRes.data);
      setCommunities(communitiesRes.data);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      alert('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  // Buscar membros elegíveis quando abrir o modal de atribuição
  const fetchEligibleMembers = async (eventId: string) => {
    setLoadingEligible(true);
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get<EligibleMembersResponse>(
        `${API_URL}/schedules/events/${eventId}/eligible-members`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setEligibleMembersInfo(res.data);
      setEligibleMembers(res.data.members);
    } catch (error) {
      console.error('Erro ao buscar membros elegíveis:', error);
      // Fallback: usar todos os membros convertendo para EligibleMember
      setEligibleMembers(members.map(m => ({ ...m, pastorals: [] })));
      setEligibleMembersInfo(null);
    } finally {
      setLoadingEligible(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const token = localStorage.getItem('token');
      // Converter a data para formato ISO-8601 completo
      const payload = {
        ...formData,
        date: new Date(formData.date).toISOString(),
      };
      await axios.post(`${API_URL}/schedules`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert('Escala criada com sucesso!');
      setShowModal(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error('Erro ao criar escala:', error);
      alert(error.response?.data?.message || 'Erro ao criar escala');
    }
  };

  const handleAssignmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const token = localStorage.getItem('token');
      await axios.post(`${API_URL}/schedules/assignments`, assignmentForm, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert('Membro atribuído com sucesso!');
      setShowAssignmentModal(false);
      resetAssignmentForm();
      fetchData();
      // Atualizar detalhes da escala selecionada
      if (selectedSchedule) {
        const res = await axios.get(`${API_URL}/schedules/${selectedSchedule.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setSelectedSchedule(res.data);
      }
    } catch (error: any) {
      console.error('Erro ao atribuir membro:', error);
      alert(error.response?.data?.message || 'Erro ao atribuir membro');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir esta escala?')) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/schedules/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert('Escala excluída com sucesso!');
      setShowDetailModal(false);
      fetchData();
    } catch (error: any) {
      console.error('Erro ao excluir escala:', error);
      alert(error.response?.data?.message || 'Erro ao excluir escala');
    }
  };

  const handleRemoveAssignment = async (assignmentId: string) => {
    if (!window.confirm('Tem certeza que deseja remover este membro da escala?')) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/schedules/assignments/${assignmentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert('Membro removido da escala!');
      fetchData();
      // Atualizar detalhes da escala selecionada
      if (selectedSchedule) {
        const res = await axios.get(`${API_URL}/schedules/${selectedSchedule.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setSelectedSchedule(res.data);
      }
    } catch (error: any) {
      console.error('Erro ao remover membro:', error);
      alert(error.response?.data?.message || 'Erro ao remover membro');
    }
  };

  const handleCheckIn = async (assignmentId: string) => {
    try {
      const token = localStorage.getItem('token');
      await axios.patch(`${API_URL}/schedules/assignments/${assignmentId}/checkin`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert('Check-in realizado!');
      fetchData();
      // Atualizar detalhes da escala selecionada
      if (selectedSchedule) {
        const res = await axios.get(`${API_URL}/schedules/${selectedSchedule.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setSelectedSchedule(res.data);
      }
    } catch (error: any) {
      console.error('Erro ao fazer check-in:', error);
      alert(error.response?.data?.message || 'Erro ao fazer check-in');
    }
  };

  const handleUndoCheckIn = async (assignmentId: string) => {
    try {
      const token = localStorage.getItem('token');
      await axios.patch(`${API_URL}/schedules/assignments/${assignmentId}/undo-checkin`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert('Check-in desfeito!');
      fetchData();
      // Atualizar detalhes da escala selecionada
      if (selectedSchedule) {
        const res = await axios.get(`${API_URL}/schedules/${selectedSchedule.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setSelectedSchedule(res.data);
      }
    } catch (error: any) {
      console.error('Erro ao desfazer check-in:', error);
      alert(error.response?.data?.message || 'Erro ao desfazer check-in');
    }
  };

  const resetForm = () => {
    setFormData({
      title: '',
      description: '',
      date: '',
      eventId: '',
    });
  };

  const resetAssignmentForm = () => {
    setAssignmentForm({
      role: '',
      memberId: '',
      scheduleId: '',
    });
    setEligibleMembers([]);
    setEligibleMembersInfo(null);
  };

  const handleScheduleClick = async (schedule: Schedule) => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/schedules/${schedule.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSelectedSchedule(res.data);
      setShowDetailModal(true);
    } catch (error) {
      console.error('Erro ao carregar detalhes:', error);
    }
  };

  const handleAddAssignment = async (schedule: Schedule) => {
    setAssignmentForm({
      ...assignmentForm,
      scheduleId: schedule.id,
    });
    // Buscar membros elegíveis baseado no evento da escala
    await fetchEligibleMembers(schedule.event.id);
    setShowAssignmentModal(true);
  };

  const handleCreateFromEvent = (event: Event) => {
    const eventDate = new Date(event.startDate);
    setFormData({
      title: `Escala - ${event.title}`,
      description: '',
      date: eventDate.toISOString().slice(0, 16),
      eventId: event.id,
    });
    setShowModal(true);
  };

  const filteredSchedules = schedules.filter((schedule) => {
    const matchesEvent = filterEventId ? schedule.event.id === filterEventId : true;
    const matchesCommunity = filterCommunityId ? schedule.event.community?.id === filterCommunityId : true;
    const matchesSearch = searchTerm
      ? schedule.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        schedule.event.title.toLowerCase().includes(searchTerm.toLowerCase())
      : true;
    return matchesEvent && matchesCommunity && matchesSearch;
  });

  // Funções auxiliares para filtros
  const hasActiveFilters = filterEventId || filterCommunityId || searchTerm;
  
  const clearAllFilters = () => {
    setFilterEventId('');
    setFilterCommunityId('');
    setSearchTerm('');
  };

  const getSelectedCommunityName = () => {
    const community = communities.find(c => c.id === filterCommunityId);
    if (community) {
      return community.parish ? `${community.parish.name} › ${community.name}` : community.name;
    }
    return '';
  };

  const getSelectedEventName = () => {
    const event = events.find(e => e.id === filterEventId);
    return event ? event.title : '';
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatShortDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Agrupar escalas por data
  const groupedSchedules = filteredSchedules.reduce((groups, schedule) => {
    const date = new Date(schedule.date).toLocaleDateString('pt-BR');
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(schedule);
    return groups;
  }, {} as Record<string, Schedule[]>);

  if (loading) return <div className="loading">Carregando...</div>;

  return (
    <div className="schedules-page">
      <div className="page-header">
        <h1>📋 Escalas de Serviço</h1>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          + Nova Escala
        </button>
      </div>

      <div className="filters">
        <div className="filter-row">
          <input
            type="text"
            placeholder="Buscar por título ou evento..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <select
            value={filterCommunityId}
            onChange={(e) => setFilterCommunityId(e.target.value)}
            className="filter-select"
          >
            <option value="">Todas as comunidades</option>
            {communities.map((community) => (
              <option key={community.id} value={community.id}>
                {community.parish ? `${community.parish.name} › ${community.name}` : community.name}
              </option>
            ))}
          </select>
          <select
            value={filterEventId}
            onChange={(e) => setFilterEventId(e.target.value)}
            className="filter-select"
          >
            <option value="">Todos os eventos</option>
            {events
              .filter(event => !filterCommunityId || event.community?.id === filterCommunityId)
              .map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title} - {formatShortDate(event.startDate)}
                </option>
              ))}
          </select>
        </div>
      </div>

      {/* Banner de Filtros Ativos */}
      {hasActiveFilters && (
        <div className="active-filters-banner">
          <div className="active-filters-info">
            <span className="filter-count">
              {filteredSchedules.length} escala{filteredSchedules.length !== 1 ? 's' : ''} encontrada{filteredSchedules.length !== 1 ? 's' : ''}
            </span>
            <div className="active-filter-tags">
              {filterCommunityId && (
                <span className="filter-tag">
                  Comunidade: {getSelectedCommunityName()}
                  <button onClick={() => setFilterCommunityId('')} className="remove-filter">×</button>
                </span>
              )}
              {filterEventId && (
                <span className="filter-tag">
                  Evento: {getSelectedEventName()}
                  <button onClick={() => setFilterEventId('')} className="remove-filter">×</button>
                </span>
              )}
              {searchTerm && (
                <span className="filter-tag">
                  Busca: "{searchTerm}"
                  <button onClick={() => setSearchTerm('')} className="remove-filter">×</button>
                </span>
              )}
            </div>
          </div>
          <button onClick={clearAllFilters} className="btn-clear-filters">
            Limpar todos
          </button>
        </div>
      )}

      {/* Lista de Eventos sem Escala */}
      <div className="events-without-schedule">
        <h3>📅 Eventos Próximos sem Escala</h3>
        <div className="events-list">
          {events
            .filter((event) => {
              const hasSchedule = schedules.some((s) => s.event.id === event.id);
              const isFuture = new Date(event.startDate) > new Date();
              const matchesCommunity = filterCommunityId ? event.community?.id === filterCommunityId : true;
              return !hasSchedule && isFuture && matchesCommunity;
            })
            .slice(0, 5)
            .map((event) => (
              <div key={event.id} className="event-item">
                <div className="event-info">
                  <span className="event-type-badge">{eventTypeLabels[event.type] || event.type}</span>
                  <strong>{event.title}</strong>
                  <span className="event-date">{formatShortDate(event.startDate)}</span>
                  {event.community && (
                    <span className="event-community">
                      {event.community.parish ? `${event.community.parish.name} › ` : ''}{event.community.name}
                    </span>
                  )}
                </div>
                <button
                  className="btn-small btn-create"
                  onClick={() => handleCreateFromEvent(event)}
                >
                  Criar Escala
                </button>
              </div>
            ))}
          {events.filter((event) => {
            const hasSchedule = schedules.some((s) => s.event.id === event.id);
            const isFuture = new Date(event.startDate) > new Date();
            const matchesCommunity = filterCommunityId ? event.community?.id === filterCommunityId : true;
            return !hasSchedule && isFuture && matchesCommunity;
          }).length === 0 && (
            <p className="no-events">
              {filterCommunityId 
                ? 'Nenhum evento próximo sem escala para esta comunidade.' 
                : 'Todos os eventos próximos já possuem escala.'}
            </p>
          )}
        </div>
      </div>

      {/* Lista de Escalas Agrupadas por Data */}
      <div className="schedules-list">
        {Object.keys(groupedSchedules).length === 0 ? (
          <p className="no-results">Nenhuma escala encontrada.</p>
        ) : (
          Object.entries(groupedSchedules).map(([date, dateSchedules]) => (
            <div key={date} className="schedule-group">
              <h3 className="group-date">📆 {date}</h3>
              <div className="schedules-grid">
                {dateSchedules.map((schedule) => (
                  <div key={schedule.id} className="schedule-card" onClick={() => handleScheduleClick(schedule)}>
                    <div className="card-header">
                      <div>
                        <h4>{schedule.title}</h4>
                        <span className="event-badge">
                          {eventTypeLabels[schedule.event.type] || schedule.event.type} - {schedule.event.title}
                        </span>
                      </div>
                      <span className="assignment-count">
                        {schedule._count.assignments} {schedule._count.assignments === 1 ? 'membro' : 'membros'}
                      </span>
                    </div>
                    <div className="card-body">
                      <p className="schedule-time">
                        🕐 {new Date(schedule.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      {schedule.description && <p className="schedule-desc">{schedule.description}</p>}
                      {schedule.assignments.length > 0 && (
                        <div className="assignments-preview">
                          {schedule.assignments.slice(0, 3).map((a) => (
                            <span key={a.id} className={`member-chip ${a.checkedIn ? 'checked-in' : ''}`}>
                              {a.member.fullName.split(' ')[0]} ({a.role})
                            </span>
                          ))}
                          {schedule.assignments.length > 3 && (
                            <span className="more-members">+{schedule.assignments.length - 3}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="btn-small btn-add" onClick={() => handleAddAssignment(schedule)}>
                        + Membro
                      </button>
                      <button className="btn-small btn-delete" onClick={() => handleDelete(schedule.id)}>
                        Excluir
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal de Criação de Escala */}
      {showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); resetForm(); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Nova Escala</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Evento *</label>
                <select
                  required
                  value={formData.eventId}
                  onChange={(e) => {
                    const event = events.find((ev) => ev.id === e.target.value);
                    if (event) {
                      setFormData({
                        ...formData,
                        eventId: e.target.value,
                        title: formData.title || `Escala - ${event.title}`,
                        date: formData.date || new Date(event.startDate).toISOString().slice(0, 16),
                      });
                    } else {
                      setFormData({ ...formData, eventId: e.target.value });
                    }
                  }}
                >
                  <option value="">Selecione um evento</option>
                  {events
                    .filter((event) => new Date(event.startDate) > new Date())
                    .map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.title} - {formatShortDate(event.startDate)}
                      </option>
                    ))}
                </select>
              </div>

              <div className="form-group">
                <label>Título *</label>
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Ex: Escala - Missa Dominical"
                />
              </div>

              <div className="form-group">
                <label>Data e Hora *</label>
                <input
                  type="datetime-local"
                  required
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Descrição</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Observações sobre a escala..."
                  rows={3}
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => { setShowModal(false); resetForm(); }}>
                  Cancelar
                </button>
                <button type="submit" className="btn-submit">
                  Criar Escala
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Atribuição de Membro */}
      {showAssignmentModal && (
        <div className="modal-overlay" onClick={() => { setShowAssignmentModal(false); resetAssignmentForm(); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Atribuir Membro à Escala</h2>
            
            {/* Informação sobre pastorais vinculadas */}
            {eligibleMembersInfo && (
              <div className="eligible-info">
                {eligibleMembersInfo.hasPastorals ? (
                  <div className="pastoral-info">
                    <p className="info-label">📋 Pastorais vinculadas ao evento:</p>
                    <div className="pastoral-badges">
                      {eligibleMembersInfo.pastorals.map((p) => (
                        <span key={p.id} className="pastoral-badge">
                          {p.name}
                          {p.isLeader && <span className="leader-tag"> (Principal)</span>}
                        </span>
                      ))}
                    </div>
                    <p className="info-note">
                      ℹ️ Apenas membros destas pastorais podem ser escalados.
                    </p>
                  </div>
                ) : (
                  <div className="no-pastoral-info">
                    <p className="info-note">
                      ℹ️ Este evento não tem pastorais vinculadas. Todos os membros da comunidade estão disponíveis.
                    </p>
                  </div>
                )}
              </div>
            )}

            <form onSubmit={handleAssignmentSubmit}>
              <div className="form-group">
                <label>Função *</label>
                <select
                  required
                  value={assignmentForm.role}
                  onChange={(e) => setAssignmentForm({ ...assignmentForm, role: e.target.value })}
                >
                  <option value="">Selecione a função</option>
                  {serviceRoles.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Membro * {loadingEligible && '(Carregando...)'}</label>
                <select
                  required
                  value={assignmentForm.memberId}
                  onChange={(e) => setAssignmentForm({ ...assignmentForm, memberId: e.target.value })}
                  disabled={loadingEligible}
                >
                  <option value="">Selecione um membro</option>
                  {eligibleMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.fullName}
                      {member.pastorals && member.pastorals.length > 0 && 
                        ` (${member.pastorals.map(p => p.name).join(', ')})`
                      }
                    </option>
                  ))}
                </select>
                {eligibleMembers.length === 0 && !loadingEligible && (
                  <p className="no-members-warning">
                    ⚠️ Nenhum membro elegível encontrado. Verifique se há membros cadastrados nas pastorais vinculadas ao evento.
                  </p>
                )}
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => { setShowAssignmentModal(false); resetAssignmentForm(); }}>
                  Cancelar
                </button>
                <button type="submit" className="btn-submit" disabled={loadingEligible || eligibleMembers.length === 0}>
                  Atribuir
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Detalhes da Escala */}
      {showDetailModal && selectedSchedule && (
        <div className="modal-overlay" onClick={() => setShowDetailModal(false)}>
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header">
              <div>
                <h2>{selectedSchedule.title}</h2>
                <p className="detail-event">
                  {eventTypeLabels[selectedSchedule.event.type] || selectedSchedule.event.type} - {selectedSchedule.event.title}
                </p>
                <p className="detail-date">📅 {formatDate(selectedSchedule.date)}</p>
                {selectedSchedule.description && (
                  <p className="detail-desc">{selectedSchedule.description}</p>
                )}
              </div>
              <button
                className="btn-primary"
                onClick={() => handleAddAssignment(selectedSchedule)}
              >
                + Adicionar Membro
              </button>
            </div>

            <div className="assignments-section">
              <h3>👥 Membros Escalados ({selectedSchedule.assignments.length})</h3>
              {selectedSchedule.assignments.length === 0 ? (
                <p className="no-assignments">Nenhum membro atribuído a esta escala.</p>
              ) : (
                <div className="assignments-list">
                  {selectedSchedule.assignments.map((assignment) => (
                    <div key={assignment.id} className={`assignment-item ${assignment.checkedIn ? 'checked-in' : ''}`}>
                      <div className="assignment-info">
                        <div className="member-avatar">
                          {assignment.member.fullName.charAt(0).toUpperCase()}
                        </div>
                        <div className="member-details">
                          <strong>{assignment.member.fullName}</strong>
                          <span className="role-badge">{assignment.role}</span>
                          {assignment.member.phone && <span className="member-phone">📞 {assignment.member.phone}</span>}
                        </div>
                      </div>
                      <div className="assignment-status">
                        {assignment.checkedIn ? (
                          <span className="status-checked">
                            ✅ Check-in em {new Date(assignment.checkedInAt!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        ) : (
                          <span className="status-pending">⏳ Aguardando</span>
                        )}
                      </div>
                      <div className="assignment-actions">
                        {assignment.checkedIn ? (
                          <button
                            className="btn-small btn-undo"
                            onClick={() => handleUndoCheckIn(assignment.id)}
                          >
                            Desfazer Check-in
                          </button>
                        ) : (
                          <button
                            className="btn-small btn-checkin"
                            onClick={() => handleCheckIn(assignment.id)}
                          >
                            Check-in
                          </button>
                        )}
                        <button
                          className="btn-small btn-remove"
                          onClick={() => handleRemoveAssignment(assignment.id)}
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowDetailModal(false)}>
                Fechar
              </button>
              <button className="btn-delete" onClick={() => handleDelete(selectedSchedule.id)}>
                Excluir Escala
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SchedulesPage;

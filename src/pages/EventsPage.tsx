import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Calendar from 'react-calendar';
import EventCalendar from '../components/EventCalendar';
import RecurrenceForm from '../components/RecurrenceForm';
import TimeInput24h from '../components/TimeInput24h';
import { generateRecurrenceDates, getEventDuration, applyDuration } from '../utils/recurrenceHelper';
import 'react-calendar/dist/Calendar.css';
import './EventsPage.css';

const API_URL = import.meta.env.VITE_API_URL;

interface Diocese {
  id: string;
  name: string;
}

interface Parish {
  id: string;
  name: string;
  diocese?: Diocese;
}

interface Community {
  id: string;
  name: string;
  parish?: Parish;
}

interface Event {
  id: string;
  title: string;
  description?: string;
  type: string;
  startDate: string;
  endDate?: string;
  location?: string;
  isRecurring: boolean;
  maxParticipants?: number;
  isPublic: boolean;
  status: string;
  community: Community;
  _count: {
    participants: number;
  };
}

const EventsPage: React.FC = () => {
  const [events, setEvents] = useState<Event[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    type: 'MASS',
    startDate: '',
    endDate: '',
    location: '',
    isRecurring: false,
    recurrenceType: '',
    recurrenceInterval: 1,
    recurrenceDays: '[]',
    recurrenceEndDate: '',
    maxParticipants: '',
    isPublic: true,
    status: 'DRAFT',
    communityId: '',
  });

  const eventTypes = [
    { value: 'MASS', label: 'Missa' },
    { value: 'RETREAT', label: 'Retiro' },
    { value: 'FORMATION', label: 'Formação' },
    { value: 'MEETING', label: 'Reunião' },
    { value: 'CELEBRATION', label: 'Celebração' },
    { value: 'PILGRIMAGE', label: 'Peregrinação' },
    { value: 'ADORATION', label: 'Adoração' },
    { value: 'ROSARY', label: 'Terço' },
    { value: 'CONFESSION', label: 'Confissão' },
    { value: 'OTHER', label: 'Outro' },
  ];

  const eventStatuses = [
    { value: 'DRAFT', label: 'Rascunho', color: '#6c757d' },
    { value: 'PUBLISHED', label: 'Publicado', color: '#28a745' },
    { value: 'CANCELLED', label: 'Cancelado', color: '#dc3545' },
    { value: 'COMPLETED', label: 'Concluído', color: '#007bff' },
  ];

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token');
      const [eventsRes, communitiesRes] = await Promise.all([
        axios.get(`${API_URL}/events`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${API_URL}/communities`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      setEvents(eventsRes.data);
      setCommunities(communitiesRes.data);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      alert('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const token = localStorage.getItem('token');
      
      if (editingEvent) {
        // Editar evento existente
        const payload = {
          ...formData,
          maxParticipants: formData.maxParticipants ? parseInt(formData.maxParticipants) : undefined,
        };
        
        await axios.patch(
          `${API_URL}/events/${editingEvent.id}`,
          payload,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        alert('Evento atualizado com sucesso!');
      } else if (formData.isRecurring && formData.recurrenceType) {
        // Criar eventos recorrentes
        const duration = getEventDuration(formData.startDate, formData.endDate);
        const days = formData.recurrenceDays ? JSON.parse(formData.recurrenceDays) : [];
        
        const dates = generateRecurrenceDates(
          formData.startDate,
          {
            type: formData.recurrenceType as any,
            interval: formData.recurrenceInterval,
            days,
            endDate: formData.recurrenceEndDate || undefined,
          }
        );
        
        let createdCount = 0;
        for (const date of dates) {
          const payload = {
            title: formData.title,
            description: formData.description,
            type: formData.type,
            startDate: date,
            endDate: applyDuration(date, duration),
            location: formData.location,
            isRecurring: false,
            maxParticipants: formData.maxParticipants ? parseInt(formData.maxParticipants) : undefined,
            isPublic: formData.isPublic,
            status: formData.status,
            communityId: formData.communityId,
          };
          
          await axios.post(`${API_URL}/events`, payload, {
            headers: { Authorization: `Bearer ${token}` },
          });
          createdCount++;
        }
        
        alert(`${createdCount} eventos criados com sucesso!`);
      } else {
        // Criar evento único
        const payload = {
          ...formData,
          maxParticipants: formData.maxParticipants ? parseInt(formData.maxParticipants) : undefined,
        };
        
        await axios.post(`${API_URL}/events`, payload, {
          headers: { Authorization: `Bearer ${token}` },
        });
        alert('Evento criado com sucesso!');
      }

      setShowModal(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error('Erro ao salvar evento:', error);
      alert(error.response?.data?.message || 'Erro ao salvar evento');
    }
  };

  const handleEdit = (event: Event) => {
    setEditingEvent(event);
    setFormData({
      title: event.title,
      description: event.description || '',
      type: event.type,
      startDate: event.startDate.slice(0, 16),
      endDate: event.endDate ? event.endDate.slice(0, 16) : '',
      location: event.location || '',
      isRecurring: event.isRecurring,
      recurrenceType: '',
      recurrenceInterval: 1,
      recurrenceDays: '[]',
      recurrenceEndDate: '',
      maxParticipants: event.maxParticipants?.toString() || '',
      isPublic: event.isPublic,
      status: event.status,
      communityId: event.community.id,
    });
    setShowModal(true);
    setShowDetailModal(false);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este evento?')) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/events/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert('Evento excluído com sucesso!');
      setShowDetailModal(false);
      fetchData();
    } catch (error: any) {
      console.error('Erro ao excluir evento:', error);
      alert(error.response?.data?.message || 'Erro ao excluir evento');
    }
  };

  const resetForm = () => {
    setFormData({
      title: '',
      description: '',
      type: 'MASS',
      startDate: '',
      endDate: '',
      location: '',
      isRecurring: false,
      recurrenceType: '',
      recurrenceInterval: 1,
      recurrenceDays: '[]',
      recurrenceEndDate: '',
      maxParticipants: '',
      isPublic: true,
      status: 'DRAFT',
      communityId: '',
    });
    setEditingEvent(null);
  };

  const handleEventClick = (event: Event) => {
    setSelectedEvent(event);
    setShowDetailModal(true);
  };

  const handleDateClick = (date: Date) => {
    resetForm();
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    const dateStr = localDate.toISOString().slice(0, 16);
    setFormData(prev => ({
      ...prev,
      startDate: dateStr,
      endDate: dateStr,
    }));
    setShowModal(true);
  };

  const handleDuplicateClick = () => {
    setShowDetailModal(false);
    setShowDuplicateModal(true);
  };

  const handleCalendarSelect = (date: Date) => {
    if (!selectedEvent) return;

    // Usar horário do evento original
    const originalDate = new Date(selectedEvent.startDate);
    const newDate = new Date(date);
    newDate.setHours(originalDate.getHours());
    newDate.setMinutes(originalDate.getMinutes());

    const dateStr = newDate.toISOString().slice(0, 16);
    
    // Verificar se já existe
    if (selectedDates.includes(dateStr)) {
      // Se já existe, remover (toggle)
      setSelectedDates(selectedDates.filter(d => d !== dateStr));
    } else {
      // Adicionar nova data
      setSelectedDates([...selectedDates, dateStr].sort());
    }
  };

  const handleTimeChange = (oldDate: string, newTime: string) => {
    const [hours, minutes] = newTime.split(':');
    const date = new Date(oldDate);
    date.setHours(parseInt(hours));
    date.setMinutes(parseInt(minutes));
    
    const newDateStr = date.toISOString().slice(0, 16);
    
    setSelectedDates(selectedDates.map(d => d === oldDate ? newDateStr : d).sort());
  };

  const handleRemoveDate = (date: string) => {
    setSelectedDates(selectedDates.filter(d => d !== date));
  };

  const handleDuplicate = async () => {
    if (!selectedEvent || selectedDates.length === 0) return;

    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${API_URL}/events/${selectedEvent.id}/duplicate`,
        { dates: selectedDates },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      alert(response.data.message);
      setShowDuplicateModal(false);
      setSelectedDates([]);
      fetchData();
    } catch (error: any) {
      console.error('Erro ao duplicar evento:', error);
      alert(error.response?.data?.message || 'Erro ao duplicar evento');
    }
  };

  const filteredEvents = events.filter((event) => {
    const matchesType = !filterType || event.type === filterType;
    const matchesStatus = !filterStatus || event.status === filterStatus;
    return matchesType && matchesStatus;
  });

  const getTypeLabel = (type: string) => {
    return eventTypes.find((t) => t.value === type)?.label || type;
  };

  const getStatusLabel = (status: string) => {
    return eventStatuses.find((s) => s.value === status)?.label || status;
  };

  const getStatusColor = (status: string) => {
    return eventStatuses.find((s) => s.value === status)?.color || '#6c757d';
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) return <div className="events-page">Carregando...</div>;

  return (
    <div className="events-page">
      <div className="events-header">
        <h1>📅 Agenda de Eventos</h1>
        <button className="btn-new-event" onClick={() => {
          resetForm();
          setShowModal(true);
        }}>
          + Novo Evento
        </button>
      </div>

      <div className="events-filters">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="filter-select"
        >
          <option value="">Todos os tipos</option>
          {eventTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="filter-select"
        >
          <option value="">Todos os status</option>
          {eventStatuses.map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </select>
      </div>

      <EventCalendar
        events={filteredEvents}
        onEventClick={handleEventClick}
        onDateClick={handleDateClick}
      />

      {/* Modal de Detalhes do Evento */}
      {showDetailModal && selectedEvent && (
        <div className="modal-overlay" onClick={() => setShowDetailModal(false)}>
          <div className="modal-content event-detail-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowDetailModal(false)}>×</button>
            
            <div className="event-detail-header">
              <h2>{selectedEvent.title}</h2>
              <span
                className="event-status-badge"
                style={{ backgroundColor: getStatusColor(selectedEvent.status) }}
              >
                {getStatusLabel(selectedEvent.status)}
              </span>
            </div>

            <div className="event-detail-body">
              <div className="detail-row">
                <strong>📌 Tipo:</strong>
                <span>{getTypeLabel(selectedEvent.type)}</span>
              </div>

              {selectedEvent.description && (
                <div className="detail-row">
                  <strong>📝 Descrição:</strong>
                  <p>{selectedEvent.description}</p>
                </div>
              )}

              <div className="detail-row">
                <strong>🕐 Início:</strong>
                <span>{formatDate(selectedEvent.startDate)}</span>
              </div>

              {selectedEvent.endDate && (
                <div className="detail-row">
                  <strong>🕐 Fim:</strong>
                  <span>{formatDate(selectedEvent.endDate)}</span>
                </div>
              )}

              {selectedEvent.location && (
                <div className="detail-row">
                  <strong>📍 Local:</strong>
                  <span>{selectedEvent.location}</span>
                </div>
              )}

              <div className="detail-row">
                <strong>🏘️ Comunidade:</strong>
                <span>
                  {selectedEvent.community.name}
                  {selectedEvent.community.parish && ` - ${selectedEvent.community.parish.name}`}
                </span>
              </div>

              {selectedEvent.maxParticipants && (
                <div className="detail-row">
                  <strong>👥 Participantes:</strong>
                  <span>
                    {selectedEvent._count.participants} / {selectedEvent.maxParticipants} inscritos
                  </span>
                </div>
              )}

              {selectedEvent.isRecurring && (
                <div className="detail-row">
                  <strong>🔄 Recorrência:</strong>
                  <span>Evento recorrente</span>
                </div>
              )}

              <div className="detail-row">
                <strong>👁️ Visibilidade:</strong>
                <span>{selectedEvent.isPublic ? 'Público' : 'Privado'}</span>
              </div>
            </div>

            <div className="event-detail-actions">
              <button className="btn-edit" onClick={() => handleEdit(selectedEvent)}>
                ✏️ Editar
              </button>
              <button className="btn-duplicate" onClick={handleDuplicateClick}>
                📋 Duplicar
              </button>
              <button className="btn-delete" onClick={() => handleDelete(selectedEvent.id)}>
                🗑️ Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Criação/Edição */}
      {showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); resetForm(); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => { setShowModal(false); resetForm(); }}>×</button>
            
            <h2>{editingEvent ? 'Editar Evento' : 'Novo Evento'}</h2>
            
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Título *</label>
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Nome do evento"
                />
              </div>

              <div className="form-group">
                <label>Descrição</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Detalhes sobre o evento"
                  rows={3}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Tipo *</label>
                  <select
                    required
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                  >
                    {eventTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Status *</label>
                  <select
                    required
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  >
                    {eventStatuses.map((status) => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Data/Hora Início *</label>
                  <input
                    type="datetime-local"
                    required
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>Data/Hora Fim</label>
                  <input
                    type="datetime-local"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Local</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder="Local do evento"
                />
              </div>

              <div className="form-group">
                <label>Comunidade *</label>
                <select
                  required
                  value={formData.communityId}
                  onChange={(e) => setFormData({ ...formData, communityId: e.target.value })}
                >
                  <option value="">Selecione uma comunidade</option>
                  {communities.map((community) => (
                    <option key={community.id} value={community.id}>
                      {community.name} - {community.parish?.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Máximo de Participantes</label>
                <input
                  type="number"
                  min="1"
                  value={formData.maxParticipants}
                  onChange={(e) => setFormData({ ...formData, maxParticipants: e.target.value })}
                  placeholder="Deixe vazio para ilimitado"
                />
              </div>

              <div className="form-checkboxes">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.isRecurring}
                    onChange={(e) => setFormData({ ...formData, isRecurring: e.target.checked })}
                  />
                  <span>Evento recorrente</span>
                </label>

                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.isPublic}
                    onChange={(e) => setFormData({ ...formData, isPublic: e.target.checked })}
                  />
                  <span>Evento público</span>
                </label>
              </div>

              <RecurrenceForm
                isRecurring={formData.isRecurring}
                recurrenceType={formData.recurrenceType}
                recurrenceInterval={formData.recurrenceInterval}
                recurrenceDays={formData.recurrenceDays}
                recurrenceEndDate={formData.recurrenceEndDate}
                onChange={(field, value) => setFormData({ ...formData, [field]: value })}
              />

              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => { setShowModal(false); resetForm(); }}>
                  Cancelar
                </button>
                <button type="submit" className="btn-submit">
                  {editingEvent ? 'Atualizar' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Duplicação */}
      {showDuplicateModal && selectedEvent && (
        <div className="modal-overlay" onClick={() => { setShowDuplicateModal(false); setSelectedDates([]); }}>
          <div className="modal-content duplicate-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => { setShowDuplicateModal(false); setSelectedDates([]); }}>×</button>
            
            <h2>📋 Duplicar Evento</h2>
            <p className="duplicate-info">
              Selecione as datas para duplicar o evento <strong>"{selectedEvent.title}"</strong>
            </p>

            <div className="duplicate-content">
              <div className="calendar-section">
                <Calendar
                  onChange={(value: any) => {
                    if (value instanceof Date) {
                      handleCalendarSelect(value);
                    }
                  }}
                  value={null}
                  minDate={new Date()}
                  locale="pt-BR"
                  tileClassName={({ date }) => {
                    const dateStr = new Date(
                      date.getFullYear(),
                      date.getMonth(),
                      date.getDate(),
                      new Date(selectedEvent.startDate).getHours(),
                      new Date(selectedEvent.startDate).getMinutes()
                    ).toISOString().slice(0, 16);
                    return selectedDates.includes(dateStr) ? 'selected-date' : '';
                  }}
                />
              </div>

              {selectedDates.length > 0 && (
                <div className="selected-dates-list">
                  <h4>Datas Selecionadas ({selectedDates.length})</h4>
                  <ul>
                    {selectedDates.map((date) => {
                      const dateObj = new Date(date);
                      const dateStr = dateObj.toLocaleDateString('pt-BR');
                      
                      // Formato 24h: HH:mm
                      const hours = dateObj.getHours().toString().padStart(2, '0');
                      const minutes = dateObj.getMinutes().toString().padStart(2, '0');
                      const timeStr = `${hours}:${minutes}`;
                      
                      return (
                        <li key={date}>
                          <div className="date-item">
                            <span className="date-text">{dateStr}</span>
                            <TimeInput24h
                              value={timeStr}
                              onChange={(newTime) => handleTimeChange(date, newTime)}
                            />
                          </div>
                          <button
                            type="button"
                            className="btn-remove-date"
                            onClick={() => handleRemoveDate(date)}
                          >
                            ✕
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {selectedDates.length === 0 && (
                <div className="empty-dates">
                  <p>📅 Nenhuma data selecionada</p>
                  <small>Clique nas datas do calendário para selecionar</small>
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => { setShowDuplicateModal(false); setSelectedDates([]); }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-submit"
                onClick={handleDuplicate}
                disabled={selectedDates.length === 0}
              >
                Duplicar para {selectedDates.length} data(s)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EventsPage;

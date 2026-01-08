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
  const [filterCommunity, setFilterCommunity] = useState('');
  const [viewMode, setViewMode] = useState<'calendar' | 'table'>('calendar');
  const [sortField, setSortField] = useState<'title' | 'startDate' | 'type' | 'status' | 'community'>('startDate');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);

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
    const matchesCommunity = !filterCommunity || event.community?.id === filterCommunity;
    return matchesType && matchesStatus && matchesCommunity;
  });

  // Ordenação
  const sortedEvents = [...filteredEvents].sort((a, b) => {
    let comparison = 0;
    switch (sortField) {
      case 'title':
        comparison = a.title.localeCompare(b.title);
        break;
      case 'startDate':
        comparison = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
        break;
      case 'type':
        comparison = a.type.localeCompare(b.type);
        break;
      case 'status':
        comparison = a.status.localeCompare(b.status);
        break;
      case 'community':
        comparison = a.community.name.localeCompare(b.community.name);
        break;
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  // Paginação
  const totalPages = Math.ceil(sortedEvents.length / itemsPerPage);
  const paginatedEvents = sortedEvents.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedEvents(paginatedEvents.map((e) => e.id));
    } else {
      setSelectedEvents([]);
    }
  };

  const handleSelectEvent = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedEvents([...selectedEvents, id]);
    } else {
      setSelectedEvents(selectedEvents.filter((eid) => eid !== id));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedEvents.length === 0) return;
    if (!window.confirm(`Tem certeza que deseja excluir ${selectedEvents.length} evento(s)?`)) return;

    try {
      const token = localStorage.getItem('token');
      for (const id of selectedEvents) {
        await axios.delete(`${API_URL}/events/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      alert(`${selectedEvents.length} evento(s) excluído(s) com sucesso!`);
      setSelectedEvents([]);
      fetchData();
    } catch (error: any) {
      console.error('Erro ao excluir eventos:', error);
      alert(error.response?.data?.message || 'Erro ao excluir eventos');
    }
  };

  const exportToCSV = () => {
    const headers = ['Título', 'Tipo', 'Data Início', 'Local', 'Comunidade', 'Status', 'Participantes'];
    const rows = sortedEvents.map((event) => [
      event.title,
      getTypeLabel(event.type),
      formatDate(event.startDate),
      event.location || '',
      event.community.name,
      getStatusLabel(event.status),
      event._count.participants.toString(),
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `eventos_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  const getTypeLabel = (type: string) => {
    return eventTypes.find((t) => t.value === type)?.label || type;
  };

  const getStatusLabel = (status: string) => {
    return eventStatuses.find((s) => s.value === status)?.label || status;
  };

  const getStatusColor = (status: string) => {
    return eventStatuses.find((s) => s.value === status)?.color || '#6c757d';
  };

  const getTypeColor = (type: string) => {
    const colors: { [key: string]: string } = {
      MASS: '#9b59b6',
      RETREAT: '#3498db',
      FORMATION: '#27ae60',
      MEETING: '#f39c12',
      CELEBRATION: '#e74c3c',
      PILGRIMAGE: '#1abc9c',
      ADORATION: '#8e44ad',
      ROSARY: '#2980b9',
      CONFESSION: '#16a085',
      OTHER: '#95a5a6',
    };
    return colors[type] || '#95a5a6';
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

      <div className="events-controls">
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

          <select
            value={filterCommunity}
            onChange={(e) => setFilterCommunity(e.target.value)}
            className="filter-select filter-community"
          >
            <option value="">Todas as comunidades</option>
            {communities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.parish ? `${c.parish.name} › ${c.name}` : c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="view-toggle">
          <button
            className={`view-toggle-btn ${viewMode === 'calendar' ? 'active' : ''}`}
            onClick={() => setViewMode('calendar')}
          >
            📅 Calendário
          </button>
          <button
            className={`view-toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
            onClick={() => setViewMode('table')}
          >
            📋 Lista
          </button>
        </div>
      </div>

      {viewMode === 'calendar' ? (
        <EventCalendar
          events={filteredEvents}
          onEventClick={handleEventClick}
          onDateClick={handleDateClick}
        />
      ) : (
        <div className="events-table-container">
          {/* Ações em lote e exportação */}
          <div className="table-actions">
            <div className="bulk-actions">
              {selectedEvents.length > 0 && (
                <>
                  <span className="selected-count">{selectedEvents.length} selecionado(s)</span>
                  <button className="btn-bulk-delete" onClick={handleBulkDelete}>
                    Excluir Selecionados
                  </button>
                  <button className="btn-clear-selection" onClick={() => setSelectedEvents([])}>
                    Limpar Seleção
                  </button>
                </>
              )}
            </div>
            <div className="table-controls">
              <button className="btn-export" onClick={exportToCSV}>
                📥 Exportar CSV
              </button>
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="items-per-page"
              >
                <option value={10}>10 por página</option>
                <option value={25}>25 por página</option>
                <option value={50}>50 por página</option>
                <option value={100}>100 por página</option>
              </select>
            </div>
          </div>

          {/* Tabela */}
          <table className="events-table">
            <thead>
              <tr>
                <th className="checkbox-col">
                  <input
                    type="checkbox"
                    checked={selectedEvents.length === paginatedEvents.length && paginatedEvents.length > 0}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                  />
                </th>
                <th className="sortable" onClick={() => handleSort('title')}>
                  Título {sortField === 'title' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th className="sortable" onClick={() => handleSort('type')}>
                  Tipo {sortField === 'type' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th className="sortable" onClick={() => handleSort('startDate')}>
                  Data {sortField === 'startDate' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th>Local</th>
                <th className="sortable" onClick={() => handleSort('community')}>
                  Comunidade {sortField === 'community' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th className="sortable" onClick={() => handleSort('status')}>
                  Status {sortField === 'status' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th>Participantes</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {paginatedEvents.map((event) => (
                <tr key={event.id} className={selectedEvents.includes(event.id) ? 'selected' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedEvents.includes(event.id)}
                      onChange={(e) => handleSelectEvent(event.id, e.target.checked)}
                    />
                  </td>
                  <td className="title-cell">
                    <span className="event-title-link" onClick={() => handleEventClick(event)}>
                      {event.title}
                    </span>
                  </td>
                  <td>
                    <span className="type-badge" style={{ backgroundColor: getTypeColor(event.type) }}>
                      {getTypeLabel(event.type)}
                    </span>
                  </td>
                  <td>{formatDate(event.startDate)}</td>
                  <td>{event.location || '-'}</td>
                  <td>{event.community.name}</td>
                  <td>
                    <span className="status-badge" style={{ backgroundColor: getStatusColor(event.status) }}>
                      {getStatusLabel(event.status)}
                    </span>
                  </td>
                  <td className="center">
                    {event._count.participants}
                    {event.maxParticipants && ` / ${event.maxParticipants}`}
                  </td>
                  <td className="actions-cell">
                    <button className="btn-action btn-edit-small" onClick={() => handleEdit(event)} title="Editar">
                      ✏️
                    </button>
                    <button className="btn-action btn-delete-small" onClick={() => handleDelete(event.id)} title="Excluir">
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Paginação */}
          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
              >
                «
              </button>
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(currentPage - 1)}
                disabled={currentPage === 1}
              >
                ‹
              </button>
              <span className="pagination-info">
                Página {currentPage} de {totalPages} ({sortedEvents.length} eventos)
              </span>
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={currentPage === totalPages}
              >
                ›
              </button>
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
              >
                »
              </button>
            </div>
          )}

          {paginatedEvents.length === 0 && (
            <div className="empty-table">
              <p>Nenhum evento encontrado</p>
            </div>
          )}
        </div>
      )}

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

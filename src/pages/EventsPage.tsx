import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './EventsPage.css';

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
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
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
        axios.get('http://localhost:3000/api/v1/events', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get('http://localhost:3000/api/v1/communities', {
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
      const payload = {
        ...formData,
        maxParticipants: formData.maxParticipants ? parseInt(formData.maxParticipants) : undefined,
      };

      if (editingEvent) {
        await axios.patch(
          `http://localhost:3000/api/v1/events/${editingEvent.id}`,
          payload,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        alert('Evento atualizado com sucesso!');
      } else {
        await axios.post('http://localhost:3000/api/v1/events', payload, {
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
      maxParticipants: event.maxParticipants?.toString() || '',
      isPublic: event.isPublic,
      status: event.status,
      communityId: event.community.id,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este evento?')) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`http://localhost:3000/api/v1/events/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert('Evento excluído com sucesso!');
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
      maxParticipants: '',
      isPublic: true,
      status: 'DRAFT',
      communityId: '',
    });
    setEditingEvent(null);
  };

  const filteredEvents = events.filter((event) => {
    const matchesSearch = event.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          event.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = !filterType || event.type === filterType;
    const matchesStatus = !filterStatus || event.status === filterStatus;
    return matchesSearch && matchesType && matchesStatus;
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
        <h1>Eventos</h1>
        <button className="btn-new-event" onClick={() => {
          resetForm();
          setShowModal(true);
        }}>
          + Novo Evento
        </button>
      </div>

      <div className="events-filters">
        <input
          type="text"
          placeholder="Buscar por título ou descrição..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />

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

      <div className="events-grid">
        {filteredEvents.map((event) => (
          <div key={event.id} className="event-card">
            <div className="event-card-header">
              <h3>{event.title}</h3>
              <span
                className="event-status-badge"
                style={{ backgroundColor: getStatusColor(event.status) }}
              >
                {getStatusLabel(event.status)}
              </span>
            </div>

            <div className="event-card-body">
              <p className="event-type">
                <strong>Tipo:</strong> {getTypeLabel(event.type)}
              </p>

              {event.description && (
                <p className="event-description">{event.description}</p>
              )}

              <p className="event-date">
                <strong>Início:</strong> {formatDate(event.startDate)}
              </p>

              {event.endDate && (
                <p className="event-date">
                  <strong>Fim:</strong> {formatDate(event.endDate)}
                </p>
              )}

              {event.location && (
                <p className="event-location">
                  <strong>Local:</strong> {event.location}
                </p>
              )}

              <p className="event-community">
                <strong>Comunidade:</strong> {event.community.name}
                {event.community.parish && ` - ${event.community.parish.name}`}
              </p>

              {event.maxParticipants && (
                <p className="event-participants">
                  <strong>Inscritos:</strong> {event._count.participants} / {event.maxParticipants}
                </p>
              )}

              {event.isRecurring && (
                <span className="event-recurring-badge">🔄 Recorrente</span>
              )}
            </div>

            <div className="event-card-actions">
              <button className="btn-edit" onClick={() => handleEdit(event)}>
                Editar
              </button>
              <button className="btn-delete" onClick={() => handleDelete(event.id)}>
                Excluir
              </button>
            </div>
          </div>
        ))}
      </div>

      {filteredEvents.length === 0 && (
        <p className="no-events">Nenhum evento encontrado.</p>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingEvent ? 'Editar Evento' : 'Novo Evento'}</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} className="event-form">
              <div className="form-group">
                <label>Título *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>Descrição</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Tipo *</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    required
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
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    required
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
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    required
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
                />
              </div>

              <div className="form-group">
                <label>Comunidade *</label>
                <select
                  value={formData.communityId}
                  onChange={(e) => setFormData({ ...formData, communityId: e.target.value })}
                  required
                >
                  <option value="">Selecione</option>
                  {communities.map((community) => (
                    <option key={community.id} value={community.id}>
                      {community.name} {community.parish && `- ${community.parish.name}`}
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

              <div className="form-checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={formData.isRecurring}
                    onChange={(e) => setFormData({ ...formData, isRecurring: e.target.checked })}
                  />
                  Evento recorrente
                </label>

                <label>
                  <input
                    type="checkbox"
                    checked={formData.isPublic}
                    onChange={(e) => setFormData({ ...formData, isPublic: e.target.checked })}
                  />
                  Evento público
                </label>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowModal(false)}>
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
    </div>
  );
};

export default EventsPage;

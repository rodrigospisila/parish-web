import React, { useEffect, useMemo, useState } from 'react';
import TitleIcon from '../components/TitleIcon';
import axios from 'axios';
import Calendar from 'react-calendar';
import { useAuth } from '../contexts/AuthContext';
import CreateEventModal from '../components/CreateEventModal';
import EventCalendar from '../components/EventCalendar';
import TimeInput24h from '../components/TimeInput24h';
import {
  eventStatuses,
  eventTypes,
  getEventStatusColor,
  getEventStatusLabel,
  getEventTypeColor,
  getEventTypeLabel,
} from '../constants/eventOptions';
import { confirm, notify } from '../services/notification.service';
import SearchSelect from '../components/SearchSelect';
import SaintAvatar from '../components/SaintAvatar';
import { usePatronSaints } from '../components/PatronSaintsManager';
import 'react-calendar/dist/Calendar.css';
import './EventsPage.css';

/** Ponto colorido para as opções de tipo/status */
const colorDot = (color: string) => (
  <span
    style={{ width: 12, height: 12, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }}
  />
);

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

interface EventPastoralSummary {
  communityPastoralId: string;
  requiredPeople?: number;
  communityPastoral?: {
    id: string;
    name?: string;
    globalPastoral?: {
      id: string;
      name: string;
    };
  };
}

interface PastoralOption {
  id: string;
  name: string;
  communityId: string;
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
  eventPastorals?: EventPastoralSummary[];
  _count: {
    participants: number;
  };
}

type SortField = 'title' | 'startDate' | 'type' | 'status' | 'community';

const toLocalInputValue = (date: Date) => {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
};

const formatDate = (dateString: string) =>
  new Date(dateString).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const getPastoralName = (eventPastoral: EventPastoralSummary) =>
  eventPastoral.communityPastoral?.globalPastoral?.name ||
  eventPastoral.communityPastoral?.name ||
  'Pastoral';

const EventsPage: React.FC = () => {
  const [events, setEvents] = useState<Event[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [pastorals, setPastorals] = useState<PastoralOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [initialEventStartDate, setInitialEventStartDate] = useState('');
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [duplicateCopyTeam, setDuplicateCopyTeam] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCommunity, setFilterCommunity] = useState('');
  // Recorte temporal da visão Lista: próximos (padrão), anteriores ou todos
  const [periodFilter, setPeriodFilter] = useState<'upcoming' | 'past' | 'all'>('upcoming');

  // Padroeiros das comunidades — avatar nas opções do seletor
  const { patronsByEntity: communityPatrons } = usePatronSaints('community');

  // Arrastar para reagendar: apenas coordenação (o backend valida o escopo)
  const { user: currentUser } = useAuth();
  const canDragEvents = ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN', 'COMMUNITY_COORDINATOR', 'PASTORAL_COORDINATOR']
    .includes(currentUser?.role ?? '');

  // Mini-calendário lateral: data clicada navega o calendário principal
  const [miniDate, setMiniDate] = useState<Date | null>(null);

  // Agenda fixa (Missa/Confissão/Adoração/Terço) sobreposta ao calendário
  const [fixedOccurrences, setFixedOccurrences] = useState<any[]>([]);
  const [showFixed, setShowFixed] = useState(true);
  const [calendarRange, setCalendarRange] = useState<{ from: Date; to: Date } | null>(null);

  useEffect(() => {
    if (!calendarRange) return;
    if (!showFixed) {
      setFixedOccurrences([]);
      return;
    }
    const token = localStorage.getItem('token');
    axios
      .get(`${API_URL}/mass-schedules/occurrences`, {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          from: calendarRange.from.toISOString(),
          to: calendarRange.to.toISOString(),
          communityId: filterCommunity || undefined,
        },
      })
      .then((res) => setFixedOccurrences(res.data || []))
      .catch(() => setFixedOccurrences([]));
  }, [calendarRange, showFixed, filterCommunity]);
  // Preferência de visualização persistida por página
  const [viewMode, setViewModeState] = useState<'calendar' | 'table'>(
    () => (localStorage.getItem('parish:viewMode:events') === 'table' ? 'table' : 'calendar'),
  );
  const setViewMode = (mode: 'calendar' | 'table') => {
    setViewModeState(mode);
    localStorage.setItem('parish:viewMode:events', mode);
  };
  const [sortField, setSortField] = useState<SortField>('startDate');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      const [eventsRes, communitiesRes, pastoralsRes] = await Promise.all([
        axios.get(`${API_URL}/events`, { headers }),
        axios.get(`${API_URL}/communities`, { headers }),
        axios.get(`${API_URL}/pastorals/community`, { headers }),
      ]);

      setEvents(eventsRes.data);
      setCommunities(communitiesRes.data);
      setPastorals(
        pastoralsRes.data.map((pastoral: any) => ({
          id: pastoral.id,
          name: pastoral.globalPastoral?.name || pastoral.name,
          communityId: pastoral.communityId,
        })),
      );
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      notify.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const closeCreateModal = () => {
    setShowModal(false);
    setEditingEvent(null);
    setInitialEventStartDate('');
  };

  const openNewEventModal = () => {
    setEditingEvent(null);
    setInitialEventStartDate('');
    setShowModal(true);
  };

  const handleEdit = (event: Event) => {
    setEditingEvent(event);
    setInitialEventStartDate('');
    setShowDetailModal(false);
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirm.delete('este evento');
    if (!confirmed) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/events/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      notify.success('Evento excluído com sucesso!');
      setShowDetailModal(false);
      setSelectedEvents((selected) => selected.filter((eventId) => eventId !== id));
      fetchData();
    } catch (error: any) {
      console.error('Erro ao excluir evento:', error);
      notify.error(error.response?.data?.message || 'Erro ao excluir evento');
    }
  };

  const handleEventClick = (event: Event) => {
    setSelectedEvent(event);
    setShowDetailModal(true);
  };

  const handleDateClick = (date: Date) => {
    setEditingEvent(null);
    setInitialEventStartDate(toLocalInputValue(date));
    setShowModal(true);
  };

  const handleDuplicateClick = () => {
    setShowDetailModal(false);
    setShowDuplicateModal(true);
    setDuplicateCopyTeam(false);
  };

  const handleCalendarSelect = (date: Date) => {
    if (!selectedEvent) {
      return;
    }

    const originalDate = new Date(selectedEvent.startDate);
    const newDate = new Date(date);
    newDate.setHours(originalDate.getHours());
    newDate.setMinutes(originalDate.getMinutes());

    const dateStr = toLocalInputValue(newDate);
    setSelectedDates((dates) =>
      dates.includes(dateStr) ? dates.filter((selectedDate) => selectedDate !== dateStr) : [...dates, dateStr].sort(),
    );
  };

  const handleTimeChange = (oldDate: string, newTime: string) => {
    const [hours, minutes] = newTime.split(':');
    const date = new Date(oldDate);
    date.setHours(parseInt(hours, 10));
    date.setMinutes(parseInt(minutes, 10));
    const newDateStr = toLocalInputValue(date);

    setSelectedDates((dates) => dates.map((selectedDate) => (selectedDate === oldDate ? newDateStr : selectedDate)).sort());
  };

  const handleDuplicate = async () => {
    if (!selectedEvent || selectedDates.length === 0) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${API_URL}/events/${selectedEvent.id}/duplicate`,
        { dates: selectedDates, copyTeam: duplicateCopyTeam },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      notify.success(response.data.message);
      setShowDuplicateModal(false);
      setSelectedDates([]);
      setDuplicateCopyTeam(false);
      fetchData();
    } catch (error: any) {
      console.error('Erro ao duplicar evento:', error);
      notify.error(error.response?.data?.message || 'Erro ao duplicar evento');
    }
  };

  const filteredEvents = events.filter((event) => {
    const matchesType = !filterType || event.type === filterType;
    const matchesStatus = !filterStatus || event.status === filterStatus;
    const matchesCommunity = !filterCommunity || event.community?.id === filterCommunity;
    return matchesType && matchesStatus && matchesCommunity;
  });

  // Dias com evento (pontinhos no mini-calendário)
  const eventDays = useMemo(() => {
    const days = new Set<string>();
    for (const event of filteredEvents) {
      const date = new Date(event.startDate);
      days.add(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
    }
    return days;
  }, [filteredEvents]);

  /** Reagendar via arrastar-e-soltar: confirma, aplica o PATCH e recarrega */
  const handleCalendarEventDrop = async (
    event: { id: string; title: string; startDate: string; endDate?: string },
    newStart: Date,
  ): Promise<boolean> => {
    const when = newStart.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    const confirmed = await confirm.action('Reagendar evento', `Mover "${event.title}" para ${when}?`, 'Reagendar');
    if (!confirmed) return false;

    try {
      const token = localStorage.getItem('token');
      // Preserva a duração original quando o evento tem horário de término
      const duration = event.endDate
        ? new Date(event.endDate).getTime() - new Date(event.startDate).getTime()
        : null;
      await axios.patch(
        `${API_URL}/events/${event.id}`,
        {
          startDate: newStart.toISOString(),
          ...(duration !== null ? { endDate: new Date(newStart.getTime() + duration).toISOString() } : {}),
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      notify.success('Evento reagendado!');
      fetchData();
      return true;
    } catch (error: any) {
      notify.error(error.response?.data?.message || 'Erro ao reagendar o evento');
      return false;
    }
  };

  /** Exporta a agenda em .ics (Google Calendar, Outlook, Apple Calendar) */
  const handleExportIcs = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/events/export.ics`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { communityId: filterCommunity || undefined },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/calendar' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'agenda-paroquial.ics';
      link.click();
      URL.revokeObjectURL(url);
      notify.success('Agenda exportada! Importe o .ics no Google Calendar, Outlook ou Apple Calendar.');
    } catch {
      notify.error('Erro ao exportar a agenda');
    }
  };

  // A visão Lista mostra por padrão apenas os próximos eventos; o filtro de
  // período permite ver os anteriores ou todos. O calendário não é afetado.
  const now = Date.now();
  const isPastEvent = (event: Event) =>
    new Date(event.endDate || event.startDate).getTime() < now;
  const tableEvents = filteredEvents.filter((event) => {
    if (periodFilter === 'all') return true;
    return periodFilter === 'past' ? isPastEvent(event) : !isPastEvent(event);
  });

  const sortedEvents = [...tableEvents].sort((a, b) => {
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

  const totalPages = Math.ceil(sortedEvents.length / itemsPerPage);
  const paginatedEvents = sortedEvents.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortField(field);
    setSortDirection('asc');
  };

  const getSortMarker = (field: SortField) => {
    if (sortField !== field) {
      return '';
    }
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectedEvents(checked ? paginatedEvents.map((event) => event.id) : []);
  };

  const handleSelectEvent = (id: string, checked: boolean) => {
    setSelectedEvents((selected) => (checked ? [...selected, id] : selected.filter((eventId) => eventId !== id)));
  };

  const handleBulkDelete = async () => {
    if (selectedEvents.length === 0) {
      return;
    }

    const confirmed = await confirm.delete(`${selectedEvents.length} evento(s)`);
    if (!confirmed) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      for (const id of selectedEvents) {
        await axios.delete(`${API_URL}/events/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      notify.success(`${selectedEvents.length} evento(s) excluído(s) com sucesso!`);
      setSelectedEvents([]);
      fetchData();
    } catch (error: any) {
      console.error('Erro ao excluir eventos:', error);
      notify.error(error.response?.data?.message || 'Erro ao excluir eventos');
    }
  };

  const exportToCSV = () => {
    const headers = ['Título', 'Tipo', 'Data Início', 'Local', 'Comunidade', 'Status', 'Participantes'];
    const rows = sortedEvents.map((event) => [
      event.title,
      getEventTypeLabel(event.type),
      formatDate(event.startDate),
      event.location || '',
      event.community.name,
      getEventStatusLabel(event.status),
      event._count.participants.toString(),
    ]);

    const csvContent = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `eventos_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  if (loading) {
    return <div className="events-page">Carregando...</div>;
  }

  return (
    <div className="events-page">
      <div className="events-header">
        <h1 style={{ display: 'flex', alignItems: 'center' }}><TitleIcon name="calendario-liturgico" /> Agenda de Eventos</h1>
        <button className="btn-new-event" onClick={openNewEventModal}>
          + Novo Evento
        </button>
      </div>

      <div className="events-controls">
        <div className="events-filters">
          <SearchSelect
            options={eventTypes.map((type) => ({ value: type.value, label: type.label, icon: colorDot(type.color) }))}
            value={filterType}
            onChange={setFilterType}
            placeholder="Todos os tipos"
            allOption
            searchPlaceholder="Buscar tipo..."
          />
          <SearchSelect
            options={eventStatuses.map((status) => ({ value: status.value, label: status.label, icon: colorDot(status.color) }))}
            value={filterStatus}
            onChange={setFilterStatus}
            placeholder="Todos os status"
            allOption
            searchPlaceholder="Buscar status..."
          />
          <SearchSelect
            options={communities.map((community) => {
              const patron = communityPatrons[community.id]?.[0];
              return {
                value: community.id,
                label: community.name,
                sublabel: community.parish?.name,
                icon: patron ? <SaintAvatar saint={patron.saint} small /> : undefined,
              };
            })}
            value={filterCommunity}
            onChange={setFilterCommunity}
            placeholder="Todas as comunidades"
            allOption
            searchPlaceholder="Buscar comunidade ou paróquia..."
          />
        </div>

        <div className="view-toggle">
          <button
            className={`view-toggle-btn ${viewMode === 'calendar' ? 'active' : ''}`}
            onClick={() => setViewMode('calendar')}
          >
            Calendário
          </button>
          <button
            className={`view-toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
            onClick={() => setViewMode('table')}
          >
            Lista
          </button>
        </div>
      </div>

      {(filterCommunity || filterType || filterStatus) && (
        <div className="active-filters-banner">
          <div className="active-filters-content">
            <span className="filter-icon">+</span>
            <span className="filter-label">Filtros ativos:</span>
            {filterCommunity && (
              <span className="filter-badge filter-badge-community">
                Comunidade:{' '}
                {communities.find((community) => community.id === filterCommunity)?.parish
                  ? `${communities.find((community) => community.id === filterCommunity)?.parish?.name} - ${
                      communities.find((community) => community.id === filterCommunity)?.name
                    }`
                  : communities.find((community) => community.id === filterCommunity)?.name}
                <button className="filter-remove" onClick={() => setFilterCommunity('')}>
                  x
                </button>
              </span>
            )}
            {filterType && (
              <span className="filter-badge filter-badge-type">
                Tipo: {getEventTypeLabel(filterType)}
                <button className="filter-remove" onClick={() => setFilterType('')}>
                  x
                </button>
              </span>
            )}
            {filterStatus && (
              <span className="filter-badge filter-badge-status">
                Status: {getEventStatusLabel(filterStatus)}
                <button className="filter-remove" onClick={() => setFilterStatus('')}>
                  x
                </button>
              </span>
            )}
            <button
              className="btn-clear-all-filters"
              onClick={() => {
                setFilterCommunity('');
                setFilterType('');
                setFilterStatus('');
              }}
            >
              Limpar todos
            </button>
          </div>
          <div className="filter-results-count">{filteredEvents.length} evento(s) encontrado(s)</div>
        </div>
      )}

      {viewMode === 'calendar' ? (
        <div className="calendar-layout">
          {/* Mini-calendário lateral: navegação rápida + pontinhos nos dias com evento */}
          <aside className="calendar-side">
            <Calendar
              locale="pt-BR"
              value={miniDate}
              onChange={(value) => {
                const date = Array.isArray(value) ? value[0] : value;
                if (date instanceof Date) setMiniDate(date);
              }}
              tileContent={({ date, view }) =>
                view === 'month' && eventDays.has(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`) ? (
                  <span className="mini-cal-dot" />
                ) : null
              }
            />
            <button type="button" className="entity-btn primary calendar-ics-btn" onClick={handleExportIcs}>
              📆 Exportar agenda (.ics)
            </button>
            <p className="mini-cal-hint">
              Clique numa data para navegar. O .ics pode ser importado no Google Calendar, Outlook ou iPhone.
            </p>
          </aside>

          <div className="calendar-main">
            {/* Legenda clicável por tipo (padrão de mercado): clique filtra o calendário */}
            <div className="calendar-legend">
              {eventTypes.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  className={`legend-item ${filterType === type.value ? 'active' : filterType ? 'dimmed' : ''}`}
                  onClick={() => setFilterType(filterType === type.value ? '' : type.value)}
                  title={filterType === type.value ? 'Clique para limpar o filtro' : `Mostrar apenas: ${type.label}`}
                >
                  <span className="legend-dot" style={{ background: type.color }} />
                  {type.label}
                </button>
              ))}
              {/* Toggle da agenda fixa (Missa/Confissão/Adoração/Terço) */}
              <button
                type="button"
                className={`legend-item ${showFixed ? 'active' : 'dimmed'}`}
                onClick={() => setShowFixed((value) => !value)}
                title={showFixed ? 'Ocultar a agenda fixa' : 'Mostrar a agenda fixa'}
              >
                🕐 Agenda fixa
              </button>
            </div>
            <EventCalendar
              events={filteredEvents}
              onEventClick={handleEventClick}
              onDateClick={handleDateClick}
              editable={canDragEvents}
              onEventDrop={handleCalendarEventDrop}
              focusDate={miniDate}
              fixedOccurrences={showFixed ? fixedOccurrences : []}
              onRangeChange={(from, to) => setCalendarRange({ from, to })}
            />
            {canDragEvents && (
              <p className="calendar-drag-hint">💡 Dica: arraste um evento para outra data para reagendá-lo.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="events-table-container entity-table">
          <div className="table-actions">
            <div className="bulk-actions" style={selectedEvents.length === 0 ? { display: 'none' } : undefined}>
              {selectedEvents.length > 0 && (
                <>
                  <span className="selected-count">{selectedEvents.length} selecionado(s)</span>
                  <button className="btn-bulk-delete" onClick={handleBulkDelete}>
                    Excluir selecionados
                  </button>
                  <button className="btn-clear-selection" onClick={() => setSelectedEvents([])}>
                    Limpar seleção
                  </button>
                </>
              )}
            </div>
            <div className="table-controls">
              <div className="period-toggle">
                {([
                  { value: 'upcoming', label: 'Próximos' },
                  { value: 'past', label: 'Anteriores' },
                  { value: 'all', label: 'Todos' },
                ] as const).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`period-toggle-btn ${periodFilter === option.value ? 'active' : ''}`}
                    onClick={() => {
                      setPeriodFilter(option.value);
                      setCurrentPage(1);
                      // Anteriores: mais recentes primeiro; próximos: mais próximos primeiro
                      setSortField('startDate');
                      setSortDirection(option.value === 'past' ? 'desc' : 'asc');
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <button className="btn-export" onClick={exportToCSV}>
                Exportar CSV
              </button>
              <select
                value={itemsPerPage}
                onChange={(event) => {
                  setItemsPerPage(Number(event.target.value));
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

          <table className="events-table">
            <thead>
              <tr>
                <th className="checkbox-col">
                  <input
                    type="checkbox"
                    checked={selectedEvents.length === paginatedEvents.length && paginatedEvents.length > 0}
                    onChange={(event) => handleSelectAll(event.target.checked)}
                  />
                </th>
                <th className="sortable" onClick={() => handleSort('title')}>
                  Título{getSortMarker('title')}
                </th>
                <th className="sortable" onClick={() => handleSort('type')}>
                  Tipo{getSortMarker('type')}
                </th>
                <th className="sortable" onClick={() => handleSort('startDate')}>
                  Data{getSortMarker('startDate')}
                </th>
                <th>Local</th>
                <th className="sortable" onClick={() => handleSort('community')}>
                  Comunidade{getSortMarker('community')}
                </th>
                <th className="sortable" onClick={() => handleSort('status')}>
                  Status{getSortMarker('status')}
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
                      onChange={(inputEvent) => handleSelectEvent(event.id, inputEvent.target.checked)}
                    />
                  </td>
                  <td className="title-cell">
                    <div>
                      <span className="event-title-link" onClick={() => handleEventClick(event)}>
                        {event.title}
                      </span>
                      {event.eventPastorals && event.eventPastorals.length > 0 && (
                        <small style={{ display: 'block', color: '#6b7280' }}>
                          {event.eventPastorals
                            .map(
                              (eventPastoral) =>
                                `${getPastoralName(eventPastoral)}${
                                  eventPastoral.requiredPeople ? ` (${eventPastoral.requiredPeople} vagas)` : ''
                                }`,
                            )
                            .join(', ')}
                        </small>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className="type-badge" style={{ backgroundColor: getEventTypeColor(event.type) }}>
                      {getEventTypeLabel(event.type)}
                    </span>
                  </td>
                  <td>{formatDate(event.startDate)}</td>
                  <td>{event.location || '-'}</td>
                  <td>{event.community.name}</td>
                  <td>
                    <span className="status-badge" style={{ backgroundColor: getEventStatusColor(event.status) }}>
                      {getEventStatusLabel(event.status)}
                    </span>
                  </td>
                  <td className="center">
                    {event._count.participants}
                    {event.maxParticipants && ` / ${event.maxParticipants}`}
                  </td>
                  <td className="actions-cell">
                    <button className="entity-icon-btn" onClick={() => handleEdit(event)} title="Editar">
                      ✏️
                    </button>
                    <button className="entity-icon-btn danger" onClick={() => handleDelete(event.id)} title="Excluir">
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {paginatedEvents.length === 0 && (
            <div className="empty-state" style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>
              {periodFilter === 'upcoming'
                ? 'Nenhum evento futuro. Use "Anteriores" ou "Todos" para ver o histórico.'
                : 'Nenhum evento encontrado para este filtro.'}
            </div>
          )}

          {totalPages > 1 && (
            <div className="pagination">
              <button className="pagination-btn" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>
                {'<<'}
              </button>
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(currentPage - 1)}
                disabled={currentPage === 1}
              >
                {'<'}
              </button>
              <span className="pagination-info">
                Página {currentPage} de {totalPages} ({sortedEvents.length} eventos)
              </span>
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={currentPage === totalPages}
              >
                {'>'}
              </button>
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
              >
                {'>>'}
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

      {showDetailModal && selectedEvent && (
        <div className="modal-overlay" onClick={() => setShowDetailModal(false)}>
          <div className="modal-content event-detail-modal" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowDetailModal(false)}>
              x
            </button>

            <div className="event-detail-header">
              <h2>{selectedEvent.title}</h2>
              <span className="event-status-badge" style={{ backgroundColor: getEventStatusColor(selectedEvent.status) }}>
                {getEventStatusLabel(selectedEvent.status)}
              </span>
            </div>

            <div className="event-detail-body">
              <div className="detail-row">
                <strong>Tipo:</strong>
                <span>{getEventTypeLabel(selectedEvent.type)}</span>
              </div>

              {selectedEvent.description && (
                <div className="detail-row">
                  <strong>Descrição:</strong>
                  <p>{selectedEvent.description}</p>
                </div>
              )}

              <div className="detail-row">
                <strong>Início:</strong>
                <span>{formatDate(selectedEvent.startDate)}</span>
              </div>

              {selectedEvent.endDate && (
                <div className="detail-row">
                  <strong>Fim:</strong>
                  <span>{formatDate(selectedEvent.endDate)}</span>
                </div>
              )}

              {selectedEvent.location && (
                <div className="detail-row">
                  <strong>Local:</strong>
                  <span>{selectedEvent.location}</span>
                </div>
              )}

              <div className="detail-row">
                <strong>Comunidade:</strong>
                <span>
                  {selectedEvent.community.name}
                  {selectedEvent.community.parish && ` - ${selectedEvent.community.parish.name}`}
                </span>
              </div>

              {selectedEvent.eventPastorals && selectedEvent.eventPastorals.length > 0 && (
                <div className="detail-row">
                  <strong>Pastorais:</strong>
                  <span>
                    {selectedEvent.eventPastorals
                      .map(
                        (eventPastoral) =>
                          `${getPastoralName(eventPastoral)}${
                            eventPastoral.requiredPeople ? ` (${eventPastoral.requiredPeople} vagas)` : ''
                          }`,
                      )
                      .join(', ')}
                  </span>
                </div>
              )}

              {selectedEvent.maxParticipants && (
                <div className="detail-row">
                  <strong>Participantes:</strong>
                  <span>
                    {selectedEvent._count.participants} / {selectedEvent.maxParticipants} inscritos
                  </span>
                </div>
              )}

              <div className="detail-row">
                <strong>Visibilidade:</strong>
                <span>{selectedEvent.isPublic ? 'Público' : 'Privado'}</span>
              </div>
            </div>

            <div className="event-detail-actions">
              <button className="btn-edit" onClick={() => handleEdit(selectedEvent)}>
                Editar
              </button>
              <button className="btn-duplicate" onClick={handleDuplicateClick}>
                Duplicar
              </button>
              <button className="btn-delete" onClick={() => handleDelete(selectedEvent.id)}>
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      <CreateEventModal
        isOpen={showModal}
        onClose={closeCreateModal}
        onSuccess={() => {
          fetchData();
          closeCreateModal();
        }}
        communities={communities}
        pastorals={pastorals}
        editingEvent={editingEvent}
        initialStartDate={initialEventStartDate}
      />

      {showDuplicateModal && selectedEvent && (
        <div
          className="modal-overlay"
          onClick={() => {
            setShowDuplicateModal(false);
            setSelectedDates([]);
          }}
        >
          <div className="modal-content duplicate-modal" onClick={(event) => event.stopPropagation()}>
            <button
              className="modal-close"
              onClick={() => {
                setShowDuplicateModal(false);
                setSelectedDates([]);
              }}
            >
              x
            </button>

            <h2>Duplicar Evento</h2>
            <p className="duplicate-info">
              Selecione as datas para duplicar o evento <strong>"{selectedEvent.title}"</strong>
            </p>

            <div className="duplicate-content">
              <div className="calendar-section">
                <Calendar
                  onChange={(value) => {
                    if (value instanceof Date) {
                      handleCalendarSelect(value);
                    }
                  }}
                  value={null}
                  minDate={new Date()}
                  locale="pt-BR"
                  tileClassName={({ date }) => {
                    const originalDate = new Date(selectedEvent.startDate);
                    const candidate = new Date(date);
                    candidate.setHours(originalDate.getHours());
                    candidate.setMinutes(originalDate.getMinutes());
                    return selectedDates.includes(toLocalInputValue(candidate)) ? 'selected-date' : '';
                  }}
                />
              </div>

              {selectedDates.length > 0 ? (
                <div className="selected-dates-list">
                  <h4>Datas selecionadas ({selectedDates.length})</h4>
                  <ul>
                    {selectedDates.map((date) => {
                      const dateObj = new Date(date);
                      const dateText = dateObj.toLocaleDateString('pt-BR');
                      const timeText = `${dateObj.getHours().toString().padStart(2, '0')}:${dateObj
                        .getMinutes()
                        .toString()
                        .padStart(2, '0')}`;

                      return (
                        <li key={date}>
                          <div className="date-item">
                            <span className="date-text">{dateText}</span>
                            <TimeInput24h value={timeText} onChange={(newTime) => handleTimeChange(date, newTime)} />
                          </div>
                          <button type="button" className="btn-remove-date" onClick={() => setSelectedDates((dates) => dates.filter((selectedDate) => selectedDate !== date))}>
                            x
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <div className="empty-dates">
                  <p>Nenhuma data selecionada</p>
                  <small>Clique nas datas do calendário para selecionar</small>
                </div>
              )}
            </div>

            <label className="duplicate-copy-team">
              <input
                type="checkbox"
                checked={duplicateCopyTeam}
                onChange={(event) => setDuplicateCopyTeam(event.target.checked)}
              />
              Repetir a mesma equipe da escala (membros escalados precisarao reconfirmar presenca)
            </label>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => {
                  setShowDuplicateModal(false);
                  setSelectedDates([]);
                  setDuplicateCopyTeam(false);
                }}
              >
                Cancelar
              </button>
              <button type="button" className="btn-submit" onClick={handleDuplicate} disabled={selectedDates.length === 0}>
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

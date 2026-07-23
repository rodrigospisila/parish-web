import React, { useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import { getEventTypeColor, getEventTypeIcon, getEventTypeLabel } from '../constants/eventOptions';
import './EventCalendar.css';

interface Community {
  id: string;
  name: string;
  parish?: {
    id: string;
    name: string;
    diocese?: {
      id: string;
      name: string;
    };
  };
}

interface CalendarEvent {
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

interface EventCalendarProps {
  events: CalendarEvent[];
  onEventClick: (event: CalendarEvent) => void;
  onDateClick: (date: Date) => void;
  /** Habilita arrastar para reagendar (coordenação) */
  editable?: boolean;
  /** Chamado ao soltar um evento em nova data; retorne false para reverter */
  onEventDrop?: (event: CalendarEvent, newStart: Date, newEnd: Date | null) => Promise<boolean>;
  /** Data para o calendário navegar (mini-calendário lateral) */
  focusDate?: Date | null;
  /** Ocorrências da agenda fixa (Missa/Confissão/...) para exibir junto */
  fixedOccurrences?: FixedOccurrence[];
  /** Notifica a página do período visível (para buscar as ocorrências fixas) */
  onRangeChange?: (from: Date, to: Date) => void;
}

export interface FixedOccurrence {
  id: string;
  title: string;
  type: string;
  start: string;
  end: string;
  community?: { id: string; name: string } | null;
}

const EventCalendar: React.FC<EventCalendarProps> = ({
  events,
  onEventClick,
  onDateClick,
  editable = false,
  onEventDrop,
  focusDate,
  fixedOccurrences = [],
  onRangeChange,
}) => {
  const calendarRef = useRef<FullCalendar>(null);

  // Navegação pelo mini-calendário lateral
  React.useEffect(() => {
    if (focusDate) {
      calendarRef.current?.getApi().gotoDate(focusDate);
    }
  }, [focusDate]);

  const calendarEvents = events.map((event) => ({
    id: event.id,
    title: event.title,
    start: event.startDate,
    end: event.endDate || event.startDate,
    backgroundColor: getEventTypeColor(event.type),
    borderColor: getEventTypeColor(event.type),
    editable,
    extendedProps: {
      ...event,
      typeLabel: getEventTypeLabel(event.type),
      isFixed: false,
    },
  }));

  // Cor neutra e estilo distinto para os horários fixos (agenda da comunidade)
  const FIXED_COLOR = '#64748b';
  const fixedCalendarEvents = fixedOccurrences.map((occ) => ({
    id: occ.id,
    title: occ.title,
    start: occ.start,
    end: occ.end,
    backgroundColor: 'transparent',
    borderColor: FIXED_COLOR,
    editable: false, // agenda fixa não se arrasta; edite em "Agenda Fixa"
    classNames: ['fc-fixed-occurrence'],
    extendedProps: {
      isFixed: true,
      typeLabel: occ.title,
      location: null,
      community: occ.community,
    },
  }));

  const allCalendarEvents = [...calendarEvents, ...fixedCalendarEvents];

  const handleEventClick = (clickInfo: any) => {
    // Ocorrência fixa não abre o modal de evento (é virtual)
    if (clickInfo.event.extendedProps?.isFixed) return;
    const event = events.find((calendarEvent) => calendarEvent.id === clickInfo.event.id);
    if (event) {
      onEventClick(event);
    }
  };

  const handleDateClick = (arg: any) => {
    onDateClick(new Date(arg.dateStr));
  };

  // Arrastar para reagendar: delega à página (PATCH); reverte se recusado/erro
  const handleEventDrop = async (info: any) => {
    const event = events.find((calendarEvent) => calendarEvent.id === info.event.id);
    if (!event || !onEventDrop) {
      info.revert();
      return;
    }
    const ok = await onEventDrop(event, info.event.start, info.event.end).catch(() => false);
    if (!ok) info.revert();
  };

  return (
    <div className="event-calendar-container">
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
        initialView={typeof window !== 'undefined' && window.innerWidth < 768 ? 'listMonth' : 'dayGridMonth'}
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay,listMonth',
        }}
        buttonText={{
          today: 'Hoje',
          month: 'Mês',
          week: 'Semana',
          day: 'Dia',
          list: 'Lista',
        }}
        locale="pt-br"
        firstDay={0}
        height="auto"
        events={allCalendarEvents}
        eventClick={handleEventClick}
        dateClick={handleDateClick}
        editable={editable}
        eventDurationEditable={false}
        eventDrop={handleEventDrop}
        datesSet={(arg) => onRangeChange?.(arg.start, arg.end)}
        eventTimeFormat={{
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }}
        slotLabelFormat={{
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }}
        eventContent={(arg) => {
          const { event } = arg;
          const typeLabel = event.extendedProps.typeLabel;
          const location = event.extendedProps.location;
          const icon = getEventTypeIcon(event.extendedProps.type);

          const isFixed = event.extendedProps.isFixed;

          // Visão mensal: linha compacta (estilo Google Calendar) — detalhes no
          // hover (tooltip) e no clique. Semana/dia/lista: conteúdo completo.
          if (arg.view.type === 'dayGridMonth') {
            return (
              <div
                className={`fc-evt-compact ${isFixed ? 'is-fixed' : ''}`}
                style={{ ['--evt-color' as any]: isFixed ? '#64748b' : event.backgroundColor }}
              >
                {isFixed && <span className="fc-evt-fixed-icon">🕐</span>}
                {arg.timeText && <span className="fc-evt-compact-time">{arg.timeText}</span>}
                <span className="fc-evt-compact-title">{event.title}</span>
              </div>
            );
          }

          // Semana/dia/lista para a agenda fixa: conteúdo enxuto com relógio
          if (isFixed) {
            return (
              <div className="fc-event-content-custom is-fixed">
                <div className="fc-event-header-custom">
                  <span className="fc-event-icon">🕐</span>
                  <span className="fc-event-time">{arg.timeText}</span>
                </div>
                <div className="fc-event-title-custom">{event.title}</div>
                <div className="fc-event-type-badge">Agenda fixa</div>
              </div>
            );
          }

          return (
            <div className="fc-event-content-custom">
              <div className="fc-event-header-custom">
                <span className="fc-event-icon">{icon}</span>
                <span className="fc-event-time">{arg.timeText}</span>
              </div>
              <div className="fc-event-title-custom">{event.title}</div>
              {location && <div className="fc-event-location">Local: {location}</div>}
              <div className="fc-event-type-badge">{typeLabel}</div>
            </div>
          );
        }}
        eventDidMount={(info) => {
          // Tooltip nativo com os detalhes (padrão de mercado: detalhes no hover)
          const p = info.event.extendedProps as any;
          const lines = [
            `${info.timeText ? `${info.timeText} · ` : ''}${info.event.title}`,
            p.isFixed ? 'Agenda fixa da comunidade' : [p.typeLabel, p.location].filter(Boolean).join(' · '),
            p.community?.name,
          ].filter(Boolean);
          info.el.setAttribute('title', lines.join('\n'));
        }}
        dayMaxEvents={3}
        moreLinkText={(num) => `+${num} eventos`}
        allDaySlot={false}
        slotMinTime="06:00:00"
        slotMaxTime="23:00:00"
        nowIndicator
        weekends
        dayHeaderFormat={{ weekday: 'short' }}
        views={{
          dayGridMonth: { titleFormat: { year: 'numeric', month: 'long' } },
        }}
      />
    </div>
  );
};

export default EventCalendar;

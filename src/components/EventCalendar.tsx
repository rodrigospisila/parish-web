import React, { useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
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
}

// Cores por tipo de evento
const eventTypeColors: Record<string, string> = {
  MASS: '#dc3545',           // Vermelho - Missa
  BAPTISM: '#007bff',        // Azul - Batismo
  WEDDING: '#28a745',        // Verde - Casamento
  CATECHISM: '#ffc107',      // Amarelo - Catequese
  MEETING: '#6f42c1',        // Roxo - Reunião
  CELEBRATION: '#fd7e14',    // Laranja - Celebração
  RETREAT: '#20c997',        // Verde-água - Retiro
  FORMATION: '#17a2b8',      // Ciano - Formação
  PILGRIMAGE: '#e83e8c',     // Rosa - Peregrinação
  ADORATION: '#6610f2',      // Índigo - Adoração
  ROSARY: '#d63384',         // Rosa escuro - Terço
  CONFESSION: '#0dcaf0',     // Ciano claro - Confissão
  OTHER: '#6c757d',          // Cinza - Outro
};

// Labels em português para os tipos
const eventTypeLabels: Record<string, string> = {
  MASS: 'Missa',
  BAPTISM: 'Batismo',
  WEDDING: 'Casamento',
  CATECHISM: 'Catequese',
  MEETING: 'Reunião',
  CELEBRATION: 'Celebração',
  RETREAT: 'Retiro',
  FORMATION: 'Formação',
  PILGRIMAGE: 'Peregrinação',
  ADORATION: 'Adoração',
  ROSARY: 'Terço',
  CONFESSION: 'Confissão',
  OTHER: 'Outro',
};

const EventCalendar: React.FC<EventCalendarProps> = ({ events, onEventClick, onDateClick }) => {
  const calendarRef = useRef<FullCalendar>(null);

  // Converter eventos para formato do FullCalendar
  const calendarEvents = events.map(event => ({
    id: event.id,
    title: event.title,
    start: event.startDate,
    end: event.endDate || event.startDate,
    backgroundColor: eventTypeColors[event.type] || eventTypeColors.OTHER,
    borderColor: eventTypeColors[event.type] || eventTypeColors.OTHER,
    extendedProps: {
      ...event,
      typeLabel: eventTypeLabels[event.type] || event.type,
    },
  }));

  const handleEventClick = (clickInfo: any) => {
    const event = events.find(e => e.id === clickInfo.event.id);
    if (event) {
      onEventClick(event);
    }
  };

  const handleDateClick = (arg: any) => {
    onDateClick(new Date(arg.dateStr));
  };

  return (
    <div className="event-calendar-container">
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
        initialView="dayGridMonth"
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
        firstDay={0} // Domingo
        height="auto"
        events={calendarEvents}
        eventClick={handleEventClick}
        dateClick={handleDateClick}
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
          
          return (
            <div className="fc-event-content-custom">
              <div className="fc-event-time">{arg.timeText}</div>
              <div className="fc-event-title-custom">
                <strong>{event.title}</strong>
              </div>
              {location && (
                <div className="fc-event-location">📍 {location}</div>
              )}
              <div className="fc-event-type">{typeLabel}</div>
            </div>
          );
        }}
        dayMaxEvents={3}
        moreLinkText={(num) => `+${num} eventos`}
        allDaySlot={false}
        slotMinTime="06:00:00"
        slotMaxTime="23:00:00"
        nowIndicator={true}
      />
    </div>
  );
};

export default EventCalendar;

export const eventTypes = [
  { value: 'MASS', label: 'Missa', color: '#8b5cf6', icon: 'M' },
  { value: 'SACRAMENT', label: 'Sacramento', color: '#0ea5e9', icon: 'S' },
  { value: 'PASTORAL_MEETING', label: 'Reunião de pastoral', color: '#f59e0b', icon: 'R' },
  { value: 'PASTORAL_ACTIVITY', label: 'Atividade de pastoral', color: '#10b981', icon: 'A' },
  { value: 'COMMUNITY_EVENT', label: 'Evento comunitário', color: '#ef4444', icon: 'C' },
  { value: 'RETREAT', label: 'Retiro', color: '#14b8a6', icon: 'T' },
  { value: 'FORMATION', label: 'Formação', color: '#2563eb', icon: 'F' },
  { value: 'VISITATION', label: 'Visitação', color: '#64748b', icon: 'V' },
] as const;

/**
 * Tipos que só existem na agenda fixa (MassScheduleType), não em Event: não
 * entram nos seletores de evento, mas ganham rótulo/cor/ícone onde aparecem.
 */
const scheduleOnlyTypes = [
  { value: 'WORD_CELEBRATION', label: 'Celebração da Palavra', color: '#16a34a', icon: '📖' },
] as const;

const findType = (type: string) =>
  eventTypes.find((eventType) => eventType.value === type) ??
  scheduleOnlyTypes.find((scheduleType) => scheduleType.value === type);

export const eventStatuses = [
  { value: 'DRAFT', label: 'Rascunho', color: '#6c757d' },
  { value: 'PUBLISHED', label: 'Publicado', color: '#28a745' },
  { value: 'CANCELLED', label: 'Cancelado', color: '#dc3545' },
  { value: 'COMPLETED', label: 'Concluído', color: '#007bff' },
] as const;

export const getEventTypeLabel = (type: string) => findType(type)?.label || type;

export const getEventTypeColor = (type: string) => findType(type)?.color || '#95a5a6';

export const getEventTypeIcon = (type: string) => findType(type)?.icon || 'E';

export const getEventStatusLabel = (status: string) =>
  eventStatuses.find((eventStatus) => eventStatus.value === status)?.label || status;

export const getEventStatusColor = (status: string) =>
  eventStatuses.find((eventStatus) => eventStatus.value === status)?.color || '#6c757d';

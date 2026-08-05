import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import TitleIcon from '../components/TitleIcon';
import { notify, confirm } from '../services/notification.service';
import { useAuth } from '../contexts/AuthContext';
import './SchedulesPage.css';

const API_URL = import.meta.env.VITE_API_URL;

type UserRole =
  | 'SYSTEM_ADMIN'
  | 'DIOCESAN_ADMIN'
  | 'PARISH_ADMIN'
  | 'COMMUNITY_COORDINATOR'
  | 'PASTORAL_COORDINATOR';

type ScheduleStatus = 'OPEN' | 'CLOSED' | 'COMPLETED' | 'CANCELLED';
type AssignmentStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED';
type CandidateRecommendationLevel = 'RECOMMENDED' | 'ATTENTION' | 'CONFLICT';
type CandidateHistoryOutcome = 'CHECKED_IN' | 'NO_SHOW' | 'DECLINED';
type CandidateFilter = 'all' | 'recommended' | 'attention' | 'conflict';

interface SchedulePastoralInfo {
  id: string;
  communityPastoralId: string;
  role?: string | null;
  isLeader?: boolean;
  requiredPeople: number;
  communityPastoral?: { id: string; globalPastoral?: { id: string; name: string } | null } | null;
}

interface Schedule {
  id: string;
  title: string;
  description?: string;
  date: string;
  status: ScheduleStatus;
  // Escala sem evento (serviço contínuo): o backend sintetiza um resumo
  // "event-like" com os dados da própria escala e marca isStandalone.
  isStandalone?: boolean;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  event: EventItem;
  // Pastorais vinculadas à ESCALA (fonte das vagas; vem no GET /schedules/:id)
  pastorals?: SchedulePastoralInfo[];
  assignments: Assignment[];
  _count: { assignments: number };
}

interface RotationSuggestion {
  role: string;
  memberId: string;
  memberName: string;
  score: number;
  spouseId?: string | null;
}

interface RotationGap {
  role: string;
  missing: number;
}

interface RotationPreviewItem {
  scheduleId: string;
  title: string;
  date: string;
  suggestions: RotationSuggestion[];
  gaps: RotationGap[];
  pastorals?: Array<{ communityPastoralId: string; name: string; requiredPeople: number }>;
  noPastorals?: boolean;
  noSlots?: boolean;
  allFilled?: boolean;
}

interface RotationResponse {
  dryRun: boolean;
  created?: number;
  preview: RotationPreviewItem[];
}

interface CommunityOption {
  id: string;
  name: string;
}

interface EventItem {
  id: string;
  title: string;
  type: string;
  description?: string;
  startDate: string;
  endDate?: string;
  location?: string;
  isRecurring?: boolean;
  community: {
    id: string;
    name: string;
    parish?: {
      id: string;
      name: string;
    };
  };
  eventPastorals?: EventPastoral[];
}

interface EventPastoral {
  communityPastoralId: string;
  requiredPeople?: number;
  role?: string;
  isLeader: boolean;
  communityPastoral?: {
    id: string;
    globalPastoral?: {
      id: string;
      name: string;
    };
  };
}

interface Assignment {
  id: string;
  role: string;
  status: AssignmentStatus;
  checkedIn: boolean;
  checkedInAt?: string;
  member: {
    id: string;
    fullName: string;
    email?: string;
    phone?: string;
    photoUrl?: string | null;
    spouseId?: string | null;
  };
  /** Pedidos de troca em aberto desta atribuição */
  swapRequests?: Array<{ id: string; message?: string | null; createdAt?: string }>;
  communityPastoral?: {
    id: string;
    globalPastoral?: {
      id: string;
      name: string;
    };
    community?: {
      id: string;
      name: string;
    };
  };
}

interface OverviewAssignment {
  id: string;
  memberId: string;
  memberName: string;
  role: string;
  status: AssignmentStatus;
  checkedIn: boolean;
  checkedInAt?: string;
  /** O membro tem pedido de troca em aberto para esta atribuição */
  hasPendingSwap?: boolean;
  /** Mensagem do pedido de troca mais recente (motivo informado pelo membro) */
  pendingSwapMessage?: string | null;
  /** Cônjuge (para destacar casais escalados juntos) */
  spouseId?: string | null;
}

/** Cônjuge do membro quando também está escalado no mesmo grupo. */
const coupleIn = <T,>(
  spouseId: string | null | undefined,
  list: T[],
  idOf: (item: T) => string,
  nameOf: (item: T) => string,
): string | null => {
  if (!spouseId) return null;
  const match = list.find((item) => idOf(item) === spouseId);
  return match ? nameOf(match) : null;
};

/** Link do WhatsApp a partir de um telefone BR (adiciona 55 quando faltar o DDI). */
const whatsappUrl = (phone: string) => {
  const digits = phone.replace(/\D/g, '');
  const full = digits.startsWith('55') && digits.length >= 12 ? digits : `55${digits}`;
  return `https://wa.me/${full}`;
};

/** Texto do tooltip do alerta de troca (inclui a mensagem, quando houver). */
const swapTooltip = (assignment: OverviewAssignment) =>
  assignment.pendingSwapMessage
    ? `Pediu troca: “${assignment.pendingSwapMessage}”`
    : 'Pediu troca desta escala (sem mensagem)';

/** Resumo dos pedidos de troca de uma escala, um por linha (tooltip do cabeçalho). */
const swapSummaryTooltip = (assignments: OverviewAssignment[]) =>
  assignments
    .filter((assignment) => assignment.hasPendingSwap)
    .map(
      (assignment) =>
        `${assignment.memberName}${assignment.pendingSwapMessage ? `: “${assignment.pendingSwapMessage}”` : ''}`,
    )
    .join('\n');

interface OverviewItem {
  scheduleId: string;
  title: string;
  date: string;
  event: EventItem;
  counts: {
    total: number;
    pending: number;
    confirmed: number;
    declined: number;
    checkedIn: number;
    /** Atribuições com pedido de troca em aberto */
    swapsPending?: number;
  };
  attendanceRate: number;
  assignments: OverviewAssignment[];
}

interface CandidatePastoralSummary {
  id: string;
  communityPastoralId: string;
  name: string;
  role?: string;
  isLeader?: boolean;
  requiredPeople: number;
  assignedCount: number;
  remainingPeople: number | null;
  /** Regra da pastoral: casais servem juntos */
  scheduleCouplesTogether?: boolean;
}

interface CandidatePastoralMembership {
  id: string;
  communityPastoralId: string;
  name: string;
  role?: string;
  eventRole?: string;
  isLeader?: boolean;
}

interface CandidateConflictItem {
  assignmentId: string;
  scheduleId: string;
  title: string;
  role: string;
  date: string;
  location?: string | null;
  community?: string | null;
  status: AssignmentStatus;
  checkedIn: boolean;
}

interface CandidateHistoryItem {
  assignmentId: string;
  scheduleId: string;
  title: string;
  role: string;
  date: string;
  location?: string | null;
  outcome: CandidateHistoryOutcome;
  status: AssignmentStatus;
  checkedIn: boolean;
  checkedInAt?: string | null;
}

interface CandidateMember {
  id: string;
  fullName: string;
  email?: string;
  phone?: string;
  photoUrl?: string;
  spouseId?: string | null;
  pastorals: CandidatePastoralMembership[];
  currentScheduleAssigned: boolean;
  conflicts: {
    sameDayAssignments: CandidateConflictItem[];
    overlappingAssignments: CandidateConflictItem[];
  };
  load: {
    upcoming30DaysCount: number;
    past30DaysCount: number;
    nextAssignments: CandidateConflictItem[];
  };
  history: {
    totalPastAssignments: number;
    actionableAssignments: number;
    respondedCount: number;
    checkedInCount: number;
    declinedCount: number;
    noShowCount: number;
    attendanceRate: number;
    responseRate: number;
    recent: CandidateHistoryItem[];
  };
  availability: {
    status: string;
    summary: string[];
  };
  recommendation: {
    level: CandidateRecommendationLevel;
    score: number;
    reasons: string[];
  };
}

interface ScheduleCandidatesResponse {
  scheduleId: string;
  title: string;
  date: string;
  event: {
    id: string;
    title: string;
    type: string;
    location?: string;
    community: {
      id: string;
      name: string;
      parish?: {
        id: string;
        name: string;
      };
    };
  };
  pastorals: CandidatePastoralSummary[];
  hasPastorals: boolean;
  availabilityFeatureEnabled: boolean;
  members: CandidateMember[];
}

interface CreateScheduleForm {
  eventId: string;
  title: string;
  description: string;
  date: string;
  pastoralSettings: CreateSchedulePastoralSetting[];
}

interface CreateSchedulePastoralSetting {
  communityPastoralId: string;
  name: string;
  role?: string;
  requiredPeople: number;
}

interface AssignmentForm {
  memberId: string;
  role: string;
  communityPastoralId: string;
}

interface CandidateReloadOptions {
  preserveRole?: string;
  preserveMemberId?: string;
  preservePastoralId?: string;
}

const canManageSchedule = (role?: string) => {
  if (!role) return false;
  return [
    'SYSTEM_ADMIN',
    'DIOCESAN_ADMIN',
    'PARISH_ADMIN',
    'COMMUNITY_COORDINATOR',
    'PASTORAL_COORDINATOR',
  ].includes(role);
};

const scheduleStatusMap: Record<ScheduleStatus, { label: string; color: string }> = {
  OPEN: { label: 'Aberta', color: '#2a9d8f' },
  CLOSED: { label: 'Fechada', color: '#f4a261' },
  COMPLETED: { label: 'Concluida', color: '#2f6d6f' },
  CANCELLED: { label: 'Cancelada', color: '#e63946' },
};

const statusLabel: Record<AssignmentStatus, string> = {
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmado',
  DECLINED: 'Recusado',
};

const recommendationLabelMap: Record<CandidateRecommendationLevel, string> = {
  RECOMMENDED: 'Pronto',
  ATTENTION: 'Atencao',
  CONFLICT: 'Conflito',
};

const historyOutcomeLabelMap: Record<CandidateHistoryOutcome, string> = {
  CHECKED_IN: 'Presente',
  NO_SHOW: 'Falta',
  DECLINED: 'Recusou',
};

const toDateTimeInput = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
};

/** Chave de dia local (YYYY-MM-DD). */
const toDayKey = (value: string | Date) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
};

/** Dias (YYYY-MM-DD) cobertos pelo evento — um por dia entre início e fim (limite 60).
 *  Evento multi-dia (tríduo, novena…) tem uma celebração/escala por dia. */
const eventDayKeys = (eventItem: EventItem): string[] => {
  const start = new Date(eventItem.startDate);
  if (Number.isNaN(start.getTime())) return [];
  const end = eventItem.endDate ? new Date(eventItem.endDate) : start;
  const days: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor <= last && days.length < 60) {
    days.push(toDayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days.length ? days : [toDayKey(start)];
};

const toHumanDate = (value: string) =>
  new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const toShortDate = (value: string) =>
  new Date(value).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });

const toDateTag = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

const toBucket = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('en-CA', { dateStyle: 'short' }).format(date);
};

const todayIsoDate = () => {
  const now = new Date();
  const tz = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
};

const addDays = (date: Date, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const getPastoralName = (eventPastoral?: EventPastoral | null) =>
  eventPastoral?.communityPastoral?.globalPastoral?.name || 'Pastoral';

const getPastoralProgress = (schedule: Schedule) => {
  // Fonte preferida: as pastorais da PRÓPRIA escala (vagas editáveis por escala).
  // Fallback: as do evento (listagens que não trazem schedule.pastorals).
  const source =
    schedule.pastorals && schedule.pastorals.length > 0
      ? schedule.pastorals.map((pastoral) => ({
          communityPastoralId: pastoral.communityPastoralId,
          name: pastoral.communityPastoral?.globalPastoral?.name || 'Pastoral',
          role: pastoral.role ?? undefined,
          isLeader: pastoral.isLeader,
          requiredPeople: Number(pastoral.requiredPeople || 0),
        }))
      : (schedule.event.eventPastorals || []).map((eventPastoral) => ({
          communityPastoralId: eventPastoral.communityPastoralId,
          name: getPastoralName(eventPastoral),
          role: eventPastoral.role,
          isLeader: eventPastoral.isLeader,
          requiredPeople: Number(eventPastoral.requiredPeople || 0),
        }));

  return source.map((item) => {
    const assignedCount = schedule.assignments.filter(
      (assignment) => assignment.communityPastoral?.id === item.communityPastoralId,
    ).length;
    return {
      ...item,
      assignedCount,
      remainingPeople: item.requiredPeople > 0 ? Math.max(item.requiredPeople - assignedCount, 0) : null,
    };
  });
};

const SchedulesPage: React.FC = () => {
  const { user: currentUser } = useAuth();
  const managerRole = canManageSchedule(currentUser?.role as UserRole | undefined);

  const [events, setEvents] = useState<EventItem[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [overview, setOverview] = useState<OverviewItem[]>([]);
  // Visualização do resumo: cards (padrão), lista compacta ou calendário
  const [overviewView, setOverviewView] = useState<'cards' | 'list' | 'calendar'>(() => {
    const stored = localStorage.getItem('schedules:overviewView');
    return stored === 'list' || stored === 'calendar' ? stored : 'cards';
  });
  const changeOverviewView = (view: 'cards' | 'list' | 'calendar') => {
    setOverviewView(view);
    localStorage.setItem('schedules:overviewView', view);
  };
  // Linha expandida na visão em lista (mostra os membros escalados)
  const [expandedOverviewId, setExpandedOverviewId] = useState<string | null>(null);
  // Calendário: mês exibido + escala selecionada (mostra quem serve)
  const [calMonth, setCalMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [calSelectedId, setCalSelectedId] = useState<string | null>(null);
  // Mostrar os membros escalados dentro das células do calendário
  const [calShowMembers, setCalShowMembers] = useState(
    () => localStorage.getItem('schedules:calMembers') !== 'off',
  );
  const toggleCalMembers = () => {
    setCalShowMembers((prev) => {
      localStorage.setItem('schedules:calMembers', prev ? 'off' : 'on');
      return !prev;
    });
  };
  const [loading, setLoading] = useState(true);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [assignSubmitting, setAssignSubmitting] = useState(false);

  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ScheduleStatus>('all');
  const [eventFilter, setEventFilter] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  // Evento multi-dia: criar uma escala para cada dia pendente do período
  const [createAllDays, setCreateAllDays] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);

  const [createForm, setCreateForm] = useState<CreateScheduleForm>({
    eventId: '',
    title: '',
    description: '',
    date: '',
    pastoralSettings: [],
  });
  const [activeSchedule, setActiveSchedule] = useState<Schedule | null>(null);

  const [assignmentForm, setAssignmentForm] = useState<AssignmentForm>({
    memberId: '',
    role: '',
    communityPastoralId: '',
  });
  const [assignmentStatusFilter, setAssignmentStatusFilter] = useState<'all' | AssignmentStatus>('all');
  const [assignmentSearch, setAssignmentSearch] = useState('');

  const [candidates, setCandidates] = useState<ScheduleCandidatesResponse | null>(null);
  const [eligibleLoading, setEligibleLoading] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  // Preencher vaga: candidatos em cards ou lista compacta
  const [assignView, setAssignView] = useState<'cards' | 'list'>(
    () => (localStorage.getItem('schedules:assignView') === 'list' ? 'list' : 'cards'),
  );
  const changeAssignView = (view: 'cards' | 'list') => {
    setAssignView(view);
    localStorage.setItem('schedules:assignView', view);
  };
  const [memberPastoralFilter, setMemberPastoralFilter] = useState('all');
  const [candidateFilter, setCandidateFilter] = useState<CandidateFilter>('all');
  const [expandedCandidateId, setExpandedCandidateId] = useState('');
  const [inlineRole, setInlineRole] = useState('');

  const [overviewFrom, setOverviewFrom] = useState(todayIsoDate());
  const [exportingPdf, setExportingPdf] = useState(false);
  const [overviewTo, setOverviewTo] = useState(toDateTimeInput(addDays(new Date(), 30).toISOString()).slice(0, 10));

  // Escala sem evento (Fase 4.1)
  const [communities, setCommunities] = useState<CommunityOption[]>([]);
  const [showStandaloneModal, setShowStandaloneModal] = useState(false);
  const [standaloneSubmitting, setStandaloneSubmitting] = useState(false);
  const [standaloneForm, setStandaloneForm] = useState({
    title: '',
    description: '',
    date: '',
    communityId: '',
    startTime: '',
    endTime: '',
    location: '',
  });

  // Gerador de rodízio (Fase 4.6)
  const [showRotationModal, setShowRotationModal] = useState(false);
  const [rotationSelection, setRotationSelection] = useState<string[]>([]);
  const [rotationPreview, setRotationPreview] = useState<RotationResponse | null>(null);
  const [rotationLoading, setRotationLoading] = useState(false);
  // Vagas definidas na geração do rodízio: scheduleId -> (communityPastoralId -> vagas)
  const [rotationSlots, setRotationSlots] = useState<Record<string, Record<string, number>>>({});
  // Casais juntos (aplica nas pastorais com a regra ativa)
  const [rotationCouples, setRotationCouples] = useState(true);

  // Edição de vagas da escala (detalhe)
  const [slotsEdit, setSlotsEdit] = useState<null | {
    scheduleId: string;
    items: Array<{ communityPastoralId: string; name: string; requiredPeople: number }>;
  }>(null);
  const [slotsSaving, setSlotsSaving] = useState(false);
  // Substituição de membro: ao escalar o novo, o anterior é removido
  const [replaceTarget, setReplaceTarget] = useState<Assignment | null>(null);

  const headers = {
    Authorization: `Bearer ${localStorage.getItem('token')}`,
  };

  /** Primeiro dia do evento ainda sem escala, mantendo o horário de início. */
  const firstPendingDateInput = (eventItem: EventItem): string => {
    const done = scheduledDaysByEvent.get(eventItem.id);
    const pending = eventDayKeys(eventItem).find((day) => !done?.has(day));
    if (!pending) return toDateTimeInput(eventItem.startDate);
    const time = toDateTimeInput(eventItem.startDate).slice(11) || '00:00';
    return `${pending}T${time}`;
  };

  const resetCreateForm = () => {
    setCreateForm({
      eventId: '',
      title: '',
      description: '',
      date: '',
      pastoralSettings: [],
    });
    setCreateAllDays(false);
  };

  const resetAssignmentForm = () => {
    setAssignmentForm({
      memberId: '',
      role: '',
      communityPastoralId: '',
    });
    setMemberSearch('');
    setMemberPastoralFilter('all');
    setCandidateFilter('all');
    setAssignmentStatusFilter('all');
    setAssignmentSearch('');
    setExpandedCandidateId('');
    setInlineRole('');
  };

  const buildCreatePastoralSettings = (eventItem?: EventItem | null): CreateSchedulePastoralSetting[] => {
    if (!eventItem?.eventPastorals?.length) {
      return [];
    }

    return eventItem.eventPastorals.map((eventPastoral) => ({
      communityPastoralId: eventPastoral.communityPastoralId,
      name: eventPastoral.communityPastoral?.globalPastoral?.name || 'Pastoral',
      role: eventPastoral.role,
      requiredPeople: Number(eventPastoral.requiredPeople || 0),
    }));
  };

  const handleCreateEventChange = (eventId: string) => {
    const selectedEvent = events.find((eventItem) => eventItem.id === eventId);

    setCreateForm((prev) => ({
      ...prev,
      eventId,
      title: selectedEvent ? `Escala - ${selectedEvent.title}` : prev.title,
      date: selectedEvent ? firstPendingDateInput(selectedEvent) : prev.date,
      pastoralSettings: buildCreatePastoralSettings(selectedEvent),
    }));
    setCreateAllDays(false);
  };

  const handleCreatePastoralRequiredPeopleChange = (communityPastoralId: string, rawValue: string) => {
    const nextValue = Math.max(0, Number(rawValue || 0));

    setCreateForm((prev) => ({
      ...prev,
      pastoralSettings: prev.pastoralSettings.map((item) =>
        item.communityPastoralId === communityPastoralId
          ? {
              ...item,
              requiredPeople: Number.isFinite(nextValue) ? nextValue : 0,
            }
          : item,
      ),
    }));
  };

  const syncScheduleState = (updatedSchedule: Schedule) => {
    setActiveSchedule(updatedSchedule);
    setSchedules((prev) => prev.map((item) => (item.id === updatedSchedule.id ? updatedSchedule : item)));
    return updatedSchedule;
  };

  const fetchScheduleById = async (scheduleId: string, withLoading = false) => {
    if (withLoading) {
      setDetailLoading(true);
    }

    try {
      const response = await axios.get<Schedule>(`${API_URL}/schedules/${scheduleId}`, { headers });
      return syncScheduleState(response.data);
    } catch (error: any) {
      console.error('Erro ao carregar detalhe da escala', error);
      notify.error(error.response?.data?.message || 'Erro ao carregar detalhe da escala');
      return null;
    } finally {
      if (withLoading) {
        setDetailLoading(false);
      }
    }
  };

  const fetchOverview = async () => {
    if (!managerRole) {
      return;
    }

    setOverviewLoading(true);
    try {
      const params: Record<string, string> = {};
      if (overviewFrom) {
        params.from = new Date(`${overviewFrom}T00:00:00`).toISOString();
      }
      if (overviewTo) {
        params.to = new Date(`${overviewTo}T23:59:59`).toISOString();
      }

      const response = await axios.get(`${API_URL}/schedules/coordinator-overview`, {
        headers,
        params,
      });
      setOverview(response.data || []);
    } catch (error: any) {
      if (error?.response?.status !== 403) {
        notify.error(error.response?.data?.message || 'Erro ao carregar visao de coordenacao');
      }
      setOverview([]);
    } finally {
      setOverviewLoading(false);
    }
  };

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      const params: Record<string, string> = {};
      if (overviewFrom) {
        params.from = new Date(`${overviewFrom}T00:00:00`).toISOString();
      }
      if (overviewTo) {
        params.to = new Date(`${overviewTo}T23:59:59`).toISOString();
      }

      const response = await axios.get(`${API_URL}/schedules/export.pdf`, {
        headers,
        params,
        responseType: 'blob',
      });

      const url = window.URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `escala-${overviewFrom || 'periodo'}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      notify.error(error.response?.data?.message || 'Erro ao gerar o PDF da escala');
    } finally {
      setExportingPdf(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [eventsResponse, schedulesResponse] = await Promise.all([
        axios.get(`${API_URL}/events`, { headers }),
        axios.get(`${API_URL}/schedules`, { headers }),
      ]);

      setEvents(eventsResponse.data || []);
      setSchedules(schedulesResponse.data || []);

      if (managerRole) {
        await fetchOverview();
        axios
          .get(`${API_URL}/communities`, { headers })
          .then((res) => setCommunities(res.data || []))
          .catch(() => setCommunities([]));
      } else {
        setOverview([]);
      }
    } catch (error: any) {
      console.error('Erro ao carregar dados de escalas', error);
      notify.error(error.response?.data?.message || 'Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getFilteredSchedules = useMemo(() => {
    return schedules.filter((schedule) => {
      const text = searchText.toLowerCase().trim();
      const bySearch =
        !text ||
        schedule.title.toLowerCase().includes(text) ||
        schedule.event.title.toLowerCase().includes(text) ||
        schedule.event.community?.name.toLowerCase().includes(text);
      const byStatus = statusFilter === 'all' || schedule.status === statusFilter;
      const byEvent = !eventFilter || schedule.event.id === eventFilter;
      return bySearch && byStatus && byEvent;
    });
  }, [schedules, searchText, statusFilter, eventFilter]);

  const groupedSchedules = useMemo(() => {
    const result: Record<string, Schedule[]> = {};
    for (const schedule of getFilteredSchedules) {
      const key = toBucket(schedule.date);
      if (!key) continue;
      if (!result[key]) {
        result[key] = [];
      }
      result[key].push(schedule);
    }

    return Object.entries(result)
      .map(([date, list]) => ({ date, list: list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [getFilteredSchedules]);

  // Dias já escalados por evento — evento multi-dia recebe UMA escala por dia
  const scheduledDaysByEvent = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const schedule of schedules) {
      if (schedule.isStandalone) continue;
      const eventId = schedule.event?.id;
      if (!eventId) continue;
      if (!map.has(eventId)) map.set(eventId, new Set());
      map.get(eventId)!.add(toDayKey(schedule.date));
    }
    return map;
  }, [schedules]);

  const eventsWithoutSchedule = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return events
      // Permanece pendente enquanto houver DIA do evento sem escala
      .filter((event) => {
        const done = scheduledDaysByEvent.get(event.id);
        return eventDayKeys(event).some((day) => !done?.has(day));
      })
      // Apenas eventos futuros ou ainda em andamento (multi-dia)
      .filter((event) => new Date(event.endDate ?? event.startDate) >= startOfToday)
      .filter((event) => {
        if (!searchText) return true;
        const text = searchText.toLowerCase().trim();
        return (
          event.title.toLowerCase().includes(text) ||
          event.type.toLowerCase().includes(text) ||
          (event.community?.name || '').toLowerCase().includes(text)
        );
      })
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
  }, [events, scheduledDaysByEvent, searchText]);

  const openCreate = (event?: EventItem) => {
    resetCreateForm();
    if (event) {
      setCreateForm({
        eventId: event.id,
        title: `Escala - ${event.title}`,
        description: '',
        date: firstPendingDateInput(event),
        pastoralSettings: buildCreatePastoralSettings(event),
      });
    }
    setShowCreateModal(true);
  };

  const openDetail = async (schedule: Schedule) => {
    setActiveSchedule(schedule);
    setAssignmentSearch('');
    setAssignmentStatusFilter('all');
    setShowDetailModal(true);
    await fetchScheduleById(schedule.id, true);
  };

  // ===== Escala sem evento (serviço contínuo) =====

  const resetStandaloneForm = () => {
    setStandaloneForm({ title: '', description: '', date: '', communityId: '', startTime: '', endTime: '', location: '' });
  };

  const handleCreateStandalone = async (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    setStandaloneSubmitting(true);
    try {
      await axios.post(
        `${API_URL}/schedules/standalone`,
        {
          title: standaloneForm.title,
          description: standaloneForm.description || undefined,
          date: new Date(standaloneForm.date).toISOString(),
          communityId: standaloneForm.communityId,
          startTime: standaloneForm.startTime || undefined,
          endTime: standaloneForm.endTime || undefined,
          location: standaloneForm.location || undefined,
        },
        { headers },
      );
      notify.success('Escala de serviço contínuo criada!');
      setShowStandaloneModal(false);
      resetStandaloneForm();
      fetchData();
    } catch (error: any) {
      notify.error(error.response?.data?.message || 'Erro ao criar escala avulsa');
    } finally {
      setStandaloneSubmitting(false);
    }
  };

  // ===== Gerador de rodízio =====

  /** Escala elegível ao rodízio: aberta e de hoje em diante (dia inteiro conta). */
  const isRotationEligible = (schedule: Schedule) => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return schedule.status === 'OPEN' && new Date(schedule.date).getTime() >= startOfToday.getTime();
  };

  const openRotation = () => {
    const openIds = schedules
      .filter((schedule) => isRotationEligible(schedule))
      .map((schedule) => schedule.id);
    setRotationSelection(openIds);
    setRotationPreview(null);
    setRotationSlots({});
    setShowRotationModal(true);
  };

  /** "Preencher automático" da gestão: gerador de rodízio focado numa única escala. */
  const openRotationForSchedule = (scheduleId: string) => {
    setRotationSelection([scheduleId]);
    setRotationPreview(null);
    setRotationSlots({});
    setShowRotationModal(true);
  };

  /** Vagas por pastoral definidas na tela do rodízio, no formato do backend. */
  const buildSlotOverrides = () =>
    Object.entries(rotationSlots)
      .map(([scheduleId, settings]) => ({
        scheduleId,
        settings: Object.entries(settings).map(([communityPastoralId, requiredPeople]) => ({
          communityPastoralId,
          requiredPeople: Math.max(0, Number(requiredPeople || 0)),
        })),
      }))
      .filter((override) => override.settings.length > 0);

  const setRotationSlot = (scheduleId: string, communityPastoralId: string, value: number) => {
    setRotationSlots((prev) => ({
      ...prev,
      [scheduleId]: { ...(prev[scheduleId] || {}), [communityPastoralId]: Math.max(0, value) },
    }));
  };

  // ===== Edição de vagas da escala (detalhe) =====

  const openSlotsEdit = () => {
    if (!activeSchedule) return;
    setSlotsEdit({
      scheduleId: activeSchedule.id,
      items: detailPastoralProgress.map((pastoral) => ({
        communityPastoralId: pastoral.communityPastoralId,
        name: pastoral.name,
        requiredPeople: pastoral.requiredPeople,
      })),
    });
  };

  const handleSaveSlots = async () => {
    if (!slotsEdit) return;
    setSlotsSaving(true);
    try {
      await axios.patch(
        `${API_URL}/schedules/${slotsEdit.scheduleId}/pastorals`,
        {
          pastoralSettings: slotsEdit.items.map((item) => ({
            communityPastoralId: item.communityPastoralId,
            requiredPeople: Number(item.requiredPeople || 0),
          })),
        },
        { headers },
      );
      notify.success('Vagas atualizadas!');
      setSlotsEdit(null);
      await fetchScheduleById(slotsEdit.scheduleId, true);
      fetchData();
    } catch (error: any) {
      notify.error(error.response?.data?.message || 'Erro ao atualizar as vagas');
    } finally {
      setSlotsSaving(false);
    }
  };

  const toggleRotationSchedule = (scheduleId: string) => {
    setRotationSelection((prev) =>
      prev.includes(scheduleId) ? prev.filter((id) => id !== scheduleId) : [...prev, scheduleId],
    );
    setRotationPreview(null);
  };

  const handleGenerateRotation = async (dryRun: boolean) => {
    if (!rotationSelection.length) {
      notify.warning('Selecione ao menos uma escala aberta.');
      return;
    }
    setRotationLoading(true);
    try {
      const response = await axios.post<RotationResponse>(
        `${API_URL}/schedules/generate`,
        {
          scheduleIds: rotationSelection,
          dryRun,
          slotOverrides: buildSlotOverrides(),
          couplesTogether: rotationCouples,
        },
        { headers },
      );
      setRotationPreview(response.data);
      if (!dryRun) {
        notify.success(`Rodízio publicado: ${response.data.created ?? 0} atribuição(ões) criada(s) como pendentes.`);
        setShowRotationModal(false);
        setRotationPreview(null);
        fetchData();
        // Mantém o modal de gestão (se aberto) com os dados frescos
        if (showDetailModal && activeSchedule) {
          void fetchScheduleById(activeSchedule.id, true);
        }
      }
    } catch (error: any) {
      notify.error(error.response?.data?.message || 'Erro ao gerar o rodízio');
    } finally {
      setRotationLoading(false);
    }
  };

  const loadScheduleCandidates = async (
    scheduleId: string,
    preferredPastoralId = '',
    options: CandidateReloadOptions = {},
  ) => {
    setEligibleLoading(true);
    try {
      const response = await axios.get<ScheduleCandidatesResponse>(`${API_URL}/schedules/${scheduleId}/candidates`, {
        headers,
      });
      const data = response.data;
      setCandidates(data);
      const preservedPastoralId = options.preservePastoralId || preferredPastoralId;
      const resolvedPastoralId =
        preservedPastoralId || (data.pastorals.length === 1 ? data.pastorals[0].communityPastoralId : '');
      const resolvedRole =
        options.preserveRole ||
        data.pastorals.find((pastoral) => pastoral.communityPastoralId === resolvedPastoralId)?.role ||
        data.pastorals[0]?.role ||
        '';
      const resolvedMemberId =
        options.preserveMemberId &&
        data.members.some(
          (member) => member.id === options.preserveMemberId && !member.currentScheduleAssigned,
        )
          ? options.preserveMemberId
          : '';

      setAssignmentForm({
        memberId: resolvedMemberId,
        role: resolvedRole,
        communityPastoralId: resolvedPastoralId,
      });
      setMemberPastoralFilter(resolvedPastoralId || 'all');
      setCandidateFilter('all');
    } catch (error: any) {
      console.error('Erro ao buscar candidatos da escala', error);
      notify.error(error.response?.data?.message || 'Erro ao carregar candidatos da escala');
      setCandidates(null);
    } finally {
      setEligibleLoading(false);
    }
  };

  const closeAssignModal = () => {
    setShowAssignModal(false);
    setCandidates(null);
    resetAssignmentForm();
    setReplaceTarget(null);
  };

  /** Abre a gestão da escala a partir do calendário/resumo (busca se não estiver na lista). */
  const openManageFromOverview = async (scheduleId: string) => {
    const existing = schedules.find((schedule) => schedule.id === scheduleId);
    if (existing) {
      void openDetail(existing);
      return;
    }
    setShowDetailModal(true);
    await fetchScheduleById(scheduleId, true);
  };

  const openAssign = async (schedule: Schedule, preferredPastoralId = '') => {
    setActiveSchedule(schedule);
    setShowAssignModal(true);
    resetAssignmentForm();
    await loadScheduleCandidates(schedule.id, preferredPastoralId);
  };

  const handlePastoralSelection = (communityPastoralId: string) => {
    const suggestedRole =
      candidates?.pastorals.find((pastoral) => pastoral.communityPastoralId === communityPastoralId)?.role || '';

    setAssignmentForm((prev) => ({
      ...prev,
      communityPastoralId,
      role: suggestedRole || prev.role,
    }));
    setMemberPastoralFilter(communityPastoralId || 'all');
    setExpandedCandidateId('');
    setInlineRole(suggestedRole);
  };

  const getFilteredAssignments = useMemo(() => {
    if (!activeSchedule) return [];
    return activeSchedule.assignments
      .filter((assignment) => assignmentStatusFilter === 'all' || assignment.status === assignmentStatusFilter)
      .filter((assignment) => {
        const q = assignmentSearch.toLowerCase().trim();
        if (!q) return true;
        return (
          assignment.member.fullName.toLowerCase().includes(q) ||
          assignment.role.toLowerCase().includes(q)
        );
      });
  }, [activeSchedule, assignmentStatusFilter, assignmentSearch]);

  const availableCandidates = useMemo(() => {
    if (!candidates) return [];

    return candidates.members.filter((member) => !member.currentScheduleAssigned);
  }, [candidates]);

  const filteredCandidates = useMemo(() => {
    if (!availableCandidates.length) return [];
    const q = memberSearch.toLowerCase().trim();
    return availableCandidates
      .filter((member) => {
        const matchText =
          !q || member.fullName.toLowerCase().includes(q) || (member.email || '').toLowerCase().includes(q);
        const matchPastoral =
          memberPastoralFilter === 'all' ||
          member.pastorals.some((pastoral) => pastoral.communityPastoralId === memberPastoralFilter);
        const matchRecommendation =
          candidateFilter === 'all' ||
          (candidateFilter === 'recommended' && member.recommendation.level === 'RECOMMENDED') ||
          (candidateFilter === 'attention' && member.recommendation.level === 'ATTENTION') ||
          (candidateFilter === 'conflict' && member.recommendation.level === 'CONFLICT');

        return matchText && matchPastoral && matchRecommendation;
      })
      .sort((a, b) => b.recommendation.score - a.recommendation.score || a.fullName.localeCompare(b.fullName));
  }, [availableCandidates, memberSearch, memberPastoralFilter, candidateFilter]);

  const candidateCounts = useMemo(() => {
    if (!availableCandidates.length) {
      return { all: 0, recommended: 0, attention: 0, conflict: 0 };
    }

    return availableCandidates.reduce(
      (acc, member) => {
        acc.all += 1;
        if (member.recommendation.level === 'RECOMMENDED') acc.recommended += 1;
        if (member.recommendation.level === 'ATTENTION') acc.attention += 1;
        if (member.recommendation.level === 'CONFLICT') acc.conflict += 1;
        return acc;
      },
      { all: 0, recommended: 0, attention: 0, conflict: 0 },
    );
  }, [availableCandidates]);

  const selectedCandidate = useMemo(() => {
    if (!assignmentForm.memberId || !candidates) {
      return null;
    }

    return candidates.members.find((member) => member.id === assignmentForm.memberId) || null;
  }, [candidates, assignmentForm.memberId]);

  const assignedMembersForPanel = useMemo(() => {
    if (!activeSchedule) {
      return [];
    }

    return [...activeSchedule.assignments]
      .filter(
        (assignment) =>
          !assignmentForm.communityPastoralId ||
          assignment.communityPastoral?.id === assignmentForm.communityPastoralId,
      )
      .sort((left, right) => left.member.fullName.localeCompare(right.member.fullName, 'pt-BR'));
  }, [activeSchedule, assignmentForm.communityPastoralId]);

  const roleSuggestions = useMemo(() => {
    const items = new Set<string>();

    activeSchedule?.event.eventPastorals?.forEach((eventPastoral) => {
      if (eventPastoral.role) {
        items.add(eventPastoral.role);
      }
    });

    candidates?.pastorals.forEach((pastoral) => {
      if (pastoral.role) {
        items.add(pastoral.role);
      }
    });

    selectedCandidate?.pastorals.forEach((pastoral) => {
      if (pastoral.eventRole) {
        items.add(pastoral.eventRole);
      }
      if (pastoral.role) {
        items.add(pastoral.role);
      }
    });

    return Array.from(items).filter(Boolean);
  }, [activeSchedule, candidates, selectedCandidate]);

  const detailPastoralProgress = useMemo(() => {
    if (!activeSchedule) return [];
    return getPastoralProgress(activeSchedule);
  }, [activeSchedule]);

  // Escalas do resumo agrupadas por dia (visão calendário)
  const overviewByDay = useMemo(() => {
    const map = new Map<string, OverviewItem[]>();
    for (const item of overview) {
      const key = toDayKey(item.date);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }
    return map;
  }, [overview]);

  // Células do mês exibido (inicia no domingo anterior; 6 semanas fixas)
  const calCells = useMemo(() => {
    const first = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return { date, key: toDayKey(date), inMonth: date.getMonth() === calMonth.getMonth() };
    });
  }, [calMonth]);

  const calSelected = useMemo(
    () => overview.find((item) => item.scheduleId === calSelectedId) ?? null,
    [overview, calSelectedId],
  );

  const overviewTotal = overview.length;
  const overviewAssignments = overview.reduce((acc, item) => acc + item.counts.total, 0);
  const overviewChecked = overview.reduce((acc, item) => acc + item.counts.checkedIn, 0);
  const overviewAttendance = overviewAssignments > 0 ? Math.round((overviewChecked / overviewAssignments) * 100) : 0;
  const openSchedulesCount = schedules.filter((schedule) => schedule.status === 'OPEN').length;
  const completedSchedulesCount = schedules.filter((schedule) => schedule.status === 'COMPLETED').length;
  const confirmedAssignmentsCount = schedules.reduce(
    (acc, schedule) =>
      acc + schedule.assignments.filter((assignment) => assignment.status === 'CONFIRMED').length,
    0,
  );
  const pendingEventsPreview = eventsWithoutSchedule.slice(0, 5);
  const nextSchedule =
    [...schedules]
      .filter((schedule) => new Date(schedule.date).getTime() >= Date.now())
      .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())[0] ||
    [...schedules].sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())[0];

  const eventPastoralText = (event: EventItem) => {
    if (!event.eventPastorals || event.eventPastorals.length === 0) {
      return 'Sem pastoral vinculada';
    }
    return event.eventPastorals
      .map((item) => {
        const name = item.communityPastoral?.globalPastoral?.name || 'Pastoral';
        const vagas = item.requiredPeople ? `${item.requiredPeople} vagas` : 'sem limite';
        return `${name} (${vagas})`;
      })
      .join(' | ');
  };

  const handleSubmitSchedule = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!createForm.eventId || !createForm.title || !createForm.date) {
      notify.warning('Informe evento, titulo e data');
      return;
    }

    const basePayload = {
      description: createForm.description,
      eventId: createForm.eventId,
      pastoralSettings: createForm.pastoralSettings.map((item) => ({
        communityPastoralId: item.communityPastoralId,
        requiredPeople: Number(item.requiredPeople || 0),
      })),
    };

    // Evento multi-dia: cria uma escala para cada dia ainda sem escala,
    // usando o horário informado no formulário para todos os dias.
    const selectedEvent = events.find((item) => item.id === createForm.eventId);
    if (createAllDays && selectedEvent && eventDayKeys(selectedEvent).length > 1) {
      const done = scheduledDaysByEvent.get(selectedEvent.id);
      const pendingDays = eventDayKeys(selectedEvent).filter((day) => !done?.has(day));
      if (pendingDays.length === 0) {
        notify.warning('Todos os dias deste evento ja possuem escala.');
        return;
      }
      // Sem vagas definidas o rodízio não terá o que sugerir — confirma a intenção
      const totalSlots = basePayload.pastoralSettings.reduce(
        (acc, item) => acc + Number(item.requiredPeople || 0),
        0,
      );
      if (totalSlots === 0) {
        const proceed = await confirm.action(
          'Criar escalas sem vagas?',
          'Nenhuma vaga por pastoral foi definida. O gerador de rodízio não terá o que sugerir nessas escalas. Deseja criar mesmo assim?',
          'Criar mesmo assim',
        );
        if (!proceed) return;
      }
      const time = createForm.date.slice(11) || '00:00';
      let created = 0;
      const failures: string[] = [];
      for (const day of pendingDays) {
        const label = `${day.slice(8, 10)}/${day.slice(5, 7)}`;
        try {
          await axios.post(
            `${API_URL}/schedules`,
            {
              ...basePayload,
              title: `${createForm.title} — ${label}`,
              date: new Date(`${day}T${time}`).toISOString(),
            },
            { headers },
          );
          created++;
        } catch (error: any) {
          failures.push(`${label}: ${error.response?.data?.message || 'erro'}`);
        }
      }
      if (created > 0) notify.success(`${created} escala(s) criada(s) para "${selectedEvent.title}"`);
      if (failures.length > 0) notify.error(`Falhas: ${failures.join(' | ')}`);
      if (created > 0) {
        setShowCreateModal(false);
        resetCreateForm();
        await fetchData();
      }
      return;
    }

    try {
      await axios.post(
        `${API_URL}/schedules`,
        {
          ...basePayload,
          title: createForm.title,
          date: new Date(createForm.date).toISOString(),
        },
        { headers },
      );
      notify.success('Escala criada com sucesso');

      setShowCreateModal(false);
      resetCreateForm();
      await fetchData();
    } catch (error: any) {
      console.error('Erro ao salvar escala', error);
      notify.error(error.response?.data?.message || 'Erro ao salvar escala');
    }
  };

  const handleDeleteSchedule = async (schedule: Schedule) => {
    const ok = await confirm.delete(`a escala ${schedule.title}`);
    if (!ok) return;

    try {
      await axios.delete(`${API_URL}/schedules/${schedule.id}`, { headers });
      notify.success('Escala removida');
      setShowDetailModal(false);
      await fetchData();
    } catch (error: any) {
      console.error('Erro ao remover escala', error);
      notify.error(error.response?.data?.message || 'Erro ao remover escala');
    }
  };

  const handleUpdateStatus = async (scheduleId: string, status: ScheduleStatus) => {
    try {
      await axios.patch(`${API_URL}/schedules/${scheduleId}/status`, { status }, { headers });
      notify.success('Status atualizado');
      await fetchData();
      await fetchScheduleById(scheduleId);
    } catch (error: any) {
      console.error('Erro ao atualizar status', error);
      notify.error(error.response?.data?.message || 'Erro ao atualizar status');
    }
  };

  const handleNotifyTeam = async (scheduleId: string) => {
    const message = await confirm.withTextarea(
      'Avisar equipe',
      'Mensagem para todos os membros escalados nesta escala',
      'Ex: Missa adiantada 15 minutos hoje',
      'Enviar aviso'
    );

    if (!message) {
      return;
    }

    try {
      const response = await axios.post(
        `${API_URL}/schedules/${scheduleId}/notify-team`,
        { message },
        { headers }
      );
      const notified = response.data?.notified ?? 0;
      notify.success(
        notified > 0
          ? `${notified} pessoa(s) da equipe foram notificadas.`
          : 'Nenhum membro escalado possui notificacoes habilitadas.'
      );
    } catch (error: any) {
      console.error('Erro ao avisar equipe', error);
      notify.error(error.response?.data?.message || 'Erro ao avisar equipe');
    }
  };

  /** Cônjuge do candidato quando ele também está na lista de candidatos. */
  const spouseCandidateOf = (member: CandidateMember) =>
    member.spouseId ? (candidates?.members.find((m) => m.id === member.spouseId) ?? null) : null;

  const createAssignment = async (memberIdOverride?: string, roleOverride?: string, keepOpen = false) => {
    if (!activeSchedule) {
      notify.warning('Selecione uma escala');
      return;
    }

    const memberId = memberIdOverride || assignmentForm.memberId;
    const role = roleOverride !== undefined ? roleOverride : assignmentForm.role;

    if (!memberId || !role.trim()) {
      notify.warning('Defina a funcao e selecione o membro');
      return;
    }

    const eventPastoralsCount = activeSchedule.event.eventPastorals?.length ?? 0;
    if (eventPastoralsCount > 1 && !assignmentForm.communityPastoralId) {
      notify.warning('Selecione a pastoral da vaga');
      return;
    }

    const candidate = candidates?.members.find((item) => item.id === memberId);
    const matchesSelectedPastoral =
      !assignmentForm.communityPastoralId ||
      !candidates?.hasPastorals ||
      candidate?.pastorals.some(
        (pastoral) => pastoral.communityPastoralId === assignmentForm.communityPastoralId,
      );

    if (!matchesSelectedPastoral) {
      notify.warning('O membro selecionado nao pertence a pastoral desta vaga');
      return;
    }

    if (candidate?.currentScheduleAssigned) {
      notify.warning('Este membro ja esta atribuido nesta mesma escala');
      return;
    }

    const warnings: string[] = [];
    if (candidate?.conflicts.overlappingAssignments.length) {
      warnings.push('ha conflito de horario com outra escala');
    }
    if (candidate?.conflicts.sameDayAssignments.length) {
      warnings.push('o membro ja serve em outra escala no mesmo dia');
    }
    if (candidate?.history.noShowCount) {
      warnings.push(`houve ${candidate.history.noShowCount} falta(s) recente(s)`);
    }

    if (warnings.length > 0) {
      const shouldContinue = await confirm.action(
        'Escalar com alerta?',
        `${candidate?.fullName || 'Este membro'} possui alertas: ${warnings.join('; ')}. Deseja continuar?`,
        'Escalar mesmo assim',
      );
      if (!shouldContinue) {
        return;
      }
    }

    setAssignSubmitting(true);
    try {
      await axios.post(
        `${API_URL}/schedules/assignments`,
        {
          scheduleId: activeSchedule.id,
          memberId,
          role: role.trim(),
          communityPastoralId: assignmentForm.communityPastoralId || undefined,
        },
        { headers },
      );
      notify.success('Membro escalado');

      // Fluxo de substituição: remove o membro anterior automaticamente
      if (replaceTarget) {
        try {
          await axios.delete(`${API_URL}/schedules/assignments/${replaceTarget.id}`, { headers });
          notify.success(`${replaceTarget.member.fullName} foi substituído(a).`);
        } catch {
          notify.error('Novo membro escalado, mas não foi possível remover o anterior — remova manualmente.');
        }
        setReplaceTarget(null);
      }

      // 💍 Casais juntos: oferece escalar o cônjuge quando a regra da pastoral está ativa
      if (!replaceTarget && candidates) {
        const justAssigned = candidates.members.find((m) => m.id === memberId);
        const pastoralRule = candidates.pastorals.find(
          (p) => p.communityPastoralId === assignmentForm.communityPastoralId,
        )?.scheduleCouplesTogether;
        const spouse = justAssigned?.spouseId
          ? candidates.members.find((m) => m.id === justAssigned.spouseId)
          : null;
        const spouseInPastoral = spouse?.pastorals?.some(
          (p) => p.communityPastoralId === assignmentForm.communityPastoralId,
        );
        const spouseAlreadyAssigned = spouse
          ? activeSchedule.assignments.some((a) => a.member.id === spouse.id)
          : false;
        if (pastoralRule && spouse && spouseInPastoral && !spouseAlreadyAssigned) {
          const wantsSpouse = await confirm.action(
            '💍 Escalar o casal junto?',
            `${justAssigned!.fullName} é casado(a) com ${spouse.fullName}, que também é candidato(a) desta pastoral. Escalar o cônjuge na mesma função?`,
            'Escalar cônjuge',
          );
          if (wantsSpouse) {
            try {
              await axios.post(
                `${API_URL}/schedules/assignments`,
                {
                  scheduleId: activeSchedule.id,
                  memberId: spouse.id,
                  role: role.trim(),
                  communityPastoralId: assignmentForm.communityPastoralId || undefined,
                },
                { headers },
              );
              notify.success(`Cônjuge ${spouse.fullName} escalado(a) junto.`);
            } catch (error: any) {
              notify.error(error.response?.data?.message || 'Não foi possível escalar o cônjuge');
            }
          }
        }
      }

      if (keepOpen) {
        setExpandedCandidateId('');
        setInlineRole('');
        await fetchData();
        await fetchScheduleById(activeSchedule.id);
        await loadScheduleCandidates(activeSchedule.id, assignmentForm.communityPastoralId, {
          preservePastoralId: assignmentForm.communityPastoralId,
        });
      } else {
        closeAssignModal();
        await fetchData();
        await fetchScheduleById(activeSchedule.id);
      }
    } catch (error: any) {
      console.error('Erro ao adicionar atribuicao', error);
      notify.error(error.response?.data?.message || 'Erro ao adicionar membro');
    } finally {
      setAssignSubmitting(false);
    }
  };

  const handleExpandMember = (memberId: string) => {
    if (expandedCandidateId === memberId) {
      setExpandedCandidateId('');
      setInlineRole('');
      return;
    }
    const defaultRole =
      candidates?.pastorals.find((p) => p.communityPastoralId === assignmentForm.communityPastoralId)?.role || '';
    setExpandedCandidateId(memberId);
    setInlineRole(defaultRole);
  };

  const handleRemoveAssignment = async (assignment: Assignment) => {
    const ok = await confirm.delete(`o membro ${assignment.member.fullName}`);
    if (!ok) return;

    try {
      await axios.delete(`${API_URL}/schedules/assignments/${assignment.id}`, { headers });
      notify.success('Atribuicao removida');
      await fetchData();
      if (activeSchedule) {
        await fetchScheduleById(activeSchedule.id);
        if (showAssignModal) {
          await loadScheduleCandidates(activeSchedule.id, assignmentForm.communityPastoralId, {
            preservePastoralId: assignmentForm.communityPastoralId,
            preserveRole: assignmentForm.role,
            preserveMemberId: assignmentForm.memberId,
          });
        }
      }
    } catch (error: any) {
      console.error('Erro ao remover atribuicao', error);
      notify.error(error.response?.data?.message || 'Erro ao remover atribuicao');
    }
  };

  const handleCheckIn = async (assignment: Assignment) => {
    const undo = assignment.checkedIn;
    try {
      const endpoint = undo
        ? `${API_URL}/schedules/assignments/${assignment.id}/undo-checkin`
        : `${API_URL}/schedules/assignments/${assignment.id}/checkin`;

      await axios.patch(endpoint, {}, { headers });
      await fetchData();
      if (activeSchedule) {
        await fetchScheduleById(activeSchedule.id);
      }
      notify.success(
        undo
          ? `Presença de ${assignment.member.fullName} removida.`
          : `Check-in de ${assignment.member.fullName} registrado.`,
      );
    } catch (error: any) {
      console.error('Erro ao atualizar presenca', error);
      notify.error(error.response?.data?.message || 'Erro ao atualizar presenca');
    }
  };

  if (loading) {
    return <div className="loading">Carregando...</div>;
  }

  return (
    <div className="schedules-page">
      <header className="schedules-hero">
        <div className="schedules-hero-copy">
          <span className="schedules-eyebrow">Coordenacao de escalas</span>
          <h1 style={{ display: 'flex', alignItems: 'center' }}><TitleIcon name="escala" /> Escalas</h1>
          <p>
            Organize os eventos da comunidade, acompanhe vagas abertas e centralize confirmacoes e
            presencas em um unico painel.
          </p>
          <div className="schedules-hero-note">
            {nextSchedule
              ? `Proxima escala: ${nextSchedule.title} em ${toHumanDate(nextSchedule.date)}`
              : 'Nenhuma escala cadastrada ate o momento.'}
          </div>
        </div>
        <div className="schedules-hero-actions">
          <button className="btn-primary schedules-primary-action" onClick={() => openCreate()}>
            Nova escala
          </button>
          {managerRole && (
            <>
              <button className="overview-action-button is-secondary" onClick={() => setShowStandaloneModal(true)}>
                Escala avulsa
              </button>
              <button className="overview-action-button is-secondary" onClick={openRotation}>
                Gerar rodizio
              </button>
            </>
          )}
        </div>
        <div className="schedules-hero-stats">
          <div className="schedule-summary-card is-blue">
            <span>Escalas abertas</span>
            <strong>{openSchedulesCount}</strong>
          </div>
          <div className="schedule-summary-card is-amber">
            <span>Eventos sem escala</span>
            <strong>{eventsWithoutSchedule.length}</strong>
          </div>
          <div className="schedule-summary-card is-green">
            <span>Membros confirmados</span>
            <strong>{confirmedAssignmentsCount}</strong>
          </div>
          <div className="schedule-summary-card is-slate">
            <span>Escalas concluidas</span>
            <strong>{completedSchedulesCount}</strong>
          </div>
        </div>
      </header>

      {managerRole && (
        <section className="coordinator-overview schedule-surface">
          <div className="coordinator-overview-header">
            <div>
              <span className="section-kicker">Visao consolidada</span>
              <h2>Resumo do coordenador</h2>
              <p className="section-description">
                Veja o volume de escalas do periodo, presencas registradas e os compromissos mais recentes.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <div className="overview-view-toggle" role="group" aria-label="Modo de visualização">
                <button
                  type="button"
                  className={overviewView === 'cards' ? 'active' : ''}
                  onClick={() => changeOverviewView('cards')}
                >
                  ▦ Cards
                </button>
                <button
                  type="button"
                  className={overviewView === 'list' ? 'active' : ''}
                  onClick={() => changeOverviewView('list')}
                >
                  ☰ Lista
                </button>
                <button
                  type="button"
                  className={overviewView === 'calendar' ? 'active' : ''}
                  onClick={() => changeOverviewView('calendar')}
                >
                  🗓 Calendário
                </button>
              </div>
              <button className="overview-action-button is-secondary" onClick={fetchOverview}>
                {overviewLoading ? 'Carregando...' : 'Atualizar'}
              </button>
            </div>
          </div>

          <div className="coordinator-controls">
            <div className="coordinator-period">
              <label className="coordinator-date-field">
                <span>De</span>
                <input type="date" value={overviewFrom} onChange={(event) => setOverviewFrom(event.target.value)} />
              </label>
              <span className="coordinator-period-sep" aria-hidden="true">
                →
              </span>
              <label className="coordinator-date-field">
                <span>Até</span>
                <input type="date" value={overviewTo} onChange={(event) => setOverviewTo(event.target.value)} />
              </label>
              <button className="overview-action-button is-primary" onClick={fetchOverview}>
                Aplicar
              </button>
            </div>
            <div className="coordinator-actions">
              <button className="overview-action-button is-secondary" onClick={() => window.print()}>
                🖨️ Imprimir
              </button>
              <button className="overview-action-button is-secondary" onClick={handleExportPdf} disabled={exportingPdf}>
                {exportingPdf ? 'Gerando PDF…' : '⬇️ Baixar PDF'}
              </button>
            </div>
          </div>

          <div className="coordinator-summary-grid">
            <div className="coordinator-kpi-card">
              <strong>{overviewTotal}</strong>
              <span>Escalas</span>
            </div>
            <div className="coordinator-kpi-card">
              <strong>{overviewAssignments}</strong>
              <span>Escalados</span>
            </div>
            <div className="coordinator-kpi-card">
              <strong>{overviewChecked}</strong>
              <span>Presentes</span>
            </div>
            <div className="coordinator-kpi-card">
              <strong>{overviewAttendance}%</strong>
              <span>Presenca</span>
            </div>
          </div>

          {overview.length === 0 ? (
            <p className="coordinator-empty">Nenhuma escala encontrada no periodo selecionado.</p>
          ) : overviewView === 'calendar' ? (
            <div className="coordinator-calendar">
              <div className="cal-toolbar">
                <div className="cal-nav">
                  <button
                    type="button"
                    onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}
                    aria-label="Mês anterior"
                  >
                    ‹
                  </button>
                  <strong className="cal-month-label">
                    {calMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                  </strong>
                  <button
                    type="button"
                    onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}
                    aria-label="Próximo mês"
                  >
                    ›
                  </button>
                </div>
                <div className="cal-toolbar-right">
                  <button
                    type="button"
                    className={`cal-members-toggle${calShowMembers ? ' active' : ''}`}
                    onClick={toggleCalMembers}
                    title="Exibir os membros escalados dentro dos dias"
                  >
                    👥 Membros
                  </button>
                  <button
                    type="button"
                    className="cal-today-btn"
                    onClick={() => {
                      const now = new Date();
                      setCalMonth(new Date(now.getFullYear(), now.getMonth(), 1));
                    }}
                  >
                    Hoje
                  </button>
                </div>
              </div>

              <div className="cal-grid cal-grid-head">
                {['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'].map((weekday) => (
                  <span key={weekday} className="cal-weekday">
                    {weekday}
                  </span>
                ))}
              </div>
              <div className="cal-grid">
                {calCells.map((cell) => {
                  const daySchedules = overviewByDay.get(cell.key) ?? [];
                  const isToday = cell.key === toDayKey(new Date());
                  return (
                    <div
                      key={cell.key}
                      className={`cal-cell${cell.inMonth ? '' : ' is-out'}${isToday ? ' is-today' : ''}`}
                    >
                      <span className="cal-day-num">{cell.date.getDate()}</span>
                      {daySchedules.map((item) => {
                        const time = new Date(item.date).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        });
                        const statusOf = (assignment: OverviewAssignment) =>
                          assignment.checkedIn
                            ? { label: 'Presente', cls: 'st-present' }
                            : assignment.status === 'CONFIRMED'
                              ? { label: 'Confirmado', cls: 'st-confirmed' }
                              : assignment.status === 'DECLINED'
                                ? { label: 'Recusado', cls: 'st-declined' }
                                : { label: 'Pendente', cls: 'st-pending' };
                        return (
                          <div key={item.scheduleId} className="cal-entry">
                            <button
                              type="button"
                              className={`cal-pill${item.counts.total === 0 ? ' is-empty' : ''}${
                                calSelectedId === item.scheduleId ? ' is-active' : ''
                              }`}
                              onClick={() => {
                                setCalSelectedId(item.scheduleId);
                                void openManageFromOverview(item.scheduleId);
                              }}
                              title={`${item.title} — ${item.counts.total} escalado(s) · clique para gerenciar`}
                            >
                              {time !== '00:00' && <span className="cal-pill-time">{time}</span>}
                              <span className="cal-pill-title">{item.title.replace(/^Escala - /, '')}</span>
                              {(item.counts.swapsPending ?? 0) > 0 && (
                                <span
                                  className="cal-pill-swap"
                                  title={`Pedido(s) de troca em aberto:\n${swapSummaryTooltip(item.assignments)}`}
                                >
                                  🔁
                                </span>
                              )}
                              <span className="cal-pill-count">
                                {item.counts.total === 0 ? '⚠' : item.counts.total}
                              </span>
                            </button>
                            {calShowMembers && (
                              <div className="cal-members">
                                {item.assignments.length === 0 ? (
                                  <span className="cal-member-empty">Sem membros</span>
                                ) : (
                                  item.assignments.map((assignment) => {
                                    const status = statusOf(assignment);
                                    return (
                                      <span
                                        key={assignment.id}
                                        className="cal-member-row"
                                        title={`${assignment.memberName} — ${assignment.role}${
                                          assignment.hasPendingSwap ? ` · ${swapTooltip(assignment)}` : ''
                                        }`}
                                      >
                                        <span className="cal-member-name">{assignment.memberName}</span>
                                        {coupleIn(
                                          assignment.spouseId,
                                          item.assignments,
                                          (a) => a.memberId,
                                          (a) => a.memberName,
                                        ) && (
                                          <span
                                            className="cal-member-badge st-couple"
                                            title={`Casal escalado junto: ${assignment.memberName} e ${coupleIn(
                                              assignment.spouseId,
                                              item.assignments,
                                              (a) => a.memberId,
                                              (a) => a.memberName,
                                            )}`}
                                          >
                                            💍
                                          </span>
                                        )}
                                        {assignment.hasPendingSwap && (
                                          <span className="cal-member-badge st-swap" title={swapTooltip(assignment)}>
                                            🔁
                                          </span>
                                        )}
                                        <span className={`cal-member-badge ${status.cls}`}>{status.label}</span>
                                      </span>
                                    );
                                  })
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              {calShowMembers && !calSelected ? null : calSelected ? (
                <div className="cal-detail">
                  <div className="cal-detail-head">
                    <div>
                      <strong>{calSelected.title}</strong>
                      <span className="cal-detail-date">{toHumanDate(calSelected.date)}</span>
                    </div>
                    <button type="button" className="cal-detail-close" onClick={() => setCalSelectedId(null)}>
                      ×
                    </button>
                  </div>
                  {calSelected.assignments.length === 0 ? (
                    <p className="overview-expand-empty">Sem atribuições nesta escala.</p>
                  ) : (
                    <div className="overview-members-grid">
                      {calSelected.assignments.map((assignment) => {
                        const status = assignment.checkedIn
                          ? { label: 'Presente', cls: 'st-present' }
                          : assignment.status === 'CONFIRMED'
                            ? { label: 'Confirmado', cls: 'st-confirmed' }
                            : assignment.status === 'DECLINED'
                              ? { label: 'Recusado', cls: 'st-declined' }
                              : { label: 'Pendente', cls: 'st-pending' };
                        return (
                          <div className="overview-member-pill" key={assignment.id}>
                            <strong>{assignment.memberName}</strong>
                            <em>{assignment.role}</em>
                            <span className={`overview-member-status ${status.cls}`}>{status.label}</span>
                            {assignment.hasPendingSwap && (
                              <span className="overview-member-status st-swap" title={swapTooltip(assignment)}>
                                🔁 Troca
                              </span>
                            )}
                            {(() => {
                              const coupleName = coupleIn(
                                assignment.spouseId,
                                calSelected.assignments,
                                (a) => a.memberId,
                                (a) => a.memberName,
                              );
                              return coupleName ? (
                                <span className="overview-member-status st-couple" title={`Casal escalado junto: ${assignment.memberName} e ${coupleName}`}>
                                  💍
                                </span>
                              ) : null;
                            })()}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <p className="cal-hint">Clique numa escala do calendário para abrir a gestão completa.</p>
              )}
            </div>
          ) : overviewView === 'list' ? (
            <div className="coordinator-table-wrap">
              <table className="coordinator-schedule-table">
                <thead>
                  <tr>
                    <th>Escala</th>
                    <th>Data</th>
                    <th className="num">Pend.</th>
                    <th className="num">Conf.</th>
                    <th className="num">Recus.</th>
                    <th className="num">Pres.</th>
                    <th className="num">Presença</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.map((item) => {
                    const isOpen = expandedOverviewId === item.scheduleId;
                    const assignmentStatusLabel = (assignment: OverviewAssignment) => {
                      if (assignment.checkedIn) return { label: 'Presente', cls: 'st-present' };
                      if (assignment.status === 'CONFIRMED') return { label: 'Confirmado', cls: 'st-confirmed' };
                      if (assignment.status === 'DECLINED') return { label: 'Recusado', cls: 'st-declined' };
                      return { label: 'Pendente', cls: 'st-pending' };
                    };
                    return (
                      <React.Fragment key={item.scheduleId}>
                        <tr
                          className={`overview-row ${isOpen ? 'is-open' : ''}`}
                          onClick={() => setExpandedOverviewId(isOpen ? null : item.scheduleId)}
                          title={isOpen ? 'Ocultar membros escalados' : 'Ver membros escalados'}
                        >
                          <td>
                            <span className="overview-row-title">
                              <span className="overview-caret" aria-hidden="true">
                                ▸
                              </span>
                              <span>
                                <span className="overview-title-line">
                                  <strong>{item.title}</strong>
                                  {item.counts.total === 0 && (
                                    <span
                                      className="overview-alert-chip"
                                      title="Nenhum membro foi atribuído a esta escala"
                                    >
                                      ⚠️ Sem atribuições
                                    </span>
                                  )}
                                  {(item.counts.swapsPending ?? 0) > 0 && (
                                    <span
                                      className="overview-swap-chip"
                                      title={`Pedido(s) de troca em aberto:\n${swapSummaryTooltip(item.assignments)}`}
                                    >
                                      🔁 {item.counts.swapsPending} troca{(item.counts.swapsPending ?? 0) > 1 ? 's' : ''}
                                    </span>
                                  )}
                                </span>
                                <small>{item.event.title}</small>
                              </span>
                            </span>
                          </td>
                          <td className="nowrap">{toHumanDate(item.date)}</td>
                          <td className="num warn">{item.counts.pending}</td>
                          <td className="num ok">{item.counts.confirmed}</td>
                          <td className="num danger">{item.counts.declined}</td>
                          <td className="num ok">{item.counts.checkedIn}</td>
                          <td className="num">
                            <span className="status-chip status-rate">{item.attendanceRate}%</span>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="overview-expand-row">
                            <td colSpan={7}>
                              {item.assignments.length === 0 ? (
                                <p className="overview-expand-empty">Sem atribuições nesta escala.</p>
                              ) : (
                                <div className="overview-members-grid">
                                  {item.assignments.map((assignment) => {
                                    const status = assignmentStatusLabel(assignment);
                                    return (
                                      <div className="overview-member-pill" key={assignment.id}>
                                        <strong>{assignment.memberName}</strong>
                                        <em>{assignment.role}</em>
                                        <span className={`overview-member-status ${status.cls}`}>{status.label}</span>
                                        {assignment.hasPendingSwap && (
                                          <span className="overview-member-status st-swap" title={swapTooltip(assignment)}>
                                            🔁 Troca
                                          </span>
                                        )}
                                        {(() => {
                                          const coupleName = coupleIn(
                                            assignment.spouseId,
                                            item.assignments,
                                            (a) => a.memberId,
                                            (a) => a.memberName,
                                          );
                                          return coupleName ? (
                                            <span className="overview-member-status st-couple" title={`Casal escalado junto: ${assignment.memberName} e ${coupleName}`}>
                                              💍
                                            </span>
                                          ) : null;
                                        })()}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="coordinator-schedule-grid">
              {overview.map((item) => (
                <div key={item.scheduleId} className="coordinator-schedule-card">
                  <div className="coordinator-schedule-header">
                    <div>
                      <h3>{item.title}</h3>
                      <p className="coordinator-schedule-date">{toHumanDate(item.date)}</p>
                      <p>{item.event.title}</p>
                    </div>
                    <div className="coordinator-schedule-badges">
                      <span className="status-chip status-rate">{item.attendanceRate}% presentes</span>
                      {item.counts.total === 0 && (
                        <span className="overview-alert-chip" title="Nenhum membro foi atribuído a esta escala">
                          ⚠️ Sem atribuições
                        </span>
                      )}
                      {(item.counts.swapsPending ?? 0) > 0 && (
                        <span
                          className="overview-swap-chip"
                          title={`Pedido(s) de troca em aberto:\n${swapSummaryTooltip(item.assignments)}`}
                        >
                          🔁 {item.counts.swapsPending} troca{(item.counts.swapsPending ?? 0) > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="assignment-status-summary">
                    <span className="status-pill status-pending">Pendentes: {item.counts.pending}</span>
                    <span className="status-pill status-confirmed">Confirmados: {item.counts.confirmed}</span>
                    <span className="status-pill status-declined">Recusados: {item.counts.declined}</span>
                    <span className="status-pill status-ok">Presentes: {item.counts.checkedIn}</span>
                  </div>
                  <div className="coordinator-members-list">
                    {item.assignments.slice(0, 2).map((assignment) => (
                      <div className="coordinator-member-item" key={assignment.id}>
                        <span className="coordinator-member-name">
                          {assignment.memberName}
                          <br />
                          <em>{assignment.role}</em>
                        </span>
                        <span>{assignment.checkedIn ? 'Presente' : assignment.status}</span>
                      </div>
                    ))}
                    {item.assignments.length > 2 && (
                      <p className="coordinator-more-members">+ {item.assignments.length - 2} membros</p>
                    )}
                    {item.assignments.length === 0 && <p className="coordinator-no-members">Sem atribuicoes</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="schedule-print-view">
            <h1 style={{ display: 'flex', alignItems: 'center' }}><TitleIcon name="escala" /> Escala de Serviço</h1>
            <p className="schedule-print-period">
              Período de {overviewFrom ? toHumanDate(`${overviewFrom}T00:00:00`) : '—'} até{' '}
              {overviewTo ? toHumanDate(`${overviewTo}T23:59:59`) : '—'}
            </p>
            {overview.map((item) => (
              <div key={`print-${item.scheduleId}`} className="print-schedule">
                <h2>
                  {toHumanDate(item.date)} — {item.event.title}
                </h2>
                {item.event.community?.name && <p>{item.event.community.name}</p>}
                <table>
                  <thead>
                    <tr>
                      <th>Função</th>
                      <th>Membro</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.assignments.map((assignment) => (
                      <tr key={`print-${assignment.id}`}>
                        <td>{assignment.role}</td>
                        <td>{assignment.memberName}</td>
                        <td>{assignment.checkedIn ? 'Presente' : statusLabel[assignment.status]}</td>
                      </tr>
                    ))}
                    {item.assignments.length === 0 && (
                      <tr>
                        <td colSpan={3}>Sem atribuições</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="schedules-toolbar-panel schedule-surface">
        <div className="section-card-header">
          <div>
            <span className="section-kicker">Filtro rapido</span>
            <h2>Refinar escalas</h2>
            <p className="section-description">
              Busque por evento, comunidade ou status para localizar a escala certa mais rapido.
            </p>
          </div>
          {(searchText || statusFilter !== 'all' || eventFilter) && (
            <button
              className="btn-clear-filters btn-clear-filters-inline"
              onClick={() => {
                setSearchText('');
                setStatusFilter('all');
                setEventFilter('');
              }}
            >
              Limpar filtros
            </button>
          )}
        </div>

        <div className="filter-row filter-row-panel">
          <input
            className="search-input"
            placeholder="Buscar por titulo, evento ou comunidade"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'all' | ScheduleStatus)}
          >
            <option value="all">Todos os status</option>
            <option value="OPEN">Aberta</option>
            <option value="CLOSED">Fechada</option>
            <option value="COMPLETED">Concluida</option>
            <option value="CANCELLED">Cancelada</option>
          </select>
          <select className="filter-select" value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}>
            <option value="">Todos os eventos</option>
            {events.map((eventItem) => (
              <option key={eventItem.id} value={eventItem.id}>
                {eventItem.title}
              </option>
            ))}
          </select>
        </div>
      </section>

      {(searchText || statusFilter !== 'all' || eventFilter) && (
        <div className="active-filters-banner">
          <div className="active-filters-info">
            <span className="filter-count">{getFilteredSchedules.length} escalas</span>
            <div className="active-filter-tags">
              {statusFilter !== 'all' && <span className="filter-tag">Status: {scheduleStatusMap[statusFilter].label}</span>}
              {eventFilter && <span className="filter-tag">Evento filtrado</span>}
              {searchText && <span className="filter-tag">Busca: {searchText}</span>}
            </div>
          </div>
          <button
            className="btn-clear-filters"
            onClick={() => {
              setSearchText('');
              setStatusFilter('all');
              setEventFilter('');
            }}
          >
            Limpar filtros
          </button>
        </div>
      )}

      <section className="events-without-schedule schedule-surface">
        <div className="section-card-header">
          <div>
            <span className="section-kicker">Pendencias</span>
            <h3>Eventos sem escala</h3>
            <p className="section-description">
              {eventsWithoutSchedule.length > 0
                ? `Mostrando os ${pendingEventsPreview.length} proximos eventos que ainda nao receberam escala.`
                : 'Todos os eventos do recorte atual ja possuem escala.'}
            </p>
          </div>
          <span className="section-count-pill">{eventsWithoutSchedule.length}</span>
        </div>
        <div className="events-list">
          {eventsWithoutSchedule.length === 0 ? (
            <p className="no-events">Nao existem eventos sem escala no recorte atual.</p>
          ) : (
            pendingEventsPreview.map((eventItem) => (
              <div className="event-item" key={eventItem.id}>
                <div className="event-info">
                  <span className="event-type-badge">{eventItem.type}</span>
                  <div className="event-copy">
                    <div className="event-title-row">
                      <strong>{eventItem.title}</strong>
                      <span className="event-date-chip">{toDateTag(eventItem.startDate)}</span>
                      {eventDayKeys(eventItem).length > 1 && (
                        <span className="event-date-chip" title="Evento de vários dias — uma escala por dia">
                          {scheduledDaysByEvent.get(eventItem.id)?.size ?? 0} de {eventDayKeys(eventItem).length} dias com escala
                        </span>
                      )}
                    </div>
                    <div className="event-meta-row">
                      <span className="event-community">{eventItem.community.name}</span>
                      {eventItem.community.parish?.name ? (
                        <span className="event-community subdued">{eventItem.community.parish.name}</span>
                      ) : null}
                    </div>
                    <small className="event-pastoral-summary">{eventPastoralText(eventItem)}</small>
                  </div>
                </div>
                <div className="event-item-actions">
                  <button className="btn-small btn-create" onClick={() => openCreate(eventItem)}>
                    Criar escala
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="schedules-list">
        {groupedSchedules.length === 0 ? (
          <div className="no-results">Nenhuma escala encontrada</div>
        ) : (
          groupedSchedules.map((group) => (
            <div className="schedule-group" key={group.date}>
              <div className="schedule-group-header">
                <h3 className="group-date">{toDateTag(group.list[0]?.date || group.date)}</h3>
                <span className="schedule-group-count">{group.list.length} escala(s)</span>
              </div>
              <div className="schedules-grid">
                {group.list.map((schedule) => {
                  const statusInfo = scheduleStatusMap[schedule.status];
                  const progressItems = getPastoralProgress(schedule);
                  return (
                    <article className="schedule-card" key={schedule.id}>
                      <div className="schedule-card-main" onClick={() => openDetail(schedule)}>
                        <div className="schedule-card-heading">
                          <div className="schedule-card-title-block">
                            <div className="schedule-card-title-row">
                              <h4>{schedule.title}</h4>
                              <span
                                className="schedule-status-badge"
                                style={{
                                  background: `${statusInfo.color}15`,
                                  color: statusInfo.color,
                                  borderColor: `${statusInfo.color}33`,
                                }}
                              >
                                {statusInfo.label}
                              </span>
                            </div>
                            <p className="event-badge">
                              {schedule.isStandalone ? '🔁 Serviço contínuo' : schedule.event.title}
                              {schedule.isStandalone && schedule.startTime ? ` · ${schedule.startTime}${schedule.endTime ? `–${schedule.endTime}` : ''}` : ''}
                            </p>
                          </div>
                          <div className="schedule-card-count-block">
                            <strong>{schedule._count.assignments}</strong>
                            <span>membros</span>
                          </div>
                        </div>
                        <div className="schedule-card-meta-grid">
                          <div className="schedule-card-meta-item">
                            <span>Quando</span>
                            <strong>{toHumanDate(schedule.date)}</strong>
                          </div>
                          <div className="schedule-card-meta-item">
                            <span>Comunidade</span>
                            <strong>{schedule.event.community?.name || 'Nao informada'}</strong>
                          </div>
                          <div className="schedule-card-meta-item">
                            <span>Paroquia</span>
                            <strong>{schedule.event.community?.parish?.name || 'Nao informada'}</strong>
                          </div>
                        </div>
                        <p className="schedule-desc">{eventPastoralText(schedule.event)}</p>
                        <div className="schedule-progress-list">
                          {progressItems.length > 0 ? (
                            progressItems.map((item) => (
                              <span key={item.communityPastoralId} className="schedule-progress-pill">
                                {item.name}: {item.requiredPeople > 0 ? `${item.assignedCount}/${item.requiredPeople}` : `${item.assignedCount}`}
                              </span>
                            ))
                          ) : (
                            <span className="schedule-progress-pill neutral">Sem pastoral vinculada</span>
                          )}
                        </div>
                        <div className="assignments-preview">
                          {schedule.assignments.slice(0, 4).map((assignment) => (
                            <span
                              key={assignment.id}
                              className={`member-chip ${assignment.status === 'CONFIRMED' ? 'status-confirmed' : assignment.status === 'DECLINED' ? 'status-declined' : 'status-pending'}`}
                              title={assignment.role ? `${assignment.member.fullName} - ${assignment.role}` : assignment.member.fullName}
                            >
                              <span className="member-chip-name">
                                {assignment.member.fullName}
                                {coupleIn(
                                  assignment.member.spouseId,
                                  schedule.assignments,
                                  (a) => a.member.id,
                                  (a) => a.member.fullName,
                                ) && ' 💍'}
                              </span>
                              {assignment.role ? <span className="member-chip-role">{assignment.role}</span> : null}
                            </span>
                          ))}
                          {schedule._count.assignments > 4 && <span className="more-members">+ {schedule._count.assignments - 4}</span>}
                        </div>
                      </div>
                      <div className="card-actions schedule-card-actions">
                        <button className="btn-small btn-surface" onClick={() => openDetail(schedule)}>
                          Detalhes
                        </button>
                        <button className="btn-small btn-add" onClick={() => void openAssign(schedule)}>
                          Preencher vagas
                        </button>
                        <button className="btn-small btn-delete" onClick={() => void handleDeleteSchedule(schedule)}>
                          Excluir
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </section>
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => { setShowCreateModal(false); resetCreateForm(); }}>
          <div className="modal-content modal-large" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => { setShowCreateModal(false); resetCreateForm(); }}>
              ×
            </button>
            <h2>Nova escala</h2>
            <form onSubmit={handleSubmitSchedule}>
              <div className="form-group">
                <label>Evento</label>
                <select
                  required
                  value={createForm.eventId}
                  onChange={(event) => handleCreateEventChange(event.target.value)}
                >
                  <option value="">Selecione</option>
                  {events.map((eventItem) => (
                    <option key={eventItem.id} value={eventItem.id}>
                      {eventItem.title} ({eventItem.community.name})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Titulo</label>
                <input
                  type="text"
                  required
                  value={createForm.title}
                  onChange={(event) => setCreateForm({ ...createForm, title: event.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Descricao</label>
                <textarea
                  rows={3}
                  value={createForm.description}
                  onChange={(event) => setCreateForm({ ...createForm, description: event.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Data e hora</label>
                <input
                  type="datetime-local"
                  required
                  value={createForm.date}
                  onChange={(event) => setCreateForm({ ...createForm, date: event.target.value })}
                />
              </div>

              {(() => {
                const selectedEvent = events.find((item) => item.id === createForm.eventId);
                if (!selectedEvent) return null;
                const days = eventDayKeys(selectedEvent);
                if (days.length <= 1) return null;
                const done = scheduledDaysByEvent.get(selectedEvent.id);
                const pending = days.filter((day) => !done?.has(day));
                const fmt = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
                return (
                  <div
                    className="form-group"
                    style={{
                      background: '#eaf4ff',
                      border: '1px solid #b6d4fe',
                      borderRadius: 10,
                      padding: '10px 12px',
                    }}
                  >
                    <strong style={{ fontSize: '0.9rem', color: '#075aa9' }}>
                      Evento de vários dias ({days.length} celebrações)
                    </strong>
                    <p style={{ margin: '4px 0 8px', fontSize: '0.82rem', color: '#33475b' }}>
                      Cada dia tem a própria escala. Já com escala:{' '}
                      {days.length - pending.length === 0
                        ? 'nenhum'
                        : days.filter((day) => done?.has(day)).map(fmt).join(', ')}{' '}
                      · Pendentes: {pending.length === 0 ? 'nenhum' : pending.map(fmt).join(', ')}
                    </p>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, cursor: 'pointer', fontSize: '0.88rem' }}>
                      <input
                        type="checkbox"
                        checked={createAllDays}
                        onChange={(event) => setCreateAllDays(event.target.checked)}
                        style={{ width: 16, height: 16 }}
                      />
                      Criar uma escala para <strong>cada dia pendente</strong> ({pending.length}) usando o horário informado acima
                    </label>
                  </div>
                );
              })()}

              <div className="create-slots-panel">
                <div className="create-slots-header">
                  <strong>Vagas por pastoral</strong>
                  <span>O coordenador pode ajustar a quantidade desta escala sem alterar o evento.</span>
                </div>

                {createForm.pastoralSettings.length > 0 ? (
                  <div className="create-slots-list">
                    {createForm.pastoralSettings.map((pastoralSetting) => (
                      <div key={pastoralSetting.communityPastoralId} className="create-slot-row">
                        <div className="create-slot-copy">
                          <strong>{pastoralSetting.name}</strong>
                          <span>{pastoralSetting.role || 'Sem funcao padrao definida para esta pastoral'}</span>
                        </div>
                        <label className="create-slot-input">
                          <span>Vagas</span>
                          <input
                            type="number"
                            min="0"
                            value={pastoralSetting.requiredPeople}
                            onChange={(event) =>
                              handleCreatePastoralRequiredPeopleChange(
                                pastoralSetting.communityPastoralId,
                                event.target.value,
                              )
                            }
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="create-slots-empty">
                    Sem pastorais vinculadas a este evento. A escala sera criada sem controle de vagas por pastoral.
                  </div>
                )}

                <small className="create-slots-hint">Use `0` para indicar vagas sem limite.</small>
              </div>

              <div className="modal-actions">
                <button
                  className="btn-cancel"
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    resetCreateForm();
                  }}
                >
                  Cancelar
                </button>
                <button className="btn-submit" type="submit">
                  Criar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDetailModal && activeSchedule && (
        <div className="modal-overlay manage-overlay" onClick={() => setShowDetailModal(false)}>
          <div className="modal-content modal-manage" onClick={(event) => event.stopPropagation()}>
            <div className="manage-topbar">
              <div className="manage-title-block">
                <span className="manage-kicker">Gestão da escala</span>
                <h2>{activeSchedule.title}</h2>
                <div className="manage-meta">
                  <span>📅 {toHumanDate(activeSchedule.date)}</span>
                  <span>⛪ {activeSchedule.isStandalone ? 'Serviço contínuo' : activeSchedule.event.title}</span>
                  {activeSchedule.event.community?.name && <span>📍 {activeSchedule.event.community.name}</span>}
                  {activeSchedule.event.location && <span>🗺 {activeSchedule.event.location}</span>}
                </div>
              </div>
              <div className="manage-top-actions">
                <select
                  className="manage-status-select"
                  value={activeSchedule.status}
                  onChange={(event) => handleUpdateStatus(activeSchedule.id, event.target.value as ScheduleStatus)}
                  title="Status da escala"
                >
                  <option value="OPEN">Aberta</option>
                  <option value="CLOSED">Fechada</option>
                  <option value="COMPLETED">Concluida</option>
                  <option value="CANCELLED">Cancelada</option>
                </select>
                <button
                  className="manage-action highlight"
                  onClick={() => openRotationForSchedule(activeSchedule.id)}
                  title="Sugere e escala membros para as vagas em aberto usando as regras do rodízio"
                >
                  ⚡ Preencher automático
                </button>
                <button className="manage-action" onClick={() => handleNotifyTeam(activeSchedule.id)}>
                  📣 Avisar equipe
                </button>
                <button className="manage-action danger" onClick={() => void handleDeleteSchedule(activeSchedule)}>
                  🗑 Excluir
                </button>
                <button className="manage-close" onClick={() => setShowDetailModal(false)} aria-label="Fechar">
                  ×
                </button>
              </div>
            </div>

            <div className="manage-kpis">
              <div className="manage-kpi">
                <strong>{activeSchedule.assignments.length}</strong>
                <span>Escalados</span>
              </div>
              <div className="manage-kpi is-pending">
                <strong>{activeSchedule.assignments.filter((a) => a.status === 'PENDING').length}</strong>
                <span>Pendentes</span>
              </div>
              <div className="manage-kpi is-confirmed">
                <strong>{activeSchedule.assignments.filter((a) => a.status === 'CONFIRMED').length}</strong>
                <span>Confirmados</span>
              </div>
              <div className="manage-kpi is-declined">
                <strong>{activeSchedule.assignments.filter((a) => a.status === 'DECLINED').length}</strong>
                <span>Recusados</span>
              </div>
              <div className="manage-kpi is-present">
                <strong>{activeSchedule.assignments.filter((a) => a.checkedIn).length}</strong>
                <span>Presentes</span>
              </div>
              {activeSchedule.assignments.filter((a) => (a.swapRequests?.length ?? 0) > 0).length > 0 && (
                <div className="manage-kpi is-swap">
                  <strong>
                    {activeSchedule.assignments.filter((a) => (a.swapRequests?.length ?? 0) > 0).length}
                  </strong>
                  <span>🔁 Trocas</span>
                </div>
              )}
            </div>

            <div className="manage-body">
              <aside className="manage-side">
                {detailLoading ? <p className="loading">Atualizando detalhes...</p> : null}

                <div className="manage-side-head">
                  <h3>Pastorais & vagas</h3>
                  {managerRole && detailPastoralProgress.length > 0 && (
                    <button className="btn-small btn-surface" onClick={openSlotsEdit}>
                      ✏️ Vagas
                    </button>
                  )}
                </div>
                <p className="manage-side-hint">Clique numa pastoral para preencher as vagas dela.</p>
              <div className="pastoral-progress-grid">
                {detailPastoralProgress.length > 0 ? (
                  detailPastoralProgress.map((pastoral) => {
                    const hasOpenSlots = pastoral.remainingPeople !== null && pastoral.remainingPeople > 0;
                    const isFull = pastoral.requiredPeople > 0 && pastoral.remainingPeople === 0;
                    return (
                      <button
                        key={pastoral.communityPastoralId}
                        type="button"
                        className={`pastoral-progress-card${hasOpenSlots ? ' has-open' : ''}${isFull ? ' is-full' : ''}`}
                        onClick={() => void openAssign(activeSchedule, pastoral.communityPastoralId)}
                        title={
                          hasOpenSlots
                            ? `Preencher as vagas de ${pastoral.name}`
                            : `Escalar pessoas em ${pastoral.name}`
                        }
                      >
                        <strong>{pastoral.name}</strong>
                        <span>
                          {pastoral.requiredPeople > 0
                            ? `${pastoral.assignedCount}/${pastoral.requiredPeople} preenchidos`
                            : `${pastoral.assignedCount} membro(s) escalado(s)`}
                        </span>
                        {hasOpenSlots ? (
                          <small className="pastoral-open-cta">
                            ➕ Preencher {pastoral.remainingPeople} vaga{(pastoral.remainingPeople ?? 0) > 1 ? 's' : ''} em aberto
                          </small>
                        ) : isFull ? (
                          <small className="pastoral-full-tag">✓ Completa</small>
                        ) : (
                          <small>{pastoral.role || 'Sem limite de vagas definido'}</small>
                        )}
                      </button>
                    );
                  })
                ) : (
                  <p className="coordinator-no-members">Sem pastoral vinculada para esta escala.</p>
                )}
              </div>

                {detailPastoralProgress.some((pastoral) => pastoral.requiredPeople === 0) && (
                  <button
                    className="manage-add-people"
                    type="button"
                    onClick={() => void openAssign(activeSchedule)}
                  >
                    ➕ Adicionar mais pessoas
                  </button>
                )}
              </aside>

              <section className="manage-main">
              <div className="assignments-section-header">
                <h3>Membros escalados</h3>
                <div className="assignment-filters">
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Buscar membro"
                    value={assignmentSearch}
                    onChange={(event) => setAssignmentSearch(event.target.value)}
                  />
                  <button
                    type="button"
                    className={`assignment-filter ${assignmentStatusFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setAssignmentStatusFilter('all')}
                  >
                    Todos
                  </button>
                  <button
                    type="button"
                    className={`assignment-filter ${assignmentStatusFilter === 'PENDING' ? 'active' : ''}`}
                    onClick={() => setAssignmentStatusFilter('PENDING')}
                  >
                    Pendente
                  </button>
                  <button
                    type="button"
                    className={`assignment-filter ${assignmentStatusFilter === 'CONFIRMED' ? 'active' : ''}`}
                    onClick={() => setAssignmentStatusFilter('CONFIRMED')}
                  >
                    Confirmado
                  </button>
                  <button
                    type="button"
                    className={`assignment-filter ${assignmentStatusFilter === 'DECLINED' ? 'active' : ''}`}
                    onClick={() => setAssignmentStatusFilter('DECLINED')}
                  >
                    Recusado
                  </button>
                </div>
              </div>

              <div className="assignment-status-summary">
                <span className="status-pill status-confirmed">
                  Confirmados:{' '}
                  {activeSchedule.assignments.filter((assignment) => assignment.status === 'CONFIRMED').length}
                </span>
                <span className="status-pill status-pending">
                  Pendentes:{' '}
                  {activeSchedule.assignments.filter((assignment) => assignment.status === 'PENDING').length}
                </span>
                <span className="status-pill status-declined">
                  Recusados:{' '}
                  {activeSchedule.assignments.filter((assignment) => assignment.status === 'DECLINED').length}
                </span>
                <span className="status-pill status-ok">
                  Presentes:{' '}
                  {activeSchedule.assignments.filter((assignment) => assignment.checkedIn).length}
                </span>
              </div>

              {getFilteredAssignments.length === 0 ? (
                <p className="no-assignments">Nenhuma atribuicao encontrada</p>
              ) : (
                <div className="assignments-list">
                  {getFilteredAssignments.map((assignment) => (
                    <div
                      className={`assignment-item ${assignment.checkedIn ? 'checked-in' : ''}${
                        (assignment.swapRequests?.length ?? 0) > 0 ? ' has-swap' : ''
                      }`}
                      key={assignment.id}
                    >
                      <div className="assignment-info">
                        <span className="member-avatar">
                          {assignment.member.photoUrl ? (
                            <img src={assignment.member.photoUrl} alt="" />
                          ) : (
                            assignment.member.fullName.charAt(0).toUpperCase()
                          )}
                        </span>
                        <div className="member-details">
                          <strong>{assignment.member.fullName}</strong>
                          <span className="member-meta-row">
                            <span className="role-badge">{assignment.role}</span>
                            <span className="member-pastoral">
                              {assignment.communityPastoral?.globalPastoral?.name || 'Pastoral'}
                            </span>
                            {(() => {
                              const coupleName = coupleIn(
                                assignment.member.spouseId,
                                activeSchedule.assignments,
                                (a) => a.member.id,
                                (a) => a.member.fullName,
                              );
                              return coupleName ? (
                                <span className="couple-chip" title={`Casado(a) com ${coupleName} — escalados juntos`}>
                                  💍 casal
                                </span>
                              ) : null;
                            })()}
                          </span>
                          <span className="member-contacts">
                            {assignment.member.phone ? (
                              <a
                                href={whatsappUrl(assignment.member.phone)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Conversar no WhatsApp"
                              >
                                💬 {assignment.member.phone}
                              </a>
                            ) : (
                              <span className="muted">📞 sem telefone</span>
                            )}
                            {assignment.member.email && (
                              <a href={`mailto:${assignment.member.email}`}>✉️ {assignment.member.email}</a>
                            )}
                          </span>
                          {(assignment.swapRequests?.length ?? 0) > 0 && (
                            <span className="member-swap-note">
                              🔁 <strong>Pediu troca</strong>
                              {assignment.swapRequests?.[0]?.message ? (
                                <>
                                  : <q>{assignment.swapRequests[0].message}</q>
                                </>
                              ) : (
                                <em> (sem mensagem)</em>
                              )}
                              {assignment.swapRequests?.[0]?.createdAt && (
                                <em className="swap-date"> · {toShortDate(assignment.swapRequests[0].createdAt!)}</em>
                              )}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="assignment-status">
                        <span className={`status-chip ${assignment.checkedIn ? 'status-ok' : assignment.status === 'CONFIRMED' ? 'status-confirmed' : assignment.status === 'DECLINED' ? 'status-declined' : 'status-pending'}`}>
                          {statusLabel[assignment.status]}
                        </span>
                        {assignment.checkedIn && assignment.checkedInAt && (
                          <small className="status-checked">{toHumanDate(assignment.checkedInAt)}</small>
                        )}
                      </div>

                      <div className="assignment-actions">
                        {assignment.status === 'CONFIRMED' ? (
                          <button
                            className="btn-small btn-checkin"
                            type="button"
                            onClick={() => handleCheckIn(assignment)}
                          >
                            {assignment.checkedIn ? 'Desfazer' : 'Check-in'}
                          </button>
                        ) : null}
                        <button
                          className="btn-small btn-surface"
                          type="button"
                          title="Escolher outro membro para esta vaga (o atual será removido)"
                          onClick={() => {
                            setReplaceTarget(assignment);
                            void openAssign(activeSchedule, assignment.communityPastoral?.id || '');
                          }}
                        >
                          🔁 Substituir
                        </button>
                        <button
                          className="btn-small btn-remove"
                          type="button"
                          onClick={() => handleRemoveAssignment(assignment)}
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              </section>
            </div>
          </div>
        </div>
      )}

      {showAssignModal && activeSchedule && (
        <div className="modal-overlay" onClick={closeAssignModal}>
          <div className="modal-content modal-assign" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={closeAssignModal}>×</button>

            <div className="assign-modal-header">
              <h2>{replaceTarget ? 'Substituir membro' : 'Preencher vaga'}</h2>
              {replaceTarget && (
                <div className="assign-replace-banner">
                  🔁 Substituindo <strong>{replaceTarget.member.fullName}</strong> — ao escalar o novo membro, o
                  anterior será removido automaticamente.
                  <button type="button" onClick={() => setReplaceTarget(null)}>
                    cancelar substituição
                  </button>
                </div>
              )}
              {candidates && (
                <p className="assign-modal-context">
                  {activeSchedule.title} • {toHumanDate(activeSchedule.date)}
                  {activeSchedule.event.location ? ` • ${activeSchedule.event.location}` : ` • ${candidates.event.community?.name ?? ''}`}
                </p>
              )}
            </div>

            {eligibleLoading && <p className="loading">Carregando candidatos...</p>}

            {!eligibleLoading && !candidates && (
              <p className="no-members-warning">Nao foi possivel carregar os dados de candidatos.</p>
            )}

            {!eligibleLoading && candidates && (
              <>
                {candidates.hasPastorals && candidates.pastorals.length > 0 && (
                  <div className="assign-pastoral-tabs">
                    {candidates.pastorals.map((pastoral) => {
                      const isFull = pastoral.requiredPeople > 0 && pastoral.assignedCount >= pastoral.requiredPeople;
                      const isActive = assignmentForm.communityPastoralId === pastoral.communityPastoralId;
                      return (
                        <button
                          key={pastoral.communityPastoralId}
                          type="button"
                          className={`assign-pastoral-tab${isActive ? ' active' : ''}${isFull ? ' full' : ''}`}
                          onClick={() => handlePastoralSelection(pastoral.communityPastoralId)}
                        >
                          <span className="assign-pastoral-tab-name">{pastoral.name}</span>
                          <span className="assign-pastoral-tab-count">
                            {pastoral.requiredPeople > 0
                              ? `${pastoral.assignedCount}/${pastoral.requiredPeople} vagas`
                              : `${pastoral.assignedCount} escalados`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {assignedMembersForPanel.length > 0 && (
                  <div className="assign-already-strip">
                    <span className="assign-already-label">
                      Ja escalados ({assignedMembersForPanel.length})
                    </span>
                    <div className="assign-already-list">
                      {assignedMembersForPanel.map((assignment) => (
                        <div key={assignment.id} className="assign-already-item">
                          <span className="assign-already-member">{assignment.member.fullName}</span>
                          <span className="assign-already-role">{assignment.role}</span>
                          <span
                            className={`status-chip ${
                              assignment.checkedIn
                                ? 'status-ok'
                                : assignment.status === 'CONFIRMED'
                                  ? 'status-confirmed'
                                  : assignment.status === 'DECLINED'
                                    ? 'status-declined'
                                    : 'status-pending'
                            }`}
                          >
                            {assignment.checkedIn ? 'Presente' : statusLabel[assignment.status]}
                          </span>
                          <button
                            type="button"
                            className="assignment-assigned-remove"
                            onClick={() => void handleRemoveAssignment(assignment)}
                          >
                            Remover
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="assign-search-row">
                  <input
                    type="text"
                    className="search-input assign-search-input"
                    placeholder="Buscar por nome ou email"
                    value={memberSearch}
                    onChange={(event) => setMemberSearch(event.target.value)}
                  />
                  <div className="candidate-filter-group">
                    <button
                      type="button"
                      className={`assignment-filter ${candidateFilter === 'all' ? 'active' : ''}`}
                      onClick={() => setCandidateFilter('all')}
                    >
                      Todos ({candidateCounts.all})
                    </button>
                    <button
                      type="button"
                      className={`assignment-filter ${candidateFilter === 'recommended' ? 'active' : ''}`}
                      onClick={() => setCandidateFilter('recommended')}
                    >
                      Prontos ({candidateCounts.recommended})
                    </button>
                    <button
                      type="button"
                      className={`assignment-filter ${candidateFilter === 'attention' ? 'active' : ''}`}
                      onClick={() => setCandidateFilter('attention')}
                    >
                      Atencao ({candidateCounts.attention})
                    </button>
                    <button
                      type="button"
                      className={`assignment-filter ${candidateFilter === 'conflict' ? 'active' : ''}`}
                      onClick={() => setCandidateFilter('conflict')}
                    >
                      Conflito ({candidateCounts.conflict})
                    </button>
                  </div>
                  <div className="overview-view-toggle assign-view-toggle" role="group" aria-label="Modo de visualização">
                    <button
                      type="button"
                      className={assignView === 'cards' ? 'active' : ''}
                      onClick={() => changeAssignView('cards')}
                    >
                      ▦
                    </button>
                    <button
                      type="button"
                      className={assignView === 'list' ? 'active' : ''}
                      onClick={() => changeAssignView('list')}
                    >
                      ☰
                    </button>
                  </div>
                </div>

                {assignView === 'list' ? (
                  <div className="assign-table-wrap">
                    {filteredCandidates.length === 0 ? (
                      <p className="no-assignments">Nenhum candidato encontrado com os filtros atuais.</p>
                    ) : (
                      <table className="assign-table">
                        <thead>
                          <tr>
                            <th>Membro</th>
                            <th>Pastoral</th>
                            <th className="num">Presença</th>
                            <th className="num">Faltas</th>
                            <th className="num">30d</th>
                            <th className="num">Score</th>
                            <th aria-label="Ação" />
                          </tr>
                        </thead>
                        <tbody>
                          {filteredCandidates.map((member) => {
                            const isExpanded = expandedCandidateId === member.id;
                            return (
                              <React.Fragment key={member.id}>
                                <tr
                                  className={`assign-row level-${member.recommendation.level.toLowerCase()}${isExpanded ? ' is-open' : ''}`}
                                  onClick={() => handleExpandMember(member.id)}
                                >
                                  <td>
                                    <div className="assign-row-member">
                                      <span className="member-avatar candidate-avatar">
                                        {member.fullName.charAt(0).toUpperCase()}
                                      </span>
                                      <span className="assign-row-member-copy">
                                        <strong>
                                          {member.fullName}
                                          {spouseCandidateOf(member) && (
                                            <span
                                              title={`Cônjuge: ${spouseCandidateOf(member)!.fullName} também é candidato(a)`}
                                            >
                                              {' '}
                                              💍
                                            </span>
                                          )}
                                        </strong>
                                        <small>{member.email || member.phone || 'Sem contato'}</small>
                                      </span>
                                    </div>
                                  </td>
                                  <td className="assign-row-pastoral">
                                    {member.pastorals[0]?.name || '—'}
                                    {member.pastorals.length > 1 ? ` +${member.pastorals.length - 1}` : ''}
                                  </td>
                                  <td className="num">{member.history.attendanceRate}%</td>
                                  <td className={`num${member.history.noShowCount > 0 ? ' danger' : ''}`}>
                                    {member.history.noShowCount}
                                  </td>
                                  <td className="num">{member.load.upcoming30DaysCount}</td>
                                  <td className="num">
                                    <span
                                      className={`candidate-level candidate-level-${member.recommendation.level.toLowerCase()}`}
                                    >
                                      {recommendationLabelMap[member.recommendation.level]}
                                    </span>{' '}
                                    <strong>{member.recommendation.score}</strong>
                                  </td>
                                  <td className="assign-row-action">
                                    <button
                                      type="button"
                                      className="btn-small btn-surface"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleExpandMember(member.id);
                                      }}
                                    >
                                      {isExpanded ? 'Fechar' : 'Selecionar'}
                                    </button>
                                  </td>
                                </tr>
                                {isExpanded && (
                                  <tr className="assign-row-expand">
                                    <td colSpan={7}>
                                      <p className="candidate-inline-summary">
                                        {member.recommendation.reasons[0] || 'Sem alertas para esta vaga'} •{' '}
                                        {member.availability.summary[0] || 'Disponibilidade nao informada'}
                                      </p>
                                      <div className="candidate-inline-form">
                                        <div className="candidate-inline-role">
                                          <label htmlFor={`list-role-${member.id}`}>Funcao para esta vaga</label>
                                          <input
                                            id={`list-role-${member.id}`}
                                            type="text"
                                            list="inline-roles"
                                            value={inlineRole}
                                            onChange={(event) => setInlineRole(event.target.value)}
                                            placeholder="Ex: Leitor, Cantor, Slide"
                                          />
                                          <datalist id="inline-roles">
                                            {roleSuggestions.map((role) => (
                                              <option key={role} value={role} />
                                            ))}
                                          </datalist>
                                        </div>
                                        <div className="candidate-inline-actions">
                                          <button
                                            type="button"
                                            className="btn-small btn-surface"
                                            onClick={() => {
                                              setExpandedCandidateId('');
                                              setInlineRole('');
                                            }}
                                          >
                                            Cancelar
                                          </button>
                                          <button
                                            type="button"
                                            className="btn-small btn-submit"
                                            disabled={assignSubmitting || !inlineRole.trim()}
                                            onClick={() => void createAssignment(member.id, inlineRole, true)}
                                          >
                                            {assignSubmitting ? 'Salvando...' : 'Escalar'}
                                          </button>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                ) : (
                <div className="candidate-list assign-candidate-list">
                  {filteredCandidates.length === 0 ? (
                    <p className="no-assignments">Nenhum candidato encontrado com os filtros atuais.</p>
                  ) : (
                    filteredCandidates.map((member) => {
                      const isExpanded = expandedCandidateId === member.id;
                      const primaryReason = member.recommendation.reasons[0] || 'Sem alertas para esta vaga';
                      const availabilitySummary = member.availability.summary[0] || 'Disponibilidade nao informada';

                      return (
                        <article
                          key={member.id}
                          className={`candidate-card ${isExpanded ? 'selected' : ''} level-${member.recommendation.level.toLowerCase()}`}
                        >
                          <div className="candidate-card-main" onClick={() => handleExpandMember(member.id)}>
                            <span className="member-avatar candidate-avatar">
                              {member.fullName.charAt(0).toUpperCase()}
                            </span>
                            <div className="candidate-content">
                              <div className="candidate-header">
                                <div>
                                  <h4>{member.fullName}</h4>
                                  <p>{member.email || member.phone || 'Sem contato informado'}</p>
                                </div>
                                <div className="candidate-score-block">
                                  <div className="candidate-score-tags">
                                    <span className={`candidate-level candidate-level-${member.recommendation.level.toLowerCase()}`}>
                                      {recommendationLabelMap[member.recommendation.level]}
                                    </span>
                                  </div>
                                  <strong>{member.recommendation.score}</strong>
                                </div>
                              </div>

                              <div className="pastoral-badges candidate-badges">
                                {member.pastorals.length > 0 ? (
                                  member.pastorals.slice(0, isExpanded ? undefined : 2).map((pastoral) => (
                                    <span key={`${member.id}-${pastoral.communityPastoralId}`} className="pastoral-badge candidate-badge">
                                      {pastoral.name}
                                      {pastoral.role ? ` • ${pastoral.role}` : ''}
                                    </span>
                                  ))
                                ) : (
                                  <span className="schedule-progress-pill neutral">Sem pastoral vinculada</span>
                                )}
                                {!isExpanded && member.pastorals.length > 2 && (
                                  <span className="schedule-progress-pill neutral">+{member.pastorals.length - 2}</span>
                                )}
                              </div>

                              <div className="candidate-metrics compact">
                                <span className="status-pill status-confirmed">Presenca {member.history.attendanceRate}%</span>
                                <span className={`status-pill ${member.history.noShowCount > 0 ? 'status-declined' : 'status-ok'}`}>
                                  Faltas {member.history.noShowCount}
                                </span>
                                <span className="status-pill status-rate">30d {member.load.upcoming30DaysCount}</span>
                                {spouseCandidateOf(member) && (
                                  <span
                                    className="status-pill status-rate"
                                    title={`Cônjuge: ${spouseCandidateOf(member)!.fullName} também é candidato(a)`}
                                  >
                                    💍 casal
                                  </span>
                                )}
                              </div>

                              <p className="candidate-inline-summary">{primaryReason} • {availabilitySummary}</p>

                              {isExpanded && (
                                <div className="candidate-expanded-details">
                                  <div className="candidate-metrics">
                                    <span className="status-pill status-confirmed">Resposta: {member.history.responseRate}%</span>
                                    <span className="status-pill status-rate">Check-ins: {member.history.checkedInCount}</span>
                                    <span className="status-pill status-rate">Recusas: {member.history.declinedCount}</span>
                                  </div>

                                  <ul className="candidate-reasons">
                                    {member.recommendation.reasons.slice(0, 3).map((reason) => (
                                      <li key={`${member.id}-${reason}`}>{reason}</li>
                                    ))}
                                  </ul>

                                  {(member.conflicts.overlappingAssignments.length > 0 ||
                                    member.conflicts.sameDayAssignments.length > 0) && (
                                    <div className="candidate-conflicts">
                                      {member.conflicts.overlappingAssignments.slice(0, 2).map((conflict) => (
                                        <div key={conflict.assignmentId} className="candidate-conflict-line">
                                          Conflito de horario: {toShortDate(conflict.date)} • {conflict.title}
                                        </div>
                                      ))}
                                      {member.conflicts.overlappingAssignments.length === 0 &&
                                        member.conflicts.sameDayAssignments.slice(0, 2).map((conflict) => (
                                          <div key={conflict.assignmentId} className="candidate-conflict-line">
                                            Mesmo dia: {toShortDate(conflict.date)} • {conflict.title}
                                          </div>
                                        ))}
                                    </div>
                                  )}

                                  <div className="candidate-history-strip">
                                    {member.history.recent.slice(0, 3).map((item) => (
                                      <span
                                        key={item.assignmentId}
                                        className={`status-pill ${item.outcome === 'CHECKED_IN' ? 'status-ok' : item.outcome === 'DECLINED' ? 'status-pending' : 'status-declined'}`}
                                      >
                                        {historyOutcomeLabelMap[item.outcome]} • {toShortDate(item.date)}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="candidate-card-actions">
                            {isExpanded ? (
                              <div className="candidate-inline-form" onClick={(event) => event.stopPropagation()}>
                                <div className="candidate-inline-role">
                                  <label htmlFor={`inline-role-${member.id}`}>Funcao para esta vaga</label>
                                  <input
                                    id={`inline-role-${member.id}`}
                                    type="text"
                                    list="inline-roles"
                                    value={inlineRole}
                                    onChange={(event) => setInlineRole(event.target.value)}
                                    placeholder="Ex: Leitor, Cantor, Slide"
                                  />
                                  <datalist id="inline-roles">
                                    {roleSuggestions.map((role) => (
                                      <option key={role} value={role} />
                                    ))}
                                  </datalist>
                                </div>
                                <div className="candidate-inline-actions">
                                  <button
                                    type="button"
                                    className="btn-small btn-surface"
                                    onClick={() => { setExpandedCandidateId(''); setInlineRole(''); }}
                                  >
                                    Cancelar
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-small btn-submit"
                                    disabled={assignSubmitting || !inlineRole.trim()}
                                    onClick={() => void createAssignment(member.id, inlineRole, true)}
                                  >
                                    {assignSubmitting ? 'Salvando...' : 'Escalar'}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="btn-small btn-surface"
                                onClick={() => handleExpandMember(member.id)}
                              >
                                Selecionar
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
                )}

                <div className="assign-modal-footer">
                  <button className="overview-action-button is-secondary" type="button" onClick={closeAssignModal}>
                    Fechar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showStandaloneModal && (
        <div className="modal-overlay" onClick={() => { setShowStandaloneModal(false); resetStandaloneForm(); }}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <h2>Nova escala avulsa (serviço contínuo)</h2>
            <p style={{ color: '#666', fontSize: '0.9rem', marginTop: '-0.5rem' }}>
              Para serviços sem evento: limpeza, secretaria, plantão do dízimo, adoração...
            </p>
            <form onSubmit={handleCreateStandalone}>
              <div className="form-group">
                <label>Título *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex.: Limpeza da Igreja"
                  value={standaloneForm.title}
                  onChange={(event) => setStandaloneForm({ ...standaloneForm, title: event.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Comunidade *</label>
                <select
                  required
                  value={standaloneForm.communityId}
                  onChange={(event) => setStandaloneForm({ ...standaloneForm, communityId: event.target.value })}
                >
                  <option value="">Selecione</option>
                  {communities.map((community) => (
                    <option key={community.id} value={community.id}>{community.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Data *</label>
                <input
                  type="datetime-local"
                  required
                  value={standaloneForm.date}
                  onChange={(event) => setStandaloneForm({ ...standaloneForm, date: event.target.value })}
                />
              </div>
              <div className="form-row" style={{ display: 'flex', gap: '0.75rem' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Início (HH:MM)</label>
                  <input
                    type="time"
                    value={standaloneForm.startTime}
                    onChange={(event) => setStandaloneForm({ ...standaloneForm, startTime: event.target.value })}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Fim (HH:MM)</label>
                  <input
                    type="time"
                    value={standaloneForm.endTime}
                    onChange={(event) => setStandaloneForm({ ...standaloneForm, endTime: event.target.value })}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Local</label>
                <input
                  type="text"
                  value={standaloneForm.location}
                  onChange={(event) => setStandaloneForm({ ...standaloneForm, location: event.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Descrição</label>
                <textarea
                  rows={3}
                  value={standaloneForm.description}
                  onChange={(event) => setStandaloneForm({ ...standaloneForm, description: event.target.value })}
                />
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => { setShowStandaloneModal(false); resetStandaloneForm(); }}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn-submit" disabled={standaloneSubmitting}>
                  {standaloneSubmitting ? 'Criando...' : 'Criar escala'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {slotsEdit && (
        <div className="modal-overlay" onClick={() => setSlotsEdit(null)}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 480 }}>
            <button className="modal-close" onClick={() => setSlotsEdit(null)}>
              ×
            </button>
            <h2>Editar vagas por pastoral</h2>
            <p style={{ color: '#52606d', fontSize: '0.9rem', margin: '0.25rem 0 1rem' }}>
              As vagas valem só para esta escala. O gerador de rodízio usa esses números para sugerir membros.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
              {slotsEdit.items.map((item, index) => (
                <label
                  key={item.communityPastoralId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    border: '1px solid #e2e8f0',
                    borderRadius: 10,
                    padding: '0.55rem 0.8rem',
                    margin: 0,
                  }}
                >
                  <span style={{ fontWeight: 600, color: '#17324d' }}>{item.name}</span>
                  <input
                    type="number"
                    min={0}
                    value={item.requiredPeople}
                    onChange={(event) =>
                      setSlotsEdit((prev) =>
                        prev
                          ? {
                              ...prev,
                              items: prev.items.map((entry, entryIndex) =>
                                entryIndex === index
                                  ? { ...entry, requiredPeople: Math.max(0, Number(event.target.value || 0)) }
                                  : entry,
                              ),
                            }
                          : prev,
                      )
                    }
                    style={{ width: 80, padding: '6px 8px', textAlign: 'center' }}
                  />
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setSlotsEdit(null)}>
                Cancelar
              </button>
              <button type="button" className="btn-submit" disabled={slotsSaving} onClick={handleSaveSlots}>
                {slotsSaving ? 'Salvando...' : 'Salvar vagas'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRotationModal && (
        <div className="modal-overlay" onClick={() => setShowRotationModal(false)}>
          <div className="modal-content modal-large" onClick={(event) => event.stopPropagation()}>
            <h2>Gerador de rodízio</h2>
            <p style={{ color: '#666', fontSize: '0.9rem', marginTop: '-0.5rem' }}>
              Sugere automaticamente os membros para as escalas abertas, equilibrando a carga entre eles.
              Gere a prévia, revise e publique — as atribuições entram como pendentes de confirmação.
            </p>

            <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #eee', borderRadius: 8, padding: '0.6rem', marginBottom: '1rem' }}>
              {schedules.filter((schedule) => isRotationEligible(schedule) || rotationSelection.includes(schedule.id)).length === 0 && (
                <p style={{ color: '#888' }}>Nenhuma escala aberta futura para gerar rodízio.</p>
              )}
              {schedules
                // Elegíveis + a escala focada (ex.: aberta via "Preencher automático")
                .filter((schedule) => isRotationEligible(schedule) || rotationSelection.includes(schedule.id))
                .map((schedule) => (
                  <label key={schedule.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0' }}>
                    <input
                      type="checkbox"
                      checked={rotationSelection.includes(schedule.id)}
                      onChange={() => toggleRotationSchedule(schedule.id)}
                    />
                    <span>
                      <strong>{schedule.title}</strong> — {toHumanDate(schedule.date)}
                      {schedule.isStandalone ? ' · serviço contínuo' : ''}
                    </span>
                  </label>
                ))}
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                margin: '0 0 1rem',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: 600,
                color: '#33475b',
              }}
            >
              <input
                type="checkbox"
                checked={rotationCouples}
                onChange={(event) => {
                  setRotationCouples(event.target.checked);
                  setRotationPreview(null);
                }}
                style={{ width: 16, height: 16 }}
              />
              💍 Escalar casais juntos (nas pastorais com a regra ativa)
            </label>

            {rotationPreview && (
              <div style={{ marginBottom: '1rem' }}>
                <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.05rem', color: '#2c3e50' }}>Prévia do rodízio</h3>
                {rotationPreview.preview.map((item) => (
                  <div key={item.scheduleId} style={{ border: '1px solid #eee', borderRadius: 8, padding: '0.6rem 0.8rem', marginBottom: '0.5rem' }}>
                    <strong>{item.title}</strong> — {toHumanDate(item.date)}
                    {(item.pastorals?.length ?? 0) > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', margin: '0.45rem 0 0.2rem' }}>
                        {item.pastorals!.map((pastoral) => (
                          <label
                            key={pastoral.communityPastoralId}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              fontSize: '0.82rem',
                              color: '#52606d',
                              background: '#f5f7fa',
                              border: '1px solid #e2e8f0',
                              borderRadius: 8,
                              padding: '0.28rem 0.55rem',
                              margin: 0,
                            }}
                          >
                            {pastoral.name} · vagas
                            <input
                              type="number"
                              min={0}
                              value={
                                rotationSlots[item.scheduleId]?.[pastoral.communityPastoralId] ??
                                pastoral.requiredPeople
                              }
                              onChange={(event) =>
                                setRotationSlot(
                                  item.scheduleId,
                                  pastoral.communityPastoralId,
                                  Number(event.target.value || 0),
                                )
                              }
                              style={{ width: 58, padding: '2px 6px', textAlign: 'center' }}
                            />
                          </label>
                        ))}
                        <span style={{ fontSize: '0.75rem', color: '#8b97a4', alignSelf: 'center' }}>
                          Ajustou? Clique em “Gerar prévia” de novo — ao publicar, as vagas são salvas na escala.
                        </span>
                      </div>
                    )}
                    {item.suggestions.length > 0 ? (
                      <ul style={{ margin: '0.35rem 0 0 1rem', padding: 0 }}>
                        {item.suggestions.map((suggestion, index) => {
                          const coupleName = coupleIn(
                            suggestion.spouseId,
                            item.suggestions,
                            (s2) => s2.memberId,
                            (s2) => s2.memberName,
                          );
                          return (
                            <li key={index} style={{ fontSize: '0.9rem', color: '#444' }}>
                              {suggestion.memberName} — {suggestion.role}
                              {coupleName && (
                                <span className="couple-chip" title={`Casal escalado junto: ${suggestion.memberName} e ${coupleName}`}>
                                  💍 casal
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : item.allFilled ? (
                      <p style={{ margin: '0.35rem 0 0 0', color: '#2e9d62', fontSize: '0.9rem' }}>
                        ✓ Todas as vagas desta escala já estão preenchidas — nada a completar.
                      </p>
                    ) : item.noPastorals ? (
                      <p style={{ margin: '0.35rem 0 0 0', color: '#b26a00', fontSize: '0.9rem' }}>
                        ⚠️ Sem pastorais vinculadas a esta escala.
                      </p>
                    ) : item.noSlots ? (
                      <p style={{ margin: '0.35rem 0 0 0', color: '#b26a00', fontSize: '0.9rem' }}>
                        ⚠️ As pastorais desta escala estão com <strong>0 vagas</strong> — o rodízio não tem o que
                        preencher. Recrie a escala definindo as vagas por pastoral (ou defina as vagas no evento
                        para as próximas herdarem).
                      </p>
                    ) : (
                      <p style={{ margin: '0.35rem 0 0 0', color: '#888', fontSize: '0.9rem' }}>
                        Sem candidatos elegíveis para as vagas desta escala.
                      </p>
                    )}
                    {item.gaps.length > 0 && (
                      <p style={{ margin: '0.35rem 0 0 0', color: '#b26a00', fontSize: '0.88rem' }}>
                        ⚠️ Vagas sem candidato: {item.gaps.map((gap) => `${gap.role} (${gap.missing})`).join(', ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setShowRotationModal(false)}>
                Fechar
              </button>
              <button
                type="button"
                className="overview-action-button is-secondary"
                disabled={rotationLoading || rotationSelection.length === 0}
                onClick={() => void handleGenerateRotation(true)}
              >
                {rotationLoading ? 'Gerando...' : 'Gerar prévia'}
              </button>
              <button
                type="button"
                className="btn-submit"
                disabled={rotationLoading || !rotationPreview || rotationPreview.preview.every((item) => item.suggestions.length === 0)}
                onClick={() => void handleGenerateRotation(false)}
              >
                Publicar atribuições
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SchedulesPage;


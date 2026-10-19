import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SearchSelect from '../components/SearchSelect';
import {
  CHART,
  ChartCard,
  ChartSeries,
  HBars,
  LineAreaChart,
  ORDINAL_BLUES,
  StackedColumns,
  StatTile,
  fmtInt,
} from '../components/charts/Charts';
import api, { getErrorMessage } from '../services/api';
import { notify } from '../services/notification.service';
import { useAuth } from '../contexts/AuthContext';
import { useModuleAccess } from '../hooks/useModuleAccess';
import { ROUTE_ACCESS, canOpen, type RouteKey } from '../components/accessRules';
import { isPagedResponse, useDebouncedValue } from '../utils/useDebouncedValue';
import OnboardingChecklistCard from '../components/team/OnboardingChecklistCard';
import './modules/ModulePages.css';
import './DashboardPage.css';

/**
 * Escopo exibido. SYSTEM_ADMIN sem comunidade escolhida: `unrestricted: true`,
 * `communityIds` VAZIO e o total em `communityCount` — nunca filtrar listas por
 * `communityIds` nesse caso (o backend já recortou).
 */
interface DashboardScope {
  communityIds: string[];
  pastoralScoped: boolean;
  pastoralIds: string[];
  unrestricted?: boolean;
  communityCount?: number;
}

interface Overview {
  scope: DashboardScope;
  /** false: a pessoa não coordena a catequese — o bloco vem zerado e fica escondido */
  canSeeCatechesis?: boolean;
  /** Features do plano bloqueadas no escopo exibido (contrato 5); seções delas vêm vazias */
  planLocked?: string[];
  /** Só vem para quem coordena a catequese ou administra a paróquia (contrato 5) */
  catechesis?: {
    pendingApprovals: number;
    documentsToReview: number;
    sessionsWithoutAttendance: number;
    unreadFamilyMessages: number;
  };
  schedules: { pendingResponses: number; declinedToReplace: number; upcomingWeek: number };
  swaps: { pending: number };
  pastorals: { joinRequests: number };
  prayers: { pendingModeration: number };
  canModeratePrayers?: boolean;
  total: number;
}

interface StatusCounts {
  confirmed: number;
  pending: number;
  declined: number;
  expired: number;
}

interface Insights {
  generatedAt: string;
  scope: DashboardScope;
  canSeeCatechesis?: boolean;
  planLocked?: string[];
  /** Ausente para quem não coordena a catequese (contrato 5) */
  catechesis?: {
    classes: number;
    catechists: number;
    activeStudents: number;
    newEnrollments30d: number;
    imageConsentPending: number;
    byStatus: { active: number; pendingApproval: number; waitlisted: number; completed: number; droppedOut: number };
    byStage: { stageId: string; name: string; ordering: number; active: number; capacity: number | null; classes: number }[];
    weeklyAttendance: {
      weekStart: string;
      sessions: number;
      marks: number;
      present: number;
      late: number;
      justified: number;
      rate: number | null;
    }[];
    attendanceRate: number | null;
    previousAttendanceRate: number | null;
    classesAttention: {
      classId: string;
      name: string;
      stage: string;
      active: number;
      capacity: number | null;
      rate: number | null;
      openSessions: number;
      pendingApprovals: number;
    }[];
    atRisk?: {
      available: boolean;
      count: number;
      students: { enrollmentId: string; classId: string; memberName: string; className: string; consecutiveAbsences: number }[];
    };
  };
  schedules: {
    next30: StatusCounts & { total: number; schedules: number; confirmationRate: number | null };
    weekly: (StatusCounts & { weekStart: string; schedules: number; isCurrent: boolean })[];
    byPastoral: (StatusCounts & { pastoralId: string | null; name: string; total: number })[];
    gaps: {
      scheduleId: string;
      date: string;
      time: string | null;
      title: string;
      pastoral: string;
      required: number;
      confirmed: number;
      pending: number;
      missing: number;
    }[];
    overloaded: { memberId: string; name: string; upcomingCount: number }[];
    agenda: {
      id: string;
      kind: 'schedule' | 'event';
      date: string;
      time: string | null;
      title: string;
      eventType: string | null;
      location: string | null;
      pastorals: string[];
      coverage: (StatusCounts & { total: number; required: number }) | null;
    }[];
  };
  community: {
    activeMembers: number;
    newMembers30d: number;
    monthlyNewMembers: { month: string; count: number }[];
    pastorals: { count: number; agents: number };
    agentsByPastoral: { pastoralId: string; name: string; agents: number }[];
    birthdays: { memberId: string; name: string; date: string; isToday: boolean; age: number | null }[];
    events: { next30: number; byType: { type: string; count: number }[] };
    sacraments: { requested: number; documents: number; course: number; scheduled: number; celebrated90d: number } | null;
    prayers: { approved30d: number } | null;
    joinRequests: { pending: number; oldestDays: number | null };
  };
}

interface PendingPrayer {
  id: string;
  title: string;
  description: string;
  category: string;
  isAnonymous: boolean;
  createdAt: string;
  communityId?: string;
  member?: { fullName: string } | null;
  community?: { id?: string; name: string } | null;
}

interface Community {
  id: string;
  name: string;
  city?: string;
}

/** Papéis que o backend deixa moderar o mural (RolesGuard hierárquico a partir de COMMUNITY_COORDINATOR). */
const PRAYER_MODERATOR_ROLES = ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN', 'COMMUNITY_COORDINATOR'] as const;

const PRAYER_CATEGORY: Record<string, string> = {
  HEALTH: 'Saúde',
  FAMILY: 'Família',
  WORK: 'Trabalho',
  STUDIES: 'Estudos',
  OTHER: 'Outros',
};

const EVENT_TYPE: Record<string, string> = {
  MASS: 'Missa',
  SACRAMENT: 'Sacramento',
  PASTORAL_MEETING: 'Reunião',
  PASTORAL_ACTIVITY: 'Atividade',
  COMMUNITY_EVENT: 'Evento',
  RETREAT: 'Retiro',
  FORMATION: 'Formação',
  VISITATION: 'Visitação',
};

const EVENT_TYPE_PLURAL: Record<string, string> = {
  MASS: 'missas',
  SACRAMENT: 'sacramentos',
  PASTORAL_MEETING: 'reuniões',
  PASTORAL_ACTIVITY: 'atividades',
  COMMUNITY_EVENT: 'eventos',
  RETREAT: 'retiros',
  FORMATION: 'formações',
  VISITATION: 'visitações',
};

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Séries de status das escalas: cores de estado (validadas) sempre com ícone + rótulo */
const STATUS_SERIES: ChartSeries[] = [
  { key: 'confirmed', label: 'Confirmadas', color: CHART.good, icon: '✓' },
  { key: 'pending', label: 'Aguardando resposta', color: CHART.warn, icon: '…' },
  { key: 'declined', label: 'Recusadas', color: CHART.critical, icon: '✕' },
  { key: 'expired', label: 'Sem resposta (prazo vencido)', color: CHART.muted, icon: '–' },
];

// schedule.date tem duas semânticas: date-only 00:00Z (horário em `time`) e
// timestamp real (escala de evento) — a mesma regra da página de escalas
const isMidnightUtc = (iso: string) => {
  const d = new Date(iso);
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
};

const dayKeyOf = (iso: string) => {
  const d = new Date(iso);
  return isMidnightUtc(iso)
    ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const timeOf = (item: { date: string; time: string | null }) =>
  item.time ?? (isMidnightUtc(item.date) ? null : new Date(item.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));

const capitalize = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

const dayLabel = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (key === todayKey) return 'Hoje';
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const tomorrowKey = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  if (key === tomorrowKey) return 'Amanhã';
  return capitalize(date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' }));
};

const weekLabel = (weekStart: string) => {
  const [, m, d] = weekStart.split('-');
  return `${d}/${m}`;
};

const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const now = new Date();
  return y === now.getFullYear() ? MONTHS[m - 1] : `${MONTHS[m - 1]}/${String(y).slice(2)}`;
};

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', {
    ...(isMidnightUtc(iso) ? { timeZone: 'UTC' as const } : {}),
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });

const greetingFor = (hour: number) => (hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite');

/** Recursos pagos com seção no Início (chaves de plan-rules.ts no backend). */
const PLAN_FEATURE_LABEL: Record<string, string> = {
  catechesis: 'Catequese',
  schedules: 'Escalas',
  swaps: 'Trocas de escala',
  pastorals: 'Pastorais',
};

/** Área da pendência → feature do plano (pendência de recurso bloqueado não aparece). */
const AREA_FEATURE: Record<string, string> = {
  Catequese: 'catechesis',
  Escalas: 'schedules',
  Pastorais: 'pastorals',
};

/** Recarrega sozinho ao voltar à aba se os números tiverem mais de 10 minutos. */
const STALE_AFTER_MS = 10 * 60_000;

/** Comunidades por página no seletor do Início (busca no servidor). */
const COMMUNITY_PAGE_SIZE = 20;

const semAcento = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const horaCurta = (date: Date) => date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * Início do coordenador: pendências acionáveis (cada linha leva à tela onde
 * se resolve), indicadores com tendência e gráficos de catequese, escalas e
 * comunidade no escopo do usuário. Orações são moderadas aqui mesmo.
 */
const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN'].includes(user?.role ?? '');
  const isParishAdmin = user?.role === 'PARISH_ADMIN';
  // GET /prayer-requests/pending exige COMMUNITY_COORDINATOR ou acima: para os
  // demais papéis a chamada só gerava um 403 a cada carregamento (achado B50)
  const canModeratePrayers = (PRAYER_MODERATOR_ROLES as readonly string[]).includes(user?.role ?? '');

  const [overview, setOverview] = useState<Overview | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [communityId, setCommunityId] = useState('');
  const [prayers, setPrayers] = useState<PendingPrayer[]>([]);
  const [prayerBusy, setPrayerBusy] = useState<string | null>(null);
  // Falha dos indicadores/orações não é mais silenciosa (ux-dashboards-26)
  // null = carregou; string (talvez vazia) = falhou, com o detalhe do servidor
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [prayersError, setPrayersError] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const lastLoadRef = useRef(0);

  const load = useCallback(async (targetCommunityId: string) => {
    setLoading(true);
    const params = targetCommunityId ? { communityId: targetCommunityId } : undefined;
    try {
      const [overviewRes, insightsRes, prayersRes] = await Promise.all([
        api.get('/dashboard/coordinator', { params }),
        api
          .get('/dashboard/coordinator/insights', { params })
          .then((res) => ({ data: res.data as Insights | null, error: null as string | null }))
          .catch((error) => ({ data: null, error: getErrorMessage(error, '') })),
        canModeratePrayers
          ? api
              .get('/prayer-requests/pending', { params })
              .then((res) => ({ data: res.data, failed: false }))
              .catch(() => ({ data: [], failed: true }))
          : Promise.resolve({ data: [], failed: false }),
      ]);
      setOverview(overviewRes.data);
      setInsights(insightsRes.data);
      setInsightsError(insightsRes.error);
      setPrayersError(prayersRes.failed);
      const now = new Date();
      setLoadedAt(now);
      lastLoadRef.current = now.getTime();
      const viewScope: DashboardScope | undefined = overviewRes.data?.scope;
      const scope: string[] = viewScope?.communityIds ?? [];
      const pending: PendingPrayer[] = Array.isArray(prayersRes.data) ? prayersRes.data : [];
      // O backend já recorta pelo escopo do moderador; aqui só a comunidade escolhida.
      // Escopo sem restrição (SYSTEM_ADMIN): `communityIds` vem vazio de propósito —
      // não filtra. Fora disso, escopo vazio = nada a moderar, nunca "tudo".
      const communityOf = (p: PendingPrayer) => p.communityId ?? p.community?.id ?? '';
      setPrayers(
        targetCommunityId
          ? pending.filter((p) => communityOf(p) === targetCommunityId)
          : viewScope?.unrestricted
            ? pending
            : pending.filter((p) => scope.includes(communityOf(p))),
      );
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar o painel'));
      setOverview(null);
      setInsights(null);
      setInsightsError(null);
    } finally {
      setLoading(false);
    }
  }, [canModeratePrayers]);

  // Seletor de comunidade: busca paginada no servidor (contrato 4) — o escopo
  // amplo (SYSTEM_ADMIN: o país inteiro) não baixa mais a lista toda
  const [communitySearch, setCommunitySearch] = useState('');
  const debouncedCommunitySearch = useDebouncedValue(communitySearch.trim(), 350);
  const [communityTotal, setCommunityTotal] = useState<number | null>(null);
  const [selectedCommunity, setSelectedCommunity] = useState<Community | null>(null);
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    api
      .get('/communities', { params: { page: 1, pageSize: COMMUNITY_PAGE_SIZE, search: debouncedCommunitySearch } })
      .then((res) => {
        if (!alive) return;
        if (isPagedResponse<Community>(res.data)) {
          setCommunities(res.data.items);
          setCommunityTotal(res.data.total);
        } else {
          // Servidor antigo (ignora `page`): lista inteira, filtrada aqui
          const all: Community[] = Array.isArray(res.data) ? res.data : [];
          const term = semAcento(debouncedCommunitySearch);
          const hits = term ? all.filter((c) => semAcento(`${c.name} ${c.city ?? ''}`).includes(term)) : all;
          setCommunities(hits.slice(0, COMMUNITY_PAGE_SIZE));
          setCommunityTotal(hits.length);
        }
      })
      .catch(() => {
        if (alive) setCommunities([]);
      });
    return () => {
      alive = false;
    };
  }, [isAdmin, debouncedCommunitySearch]);

  const pickCommunity = (id: string) => {
    setSelectedCommunity(id ? communities.find((c) => c.id === id) ?? null : null);
    setCommunityId(id);
  };
  // A comunidade escolhida continua no seletor mesmo fora da página atual da busca
  const communityOptions = [
    ...(selectedCommunity && !communities.some((c) => c.id === selectedCommunity.id) ? [selectedCommunity] : []),
    ...communities,
  ].map((c) => ({ value: c.id, label: c.name, sublabel: c.city }));
  const communityFooter =
    communityTotal !== null && communityTotal > communities.length
      ? `${fmtInt(communities.length)} de ${fmtInt(communityTotal)} — digite para refinar a busca`
      : undefined;

  useEffect(() => {
    void load(communityId);
  }, [communityId, load]);

  // Aba deixada aberta: ao voltar, recarrega se os números tiverem mais de 10 min
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (lastLoadRef.current && Date.now() - lastLoadRef.current > STALE_AFTER_MS) void load(communityId);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [communityId, load]);

  // Destinos dos atalhos: só vira link o que a pessoa consegue abrir (mesma
  // regra do menu). Quem coordena pastoral pelo vínculo (papel de base) vê a
  // pendência e resolve pelo app, na aba Coordenação.
  const { modOn } = useModuleAccess(user?.role);
  const canGo = (to: string) => {
    if (to.startsWith('#')) return true;
    const key = to.replace(/^\/admin\//, '');
    return !(key in ROUTE_ACCESS) || canOpen(user, key as RouteKey, modOn);
  };

  // Recursos do plano bloqueados no escopo exibido (contrato 5)
  const planLocked = useMemo(
    () => new Set([...(overview?.planLocked ?? []), ...(insights?.planLocked ?? [])]),
    [overview, insights],
  );
  const lockedCards = Object.keys(PLAN_FEATURE_LABEL).filter((feature) => planLocked.has(feature));

  const moderatePrayer = async (id: string, approve: boolean) => {
    setPrayerBusy(id);
    try {
      await api.patch(`/prayer-requests/${id}/${approve ? 'approve' : 'reject'}`, {});
      notify.success(approve ? 'Pedido publicado no mural' : 'Pedido recusado');
      setPrayers((current) => current.filter((p) => p.id !== id));
      setOverview((current) =>
        current
          ? {
              ...current,
              prayers: { pendingModeration: Math.max(0, current.prayers.pendingModeration - 1) },
              total: Math.max(0, current.total - 1),
            }
          : current,
      );
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao moderar o pedido'));
    } finally {
      setPrayerBusy(null);
    }
  };

  const pastoralsTo = user?.role === 'PASTORAL_COORDINATOR' ? '/admin/pastorals/my' : '/admin/pastorals/community';

  const pendingItems = useMemo(() => {
    if (!overview) return [];
    const cat = overview.canSeeCatechesis === false ? undefined : overview.catechesis;
    const items: { key: string; value: number; label: string; area: string; to: string; tone: 'warn' | 'bad' }[] = [
      ...(cat
        ? ([
            { key: 'approvals', value: cat.pendingApprovals, label: 'inscrições aguardando aprovação', area: 'Catequese', to: '/admin/catechesis', tone: 'warn' },
            { key: 'docs', value: cat.documentsToReview, label: 'documentos para conferir', area: 'Catequese', to: '/admin/catechesis', tone: 'warn' },
            { key: 'sessions', value: cat.sessionsWithoutAttendance, label: 'encontros já ocorridos sem chamada', area: 'Catequese', to: '/admin/catechesis', tone: 'bad' },
            { key: 'messages', value: cat.unreadFamilyMessages, label: 'mensagens de famílias não lidas', area: 'Catequese', to: '/admin/catechesis', tone: 'warn' },
          ] as const)
        : []),
      { key: 'responses', value: overview.schedules.pendingResponses, label: 'respostas de escala pendentes', area: 'Escalas', to: '/admin/schedules', tone: 'warn' },
      { key: 'declined', value: overview.schedules.declinedToReplace, label: 'recusas para substituir', area: 'Escalas', to: '/admin/schedules', tone: 'bad' },
      { key: 'swaps', value: planLocked.has('swaps') ? 0 : overview.swaps.pending, label: 'trocas aguardando decisão', area: 'Escalas', to: '/admin/swaps', tone: 'warn' },
      { key: 'join', value: overview.pastorals.joinRequests, label: 'pedidos “quero participar”', area: 'Pastorais', to: pastoralsTo, tone: 'warn' },
      { key: 'prayers', value: overview.canModeratePrayers === false ? 0 : overview.prayers.pendingModeration, label: 'pedidos de oração para moderar', area: 'Mural', to: '#dash-prayers', tone: 'warn' },
    ];
    return items.filter((item) => item.value > 0 && !(AREA_FEATURE[item.area] && planLocked.has(AREA_FEATURE[item.area])));
  }, [overview, pastoralsTo, planLocked]);

  const go = (to: string) => {
    if (to.startsWith('#')) {
      document.getElementById(to.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    navigate(to);
  };

  // ---------- Derivados para os gráficos ----------
  const cat = insights?.catechesis;
  const sch = insights?.schedules;
  const com = insights?.community;
  const hasCatechesis =
    !!cat &&
    cat.classes > 0 &&
    !planLocked.has('catechesis') &&
    insights?.canSeeCatechesis !== false &&
    overview?.canSeeCatechesis !== false;
  const hasAnySchedules =
    !!sch && !planLocked.has('schedules') && (sch.weekly.some((w) => w.schedules > 0) || sch.next30.schedules > 0);

  const attendancePoints = (cat?.weeklyAttendance ?? []).map((w) => ({
    label: weekLabel(w.weekStart),
    value: w.rate,
    details: [
      { label: 'presenças de', value: `${fmtInt(w.present)} / ${fmtInt(w.marks)}` },
      { label: 'encontros com chamada', value: fmtInt(w.sessions) },
      ...(w.late ? [{ label: 'atrasos', value: fmtInt(w.late) }] : []),
      ...(w.justified ? [{ label: 'faltas justificadas', value: fmtInt(w.justified) }] : []),
    ],
  }));
  const attendanceHasData = (cat?.weeklyAttendance ?? []).some((w) => w.marks > 0);
  const attendanceDelta =
    cat && cat.attendanceRate !== null && cat.previousAttendanceRate !== null
      ? cat.attendanceRate - cat.previousAttendanceRate
      : null;

  const weeklyGroups = (sch?.weekly ?? []).map((w) => ({
    label: weekLabel(w.weekStart),
    values: { confirmed: w.confirmed, pending: w.pending, declined: w.declined, expired: w.expired },
    highlight: w.isCurrent,
    note: `${fmtInt(w.schedules)} escala(s) na semana`,
  }));

  const stageRows = (cat?.byStage ?? []).map((stage, index, all) => ({
    label: stage.name,
    sub: `${fmtInt(stage.classes)} turma(s)`,
    values: { active: stage.active },
    max: stage.capacity,
    valueText: stage.capacity ? `${fmtInt(stage.active)}/${fmtInt(stage.capacity)}` : fmtInt(stage.active),
    color: ORDINAL_BLUES[Math.min(ORDINAL_BLUES.length - 1, Math.round((index / Math.max(1, all.length - 1)) * (ORDINAL_BLUES.length - 1)))],
  }));

  const pastoralRows = (sch?.byPastoral ?? []).map((p) => ({
    label: p.name,
    values: { confirmed: p.confirmed, pending: p.pending, declined: p.declined, expired: p.expired },
    valueText: p.total ? `${Math.round((p.confirmed / p.total) * 100)}%` : '—',
  }));

  const memberGroups = (com?.monthlyNewMembers ?? []).map((m) => ({ label: monthLabel(m.month), values: { members: m.count } }));
  const agentRows = planLocked.has('pastorals') ? [] : (com?.agentsByPastoral ?? []).map((p) => ({ label: p.name, values: { agents: p.agents } }));

  const agendaByDay = useMemo(() => {
    const groups = new Map<string, Insights['schedules']['agenda']>();
    for (const item of sch?.agenda ?? []) {
      const key = dayKeyOf(item.date);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    // Dentro do dia, pelo horário exibido (escala date-only + hora vs. timestamp real)
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, items]) => [day, [...items].sort((a, b) => (timeOf(a) ?? '99:99').localeCompare(timeOf(b) ?? '99:99'))] as const)
      .slice(0, 7);
  }, [sch]);

  const now = new Date();
  const firstName = (user?.name ?? '').trim().split(/\s+/)[0] || 'coordenação';
  // Total do escopo: `communityCount` (backend novo; no SYSTEM_ADMIN os ids vêm vazios)
  const scopeCount = overview ? overview.scope.communityCount ?? overview.scope.communityIds.length : 0;
  const scopeLabel = communityId
    ? selectedCommunity?.name ?? communities.find((c) => c.id === communityId)?.name ?? 'Comunidade selecionada'
    : overview
      ? overview.scope.unrestricted
        ? `Todas as comunidades (${fmtInt(scopeCount)})`
        : scopeCount === 1
          ? communities.find((c) => c.id === overview.scope.communityIds[0])?.name ?? 'Sua comunidade'
          : `${fmtInt(scopeCount)} comunidades no seu escopo`
      : '';

  return (
    <div className={`module-page dash-root${loading && overview ? ' is-refreshing' : ''}`}>
      <header className="dash-head">
        <div className="dash-head__intro">
          <p className="dash-head__eyebrow">{capitalize(now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
          <h1 className="dash-head__title">
            {greetingFor(now.getHours())}, {firstName}
          </h1>
          {scopeLabel && (
            <p className="dash-head__scope">
              {scopeLabel}
              {overview?.scope.pastoralScoped ? ' · escalas e pedidos só das suas pastorais' : ''}
            </p>
          )}
        </div>
        <div className="dash-head__actions">
          {isAdmin && (communityOptions.length > 0 || communitySearch.trim() !== '') && (
            <div className="dash-head__select">
              <SearchSelect
                options={communityOptions}
                value={communityId}
                onChange={pickCommunity}
                placeholder="Todas as comunidades do meu escopo"
                allOption
                searchPlaceholder="Buscar comunidade ou cidade..."
                onSearchChange={setCommunitySearch}
                footer={communityFooter}
              />
            </div>
          )}
          {loadedAt && (
            <span className="dash-updated" title={insights?.generatedAt ? `Indicadores gerados às ${horaCurta(new Date(insights.generatedAt))}` : undefined}>
              Atualizado às {horaCurta(loadedAt)}
            </span>
          )}
          <button type="button" className="btn-small dash-refresh" onClick={() => void load(communityId)} disabled={loading}>
            ↻ Atualizar
          </button>
        </div>
      </header>

      {/* Primeiros passos (Onda 1): só a administração paroquial, até dispensar ou concluir */}
      {isParishAdmin && user?.parishId && <OnboardingChecklistCard parishId={user.parishId} />}

      {loading && !overview && <div className="loading">Carregando o painel...</div>}
      {!loading && !overview && (
        <p className="dash-alert" role="alert">
          Não foi possível carregar o painel.{' '}
          <button type="button" className="dash-link" onClick={() => void load(communityId)}>
            Tentar de novo
          </button>
        </p>
      )}

      {overview && (
        <>
          {/* ---------- Pendências ---------- */}
          <section className={`dash-pending${overview.total === 0 ? ' dash-pending--clear' : ''}`} aria-label="Pendências">
            <div className="dash-pending__hero">
              <span className="dash-pending__number">{fmtInt(overview.total)}</span>
              <span className="dash-pending__caption">
                {overview.total === 0 ? 'Tudo em dia' : overview.total === 1 ? 'pendência aguarda a coordenação' : 'pendências aguardam a coordenação'}
              </span>
              {overview.total === 0 && <span className="dash-pending__note">Nenhuma pendência no seu escopo. 🙌</span>}
            </div>
            {pendingItems.length > 0 && (
              <ul className="dash-pending__list">
                {pendingItems.map((item) => (
                  <li key={item.key}>
                    {canGo(item.to) ? (
                      <button type="button" className={`dash-pending__item dash-pending__item--${item.tone}`} onClick={() => go(item.to)}>
                        <span className="dash-pending__value">{fmtInt(item.value)}</span>
                        <span className="dash-pending__label">{item.label}</span>
                        <span className="dash-pending__area">{item.area}</span>
                        <span className="dash-pending__arrow" aria-hidden="true">
                          →
                        </span>
                      </button>
                    ) : (
                      <div
                        className={`dash-pending__item dash-pending__item--${item.tone} dash-pending__item--static`}
                        title="Resolva pelo aplicativo, na aba Coordenação"
                      >
                        <span className="dash-pending__value">{fmtInt(item.value)}</span>
                        <span className="dash-pending__label">{item.label}</span>
                        <span className="dash-pending__area">{item.area} · pelo app</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---------- Recursos fora do plano (contrato 5) ---------- */}
          {lockedCards.length > 0 && (
            <section className="dash-locked" aria-label="Recursos do plano da comunidade">
              {lockedCards.map((feature) => (
                <div key={feature} className="dash-locked__card">
                  <span className="dash-locked__eyebrow">Recurso do plano da comunidade</span>
                  <strong className="dash-locked__title">{PLAN_FEATURE_LABEL[feature]}</strong>
                  <p className="dash-locked__text">
                    Não faz parte do plano {communityId || scopeCount === 1 ? 'desta comunidade' : 'de comunidades do seu escopo'}.
                    Calendário, mapa e liturgia continuam liberados.{' '}
                    {isParishAdmin ? (
                      <>
                        Para ativar,{' '}
                        <a href="/suporte" target="_blank" rel="noopener noreferrer" className="dash-link">
                          fale com o Parish
                        </a>
                        .
                      </>
                    ) : (
                      'Para ativar, fale com a administração da paróquia.'
                    )}
                  </p>
                </div>
              ))}
            </section>
          )}

          {insightsError !== null && (
            <p className="dash-alert" role="alert">
              Não foi possível carregar os indicadores.{' '}
              {insightsError && <span className="dash-alert__detail">{insightsError}</span>}{' '}
              <button type="button" className="dash-link" onClick={() => void load(communityId)} disabled={loading}>
                Tentar de novo
              </button>
            </p>
          )}
          {prayersError && (
            <p className="dash-alert" role="alert">
              Não foi possível carregar os pedidos de oração para moderar.{' '}
              <button type="button" className="dash-link" onClick={() => void load(communityId)} disabled={loading}>
                Tentar de novo
              </button>
            </p>
          )}

          {/* ---------- Indicadores ---------- */}
          {insights && (
            <section className="dash-kpis" aria-label="Indicadores">
              {hasCatechesis && (
                <StatTile
                  label="Catequizandos ativos"
                  value={fmtInt(cat!.activeStudents)}
                  delta={cat!.newEnrollments30d > 0 ? { text: `+${fmtInt(cat!.newEnrollments30d)} em 30 dias`, tone: 'good' } : null}
                  hint={`${fmtInt(cat!.classes)} turma(s) · ${fmtInt(cat!.catechists)} catequista(s)`}
                  onClick={canGo('/admin/catechesis') ? () => navigate('/admin/catechesis') : undefined}
                />
              )}
              {hasCatechesis && (
                <StatTile
                  label="Frequência (4 semanas)"
                  value={cat!.attendanceRate === null ? '—' : `${fmtInt(cat!.attendanceRate)}%`}
                  delta={
                    attendanceDelta === null
                      ? null
                      : {
                          text: `${attendanceDelta >= 0 ? '+' : '−'}${fmtInt(Math.abs(attendanceDelta))} pts vs. 4 anteriores`,
                          tone: attendanceDelta > 0 ? 'good' : attendanceDelta < 0 ? 'bad' : 'neutral',
                        }
                  }
                  hint={cat!.atRisk?.available && cat!.atRisk.count > 0 ? `${fmtInt(cat!.atRisk.count)} em risco de evasão` : undefined}
                  trend={cat!.weeklyAttendance.map((w) => w.rate)}
                />
              )}
              {hasAnySchedules && (
                <StatTile
                  label="Escalas confirmadas"
                  value={sch!.next30.confirmationRate === null ? '—' : `${fmtInt(sch!.next30.confirmationRate)}%`}
                  meter={{ value: sch!.next30.confirmationRate, color: CHART.good }}
                  hint={`${fmtInt(sch!.next30.confirmed)} de ${fmtInt(sch!.next30.total)} convocações · próximos 30 dias`}
                  delta={sch!.next30.pending > 0 ? { text: `${fmtInt(sch!.next30.pending)} aguardando`, tone: 'neutral' } : null}
                  onClick={canGo('/admin/schedules') ? () => navigate('/admin/schedules') : undefined}
                />
              )}
              <StatTile
                label="Membros ativos"
                value={fmtInt(com!.activeMembers)}
                delta={com!.newMembers30d > 0 ? { text: `+${fmtInt(com!.newMembers30d)} em 30 dias`, tone: 'good' } : null}
                hint={`${fmtInt(com!.pastorals.agents)} agentes em ${fmtInt(com!.pastorals.count)} pastoral(is)`}
                trend={com!.monthlyNewMembers.map((m) => m.count)}
                onClick={canGo('/admin/members') ? () => navigate('/admin/members') : undefined}
              />
              <StatTile
                label="Eventos (30 dias)"
                value={fmtInt(com!.events.next30)}
                hint={
                  com!.events.byType.length
                    ? com!.events.byType
                        .slice(0, 3)
                        .map((t) => `${fmtInt(t.count)} ${t.count === 1 ? (EVENT_TYPE[t.type] ?? t.type).toLowerCase() : EVENT_TYPE_PLURAL[t.type] ?? t.type.toLowerCase()}`)
                        .join(' · ')
                    : 'nenhum evento publicado'
                }
                onClick={canGo('/admin/events') ? () => navigate('/admin/events') : undefined}
              />
            </section>
          )}

          {/* ---------- Gráficos + lateral ---------- */}
          {insights && (
            <div className="dash-columns">
              <div className="dash-main">
                {hasCatechesis && (
                  <ChartCard
                    title="Frequência na catequese"
                    subtitle="Presenças sobre chamadas lançadas, por semana · últimas 8 semanas"
                    empty={attendanceHasData ? null : 'Nenhuma chamada lançada nas últimas 8 semanas.'}
                    table={{
                      columns: ['Semana', 'Frequência', 'Presenças', 'Chamadas', 'Encontros'],
                      rows: cat!.weeklyAttendance.map((w) => [
                        `Semana de ${weekLabel(w.weekStart)}`,
                        w.rate === null ? '—' : `${w.rate}%`,
                        w.present,
                        w.marks,
                        w.sessions,
                      ]),
                    }}
                  >
                    <LineAreaChart points={attendancePoints} max={100} unit="%" ariaLabel="Frequência semanal na catequese" />
                  </ChartCard>
                )}

                {hasAnySchedules && (
                  <ChartCard
                    title="Resposta às escalas por semana"
                    subtitle="Convocações por situação · 5 semanas passadas, a atual e as 2 seguintes"
                    legend={STATUS_SERIES}
                    table={{
                      columns: ['Semana', 'Confirmadas', 'Aguardando', 'Recusadas', 'Sem resposta', 'Escalas'],
                      rows: sch!.weekly.map((w) => [
                        `${weekLabel(w.weekStart)}${w.isCurrent ? ' (atual)' : ''}`,
                        w.confirmed,
                        w.pending,
                        w.declined,
                        w.expired,
                        w.schedules,
                      ]),
                    }}
                  >
                    <StackedColumns groups={weeklyGroups} series={STATUS_SERIES} ariaLabel="Convocações de escala por semana e situação" />
                  </ChartCard>
                )}

                <div className="dash-pair">
                  {hasCatechesis && (
                    <ChartCard
                      title="Catequizandos por etapa"
                      subtitle="Matrículas ativas; a trilha cinza é o total de vagas"
                      empty={stageRows.length ? null : 'Nenhuma turma ativa.'}
                      table={{
                        columns: ['Etapa', 'Ativos', 'Vagas', 'Turmas'],
                        rows: cat!.byStage.map((s) => [s.name, s.active, s.capacity ?? 'sem limite', s.classes]),
                      }}
                    >
                      <HBars rows={stageRows} series={[{ key: 'active', label: 'Ativos', color: CHART.series }]} ariaLabel="Catequizandos ativos por etapa" />
                    </ChartCard>
                  )}
                  <ChartCard
                    title="Novos membros por mês"
                    subtitle="Cadastros na comunidade · últimos 6 meses"
                    empty={com!.monthlyNewMembers.some((m) => m.count > 0) ? null : 'Nenhum cadastro novo nos últimos 6 meses.'}
                    table={{ columns: ['Mês', 'Novos membros'], rows: com!.monthlyNewMembers.map((m) => [monthLabel(m.month), m.count]) }}
                  >
                    <StackedColumns
                      groups={memberGroups}
                      series={[{ key: 'members', label: 'Novos membros', color: CHART.series }]}
                      height={200}
                      ariaLabel="Novos membros cadastrados por mês"
                    />
                  </ChartCard>
                </div>

                {hasAnySchedules && (
                  <ChartCard
                    title="Resposta por pastoral"
                    subtitle="Convocações dos próximos 30 dias · o número à direita é a taxa de confirmação"
                    legend={STATUS_SERIES}
                    empty={pastoralRows.length ? null : 'Nenhuma convocação nos próximos 30 dias.'}
                    table={{
                      columns: ['Pastoral', 'Confirmadas', 'Aguardando', 'Recusadas', 'Sem resposta', 'Total'],
                      rows: sch!.byPastoral.map((p) => [p.name, p.confirmed, p.pending, p.declined, p.expired, p.total]),
                    }}
                  >
                    <HBars rows={pastoralRows} series={STATUS_SERIES} ariaLabel="Situação das convocações por pastoral" />
                  </ChartCard>
                )}

                {!hasAnySchedules && agentRows.length > 0 && (
                  <ChartCard
                    title="Agentes por pastoral"
                    subtitle="Vínculos ativos"
                    table={{ columns: ['Pastoral', 'Agentes'], rows: com!.agentsByPastoral.map((p) => [p.name, p.agents]) }}
                  >
                    <HBars rows={agentRows} series={[{ key: 'agents', label: 'Agentes', color: CHART.series }]} ariaLabel="Agentes ativos por pastoral" />
                  </ChartCard>
                )}

                {hasCatechesis && cat!.classesAttention.length > 0 && (
                  <section className="dash-panel">
                    <header className="dash-panel__head">
                      <div>
                        <h3 className="dash-panel__title">Turmas que pedem atenção</h3>
                        <p className="dash-panel__subtitle">Chamada em aberto, inscrição parada ou frequência abaixo de 75% nos últimos 30 dias</p>
                      </div>
                      {canGo('/admin/catechesis') && (
                        <button type="button" className="dash-link" onClick={() => navigate('/admin/catechesis')}>
                          Abrir catequese →
                        </button>
                      )}
                    </header>
                    <div className="dash-table-wrap">
                      <table className="dash-table">
                        <thead>
                          <tr>
                            <th>Turma</th>
                            <th>Etapa</th>
                            <th className="is-num">Ativos</th>
                            <th className="is-num">Frequência (30 dias)</th>
                            <th className="is-num">Chamadas em aberto</th>
                            <th className="is-num">Inscrições aguardando</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cat!.classesAttention.map((klass) => (
                            <tr key={klass.classId}>
                              <td>{klass.name}</td>
                              <td className="is-muted">{klass.stage}</td>
                              <td className="is-num">
                                {fmtInt(klass.active)}
                                {klass.capacity ? <span className="is-muted">/{fmtInt(klass.capacity)}</span> : null}
                              </td>
                              <td className="is-num">
                                {klass.rate === null ? (
                                  <span className="is-muted">sem chamada</span>
                                ) : (
                                  <span className={`dash-pill ${klass.rate < 60 ? 'dash-pill--bad' : klass.rate < 75 ? 'dash-pill--warn' : 'dash-pill--ok'}`}>
                                    {klass.rate}%
                                  </span>
                                )}
                              </td>
                              <td className="is-num">{klass.openSessions ? <span className="dash-pill dash-pill--bad">{fmtInt(klass.openSessions)}</span> : '—'}</td>
                              <td className="is-num">{klass.pendingApprovals ? <span className="dash-pill dash-pill--warn">{fmtInt(klass.pendingApprovals)}</span> : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </div>

              <aside className="dash-side">
                <section className="dash-panel">
                  <header className="dash-panel__head">
                    <h3 className="dash-panel__title">Próximos 7 dias</h3>
                    {canGo('/admin/schedules') && !planLocked.has('schedules') && (
                      <button type="button" className="dash-link" onClick={() => navigate('/admin/schedules')}>
                        Escalas →
                      </button>
                    )}
                  </header>
                  {agendaByDay.length === 0 ? (
                    <p className="dash-empty">Nenhuma escala ou evento publicado nos próximos 7 dias.</p>
                  ) : (
                    <div className="dash-agenda">
                      {agendaByDay.map(([day, items]) => (
                        <div key={day} className="dash-agenda__day">
                          <h4 className="dash-agenda__daylabel">{dayLabel(day)}</h4>
                          <ul className="dash-agenda__list">
                            {items.map((item) => {
                              const time = timeOf(item);
                              const cov = item.coverage;
                              const missing = cov ? Math.max(0, cov.required - cov.confirmed - cov.pending) : 0;
                              return (
                                <li key={`${item.kind}-${item.id}`} className="dash-agenda__item">
                                  <span className="dash-agenda__time">{time ?? '—'}</span>
                                  <span className="dash-agenda__body">
                                    <span className="dash-agenda__title">{item.title}</span>
                                    <span className="dash-agenda__meta">
                                      {item.eventType ? EVENT_TYPE[item.eventType] ?? item.eventType : 'Escala'}
                                      {item.pastorals.length ? ` · ${item.pastorals.slice(0, 2).join(', ')}${item.pastorals.length > 2 ? '…' : ''}` : ''}
                                      {item.location ? ` · ${item.location}` : ''}
                                    </span>
                                  </span>
                                  {cov && (
                                    <span
                                      className={`dash-pill ${missing > 0 ? 'dash-pill--bad' : cov.pending > 0 || cov.declined > 0 ? 'dash-pill--warn' : 'dash-pill--ok'}`}
                                      title={`${cov.confirmed} confirmadas · ${cov.pending} aguardando · ${cov.declined} recusadas${cov.required ? ` · ${cov.required} vagas` : ''}`}
                                    >
                                      {missing > 0
                                        ? `faltam ${missing}`
                                        : cov.pending > 0
                                          ? `${cov.confirmed}/${cov.required || cov.confirmed + cov.pending} ✓`
                                          : cov.confirmed > 0
                                            ? 'completa'
                                            : 'sem equipe'}
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {!planLocked.has('schedules') && (sch?.gaps ?? []).length > 0 && (
                  <section className="dash-panel dash-panel--alert">
                    <header className="dash-panel__head">
                      <h3 className="dash-panel__title">Vagas descobertas</h3>
                      <span className="dash-panel__subtitle">próximos 14 dias</span>
                    </header>
                    <ul className="dash-list">
                      {sch!.gaps.map((gap) => (
                        <li key={`${gap.scheduleId}-${gap.pastoral}`} className="dash-list__item">
                          <span className="dash-list__main">
                            <span className="dash-list__title">{gap.title}</span>
                            <span className="dash-list__meta">
                              {shortDate(gap.date)}
                              {gap.time ? ` ${gap.time}` : ''} · {gap.pastoral}
                            </span>
                          </span>
                          <span className="dash-pill dash-pill--bad">faltam {fmtInt(gap.missing)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {hasCatechesis && !!cat!.atRisk && cat!.atRisk.count > 0 && (
                  <section className="dash-panel dash-panel--alert">
                    <header className="dash-panel__head">
                      <h3 className="dash-panel__title">Risco de evasão</h3>
                      <span className="dash-panel__subtitle">3+ faltas seguidas sem justificativa</span>
                    </header>
                    <ul className="dash-list">
                      {cat!.atRisk!.students.map((student) => (
                        <li key={student.enrollmentId} className="dash-list__item">
                          <span className="dash-list__main">
                            <span className="dash-list__title">{student.memberName}</span>
                            <span className="dash-list__meta">{student.className}</span>
                          </span>
                          <span className="dash-pill dash-pill--bad">{fmtInt(student.consecutiveAbsences)} faltas</span>
                        </li>
                      ))}
                    </ul>
                    {cat!.atRisk!.count > cat!.atRisk!.students.length && (
                      <p className="dash-panel__foot">+ {fmtInt(cat!.atRisk!.count - cat!.atRisk!.students.length)} outro(s) — veja o painel da turma.</p>
                    )}
                  </section>
                )}

                <section className="dash-panel">
                  <header className="dash-panel__head">
                    <h3 className="dash-panel__title">Aniversariantes</h3>
                    <span className="dash-panel__subtitle">próximos 7 dias</span>
                  </header>
                  {com!.birthdays.length === 0 ? (
                    <p className="dash-empty">Nenhum aniversário nos próximos 7 dias.</p>
                  ) : (
                    <ul className="dash-list">
                      {com!.birthdays.map((b) => (
                        <li key={b.memberId} className="dash-list__item">
                          <span className="dash-list__main">
                            <span className="dash-list__title">
                              {b.isToday && <span aria-hidden="true">🎂 </span>}
                              {b.name}
                            </span>
                            <span className="dash-list__meta">
                              {b.isToday ? 'Hoje' : capitalize(new Date(`${b.date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }))}
                              {b.age !== null && b.age > 0 ? ` · ${b.age} anos` : ''}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {!planLocked.has('schedules') && (sch?.overloaded ?? []).length > 0 && (
                  <section className="dash-panel">
                    <header className="dash-panel__head">
                      <h3 className="dash-panel__title">Sobrecarga de escalas</h3>
                      <span className="dash-panel__subtitle">4+ convocações em 30 dias</span>
                    </header>
                    <ul className="dash-list">
                      {sch!.overloaded.map((m) => (
                        <li key={m.memberId} className="dash-list__item">
                          <span className="dash-list__title">{m.name}</span>
                          <span className="dash-pill dash-pill--warn">{fmtInt(m.upcomingCount)} escalas</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {com!.sacraments && (com!.sacraments.requested + com!.sacraments.documents + com!.sacraments.course + com!.sacraments.scheduled > 0 || com!.sacraments.celebrated90d > 0) && (
                  <section className="dash-panel">
                    <header className="dash-panel__head">
                      <h3 className="dash-panel__title">Sacramentos em preparação</h3>
                      {canGo('/admin/sacrament-processes') && (
                        <button type="button" className="dash-link" onClick={() => navigate('/admin/sacrament-processes')}>
                          Abrir →
                        </button>
                      )}
                    </header>
                    <ol className="dash-funnel">
                      {[
                        { label: 'Solicitados', value: com!.sacraments.requested },
                        { label: 'Documentos', value: com!.sacraments.documents },
                        { label: 'Em curso', value: com!.sacraments.course },
                        { label: 'Agendados', value: com!.sacraments.scheduled },
                      ].map((step, index) => (
                        <li key={step.label} className="dash-funnel__step">
                          <span className="dash-funnel__dot" style={{ background: ORDINAL_BLUES[index + 1] }} aria-hidden="true" />
                          <span className="dash-funnel__label">{step.label}</span>
                          <span className="dash-funnel__value">{fmtInt(step.value)}</span>
                        </li>
                      ))}
                    </ol>
                    <p className="dash-panel__foot">{fmtInt(com!.sacraments.celebrated90d)} celebrado(s) nos últimos 90 dias.</p>
                  </section>
                )}

                {hasCatechesis && cat!.imageConsentPending > 0 && (
                  <section className="dash-panel">
                    <header className="dash-panel__head">
                      <h3 className="dash-panel__title">Uso de imagem</h3>
                    </header>
                    <p className="dash-panel__text">
                      <strong>{fmtInt(cat!.imageConsentPending)}</strong> catequizando(s) ativo(s) ainda sem resposta sobre o uso de imagem — vale
                      confirmar com as famílias antes de fotos e vídeos.
                    </p>
                  </section>
                )}
              </aside>
            </div>
          )}

          {/* ---------- Moderação de orações ---------- */}
          {prayers.length > 0 && (
            <section className="dash-group" id="dash-prayers">
              <h2 className="dash-group__title">Moderar pedidos de oração</h2>
              <div className="dash-prayers">
                {prayers.map((prayer) => (
                  <div key={prayer.id} className="dash-prayer">
                    <div className="dash-prayer__body">
                      <strong>{prayer.title}</strong>
                      <span className="dash-prayer__meta">
                        {PRAYER_CATEGORY[prayer.category] ?? prayer.category} · {prayer.isAnonymous ? 'anônimo' : prayer.member?.fullName ?? 'sem autor'}
                        {prayer.community?.name ? ` · ${prayer.community.name}` : ''} · {new Date(prayer.createdAt).toLocaleDateString('pt-BR')}
                      </span>
                      <p>{prayer.description}</p>
                    </div>
                    <div className="dash-prayer__actions">
                      <button className="btn-small success" disabled={prayerBusy === prayer.id} onClick={() => void moderatePrayer(prayer.id, true)}>
                        Publicar
                      </button>
                      <button className="btn-small danger" disabled={prayerBusy === prayer.id} onClick={() => void moderatePrayer(prayer.id, false)}>
                        Recusar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default DashboardPage;

import React, { useState, useEffect, useCallback, useRef } from 'react';
import TitleIcon from '../../components/TitleIcon';
import api, { getErrorMessage } from '../../services/api';
import { notify } from '../../services/notification.service';
import { useAuth } from '../../contexts/AuthContext';
import './ModulePages.css';
import './CatechesisPage.css';

interface Stage {
  id: string;
  name: string;
  description?: string | null;
  ordering: number;
  sacramentType?: string | null;
}

interface CatechesisClass {
  id: string;
  name: string;
  year: number;
  weekday?: number | null;
  time?: string | null;
  room?: string | null;
  stage: { name: string; sacramentType?: string | null };
  community: { name: string };
  _count: { enrollments: number; sessions: number };
  /** Limite de vagas (null = sem limite) */
  capacity?: number | null;
  /** Ocupação = matriculados ativos + inscrições aguardando aprovação */
  occupied?: number;
  openSpots?: number | null;
  isFull?: boolean;
}

interface ClassReport {
  catechists: Array<{ memberId: string; fullName: string; role: string }>;
  total: number;
  active: number;
  dropouts: number;
  completed: number;
  pending: number;
  students: Array<{
    enrollmentId: string;
    member: { id: string; fullName: string };
    status: string;
    pendingDocuments?: string | null;
    rejectionReason?: string | null;
    contact?: { name: string | null; phone: string | null } | null;
    submittedDocs: number;
    docsCount: number;
    attendanceRate: number | null;
    sessions: number;
    /** Mensagens da família ainda não lidas pela equipe (Onda 4) */
    unreadMessages?: number;
  }>;
}

interface ChatMessage {
  id: string;
  body: string;
  fromTeam: boolean;
  authorName: string;
  mine: boolean;
  createdAt: string;
  readAt?: string | null;
}

interface ChatThread {
  enrollmentId: string;
  isTeam: boolean;
  student: string;
  className: string;
  canWrite: boolean;
  messages: ChatMessage[];
}

interface EnrollmentDocument {
  id: string;
  kind: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: 'SUBMITTED' | 'VERIFIED' | 'REJECTED';
  reviewNotes?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

interface RenewalPreview {
  classId: string;
  stage: { id: string; name: string };
  nextStage: { id: string; name: string; sacramentType?: string | null } | null;
  targetClasses: Array<{ id: string; name: string; year: number; weekday?: number | null; time?: string | null; capacity: number | null }>;
  students: Array<{
    enrollmentId: string;
    member: { id: string; fullName: string };
    eligible: boolean;
    missingDocuments: string | null;
  }>;
}

interface Community {
  id: string;
  name: string;
}

interface Assessment {
  id: string;
  period: string;
  rating?: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

interface ClassFee {
  id: string;
  description: string;
  amount: number;
  dueDate?: string | null;
  collected: number;
  othersCollected: number;
  othersCount: number;
  paidCount: number;
  waivedCount: number;
  pendingCount: number;
  students: Array<{
    enrollmentId: string;
    fullName: string;
    status: 'PAID' | 'WAIVED' | 'PENDING';
    amount: number | null;
    method: string | null;
    paidAt: string | null;
    paymentId: string | null;
  }>;
}

interface CommunityOverviewRow {
  classId: string;
  name: string;
  stage: string;
  active: number;
  pendingApproval: number;
  documentsToReview: number;
  /** Mensagens da familia ainda nao lidas pela equipe */
  unreadFamilyMessages?: number;
  pendingDocumentsCount: number;
  pastSessionsWithoutAttendance: number;
  feesPendingCount: number;
}

interface SentNotice {
  title: string;
  body: string;
  sentAt: string;
  kind: string;
}

interface DioceseOverview {
  dioceseId: string;
  parishes: Array<{
    parishId: string;
    parishName: string;
    stages: Array<{
      stageId: string;
      stageName: string;
      ordering: number;
      sacramentType?: string | null;
      classes: number;
      active: number;
      pending: number;
      completed: number;
    }>;
    totals: { classes: number; active: number; pending: number; completed: number };
  }>;
  totals: { parishes: number; classes: number; active: number; pending: number; completed: number };
}

const RATING_LABELS: Record<string, string> = {
  EXCELLENT: 'Ótimo',
  GOOD: 'Bom',
  REGULAR: 'Regular',
  NEEDS_ATTENTION: 'Precisa de atenção',
};

const money = (value: number) => `R$ ${value.toFixed(2).replace('.', ',')}`;

/** Com responseType 'blob' o erro do backend também vem como Blob — recupera a mensagem real. */
const blobErrorMessage = async (error: any, fallback: string): Promise<string> => {
  try {
    if (error?.response?.data instanceof Blob) {
      const parsed = JSON.parse(await error.response.data.text());
      if (parsed?.message) {
        return Array.isArray(parsed.message) ? parsed.message.join(', ') : parsed.message;
      }
    }
  } catch {
    // corpo não-JSON — segue para o genérico
  }
  return getErrorMessage(error, fallback);
};

/** Domingo de Páscoa (algoritmo de Meeus/Butcher), em UTC. */
const easterSunday = (year: number): Date => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
};

const holidayCache = new Map<number, Map<string, string>>();

/** Feriados nacionais do Brasil + datas litúrgicas móveis do ano. */
const nationalHolidays = (year: number): Map<string, string> => {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const map = new Map<string, string>();
  const fixed = (month: number, day: number, label: string) =>
    map.set(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, label);
  fixed(1, 1, 'Confraternização Universal');
  fixed(4, 21, 'Tiradentes');
  fixed(5, 1, 'Dia do Trabalho');
  fixed(9, 7, 'Independência do Brasil');
  fixed(10, 12, 'Nossa Senhora Aparecida');
  fixed(11, 2, 'Finados');
  fixed(11, 15, 'Proclamação da República');
  fixed(11, 20, 'Consciência Negra');
  fixed(12, 25, 'Natal');
  const easter = easterSunday(year);
  const offset = (days: number) => {
    const date = new Date(easter);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  map.set(offset(-48), 'Carnaval (segunda)');
  map.set(offset(-47), 'Carnaval (terça)');
  map.set(offset(-2), 'Sexta-feira Santa');
  map.set(offset(0), 'Páscoa');
  map.set(offset(60), 'Corpus Christi');
  holidayCache.set(year, map);
  return map;
};

const holidayLabel = (isoDate: string): string | null =>
  nationalHolidays(Number(isoDate.slice(0, 4))).get(isoDate) ?? null;

interface Member {
  id: string;
  fullName: string;
}

interface SessionSummary {
  id: string;
  date: string;
  topic?: string | null;
  marked: number;
  present: number;
  late: number;
}

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'cate-badge--active',
  COMPLETED: 'cate-badge--done',
  PENDING_APPROVAL: 'cate-badge--waiting',
  DROPPED_OUT: 'cate-badge--out',
  REJECTED: 'cate-badge--out',
  TRANSFERRED: 'cate-badge--moved',
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

const SACRAMENT_LABELS: Record<string, string> = {
  BAPTISM: 'Batismo',
  FIRST_COMMUNION: 'Primeira Eucaristia',
  CONFIRMATION: 'Crisma',
  MARRIAGE: 'Matrimônio',
  HOLY_ORDERS: 'Ordem',
  ANOINTING_OF_THE_SICK: 'Unção dos Enfermos',
};

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const ENROLLMENT_STATUS: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: 'Ativo', color: 'blue' },
  COMPLETED: { label: 'Concluído', color: 'green' },
  DROPPED_OUT: { label: 'Desistente', color: 'red' },
  TRANSFERRED: { label: 'Transferido', color: 'gray' },
  PENDING_APPROVAL: { label: 'Aguardando aprovação', color: 'yellow' },
  REJECTED: { label: 'Não aprovada', color: 'red' },
};

const CatechesisPage: React.FC = () => {
  const { user } = useAuth();
  const isDiocesan = user?.role === 'DIOCESAN_ADMIN' || user?.role === 'SYSTEM_ADMIN';
  const [tab, setTab] = useState<'classes' | 'stages' | 'diocese' | 'panorama'>('classes');
  const [loading, setLoading] = useState(true);
  const [stages, setStages] = useState<Stage[]>([]);
  const [classes, setClasses] = useState<CatechesisClass[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [selectedClass, setSelectedClass] = useState<CatechesisClass | null>(null);
  const [report, setReport] = useState<ClassReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const [showStageModal, setShowStageModal] = useState(false);
  const [stageForm, setStageForm] = useState({ name: '', description: '', ordering: 0, sacramentType: '' });

  const [showClassModal, setShowClassModal] = useState(false);
  const [classForm, setClassForm] = useState({
    name: '',
    year: new Date().getFullYear(),
    stageId: '',
    communityId: '',
    weekday: '',
    time: '',
    room: '',
    capacity: '',
  });

  // Editar turma (nome/dia/horário/sala/vagas — etapa e comunidade não mudam)
  const [showEditClassModal, setShowEditClassModal] = useState(false);
  const [savingClass, setSavingClass] = useState(false);
  const [editClassForm, setEditClassForm] = useState({
    name: '',
    year: new Date().getFullYear(),
    weekday: '',
    time: '',
    room: '',
    capacity: '',
  });

  const [renewal, setRenewal] = useState<RenewalPreview | null>(null);
  const [renewalTarget, setRenewalTarget] = useState('');
  const [renewalSelection, setRenewalSelection] = useState<Record<string, boolean>>({});
  const [renewing, setRenewing] = useState(false);

  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [enrollForm, setEnrollForm] = useState({ memberId: '', waiveBaptism: false, overrideCapacity: false });

  const [showCatechistModal, setShowCatechistModal] = useState(false);
  const [catechistForm, setCatechistForm] = useState({ memberId: '', role: 'Catequista' });
  // null = carregando; [] = ninguém elegível na pastoral da Catequese
  const [eligibleCatechists, setEligibleCatechists] = useState<Member[] | null>(null);

  const [showSessionModal, setShowSessionModal] = useState(false);
  const [sessionForm, setSessionForm] = useState({ date: '', topic: '' });

  const [attendanceSessionId, setAttendanceSessionId] = useState<string | null>(null);
  // Tri-state espelhando o app: gravar só presente/ausente pela web ZERAVA os
  // atrasos registrados no celular (o backend força late=false quando omitido)
  // 'unset' = sem marcação anterior: fica FORA do salvamento (reabrir uma
  // chamada parcial e salvar não fabrica presenças retroativas)
  type Mark = 'present' | 'late' | 'absent' | 'unset';
  const nextMark = (mark: Mark): Mark =>
    mark === 'unset' ? 'present' : mark === 'present' ? 'late' : mark === 'late' ? 'absent' : 'present';
  const MARK_LABEL: Record<Mark, string> = {
    present: '✓ Presente',
    late: '🕒 Atrasado',
    absent: '✗ Ausente',
    unset: '· Marcar',
  };
  const [attendance, setAttendance] = useState<Record<string, Mark>>({});
  const [attendanceMeta, setAttendanceMeta] = useState<{ date: string; topic?: string | null } | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  // Pareceres por período (Fase 5)
  const [assessmentTarget, setAssessmentTarget] = useState<{ enrollmentId: string; fullName: string } | null>(null);
  const [docTarget, setDocTarget] = useState<{ enrollmentId: string; fullName: string } | null>(null);
  const [docList, setDocList] = useState<EnrollmentDocument[] | null>(null);
  const [reviewingDoc, setReviewingDoc] = useState<string | null>(null);

  const [showBatchAssessment, setShowBatchAssessment] = useState(false);
  const [batchSelection, setBatchSelection] = useState<Record<string, boolean>>({});
  const [batchForm, setBatchForm] = useState({ period: '', rating: '', notes: '' });
  const [savingBatch, setSavingBatch] = useState(false);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [assessmentForm, setAssessmentForm] = useState({ period: '', rating: '', notes: '' });
  const [savingAssessment, setSavingAssessment] = useState(false);

  // Taxa de material (Fase 5)
  const [showFees, setShowFees] = useState(false);
  const [classFees, setClassFees] = useState<ClassFee[]>([]);
  const [feeForm, setFeeForm] = useState({ description: '', amount: '', dueDate: '' });

  // Visão diocesana (Fase 5)
  const [dioceseOverview, setDioceseOverview] = useState<DioceseOverview | null>(null);
  const [dioceseLoading, setDioceseLoading] = useState(false);
  const [dioceses, setDioceses] = useState<Array<{ id: string; name: string }>>([]);
  const [dioceseId, setDioceseId] = useState('');
  const isSystemAdmin = user?.role === 'SYSTEM_ADMIN';

  // Panorama da comunidade (Onda 3): pendências consolidadas entre turmas
  const isCoordinator = ['PASTORAL_COORDINATOR', 'COMMUNITY_COORDINATOR', 'PARISH_ADMIN', 'DIOCESAN_ADMIN', 'SYSTEM_ADMIN'].includes(user?.role ?? '');
  const [overviewRows, setOverviewRows] = useState<CommunityOverviewRow[] | null>(null);
  // Trocar a comunidade rápido: só a resposta da ÚLTIMA requisição vale
  const overviewSeq = useRef(0);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewCommunityId, setOverviewCommunityId] = useState('');

  // Planejamento de temas em lote (Onda 3)
  const [showTopicsModal, setShowTopicsModal] = useState(false);
  const [topicsDraft, setTopicsDraft] = useState<Record<string, string>>({});
  // Temas como estavam ao abrir — só o que mudou é enviado (não sobrescreve
  // o que outro catequista salvou enquanto o modal estava aberto)
  const [topicsBaseline, setTopicsBaseline] = useState<Record<string, string>>({});
  const [savingTopics, setSavingTopics] = useState(false);

  // Histórico de avisos enviados às famílias (Onda 3)
  const [sentNotices, setSentNotices] = useState<SentNotice[] | null>(null);
  const [showSentNotices, setShowSentNotices] = useState(false);

  // Conversa família ↔ equipe por matrícula (Onda 4)
  const [chatTarget, setChatTarget] = useState<{ enrollmentId: string; fullName: string } | null>(null);
  const [chatThread, setChatThread] = useState<ChatThread | null>(null);
  const [chatText, setChatText] = useState('');
  const [sendingChat, setSendingChat] = useState(false);

  // Quem fez a última chamada (auditoria leve visível na própria tela)
  const [lastMarked, setLastMarked] = useState<{ byName: string | null; at: string } | null>(null);

  const [showAgendaModal, setShowAgendaModal] = useState(false);
  const [agendaRange, setAgendaRange] = useState({ from: '', to: '' });
  const [agendaDates, setAgendaDates] = useState<Record<string, boolean>>({});
  const [generatingAgenda, setGeneratingAgenda] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [stagesRes, classesRes, communitiesRes, membersRes] = await Promise.all([
        api.get('/catechesis/stages'),
        api.get('/catechesis/classes'),
        api.get('/communities'),
        api.get('/members'),
      ]);
      setStages(stagesRes.data);
      setClasses(classesRes.data);
      setCommunities(communitiesRes.data);
      setMembers(membersRes.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar dados da catequese'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Cabeçalho do detalhe sempre com os dados frescos da lista (vagas/ocupação
  // mudam a cada matrícula/edição — o objeto guardado no clique ficaria velho)
  useEffect(() => {
    setSelectedClass((prev) => (prev ? classes.find((klass) => klass.id === prev.id) ?? prev : prev));
  }, [classes]);

  const openClassDetail = async (klass: CatechesisClass) => {
    setSelectedClass(klass);
    setReportLoading(true);
    try {
      const [reportRes, sessionsRes] = await Promise.all([
        api.get(`/catechesis/classes/${klass.id}/report`),
        api.get(`/catechesis/classes/${klass.id}/sessions`),
      ]);
      setReport(reportRes.data);
      setSessions(sessionsRes.data ?? []);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar o relatório da turma'));
      setReport(null);
      setSessions([]);
    } finally {
      setReportLoading(false);
    }
  };

  // Reabre a chamada de um encontro existente (antes só dava na criação)
  const openSessionAttendance = async (session: SessionSummary) => {
    try {
      const res = await api.get(`/catechesis/sessions/${session.id}/attendance`);
      const initial: Record<string, Mark> = {};
      (res.data?.students ?? []).forEach((student: { enrollmentId: string; present: boolean | null; late?: boolean }) => {
        initial[student.enrollmentId] =
          student.present === null ? 'unset' : student.late ? 'late' : student.present ? 'present' : 'absent';
      });
      setAttendance(initial);
      setAttendanceMeta({ date: session.date, topic: session.topic });
      setLastMarked(res.data?.lastMarked ?? null);
      setAttendanceSessionId(session.id);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao abrir a chamada'));
    }
  };

  const refreshDetail = async () => {
    if (selectedClass) await openClassDetail(selectedClass);
    fetchData();
  };

  const handleCreateStage = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/catechesis/stages', {
        name: stageForm.name,
        description: stageForm.description || undefined,
        ordering: Number(stageForm.ordering) || 0,
        sacramentType: stageForm.sacramentType || undefined,
      });
      notify.success('Etapa criada com sucesso!');
      setShowStageModal(false);
      setStageForm({ name: '', description: '', ordering: 0, sacramentType: '' });
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao criar etapa'));
    }
  };

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/catechesis/classes', {
        name: classForm.name,
        year: Number(classForm.year),
        stageId: classForm.stageId,
        communityId: classForm.communityId,
        weekday: classForm.weekday === '' ? undefined : Number(classForm.weekday),
        time: classForm.time || undefined,
        room: classForm.room || undefined,
        capacity: classForm.capacity === '' ? undefined : Number(classForm.capacity),
      });
      notify.success('Turma criada com sucesso!');
      setShowClassModal(false);
      setClassForm({ name: '', year: new Date().getFullYear(), stageId: '', communityId: '', weekday: '', time: '', room: '', capacity: '' });
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao criar turma'));
    }
  };

  const openEditClass = () => {
    if (!selectedClass) return;
    setEditClassForm({
      name: selectedClass.name,
      year: selectedClass.year,
      weekday: selectedClass.weekday === null || selectedClass.weekday === undefined ? '' : String(selectedClass.weekday),
      time: selectedClass.time ?? '',
      room: selectedClass.room ?? '',
      capacity: selectedClass.capacity == null ? '' : String(selectedClass.capacity),
    });
    setShowEditClassModal(true);
  };

  const handleUpdateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClass) return;
    setSavingClass(true);
    try {
      const { data } = await api.patch<{ capacityWarning?: string | null }>(`/catechesis/classes/${selectedClass.id}`, {
        name: editClassForm.name,
        year: Number(editClassForm.year),
        weekday: editClassForm.weekday === '' ? null : Number(editClassForm.weekday),
        time: editClassForm.time || null,
        room: editClassForm.room || null,
        capacity: editClassForm.capacity === '' ? null : Number(editClassForm.capacity),
      });
      notify.success('Turma atualizada!');
      if (data?.capacityWarning) notify.warning(data.capacityWarning);
      setShowEditClassModal(false);
      // A lista recarregada reidrata o detalhe (occupied/openSpots/isFull inclusos)
      await fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao atualizar a turma'));
    } finally {
      setSavingClass(false);
    }
  };

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClass) return;
    try {
      await api.post('/catechesis/enrollments', {
        classId: selectedClass.id,
        memberId: enrollForm.memberId,
        ...(enrollForm.waiveBaptism ? { requireBaptism: false } : {}),
        ...(enrollForm.overrideCapacity ? { overrideCapacity: true } : {}),
      });
      notify.success('Catequizando matriculado!');
      setShowEnrollModal(false);
      setEnrollForm({ memberId: '', waiveBaptism: false, overrideCapacity: false });
      refreshDetail();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao matricular'));
    }
  };

  const openCatechistModal = async () => {
    if (!selectedClass) return;
    setEligibleCatechists(null);
    setCatechistForm({ memberId: '', role: 'Catequista' });
    setShowCatechistModal(true);
    try {
      const res = await api.get(`/catechesis/classes/${selectedClass.id}/eligible-catechists`);
      setEligibleCatechists(res.data ?? []);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar os membros da pastoral'));
      setEligibleCatechists([]);
    }
  };

  const handleAddCatechist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClass) return;
    try {
      await api.post(`/catechesis/classes/${selectedClass.id}/catechists`, {
        memberId: catechistForm.memberId,
        role: catechistForm.role || undefined,
      });
      notify.success('Catequista adicionado à turma!');
      setShowCatechistModal(false);
      setCatechistForm({ memberId: '', role: 'Catequista' });
      refreshDetail();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao adicionar catequista'));
    }
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClass) return;
    try {
      const res = await api.post(`/catechesis/classes/${selectedClass.id}/sessions`, {
        // Date-only (00:00Z), como o app — toISOString() de datetime-local
        // deslocava encontros noturnos para o dia seguinte
        date: sessionForm.date,
        topic: sessionForm.topic || undefined,
      });
      notify.success('Encontro registrado! Agora faça a chamada.');
      setShowSessionModal(false);
      setSessionForm({ date: '', topic: '' });
      // Abre a chamada com todos presentes por padrão
      const initial: Record<string, Mark> = {};
      (report?.students ?? [])
        .filter((s) => s.status === 'ACTIVE')
        .forEach((s) => {
          initial[s.enrollmentId] = 'present';
        });
      setAttendance(initial);
      setAttendanceMeta({ date: sessionForm.date, topic: undefined });
      setLastMarked(null);
      setAttendanceSessionId(res.data.id);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao registrar encontro'));
    }
  };

  const closeAttendance = () => {
    setAttendanceSessionId(null);
    setAttendanceMeta(null);
    setLastMarked(null);
  };

  const handleSaveAttendance = async () => {
    if (!attendanceSessionId) return;
    try {
      await api.post(`/catechesis/sessions/${attendanceSessionId}/attendance`, {
        entries: Object.entries(attendance)
          .filter(([, mark]) => mark !== 'unset')
          .map(([enrollmentId, mark]) => ({
            enrollmentId,
            present: mark === 'present' || mark === 'late',
            late: mark === 'late',
          })),
      });
      notify.success('Chamada registrada!');
      closeAttendance();
      refreshDetail();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao salvar a chamada'));
    }
  };

  const handleTransfer = async (enrollmentId: string, targetClassId: string) => {
    if (!targetClassId) return;
    try {
      await api.patch(`/catechesis/enrollments/${enrollmentId}/transfer`, { targetClassId });
      notify.success('Matrícula transferida!');
      refreshDetail();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao transferir matrícula'));
    }
  };

  const handleComplete = async (enrollmentId: string) => {
    try {
      await api.patch(`/catechesis/enrollments/${enrollmentId}/complete`, {});
      notify.success('Etapa concluída — sacramento registrado quando aplicável!');
      refreshDetail();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao concluir matrícula'));
    }
  };

  const openAssessments = async (enrollmentId: string, fullName: string) => {
    try {
      const res = await api.get(`/catechesis/enrollments/${enrollmentId}/assessments`);
      setAssessments(res.data ?? []);
      setAssessmentForm({ period: '', rating: '', notes: '' });
      setAssessmentTarget({ enrollmentId, fullName });
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar os pareceres'));
    }
  };

  const handleSaveAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assessmentTarget) return;
    setSavingAssessment(true);
    try {
      await api.post(`/catechesis/enrollments/${assessmentTarget.enrollmentId}/assessments`, {
        period: assessmentForm.period,
        rating: assessmentForm.rating || undefined,
        notes: assessmentForm.notes,
      });
      notify.success('Parecer registrado — a família foi avisada!');
      const res = await api.get(`/catechesis/enrollments/${assessmentTarget.enrollmentId}/assessments`);
      setAssessments(res.data ?? []);
      setAssessmentForm({ period: '', rating: '', notes: '' });
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao salvar o parecer'));
    } finally {
      setSavingAssessment(false);
    }
  };

  const openDocuments = async (enrollmentId: string, fullName: string) => {
    setDocList(null);
    setDocTarget({ enrollmentId, fullName });
    try {
      const res = await api.get(`/catechesis/enrollments/${enrollmentId}/documents`);
      setDocList(res.data ?? []);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar os documentos'));
      setDocList([]);
    }
  };

  const openDocumentFile = async (documentId: string) => {
    // A aba abre SINCRONAMENTE no clique (popup blocker); o conteúdo chega depois
    const win = window.open('', '_blank');
    try {
      const res = await api.get(`/catechesis/documents/${documentId}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      if (win) {
        win.location.href = url;
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = 'documento';
        link.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error: any) {
      win?.close();
      try {
        if (error?.response?.data instanceof Blob) {
          const parsed = JSON.parse(await error.response.data.text());
          if (parsed?.message) {
            notify.error(Array.isArray(parsed.message) ? parsed.message.join(', ') : parsed.message);
            return;
          }
        }
      } catch {
        // segue para o genérico
      }
      notify.error(getErrorMessage(error, 'Erro ao abrir o arquivo'));
    }
  };

  const handleReviewDocument = async (documentId: string, approve: boolean) => {
    let notes: string | undefined;
    if (!approve) {
      const typed = window.prompt('Motivo da recusa (a família será avisada e poderá reenviar):');
      if (typed === null) return;
      notes = typed.trim() || undefined;
    }
    setReviewingDoc(documentId);
    try {
      await api.patch(`/catechesis/documents/${documentId}/review`, { approve, notes });
      notify.success(approve ? 'Documento conferido — pendência baixada e arquivo removido.' : 'Documento recusado — a família foi avisada.');
      if (docTarget) {
        const res = await api.get(`/catechesis/enrollments/${docTarget.enrollmentId}/documents`);
        setDocList(res.data ?? []);
      }
      refreshDetail();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao conferir o documento'));
    } finally {
      setReviewingDoc(null);
    }
  };

  const handleEditSession = async (session: SessionSummary) => {
    const currentDate = new Date(session.date).toISOString().slice(0, 10);
    const date = window.prompt('Data do encontro (AAAA-MM-DD):', currentDate);
    if (date === null) return;
    const topic = window.prompt('Tema (vazio remove):', session.topic ?? '');
    if (topic === null) return;
    try {
      await api.patch(`/catechesis/sessions/${session.id}`, {
        date: date.trim() || undefined,
        topic,
      });
      notify.success('Encontro atualizado!');
      refreshDetail();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao atualizar o encontro'));
    }
  };

  const handleDeleteSession = async (session: SessionSummary) => {
    const when = new Date(session.date).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
    if (!window.confirm(`Excluir o encontro de ${when}? A chamada dele será apagada junto.`)) return;
    try {
      await api.delete(`/catechesis/sessions/${session.id}`);
      notify.success('Encontro excluído.');
      refreshDetail();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao excluir o encontro'));
    }
  };

  const handleNotifyFamily = async (enrollmentId: string, fullName: string) => {
    const message = window.prompt(`Aviso só para a família de ${fullName} (até 500 caracteres):`);
    if (message === null || !message.trim()) return;
    try {
      const res = await api.post(`/catechesis/enrollments/${enrollmentId}/notify`, { message });
      notify.success(
        res.data.notified > 0
          ? `Aviso enviado para ${res.data.notified} conta(s) da família.`
          : 'A família não tem conta no app para receber o aviso.',
      );
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao enviar o aviso'));
    }
  };

  const openBatchAssessment = () => {
    if (!report) return;
    const selection: Record<string, boolean> = {};
    report.students
      .filter((student) => student.status === 'ACTIVE' || student.status === 'COMPLETED')
      .forEach((student) => {
        selection[student.enrollmentId] = student.status === 'ACTIVE';
      });
    setBatchSelection(selection);
    setBatchForm({ period: '', rating: '', notes: '' });
    setShowBatchAssessment(true);
  };

  const handleSaveBatchAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClass) return;
    const enrollmentIds = Object.entries(batchSelection)
      .filter(([, checked]) => checked)
      .map(([id]) => id);
    if (!enrollmentIds.length) {
      notify.error('Selecione ao menos um catequizando');
      return;
    }
    setSavingBatch(true);
    try {
      const res = await api.post(`/catechesis/classes/${selectedClass.id}/assessments`, {
        period: batchForm.period,
        rating: batchForm.rating || undefined,
        notes: batchForm.notes,
        enrollmentIds,
      });
      notify.success(`Parecer registrado para ${res.data.saved} catequizando(s) — as famílias foram avisadas!`);
      setShowBatchAssessment(false);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao salvar os pareceres'));
    } finally {
      setSavingBatch(false);
    }
  };

  const loadClassFees = async () => {
    if (!selectedClass) return;
    try {
      const res = await api.get(`/catechesis/classes/${selectedClass.id}/fees`);
      setClassFees(res.data ?? []);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar as taxas'));
    }
  };

  const handleCreateFee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClass) return;
    try {
      await api.post(`/catechesis/classes/${selectedClass.id}/fees`, {
        description: feeForm.description,
        amount: Number(feeForm.amount),
        dueDate: feeForm.dueDate || undefined,
      });
      notify.success('Taxa criada — as famílias da turma foram avisadas!');
      setFeeForm({ description: '', amount: '', dueDate: '' });
      loadClassFees();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao criar a taxa'));
    }
  };

  const handleFeePayment = async (feeId: string, enrollmentId: string, waived: boolean) => {
    if (waived) {
      // Irreversível nesta fase (sem estorno) — confirmação obrigatória
      const confirmed = window.confirm(
        'Isentar este catequizando da taxa? A isenção não pode ser desfeita e impede registrar pagamento depois.',
      );
      if (!confirmed) return;
    }
    const method = waived ? undefined : window.prompt('Forma de pagamento (ex.: Dinheiro, Pix):', 'Dinheiro');
    if (!waived && method === null) return; // cancelou
    try {
      await api.post(`/catechesis/fees/${feeId}/payments`, {
        enrollmentId,
        waived,
        method: method || undefined,
      });
      notify.success(waived ? 'Isenção registrada.' : 'Pagamento registrado no financeiro!');
      loadClassFees();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao registrar'));
    }
  };

  const loadDioceseOverview = async (selectedDioceseId?: string) => {
    // SYSTEM_ADMIN precisa escolher a diocese; sem escolha, mostra só o seletor
    if (isSystemAdmin && !selectedDioceseId) {
      setDioceseOverview(null);
      return;
    }
    setDioceseLoading(true);
    try {
      const res = await api.get('/catechesis/diocese-overview', {
        params: selectedDioceseId ? { dioceseId: selectedDioceseId } : undefined,
      });
      setDioceseOverview(res.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar a visão diocesana'));
      setDioceseOverview(null);
    } finally {
      setDioceseLoading(false);
    }
  };

  const openDioceseTab = async () => {
    setTab('diocese');
    if (isSystemAdmin && dioceses.length === 0) {
      try {
        const res = await api.get('/dioceses');
        setDioceses(res.data ?? []);
      } catch {
        // seletor fica vazio; o erro aparece ao tentar carregar
      }
    }
    // Sempre recarrega ao entrar na aba — números congelados enganam
    loadDioceseOverview(isSystemAdmin ? dioceseId || undefined : undefined);
  };

  const downloadPdf = async (path: string, filename: string) => {
    try {
      const res = await api.get(path, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      // Com responseType blob o corpo do erro também vira Blob — recupera a
      // mensagem real do backend antes de cair no genérico
      try {
        if (error?.response?.data instanceof Blob) {
          const parsed = JSON.parse(await error.response.data.text());
          if (parsed?.message) {
            notify.error(Array.isArray(parsed.message) ? parsed.message.join(', ') : parsed.message);
            return;
          }
        }
      } catch {
        // corpo não-JSON — segue para o genérico
      }
      notify.error(getErrorMessage(error, 'Erro ao gerar o PDF'));
    }
  };

  const openChat = async (enrollmentId: string, fullName: string) => {
    setChatTarget({ enrollmentId, fullName });
    setChatThread(null);
    setChatText('');
    try {
      const res = await api.get(`/catechesis/enrollments/${enrollmentId}/messages`);
      setChatThread(res.data);
      // Abrir a conversa zera o contador da linha (o backend já marcou como lida)
      setReport((current) =>
        current
          ? {
              ...current,
              students: current.students.map((s) =>
                s.enrollmentId === enrollmentId ? { ...s, unreadMessages: 0 } : s,
              ),
            }
          : current,
      );
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao abrir a conversa'));
      setChatTarget(null);
    }
  };

  const sendChat = async () => {
    // Enter repetido durante o envio em voo duplicava a mensagem
    if (!chatTarget || !chatText.trim() || sendingChat) return;
    setSendingChat(true);
    try {
      const res = await api.post(`/catechesis/enrollments/${chatTarget.enrollmentId}/messages`, { body: chatText.trim() });
      setChatThread((current) => (current ? { ...current, messages: [...current.messages, res.data] } : current));
      setChatText('');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao enviar a mensagem'));
    } finally {
      setSendingChat(false);
    }
  };

  const loadCommunityOverview = async (communityId?: string) => {
    const seq = ++overviewSeq.current;
    setOverviewLoading(true);
    try {
      const res = await api.get('/catechesis/community-overview', {
        params: communityId ? { communityId } : undefined,
      });
      if (seq !== overviewSeq.current) return;
      setOverviewRows(res.data ?? []);
    } catch (error) {
      if (seq !== overviewSeq.current) return;
      notify.error(getErrorMessage(error, 'Erro ao carregar o panorama'));
      setOverviewRows(null);
    } finally {
      if (seq === overviewSeq.current) setOverviewLoading(false);
    }
  };

  const openPanoramaTab = () => {
    setTab('panorama');
    // Coordenador usa a própria comunidade; admin escolhe no seletor
    const communityId = overviewCommunityId || user?.communityId || communities[0]?.id || '';
    if (!overviewCommunityId && communityId) setOverviewCommunityId(communityId);
    if (communityId) loadCommunityOverview(communityId);
  };

  const openTopicsModal = async () => {
    if (!selectedClass) return;
    // Recarrega os encontros: o draft parte do que está gravado AGORA
    let fresh: SessionSummary[] = sessions;
    try {
      const res = await api.get(`/catechesis/classes/${selectedClass.id}/sessions`);
      fresh = res.data ?? [];
      setSessions(fresh);
    } catch {
      // segue com a lista em memória
    }
    // Só encontros de hoje em diante — tema de encontro passado é histórico.
    // 'Hoje' = dia civil local (toISOString puro viraria amanhã depois das 21h)
    const now = new Date();
    const todayIso = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10);
    const draft: Record<string, string> = {};
    fresh
      .filter((session) => session.date.slice(0, 10) >= todayIso)
      .forEach((session) => {
        draft[session.id] = session.topic ?? '';
      });
    if (Object.keys(draft).length === 0) {
      notify.error('Nenhum encontro futuro — gere a agenda primeiro');
      return;
    }
    setTopicsBaseline(draft);
    setTopicsDraft({ ...draft });
    setShowTopicsModal(true);
  };

  const handleSaveTopics = async () => {
    if (!selectedClass) return;
    const items = Object.entries(topicsDraft)
      .filter(([sessionId, topic]) => (topicsBaseline[sessionId] ?? '') !== topic)
      .map(([sessionId, topic]) => ({ sessionId, topic }));
    if (items.length === 0) {
      notify.success('Nenhum tema alterado');
      setShowTopicsModal(false);
      return;
    }
    setSavingTopics(true);
    try {
      await api.post(`/catechesis/classes/${selectedClass.id}/sessions/topics`, { items });
      notify.success(`${items.length} tema(s) atualizado(s)!`);
      setShowTopicsModal(false);
      await refreshDetail();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao salvar os temas'));
    } finally {
      setSavingTopics(false);
    }
  };

  const openSentNotices = async () => {
    if (!selectedClass) return;
    setSentNotices(null);
    setShowSentNotices(true);
    try {
      const res = await api.get(`/catechesis/classes/${selectedClass.id}/sent-notices`);
      setSentNotices(res.data ?? []);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar os avisos enviados'));
      setShowSentNotices(false);
    }
  };

  const downloadCsv = async (path: string, filename: string) => {
    try {
      const res = await api.get(path, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notify.error(await blobErrorMessage(error, 'Erro ao exportar'));
    }
  };

  // Prévia da agenda: todas as datas do dia-da-semana da turma no período
  const buildAgendaPreview = () => {
    if (!selectedClass) return;
    if (selectedClass.weekday === null || selectedClass.weekday === undefined) {
      notify.error('Defina o dia da semana da turma para gerar a agenda');
      return;
    }
    if (!agendaRange.from || !agendaRange.to || agendaRange.from > agendaRange.to) {
      notify.error('Informe um período válido (início e fim)');
      return;
    }
    const cursor = new Date(agendaRange.from);
    const end = new Date(agendaRange.to);
    const DAY_MS = 24 * 60 * 60 * 1000;
    if (end.getTime() - cursor.getTime() > 370 * DAY_MS) {
      notify.error('Período máximo de 12 meses — gere um ano letivo por vez');
      return;
    }
    const dates: Record<string, boolean> = {};
    while (cursor.getTime() <= end.getTime()) {
      if (cursor.getUTCDay() === selectedClass.weekday) {
        const iso = cursor.toISOString().slice(0, 10);
        // Feriado nacional já vem desmarcado (o rótulo explica; dá para remarcar)
        dates[iso] = holidayLabel(iso) === null;
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    if (!Object.keys(dates).length) {
      notify.error('Nenhuma data do dia da turma dentro do período');
      return;
    }
    setAgendaDates(dates);
  };

  const handleGenerateAgenda = async () => {
    if (!selectedClass) return;
    const dates = Object.entries(agendaDates)
      .filter(([, checked]) => checked)
      .map(([date]) => date);
    if (!dates.length) {
      notify.error('Selecione ao menos uma data');
      return;
    }
    setGeneratingAgenda(true);
    try {
      const res = await api.post(`/catechesis/classes/${selectedClass.id}/generate-sessions`, { dates });
      notify.success(
        `${res.data.created} encontro(s) criado(s)${res.data.skipped ? ` (${res.data.skipped} já existiam)` : ''} — as famílias receberam um único aviso-resumo.`,
      );
      setShowAgendaModal(false);
      setAgendaDates({});
      setAgendaRange({ from: '', to: '' });
      refreshDetail();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao gerar a agenda'));
    } finally {
      setGeneratingAgenda(false);
    }
  };

  const handleApprove = async (enrollmentId: string) => {
    try {
      await api.patch(`/catechesis/enrollments/${enrollmentId}/approve`, {});
      notify.success('Matrícula aprovada — a família foi avisada!');
      refreshDetail();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao aprovar a inscrição'));
    }
  };

  const handleReject = async (enrollmentId: string) => {
    const reason = window.prompt('Motivo da recusa (opcional — a família será avisada):');
    if (reason === null) return; // cancelou
    try {
      await api.patch(`/catechesis/enrollments/${enrollmentId}/reject`, {
        reason: reason.trim() || undefined,
      });
      notify.success('Inscrição recusada — a família foi avisada.');
      refreshDetail();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao recusar a inscrição'));
    }
  };

  const handleRemoveCatechist = async (memberId: string, fullName: string) => {
    if (!selectedClass) return;
    if (!window.confirm(`Remover ${fullName} da equipe desta turma? O acesso operacional dele à turma é encerrado.`)) return;
    try {
      await api.delete(`/catechesis/classes/${selectedClass.id}/catechists/${memberId}`);
      notify.success('Catequista removido da turma.');
      refreshDetail();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao remover o catequista'));
    }
  };

  const openRenewal = async () => {
    if (!selectedClass) return;
    try {
      const res = await api.get(`/catechesis/classes/${selectedClass.id}/renewal-preview`);
      const preview: RenewalPreview = res.data;
      const selection: Record<string, boolean> = {};
      preview.students.forEach((s) => {
        selection[s.enrollmentId] = s.eligible;
      });
      setRenewalSelection(selection);
      setRenewalTarget(preview.targetClasses[0]?.id ?? '');
      setRenewal(preview);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao preparar a renovação'));
    }
  };

  const handleRenew = async () => {
    if (!selectedClass || !renewal) return;
    const enrollmentIds = Object.entries(renewalSelection)
      .filter(([, checked]) => checked)
      .map(([id]) => id);
    if (!renewalTarget) {
      notify.error('Escolha a turma de destino');
      return;
    }
    if (enrollmentIds.length === 0) {
      notify.error('Selecione ao menos um catequizando');
      return;
    }
    setRenewing(true);
    try {
      const res = await api.post(`/catechesis/classes/${selectedClass.id}/renew`, {
        targetClassId: renewalTarget,
        enrollmentIds,
      });
      notify.success(`Renovação concluída: ${res.data.renewed + res.data.reactivated} matrícula(s) na nova turma!`);
      setRenewal(null);
      refreshDetail();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao renovar a turma'));
    } finally {
      setRenewing(false);
    }
  };

  if (loading) return <div className="module-page"><div className="loading">Carregando...</div></div>;

  return (
    <div className="module-page">
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center' }}><TitleIcon name="catequese" /> Catequese</h1>
        <div className="header-actions">
          {tab === 'stages' ? (
            <button className="btn-primary" onClick={() => setShowStageModal(true)}>+ Nova Etapa</button>
          ) : (
            <button className="btn-primary" onClick={() => setShowClassModal(true)}>+ Nova Turma</button>
          )}
        </div>
      </div>

      <div className="module-tabs">
        <button className={`tab-btn ${tab === 'classes' ? 'active' : ''}`} onClick={() => setTab('classes')}>
          Turmas ({classes.length})
        </button>
        <button className={`tab-btn ${tab === 'stages' ? 'active' : ''}`} onClick={() => setTab('stages')}>
          Etapas ({stages.length})
        </button>
        {isCoordinator && (
          <button className={`tab-btn ${tab === 'panorama' ? 'active' : ''}`} onClick={openPanoramaTab}>
            Panorama
          </button>
        )}
        {isDiocesan && (
          <button
            className={`tab-btn ${tab === 'diocese' ? 'active' : ''}`}
            onClick={() => void openDioceseTab()}
          >
            Visão diocesana
          </button>
        )}
      </div>

      {tab === 'panorama' && (
        <>
          {communities.length > 1 && (
            <div className="inline-form" style={{ marginBottom: '1rem' }}>
              <select
                className="filter-select"
                value={overviewCommunityId}
                onChange={(e) => {
                  setOverviewCommunityId(e.target.value);
                  if (e.target.value) loadCommunityOverview(e.target.value);
                }}
              >
                {communities.map((community) => (
                  <option key={community.id} value={community.id}>{community.name}</option>
                ))}
              </select>
            </div>
          )}
          {overviewLoading && <div className="loading">Carregando o panorama...</div>}
          {!overviewLoading && overviewRows && overviewRows.length === 0 && (
            <div className="cate-empty">Nenhuma turma ativa nesta comunidade.</div>
          )}
          {!overviewLoading && overviewRows && overviewRows.length > 0 && (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Turma</th>
                    <th>Etapa</th>
                    <th>Ativos</th>
                    <th>Aguardando aprovação</th>
                    <th>Docs p/ conferir</th>
                    <th>Mensagens</th>
                    <th>Docs pendentes</th>
                    <th>Chamadas em aberto</th>
                    <th>Taxas pendentes</th>
                  </tr>
                </thead>
                <tbody>
                  {overviewRows.map((row) => {
                    const klass = classes.find((k) => k.id === row.classId);
                    const attention =
                      row.pendingApproval + row.documentsToReview + (row.unreadFamilyMessages ?? 0) + row.pastSessionsWithoutAttendance > 0;
                    return (
                      <tr key={row.classId}>
                        <td>
                          {klass ? (
                            <button className="link-button" onClick={() => { setTab('classes'); void openClassDetail(klass); }}>
                              {row.name}
                            </button>
                          ) : (
                            row.name
                          )}
                          {attention && ' ⚠️'}
                        </td>
                        <td>{row.stage}</td>
                        <td>{row.active}</td>
                        <td>{row.pendingApproval > 0 ? <span className="status-badge yellow">{row.pendingApproval}</span> : '—'}</td>
                        <td>{row.documentsToReview > 0 ? <span className="status-badge yellow">{row.documentsToReview}</span> : '—'}</td>
                        <td>{(row.unreadFamilyMessages ?? 0) > 0 ? <span className="status-badge yellow">{row.unreadFamilyMessages}</span> : '—'}</td>
                        <td>{row.pendingDocumentsCount > 0 ? row.pendingDocumentsCount : '—'}</td>
                        <td>{row.pastSessionsWithoutAttendance > 0 ? <span className="status-badge red">{row.pastSessionsWithoutAttendance}</span> : '—'}</td>
                        <td>{row.feesPendingCount > 0 ? row.feesPendingCount : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'diocese' && (
        <>
          {isSystemAdmin && (
            <div className="inline-form" style={{ marginBottom: '1rem' }}>
              <select
                className="filter-select"
                value={dioceseId}
                onChange={(e) => {
                  setDioceseId(e.target.value);
                  loadDioceseOverview(e.target.value || undefined);
                }}
              >
                <option value="">Escolha a diocese...</option>
                {dioceses.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <button className="btn-small" onClick={() => loadDioceseOverview(dioceseId || undefined)}>↻ Atualizar</button>
            </div>
          )}
          {dioceseLoading && <div className="loading">Carregando a diocese...</div>}
          {!dioceseLoading && !dioceseOverview && isSystemAdmin && !dioceseId && (
            <div className="empty-state">Escolha a diocese para ver o panorama da catequese.</div>
          )}
          {!dioceseLoading && dioceseOverview && (
            <>
              <div className="summary-cards">
                <div className="summary-card"><div className="label">Paróquias com catequese</div><div className="value">{dioceseOverview.totals.parishes}</div></div>
                <div className="summary-card"><div className="label">Turmas ativas</div><div className="value">{dioceseOverview.totals.classes}</div></div>
                <div className="summary-card"><div className="label">Catequizandos ativos</div><div className="value positive">{dioceseOverview.totals.active}</div></div>
                <div className="summary-card"><div className="label">Aguardando aprovação</div><div className="value">{dioceseOverview.totals.pending}</div></div>
                <div className="summary-card"><div className="label">Concluídos</div><div className="value">{dioceseOverview.totals.completed}</div></div>
              </div>
              {dioceseOverview.parishes.length === 0 && (
                <div className="empty-state">Nenhuma paróquia da diocese tem etapas de catequese cadastradas ainda.</div>
              )}
              {dioceseOverview.parishes.map((parish) => (
                <div key={parish.parishId} className="detail-panel" style={{ marginBottom: '1rem' }}>
                  <h2>{parish.parishName}</h2>
                  <div className="table-container">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Etapa</th>
                          <th>Turmas</th>
                          <th>Ativos</th>
                          <th>Aguardando</th>
                          <th>Concluídos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parish.stages.map((stage) => (
                          <tr key={stage.stageId}>
                            <td><strong>{stage.stageName}</strong></td>
                            <td>{stage.classes}</td>
                            <td>{stage.active}</td>
                            <td>{stage.pending}</td>
                            <td>{stage.completed}</td>
                          </tr>
                        ))}
                        <tr>
                          <td><strong>Total</strong></td>
                          <td><strong>{parish.totals.classes}</strong></td>
                          <td><strong>{parish.totals.active}</strong></td>
                          <td><strong>{parish.totals.pending}</strong></td>
                          <td><strong>{parish.totals.completed}</strong></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {tab === 'stages' && (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Ordem</th>
                <th>Etapa</th>
                <th>Sacramento gerado</th>
                <th>Descrição</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((stage) => (
                <tr key={stage.id}>
                  <td>{stage.ordering}</td>
                  <td><strong>{stage.name}</strong></td>
                  <td>{stage.sacramentType ? SACRAMENT_LABELS[stage.sacramentType] ?? stage.sacramentType : '—'}</td>
                  <td>{stage.description || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {stages.length === 0 && <div className="empty-state">Nenhuma etapa cadastrada. Cadastre as etapas da paróquia (ex.: Pré-Eucaristia, Eucaristia, Crisma).</div>}
        </div>
      )}

      {tab === 'classes' && !selectedClass && (
        <div className="cate-root">
          <div className="cate-grid">
            {classes.map((klass) => (
              <div key={klass.id} className="cate-card" onClick={() => openClassDetail(klass)}>
                <div className="cate-card__head">
                  <div>
                    <h3 className="cate-card__title">{klass.name}</h3>
                    <p className="cate-card__stage">{klass.stage.name}</p>
                  </div>
                  <span className="cate-year">{klass.year}</span>
                </div>
                <div className="cate-card__meta">
                  <span>
                    📍 {klass.community.name}
                    {klass.room ? ` · ${klass.room}` : ''}
                  </span>
                  <span>
                    🗓 {klass.weekday !== null && klass.weekday !== undefined ? WEEKDAYS[klass.weekday] : 'Dia a definir'}
                    {klass.time ? ` às ${klass.time}` : ''}
                  </span>
                </div>
                <div className="cate-card__foot">
                  <div className="cate-card__stats">
                    <span><strong>{klass._count.enrollments}</strong> ativos</span>
                    <span><strong>{klass._count.sessions}</strong> encontros</span>
                    {klass.capacity != null ? (
                      <span className={`cate-seats ${klass.isFull ? 'is-full' : ''}`}>
                        {klass.isFull ? 'Lotada' : `${klass.openSpots} vaga${klass.openSpots === 1 ? '' : 's'}`}
                        {' '}({klass.occupied ?? 0}/{klass.capacity})
                      </span>
                    ) : (
                      <span className="cate-seats is-open">Sem limite</span>
                    )}
                  </div>
                  <span className="cate-card__open">Abrir turma →</span>
                </div>
              </div>
            ))}
          </div>
          {classes.length === 0 && <div className="cate-empty">Nenhuma turma cadastrada — crie a primeira em “+ Nova Turma”.</div>}
        </div>
      )}

      {tab === 'classes' && selectedClass && (
        <div className="cate-root">
          <button className="cate-back" onClick={() => setSelectedClass(null)}>← Todas as turmas</button>

          <div className="cate-detail">
            <div className="cate-detail__head">
              <div className="cate-detail__title-row">
                <div>
                  <h2 className="cate-detail__title">{selectedClass.name} · {selectedClass.year}</h2>
                  <p className="cate-detail__sub">
                    <strong>{selectedClass.stage.name}</strong>
                    {' · '}{selectedClass.community.name}
                    {' · '}
                    {selectedClass.weekday !== null && selectedClass.weekday !== undefined
                      ? WEEKDAYS[selectedClass.weekday]
                      : 'dia a definir'}
                    {selectedClass.time ? ` às ${selectedClass.time}` : ''}
                    {selectedClass.room ? ` · ${selectedClass.room}` : ''}
                  </p>
                </div>
              </div>

              {report && !reportLoading && (
                <div className="cate-team">
                  <span className="cate-team__label">Equipe</span>
                  {report.catechists.length === 0 && (
                    <span className="cate-team__empty">
                      Nenhum catequista — vincule pela pastoral da Catequese e use “+ Catequista”
                    </span>
                  )}
                  {report.catechists.map((catechist) => (
                    <span key={catechist.memberId} className="cate-chip">
                      <span className="cate-chip__avatar">{initials(catechist.fullName)}</span>
                      {catechist.fullName}
                      <span className="cate-chip__role">{catechist.role}</span>
                      <button
                        className="cate-chip__remove"
                        title="Remover da turma"
                        onClick={() => handleRemoveCatechist(catechist.memberId, catechist.fullName)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <button className="cate-btn cate-btn--ghost" onClick={() => void openCatechistModal()}>
                    + Catequista
                  </button>
                </div>
              )}
            </div>

            <div className="cate-toolbar">
              <button
                className="cate-btn cate-btn--primary"
                onClick={() => {
                  // Sempre abre limpo — um "matricular mesmo assim" marcado num
                  // cancelamento anterior não pode vazar para a próxima matrícula
                  setEnrollForm({ memberId: '', waiveBaptism: false, overrideCapacity: false });
                  setShowEnrollModal(true);
                }}
              >
                + Matricular
              </button>
              <button className="cate-btn cate-btn--primary" onClick={() => setShowSessionModal(true)}>
                + Encontro (chamada)
              </button>
              <button className="cate-btn" onClick={openEditClass}>
                ✏️ Editar turma
              </button>
              {selectedClass.capacity != null && (
                <span className={`cate-seats ${selectedClass.isFull ? 'is-full' : ''}`}>
                  {selectedClass.isFull
                    ? `Lotada (${selectedClass.occupied ?? 0}/${selectedClass.capacity})`
                    : `${selectedClass.openSpots} vaga${selectedClass.openSpots === 1 ? '' : 's'} de ${selectedClass.capacity}`}
                </span>
              )}
              <span className="cate-toolbar__sep" />
              <button
                className="cate-btn"
                onClick={() => {
                  // Sempre abre limpo — prévia de outra turma/período não vaza
                  setAgendaDates({});
                  setAgendaRange({ from: '', to: '' });
                  setShowAgendaModal(true);
                }}
              >
                📅 Gerar agenda
              </button>
              <button className="cate-btn" onClick={() => void openTopicsModal()}>
                📝 Planejar temas
              </button>
              <button className="cate-btn" onClick={() => void openSentNotices()}>
                ✉ Avisos enviados
              </button>
              {report && report.completed > 0 && (
                <button className="cate-btn" onClick={openRenewal}>↻ Renovar turma</button>
              )}
              <button
                className="cate-btn"
                onClick={() => {
                  // Sempre abre limpo — a matriz da turma anterior não pode
                  // receber cliques (pagamento iria para a taxa errada)
                  setClassFees([]);
                  setShowFees(true);
                  loadClassFees();
                }}
              >
                💰 Taxas
              </button>
              <span className="cate-toolbar__sep" />
              <button
                className="cate-btn"
                onClick={() => downloadPdf(`/catechesis/classes/${selectedClass.id}/roster.pdf`, `lista_${selectedClass.name.replace(/\s+/g, '_').toLowerCase()}.pdf`)}
              >
                🖨 Lista da turma
              </button>
              {report && report.completed > 0 && (
                <button
                  className="cate-btn"
                  onClick={() => downloadPdf(`/catechesis/classes/${selectedClass.id}/certificates.pdf`, `certificados_${selectedClass.name.replace(/\s+/g, '_').toLowerCase()}.pdf`)}
                >
                  🎓 Certificados (lote)
                </button>
              )}
            </div>

            {reportLoading && <div className="loading">Carregando a turma...</div>}

            {report && !reportLoading && (
              <>
                <div className="cate-stats">
                  <div className="cate-stat">
                    <div className="cate-stat__value">{report.total}</div>
                    <div className="cate-stat__label">Matriculados</div>
                  </div>
                  <div className="cate-stat">
                    <div className="cate-stat__value cate-stat__value--ok">{report.active}</div>
                    <div className="cate-stat__label">Ativos</div>
                  </div>
                  {report.pending > 0 && (
                    <div className="cate-stat">
                      <div className="cate-stat__value cate-stat__value--warn">{report.pending}</div>
                      <div className="cate-stat__label">Aguardando</div>
                    </div>
                  )}
                  <div className="cate-stat">
                    <div className="cate-stat__value">{report.completed}</div>
                    <div className="cate-stat__label">Concluídos</div>
                  </div>
                  <div className="cate-stat">
                    <div className={`cate-stat__value${report.dropouts > 0 ? ' cate-stat__value--danger' : ''}`}>{report.dropouts}</div>
                    <div className="cate-stat__label">Desistências</div>
                  </div>
                  <div className="cate-stat">
                    <div className="cate-stat__value">{sessions.length}</div>
                    <div className="cate-stat__label">Encontros</div>
                  </div>
                </div>

                <div className="cate-body">
                  <section>
                    <div className="cate-section__head">
                      <h3 className="cate-section__title">Encontros</h3>
                      <span className="cate-section__hint">Clique num encontro para abrir/editar a chamada</span>
                    </div>
                    {sessions.length === 0 ? (
                      <div className="cate-empty">
                        Nenhum encontro ainda — use “+ Encontro (chamada)” ou gere a agenda do ano.
                      </div>
                    ) : (
                      <div className="cate-sessions">
                        {sessions.map((session) => (
                          <div
                            key={session.id}
                            className="cate-session"
                            role="button"
                            tabIndex={0}
                            onClick={() => void openSessionAttendance(session)}
                            onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && void openSessionAttendance(session)}
                          >
                            <span>
                              <span className="cate-session__date">
                                {new Date(session.date).toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' })}
                              </span>
                              <div className="cate-session__meta">{session.topic || 'Sem tema'}</div>
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              {session.marked === 0 ? (
                                <span className="cate-session__badge cate-session__badge--todo">sem chamada</span>
                              ) : (
                                <span className="cate-session__badge cate-session__badge--done">
                                  {session.present}/{session.marked} ✓
                                </span>
                              )}
                              <button
                                type="button"
                                className="cate-chip__remove"
                                title="Editar encontro"
                                onClick={(e) => { e.stopPropagation(); void handleEditSession(session); }}
                              >
                                ✏️
                              </button>
                              <button
                                type="button"
                                className="cate-chip__remove"
                                title="Excluir encontro"
                                onClick={(e) => { e.stopPropagation(); void handleDeleteSession(session); }}
                              >
                                🗑
                              </button>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section>
                    <div className="cate-section__head">
                      <h3 className="cate-section__title">Catequizandos</h3>
                      {report.students.some((s) => s.status === 'ACTIVE' || s.status === 'COMPLETED') && (
                        <button className="cate-btn" onClick={openBatchAssessment}>📝 Parecer em lote</button>
                      )}
                    </div>
                    {report.students.length === 0 ? (
                      <div className="cate-empty">Nenhum catequizando matriculado ainda.</div>
                    ) : (
                      <div className="cate-table-wrap">
                        <table className="cate-table">
                          <thead>
                            <tr>
                              <th>Catequizando</th>
                              <th>Status</th>
                              <th>Frequência</th>
                              <th>Docs pendentes</th>
                              <th style={{ textAlign: 'right' }}>Ações</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.students.map((student) => {
                              const st = ENROLLMENT_STATUS[student.status] ?? { label: student.status, color: 'gray' };
                              const badgeClass = STATUS_BADGE[student.status] ?? 'cate-badge--moved';
                              return (
                                <tr key={student.enrollmentId}>
                                  <td>
                                    <strong>{student.member.fullName}</strong>
                                    {student.contact && (
                                      <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                                        {student.contact.name ? `Resp.: ${student.contact.name}` : 'Contato próprio'}
                                        {student.contact.phone ? ` · 📞 ${student.contact.phone}` : ''}
                                      </div>
                                    )}
                                  </td>
                                  <td>
                                    <span className={`cate-badge ${badgeClass}`}>{st.label}</span>
                                    {student.status === 'REJECTED' && student.rejectionReason && (
                                      <div style={{ fontSize: '0.74rem', color: '#b91c1c', marginTop: 2 }}>
                                        {student.rejectionReason}
                                      </div>
                                    )}
                                  </td>
                                  <td>
                                    {student.attendanceRate === null ? (
                                      <span style={{ color: '#94a3b8' }}>—</span>
                                    ) : (
                                      <span className="cate-freq">
                                        <span className="cate-freq__bar">
                                          <span
                                            className={`cate-freq__fill${student.attendanceRate < 60 ? ' cate-freq__fill--low' : ''}`}
                                            style={{ width: `${student.attendanceRate}%`, display: 'block' }}
                                          />
                                        </span>
                                        <span className="cate-freq__num">{student.attendanceRate}%</span>
                                      </span>
                                    )}
                                  </td>
                                  <td>
                                    {student.submittedDocs > 0 ? (
                                      <button
                                        className="cate-mini cate-mini--ok"
                                        onClick={() => openDocuments(student.enrollmentId, student.member.fullName)}
                                      >
                                        📎 Conferir documento{student.submittedDocs > 1 ? 's' : ''} ({student.submittedDocs})
                                      </button>
                                    ) : (
                                      <>
                                        {student.pendingDocuments ? (
                                          <span className="cate-doc-pending">📄 {student.pendingDocuments}</span>
                                        ) : student.docsCount === 0 ? (
                                          <span style={{ color: '#94a3b8' }}>—</span>
                                        ) : null}
                                        {student.docsCount > 0 && (
                                          <button
                                            className="cate-mini"
                                            style={{ marginLeft: student.pendingDocuments ? '0.4rem' : 0 }}
                                            onClick={() => openDocuments(student.enrollmentId, student.member.fullName)}
                                          >
                                            🗂 Histórico ({student.docsCount})
                                          </button>
                                        )}
                                      </>
                                    )}
                                  </td>
                                  <td>
                                    <div className="cate-row-actions">
                                      {student.status === 'PENDING_APPROVAL' && (
                                        <>
                                          <button className="cate-mini cate-mini--ok" onClick={() => handleApprove(student.enrollmentId)}>✓ Aprovar</button>
                                          <button className="cate-mini cate-mini--danger" onClick={() => handleReject(student.enrollmentId)}>Recusar</button>
                                          <button
                                            className="cate-mini"
                                            title="Conversa com a família"
                                            onClick={() => void openChat(student.enrollmentId, student.member.fullName)}
                                          >
                                            💬 Conversa{student.unreadMessages ? ` (${student.unreadMessages})` : ''}
                                          </button>
                                        </>
                                      )}
                                      {(student.status === 'ACTIVE' || student.status === 'COMPLETED') && (
                                        <>
                                          <button className="cate-mini" onClick={() => openAssessments(student.enrollmentId, student.member.fullName)}>
                                            📝 Parecer
                                          </button>
                                          <button className="cate-mini" onClick={() => handleNotifyFamily(student.enrollmentId, student.member.fullName)}>
                                            ✉ Avisar
                                          </button>
                                          <button
                                            className="cate-mini"
                                            title="Conversa com a família"
                                            onClick={() => void openChat(student.enrollmentId, student.member.fullName)}
                                          >
                                            💬 Conversa{student.unreadMessages ? ` (${student.unreadMessages})` : ''}
                                          </button>
                                        </>
                                      )}
                                      {student.status === 'COMPLETED' && (
                                        <button
                                          className="cate-mini"
                                          onClick={() => downloadPdf(`/catechesis/enrollments/${student.enrollmentId}/certificate.pdf`, `certificado_${student.member.fullName.replace(/\s+/g, '_').toLowerCase()}.pdf`)}
                                        >
                                          🎓 Certificado
                                        </button>
                                      )}
                                      {student.status === 'ACTIVE' && (
                                        <>
                                          <button
                                            className="cate-mini"
                                            onClick={() => downloadPdf(`/catechesis/enrollments/${student.enrollmentId}/declaration.pdf`, `declaracao_${student.member.fullName.replace(/\s+/g, '_').toLowerCase()}.pdf`)}
                                          >
                                            📄 Declaração
                                          </button>
                                          <button className="cate-mini cate-mini--ok" onClick={() => handleComplete(student.enrollmentId)}>Concluir</button>
                                          <select
                                            className="cate-select"
                                            defaultValue=""
                                            onChange={(e) => handleTransfer(student.enrollmentId, e.target.value)}
                                          >
                                            <option value="" disabled>Transferir…</option>
                                            {classes.filter((c) => c.id !== selectedClass.id).map((c) => (
                                              <option key={c.id} value={c.id}>{c.name} · {c.year}</option>
                                            ))}
                                          </select>
                                        </>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showStageModal && (
        <div className="module-modal-overlay" onClick={() => setShowStageModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Nova Etapa de Catequese</h2>
            <form onSubmit={handleCreateStage}>
              <div className="form-group">
                <label>Nome *</label>
                <input type="text" required value={stageForm.name} onChange={(e) => setStageForm({ ...stageForm, name: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Ordem</label>
                  <input type="number" value={stageForm.ordering} onChange={(e) => setStageForm({ ...stageForm, ordering: Number(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Sacramento gerado</label>
                  <select value={stageForm.sacramentType} onChange={(e) => setStageForm({ ...stageForm, sacramentType: e.target.value })}>
                    <option value="">Nenhum</option>
                    {Object.entries(SACRAMENT_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Descrição</label>
                <textarea rows={3} value={stageForm.description} onChange={(e) => setStageForm({ ...stageForm, description: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowStageModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Criar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showClassModal && (
        <div className="module-modal-overlay" onClick={() => setShowClassModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Nova Turma</h2>
            <form onSubmit={handleCreateClass}>
              <div className="form-group">
                <label>Nome da turma *</label>
                <input type="text" required value={classForm.name} onChange={(e) => setClassForm({ ...classForm, name: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Ano *</label>
                  <input type="number" required value={classForm.year} onChange={(e) => setClassForm({ ...classForm, year: Number(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Etapa *</label>
                  <select required value={classForm.stageId} onChange={(e) => setClassForm({ ...classForm, stageId: e.target.value })}>
                    <option value="">Selecione</option>
                    {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Comunidade *</label>
                <select required value={classForm.communityId} onChange={(e) => setClassForm({ ...classForm, communityId: e.target.value })}>
                  <option value="">Selecione</option>
                  {communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Dia da semana</label>
                  <select value={classForm.weekday} onChange={(e) => setClassForm({ ...classForm, weekday: e.target.value })}>
                    <option value="">A definir</option>
                    {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Horário</label>
                  <input type="time" value={classForm.time} onChange={(e) => setClassForm({ ...classForm, time: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Sala/local</label>
                  <input type="text" value={classForm.room} onChange={(e) => setClassForm({ ...classForm, room: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Vagas (inscrição online)</label>
                  <input
                    type="number"
                    min={1}
                    placeholder="Sem limite"
                    value={classForm.capacity}
                    onChange={(e) => setClassForm({ ...classForm, capacity: e.target.value })}
                  />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowClassModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Criar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEnrollModal && selectedClass && (
        <div className="module-modal-overlay" onClick={() => setShowEnrollModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Matricular em {selectedClass.name}</h2>
            {selectedClass.capacity != null && (
              <p className={`cate-seats-note ${selectedClass.isFull ? 'is-full' : ''}`}>
                {selectedClass.isFull
                  ? `Turma lotada — ${selectedClass.occupied ?? 0}/${selectedClass.capacity} vagas ocupadas.`
                  : `${selectedClass.openSpots} de ${selectedClass.capacity} vaga${selectedClass.capacity === 1 ? '' : 's'} disponíveis.`}
              </p>
            )}
            <form onSubmit={handleEnroll}>
              <div className="form-group">
                <label>Catequizando (membro) *</label>
                <select required value={enrollForm.memberId} onChange={(e) => setEnrollForm({ ...enrollForm, memberId: e.target.value })}>
                  <option value="">Selecione</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
                </select>
              </div>
              <label className="form-check">
                <input
                  type="checkbox"
                  checked={enrollForm.waiveBaptism}
                  onChange={(e) => setEnrollForm({ ...enrollForm, waiveBaptism: e.target.checked })}
                />
                Dispensar comprovação de Batismo (ex.: etapa de preparação para o próprio Batismo)
              </label>
              {selectedClass.isFull && (
                <label className="form-check">
                  <input
                    type="checkbox"
                    checked={enrollForm.overrideCapacity}
                    onChange={(e) => setEnrollForm({ ...enrollForm, overrideCapacity: e.target.checked })}
                  />
                  Matricular mesmo assim, acima do limite de vagas
                </label>
              )}
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowEnrollModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit" disabled={!!selectedClass.isFull && !enrollForm.overrideCapacity}>
                  Matricular
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditClassModal && selectedClass && (
        <div className="module-modal-overlay" onClick={() => setShowEditClassModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Editar {selectedClass.name}</h2>
            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 0.8rem' }}>
              Etapa e comunidade não mudam aqui (para trocar a etapa, use transferência/renovação).
            </p>
            <form onSubmit={handleUpdateClass}>
              <div className="form-group">
                <label>Nome da turma *</label>
                <input type="text" required value={editClassForm.name} onChange={(e) => setEditClassForm({ ...editClassForm, name: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Ano *</label>
                  <input type="number" required value={editClassForm.year} onChange={(e) => setEditClassForm({ ...editClassForm, year: Number(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Vagas</label>
                  <input
                    type="number"
                    min={1}
                    placeholder="Sem limite"
                    value={editClassForm.capacity}
                    onChange={(e) => setEditClassForm({ ...editClassForm, capacity: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Dia da semana</label>
                  <select value={editClassForm.weekday} onChange={(e) => setEditClassForm({ ...editClassForm, weekday: e.target.value })}>
                    <option value="">A definir</option>
                    {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Horário</label>
                  <input type="time" value={editClassForm.time} onChange={(e) => setEditClassForm({ ...editClassForm, time: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Sala/local</label>
                <input type="text" value={editClassForm.room} onChange={(e) => setEditClassForm({ ...editClassForm, room: e.target.value })} />
              </div>
              <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 0.4rem' }}>
                Deixe as vagas em branco para turma sem limite. O limite vale para a inscrição online e para a matrícula na secretaria.
              </p>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowEditClassModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit" disabled={savingClass}>{savingClass ? 'Salvando…' : 'Salvar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCatechistModal && selectedClass && (
        <div className="module-modal-overlay" onClick={() => setShowCatechistModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Adicionar catequista</h2>
            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 0.8rem' }}>
              Só aparecem membros vinculados à pastoral da Catequese desta comunidade.
            </p>
            <form onSubmit={handleAddCatechist}>
              <div className="form-group">
                <label>Membro *</label>
                {eligibleCatechists === null ? (
                  <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Carregando membros da pastoral...</p>
                ) : eligibleCatechists.length === 0 ? (
                  <p style={{ color: '#d97706', fontSize: '0.9rem' }}>
                    Nenhum membro disponível — vincule os catequistas à pastoral da Catequese na aba Pastorais.
                  </p>
                ) : (
                  <select required value={catechistForm.memberId} onChange={(e) => setCatechistForm({ ...catechistForm, memberId: e.target.value })}>
                    <option value="">Selecione</option>
                    {eligibleCatechists.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
                  </select>
                )}
              </div>
              <div className="form-group">
                <label>Função</label>
                <input type="text" value={catechistForm.role} onChange={(e) => setCatechistForm({ ...catechistForm, role: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowCatechistModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit" disabled={!eligibleCatechists || eligibleCatechists.length === 0}>
                  Adicionar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showSessionModal && selectedClass && (
        <div className="module-modal-overlay" onClick={() => setShowSessionModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Novo encontro</h2>
            <form onSubmit={handleCreateSession}>
              <div className="form-group">
                <label>Data *</label>
                <input type="date" required value={sessionForm.date} onChange={(e) => setSessionForm({ ...sessionForm, date: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Tema</label>
                <input type="text" value={sessionForm.topic} onChange={(e) => setSessionForm({ ...sessionForm, topic: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowSessionModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Registrar e abrir chamada</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {docTarget && (
        <div className="module-modal-overlay" onClick={() => setDocTarget(null)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Documentos · {docTarget.fullName}</h2>
            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 0.8rem' }}>
              Conferir dá baixa na pendência e <strong>apaga o arquivo</strong> (retenção mínima) — fica
              só o registro de quem conferiu e quando.
            </p>
            {docList === null && <div className="loading">Carregando...</div>}
            {docList !== null && docList.length === 0 && (
              <p style={{ color: '#64748b' }}>Nenhum documento enviado ainda.</p>
            )}
            {(docList ?? []).map((doc) => (
              <div
                key={doc.id}
                style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '0.7rem 0.9rem', marginBottom: '0.6rem' }}
              >
                <strong>{doc.kind}</strong>
                <span style={{ color: '#64748b', fontSize: '0.82rem' }}>
                  {' '}· {doc.fileName} · {(doc.sizeBytes / 1024 / 1024).toFixed(1)} MB ·{' '}
                  {new Date(doc.createdAt).toLocaleDateString('pt-BR')}
                </span>
                <div style={{ marginTop: '0.45rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {doc.status === 'SUBMITTED' && (
                    <>
                      <button className="cate-mini" onClick={() => openDocumentFile(doc.id)}>👁 Ver arquivo</button>
                      <button
                        className="cate-mini cate-mini--ok"
                        disabled={reviewingDoc === doc.id}
                        onClick={() => handleReviewDocument(doc.id, true)}
                      >
                        ✓ Conferido (dar baixa)
                      </button>
                      <button
                        className="cate-mini cate-mini--danger"
                        disabled={reviewingDoc === doc.id}
                        onClick={() => handleReviewDocument(doc.id, false)}
                      >
                        Recusar
                      </button>
                    </>
                  )}
                  {doc.status === 'VERIFIED' && (
                    <span className="cate-badge cate-badge--done">
                      Conferido em {doc.reviewedAt ? new Date(doc.reviewedAt).toLocaleDateString('pt-BR') : '—'}
                    </span>
                  )}
                  {doc.status === 'REJECTED' && (
                    <span className="cate-badge cate-badge--out">
                      Recusado{doc.reviewNotes ? ` — ${doc.reviewNotes}` : ''}
                    </span>
                  )}
                </div>
              </div>
            ))}
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setDocTarget(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {showBatchAssessment && selectedClass && report && (
        <div className="module-modal-overlay" onClick={() => setShowBatchAssessment(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h2>Parecer em lote · {selectedClass.name}</h2>
            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 0.8rem' }}>
              O mesmo período, conceito e texto valem para todos os selecionados. Quem já tem parecer
              neste período terá o texto <strong>substituído</strong>. Cada família recebe o aviso do
              próprio catequizando.
            </p>
            <form onSubmit={handleSaveBatchAssessment}>
              <div className="checklist" style={{ maxHeight: 180, overflowY: 'auto', marginBottom: '0.8rem' }}>
                {report.students
                  .filter((student) => student.status === 'ACTIVE' || student.status === 'COMPLETED')
                  .map((student) => (
                    <label key={student.enrollmentId}>
                      <input
                        type="checkbox"
                        checked={!!batchSelection[student.enrollmentId]}
                        onChange={(e) =>
                          setBatchSelection({ ...batchSelection, [student.enrollmentId]: e.target.checked })
                        }
                      />
                      {student.member.fullName}
                      {student.status === 'COMPLETED' ? ' (concluído)' : ''}
                    </label>
                  ))}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Período *</label>
                  <input
                    type="text"
                    required
                    placeholder="1º semestre 2026"
                    value={batchForm.period}
                    onChange={(e) => setBatchForm({ ...batchForm, period: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Conceito</label>
                  <select value={batchForm.rating} onChange={(e) => setBatchForm({ ...batchForm, rating: e.target.value })}>
                    <option value="">Sem conceito</option>
                    {Object.entries(RATING_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Parecer * (o mesmo texto para todos — as famílias veem no app)</label>
                <textarea
                  rows={4}
                  required
                  maxLength={2000}
                  value={batchForm.notes}
                  onChange={(e) => setBatchForm({ ...batchForm, notes: e.target.value })}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowBatchAssessment(false)}>Cancelar</button>
                <button type="submit" className="btn-submit" disabled={savingBatch}>
                  {savingBatch
                    ? 'Salvando...'
                    : `Salvar para ${Object.values(batchSelection).filter(Boolean).length} catequizando(s)`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {assessmentTarget && (
        <div className="module-modal-overlay" onClick={() => setAssessmentTarget(null)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Pareceres · {assessmentTarget.fullName}</h2>
            {assessments.length === 0 && <p style={{ color: '#666' }}>Nenhum parecer registrado ainda.</p>}
            {assessments.map((assessment) => (
              <div key={assessment.id} style={{ borderLeft: '3px solid #0a5cab', padding: '0.4rem 0.8rem', marginBottom: '0.6rem' }}>
                <strong>{assessment.period}</strong>
                {assessment.rating ? ` · ${RATING_LABELS[assessment.rating] ?? assessment.rating}` : ''}
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.92rem' }}>{assessment.notes}</p>
              </div>
            ))}
            <form onSubmit={handleSaveAssessment}>
              <div className="form-row">
                <div className="form-group">
                  <label>Período *</label>
                  <input
                    type="text"
                    required
                    placeholder="1º semestre 2026"
                    value={assessmentForm.period}
                    onChange={(e) => setAssessmentForm({ ...assessmentForm, period: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Conceito</label>
                  <select value={assessmentForm.rating} onChange={(e) => setAssessmentForm({ ...assessmentForm, rating: e.target.value })}>
                    <option value="">Sem conceito</option>
                    {Object.entries(RATING_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Parecer do catequista * (a família vê no app)</label>
                <textarea
                  rows={4}
                  required
                  maxLength={2000}
                  value={assessmentForm.notes}
                  onChange={(e) => setAssessmentForm({ ...assessmentForm, notes: e.target.value })}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setAssessmentTarget(null)}>Fechar</button>
                <button type="submit" className="btn-submit" disabled={savingAssessment}>
                  {savingAssessment ? 'Salvando...' : 'Salvar parecer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showFees && selectedClass && (
        <div className="module-modal-overlay" onClick={() => setShowFees(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
            <h2>Taxas de material · {selectedClass.name}</h2>
            <form onSubmit={handleCreateFee}>
              <div className="form-row">
                <div className="form-group">
                  <label>Descrição *</label>
                  <input
                    type="text"
                    required
                    placeholder="Material 2026"
                    value={feeForm.description}
                    onChange={(e) => setFeeForm({ ...feeForm, description: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Valor (R$) *</label>
                  <input
                    type="number"
                    min={1}
                    step="0.01"
                    required
                    value={feeForm.amount}
                    onChange={(e) => setFeeForm({ ...feeForm, amount: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Vencimento</label>
                  <input type="date" value={feeForm.dueDate} onChange={(e) => setFeeForm({ ...feeForm, dueDate: e.target.value })} />
                </div>
              </div>
              <button type="submit" className="btn-small success">+ Criar taxa (avisa as famílias)</button>
            </form>
            {classFees.length > 0 && (
              <button
                type="button"
                className="btn-small"
                style={{ marginTop: '0.6rem' }}
                onClick={() => downloadCsv(`/catechesis/classes/${selectedClass.id}/fees/export.csv`, `taxas_${selectedClass.name.replace(/\s+/g, '_').toLowerCase()}.csv`)}
              >
                ⬇ Exportar CSV
              </button>
            )}
            {classFees.length === 0 && (
              <p style={{ color: '#666', marginTop: '0.8rem' }}>
                Nenhuma taxa nesta turma — o recurso é opcional e só aparece para as famílias se você criar.
              </p>
            )}
            {classFees.map((fee) => (
              <div key={fee.id} style={{ marginTop: '1rem' }}>
                <h3 style={{ margin: '0 0 0.3rem' }}>
                  {fee.description} · {money(fee.amount)}
                  {fee.dueDate ? ` · vence ${new Date(fee.dueDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}` : ''}
                </h3>
                <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 0.4rem' }}>
                  Arrecadado: <strong>{money(fee.collected)}</strong> · {fee.paidCount} pago(s) ·{' '}
                  {fee.waivedCount} isento(s) · {fee.pendingCount} pendente(s)
                  {fee.othersCount > 0 && (
                    <> · + {money(fee.othersCollected)} de {fee.othersCount} catequizando(s) que saíram da turma</>
                  )}
                </p>
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Catequizando</th>
                        <th>Situação</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fee.students.map((student) => (
                        <tr key={student.enrollmentId}>
                          <td>{student.fullName}</td>
                          <td>
                            {student.status === 'PAID' && (
                              <span className="status-badge green">
                                Pago {student.method ? `(${student.method})` : ''}
                              </span>
                            )}
                            {student.status === 'WAIVED' && <span className="status-badge gray">Isento</span>}
                            {student.status === 'PENDING' && <span className="status-badge yellow">Pendente</span>}
                          </td>
                          <td className="actions-cell">
                            {student.status === 'PENDING' && (
                              <>
                                <button className="btn-small success" onClick={() => handleFeePayment(fee.id, student.enrollmentId, false)}>
                                  Registrar pagamento
                                </button>
                                <button className="btn-small" onClick={() => handleFeePayment(fee.id, student.enrollmentId, true)}>
                                  Isentar
                                </button>
                              </>
                            )}
                            {student.status === 'PAID' && student.paymentId && (
                              <button
                                className="btn-small"
                                onClick={() => downloadPdf(`/catechesis/fees/payments/${student.paymentId}/receipt.pdf`, `recibo_${student.fullName.replace(/\s+/g, '_').toLowerCase()}.pdf`)}
                              >
                                🧾 Recibo
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setShowFees(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {showAgendaModal && selectedClass && (
        <div className="module-modal-overlay" onClick={() => setShowAgendaModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Gerar agenda do ano · {selectedClass.name}</h2>
            <p style={{ fontSize: '0.9rem', color: '#666' }}>
              Todos os encontros de{' '}
              <strong>
                {selectedClass.weekday !== null && selectedClass.weekday !== undefined
                  ? WEEKDAYS[selectedClass.weekday]
                  : 'dia a definir'}
              </strong>{' '}
              no período. Feriados nacionais já vêm identificados e desmarcados (remarque se
              houver encontro); desmarque também os recessos da paróquia — as famílias recebem um
              único aviso-resumo.
            </p>
            <div className="form-row">
              <div className="form-group">
                <label>Início *</label>
                <input type="date" value={agendaRange.from} onChange={(e) => { setAgendaRange({ ...agendaRange, from: e.target.value }); setAgendaDates({}); }} />
              </div>
              <div className="form-group">
                <label>Fim *</label>
                <input type="date" value={agendaRange.to} onChange={(e) => { setAgendaRange({ ...agendaRange, to: e.target.value }); setAgendaDates({}); }} />
              </div>
            </div>
            <button type="button" className="btn-small" onClick={buildAgendaPreview}>Gerar prévia</button>
            {Object.keys(agendaDates).length > 0 && (
              <div className="checklist" style={{ maxHeight: 260, overflowY: 'auto', marginTop: '0.75rem' }}>
                {Object.keys(agendaDates).sort().map((date) => {
                  const holiday = holidayLabel(date);
                  return (
                    <label key={date}>
                      <input
                        type="checkbox"
                        checked={agendaDates[date]}
                        onChange={(e) => setAgendaDates({ ...agendaDates, [date]: e.target.checked })}
                      />
                      {new Date(date).toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
                      {holiday && (
                        <span style={{ color: '#b05a12', fontWeight: 600 }}> — 🎉 {holiday}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setShowAgendaModal(false)}>Cancelar</button>
              {Object.keys(agendaDates).length > 0 && (
                <button type="button" className="btn-submit" disabled={generatingAgenda} onClick={handleGenerateAgenda}>
                  {generatingAgenda
                    ? 'Criando...'
                    : `Criar ${Object.values(agendaDates).filter(Boolean).length} encontro(s)`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {renewal && selectedClass && (
        <div className="module-modal-overlay" onClick={() => setRenewal(null)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Renovar turma · {selectedClass.name}</h2>
            {!renewal.nextStage ? (
              <p>
                Esta é a última etapa do itinerário ({renewal.stage.name}) — não há próxima etapa
                cadastrada para renovar.
              </p>
            ) : renewal.targetClasses.length === 0 ? (
              <p>
                Próxima etapa: <strong>{renewal.nextStage.name}</strong>. Nenhuma turma ativa dessa
                etapa nesta comunidade — crie a turma do próximo ano antes de renovar.
              </p>
            ) : renewal.students.length === 0 ? (
              <p>Nenhum catequizando concluído nesta turma para renovar.</p>
            ) : (
              <>
                <div className="form-group">
                  <label>Turma de destino ({renewal.nextStage.name}) *</label>
                  <select value={renewalTarget} onChange={(e) => setRenewalTarget(e.target.value)}>
                    {renewal.targetClasses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.year}
                        {c.capacity !== null ? ` (${c.capacity} vagas)` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="checklist">
                  {renewal.students.map((s) => (
                    <label key={s.enrollmentId}>
                      <input
                        type="checkbox"
                        checked={!!renewalSelection[s.enrollmentId]}
                        onChange={(e) =>
                          setRenewalSelection({ ...renewalSelection, [s.enrollmentId]: e.target.checked })
                        }
                      />
                      {s.member.fullName}
                      {s.missingDocuments ? ` — 📄 falta: ${s.missingDocuments}` : ''}
                    </label>
                  ))}
                </div>
              </>
            )}
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setRenewal(null)}>Fechar</button>
              {renewal.nextStage && renewal.targetClasses.length > 0 && renewal.students.length > 0 && (
                <button type="button" className="btn-submit" disabled={renewing} onClick={handleRenew}>
                  {renewing ? 'Renovando...' : 'Renovar selecionados'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {chatTarget && (
        <div className="module-modal-overlay" onClick={() => setChatTarget(null)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <h2>💬 Conversa · {chatTarget.fullName}</h2>
            <p style={{ fontSize: '0.82rem', color: '#666', margin: '0 0 0.6rem' }}>
              Só a família e a equipe da turma leem esta conversa. Tudo fica registrado.
            </p>
            {chatThread === null && <div className="loading">Carregando...</div>}
            {chatThread && (
              <div className="cate-chat">
                {chatThread.messages.length === 0 && (
                  <p style={{ color: '#888', textAlign: 'center', margin: '1rem 0' }}>Nenhuma mensagem ainda — escreva a primeira.</p>
                )}
                {chatThread.messages.map((message) => (
                  <div key={message.id} className={`cate-chat__msg${message.fromTeam ? ' cate-chat__msg--team' : ''}`}>
                    <div className="cate-chat__bubble">
                      <span className="cate-chat__author">
                        {message.fromTeam ? `Equipe · ${message.authorName}` : `Família · ${message.authorName}`}
                      </span>
                      <p>{message.body}</p>
                      <span className="cate-chat__time">
                        {new Date(message.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        {message.fromTeam && message.readAt ? ' · lida' : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {chatThread && chatThread.canWrite && (
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
                <input
                  type="text"
                  maxLength={1000}
                  placeholder="Escreva para a família..."
                  style={{ flex: 1 }}
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendChat();
                    }
                  }}
                />
                <button type="button" className="btn-submit" disabled={sendingChat || !chatText.trim()} onClick={() => void sendChat()}>
                  {sendingChat ? '...' : 'Enviar'}
                </button>
              </div>
            )}
            {chatThread && !chatThread.canWrite && (
              <p style={{ fontSize: '0.82rem', color: '#888' }}>Matrícula encerrada — conversa somente para leitura.</p>
            )}
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setChatTarget(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {showTopicsModal && selectedClass && (
        <div className="module-modal-overlay" onClick={() => setShowTopicsModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680 }}>
            <h2>Planejar temas · {selectedClass.name}</h2>
            <div className="cate-topics__head">
              <p className="cate-topics__hint">
                Defina o tema de cada encontro futuro — as famílias veem na agenda da turma.
              </p>
              <span className="cate-topics__count">
                {Object.values(topicsDraft).filter((topic) => topic.trim()).length} de {Object.keys(topicsDraft).length} definidos
              </span>
            </div>
            <div className="cate-topics">
              {sessions
                .filter((session) => session.id in topicsDraft)
                .slice()
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((session, index) => {
                  const date = new Date(session.date);
                  const filled = (topicsDraft[session.id] ?? '').trim().length > 0;
                  return (
                    <label key={session.id} className={`cate-topics__row${filled ? ' is-filled' : ''}${index === 0 ? ' is-next' : ''}`}>
                      <span className="cate-topics__date">
                        <strong>{date.toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit' })}</strong>
                        <small>
                          {date.toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'short' }).replace('.', '')}
                          {index === 0 ? ' · próximo' : ''}
                        </small>
                      </span>
                      <input
                        type="text"
                        maxLength={120}
                        placeholder="Tema do encontro"
                        value={topicsDraft[session.id]}
                        onChange={(e) => setTopicsDraft({ ...topicsDraft, [session.id]: e.target.value })}
                      />
                      <span className="cate-topics__check" aria-hidden="true">✓</span>
                    </label>
                  );
                })}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setShowTopicsModal(false)}>Cancelar</button>
              <button type="button" className="btn-submit" disabled={savingTopics} onClick={() => void handleSaveTopics()}>
                {savingTopics ? 'Salvando...' : 'Salvar temas'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSentNotices && selectedClass && (
        <div className="module-modal-overlay" onClick={() => setShowSentNotices(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h2>Avisos enviados · {selectedClass.name}</h2>
            {sentNotices === null && <div className="loading">Carregando...</div>}
            {sentNotices && sentNotices.length === 0 && (
              <p style={{ color: '#666' }}>Nenhum aviso enviado às famílias ainda.</p>
            )}
            {sentNotices && sentNotices.length > 0 && (
              <div className="checklist" style={{ maxHeight: 420, overflowY: 'auto' }}>
                {sentNotices.map((notice, index) => (
                  <div key={index} style={{ padding: '0.5rem 0', borderBottom: '1px solid #eee' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem' }}>
                      <strong style={{ fontSize: '0.9rem' }}>{notice.title}</strong>
                      <span style={{ fontSize: '0.78rem', color: '#888', whiteSpace: 'nowrap' }}>
                        {new Date(notice.sentAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{notice.body}</p>
                    <span style={{ fontSize: '0.75rem', color: '#999' }}>
                      {notice.kind === 'family-message' ? 'aviso individual' : notice.kind === 'agenda' ? 'agenda publicada' : notice.kind === 'session-moved' ? 'remarcação' : 'aviso da turma'}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setShowSentNotices(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {attendanceSessionId && (
        <div className="module-modal-overlay" onClick={closeAttendance}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>
              Chamada
              {attendanceMeta
                ? ` · ${new Date(attendanceMeta.date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}${attendanceMeta.topic ? ` — ${attendanceMeta.topic}` : ''}`
                : ' do encontro'}
            </h2>
            {lastMarked && (
              <p style={{ fontSize: '0.82rem', color: '#666', margin: '0 0 0.5rem' }}>
                Última chamada{lastMarked.byName ? ` por ${lastMarked.byName}` : ''} em{' '}
                {new Date(lastMarked.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
            <div className="checklist">
              {Object.keys(attendance).length === 0 && <p>Nenhum catequizando ativo para a chamada.</p>}
              {(report?.students ?? [])
                .filter((s) => s.enrollmentId in attendance)
                .map((s) => {
                  const mark = attendance[s.enrollmentId];
                  const color =
                    mark === 'present' ? '#15803d' : mark === 'late' ? '#b45309' : mark === 'absent' ? '#b91c1c' : '#64748b';
                  return (
                    <div key={s.enrollmentId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', padding: '0.3rem 0' }}>
                      <span>{s.member.fullName}</span>
                      <button
                        type="button"
                        className="cate-mini"
                        style={{ color, borderColor: color, minWidth: 110 }}
                        onClick={() => setAttendance({ ...attendance, [s.enrollmentId]: nextMark(mark) })}
                      >
                        {MARK_LABEL[mark]}
                      </button>
                    </div>
                  );
                })}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={closeAttendance}>Fechar sem salvar</button>
              <button type="button" className="btn-submit" onClick={handleSaveAttendance}>Salvar chamada</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CatechesisPage;

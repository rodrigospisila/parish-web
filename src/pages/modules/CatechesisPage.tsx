import React, { useState, useEffect, useCallback, useRef } from 'react';
import TitleIcon from '../../components/TitleIcon';
import RoomSelect from '../../components/RoomSelect';
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
  /** Cor do "tempo" (hex), exibida em cards e listas */
  color?: string | null;
}

/** Paleta sugerida para as etapas (a planilha da paróquia usa cores por tempo) */
const STAGE_COLORS = ['#eab308', '#3b82f6', '#10b981', '#8b5cf6', '#f97316', '#0ea5e9', '#dc2626', '#64748b'];

interface CatechesisClass {
  id: string;
  name: string;
  year: number;
  weekday?: number | null;
  time?: string | null;
  room?: string | null;
  status?: string;
  stage: { name: string; sacramentType?: string | null; color?: string | null };
  communityId?: string;
  community: { name: string };
  _count: { enrollments: number; sessions: number };
  /** Limite de vagas (null = sem limite) */
  capacity?: number | null;
  /** Ocupação = matriculados ativos + inscrições aguardando aprovação */
  occupied?: number;
  openSpots?: number | null;
  isFull?: boolean;
  /** Matrículas concluídas — 0 efetivos + N concluídos = turma "Concluída" */
  completedCount?: number;
  /** Inscrições online: chave geral + janela opcional */
  enrollmentOpen?: boolean;
  enrollmentOpensAt?: string | null;
  enrollmentClosesAt?: string | null;
  /** Turma cheia: fila de espera ou bloqueio */
  fullBehavior?: 'WAITLIST' | 'BLOCK';
  /** Pendências acionáveis: inscrições aguardando/fila e docs para conferir */
  pendingApprovalCount?: number;
  docsToReviewCount?: number;
}

/** Total de pendências acionáveis da turma (badge/filtro da lista). */
const classAttention = (klass: CatechesisClass): number =>
  (klass.pendingApprovalCount ?? 0) + (klass.docsToReviewCount ?? 0);

/** Inscrições online desta turma estão abertas agora? (espelha o backend) */
const enrollmentWindowOpen = (klass: CatechesisClass): boolean => {
  if (klass.enrollmentOpen === false) return false;
  const now = Date.now();
  if (klass.enrollmentOpensAt && now < new Date(klass.enrollmentOpensAt).getTime()) return false;
  if (klass.enrollmentClosesAt && now > new Date(klass.enrollmentClosesAt).getTime()) return false;
  return true;
};

/** Badge do estado das inscrições na lista/cards — nada em turma concluída
 * (ruído histórico) e "abrem em DD/MM" quando a janela é futura. */
const enrollmentBadge = (klass: CatechesisClass): { label: string; title: string } | null => {
  const concluded = (klass.occupied ?? klass._count.enrollments) === 0 && (klass.completedCount ?? 0) > 0;
  if (concluded || enrollmentWindowOpen(klass)) return null;
  if (klass.enrollmentOpen !== false && klass.enrollmentOpensAt && Date.now() < new Date(klass.enrollmentOpensAt).getTime()) {
    const opens = new Date(klass.enrollmentOpensAt).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
    return { label: `inscrições abrem ${opens}`, title: 'A turma aparece na inscrição do app a partir dessa data' };
  }
  return { label: 'inscrições fechadas', title: 'A turma não aparece na inscrição do app — reabra em Editar turma' };
};

interface ClassReport {
  catechists: Array<{ memberId: string; fullName: string; role: string }>;
  total: number;
  active: number;
  dropouts: number;
  completed: number;
  pending: number;
  /** Fila de espera (turma cheia) — aceite abre +1 vaga */
  waitlisted?: number;
  students: Array<{
    enrollmentId: string;
    member: { id: string; fullName: string };
    status: string;
    pendingDocuments?: string | null;
    rejectionReason?: string | null;
    /** Fila de espera: posição por ordem de entrada (1 = próximo) */
    waitlistPosition?: number | null;
    /** Catecumenato: ainda não batizado — 1 ano de catequese antes do Batismo */
    unbaptized?: boolean;
    baptismSince?: string | null;
    baptismReady?: boolean;
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
  /** Notificação criada para o outro lado (tick duplo; azul quando readAt) */
  deliveredAt?: string | null;
}

interface ChatThread {
  enrollmentId: string;
  isTeam: boolean;
  student: string;
  className: string;
  canWrite: boolean;
  messages: ChatMessage[];
}

interface AttendanceGridMark {
  sessionId: string;
  enrollmentId: string;
  present: boolean;
  late: boolean;
  justified: boolean;
  hasCertificate: boolean;
}

interface AttendanceGridData {
  classId: string;
  sessions: Array<{ id: string; date: string; topic?: string | null }>;
  students: Array<{ enrollmentId: string; status: string; member: { id: string; fullName: string } }>;
  marks: AttendanceGridMark[];
}

interface EnrollmentDocument {
  id: string;
  kind: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: 'SUBMITTED' | 'VERIFIED' | 'REJECTED';
  /** Declaração sem arquivo: não tem o documento / batismo de outra denominação */
  declaration?: 'NOT_HAVE' | 'OTHER_DENOMINATION' | null;
  denomination?: string | null;
  /** Conferência automática (IA) — apoio, a decisão é da equipe */
  autoCheckStatus?: 'MATCH' | 'MISMATCH' | 'UNREADABLE' | 'SKIPPED' | null;
  autoCheckNotes?: string | null;
  /** O que foi LIDO do documento — base do "corrigir cadastro" */
  extractedName?: string | null;
  extractedBirthDate?: string | null;
  /** O binário ainda está armazenado? (aceitos ficam; recusados/antigos não) */
  hasFile?: boolean;
  reviewNotes?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

interface DocRequirement {
  id?: string | null;
  kind: string;
  required: boolean;
  allowNotHave: boolean;
  allowOtherDenomination: boolean;
  isDefault?: boolean;
}

interface RenewalTargetClass {
  id: string;
  name: string;
  year: number;
  weekday?: number | null;
  time?: string | null;
  room?: string | null;
  capacity: number | null;
  /** Vagas reais: ativos + aguardando aprovação (mesmo número que a matrícula confere) */
  occupied: number;
  openSpots: number | null;
  isFull: boolean;
}

interface RenewalPreview {
  classId: string;
  stage: { id: string; name: string; color?: string | null };
  nextStage: { id: string; name: string; sacramentType?: string | null; color?: string | null } | null;
  targetClasses: RenewalTargetClass[];
  students: Array<{
    enrollmentId: string;
    member: { id: string; fullName: string };
    eligible: boolean;
    /** Catecúmeno em preparação para o Batismo (sem certidão a cobrar) */
    unbaptized?: boolean;
    missingDocuments: string | null;
    /** Já realocado: matrícula efetiva em outra turma (progresso da virada);
     * de outra paróquia vem sem nome (LGPD) — só outsideParish */
    alreadyEnrolledIn?: { classId?: string; className?: string; year?: number; status: string; outsideParish?: boolean } | null;
  }>;
}

interface YearEndRow {
  classId: string;
  name: string;
  year: number;
  stage: { id: string; name: string; color?: string | null; ordering: number; sacramentType?: string | null };
  active: number;
  completed: number;
  relocated: number;
  toRelocate: number;
  /** A sucessora (mesma etapa, ano seguinte) já foi criada? */
  hasNextYearClass?: boolean;
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
  WAITLISTED: 'cate-badge--waiting',
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
  WAITLISTED: { label: 'Fila de espera', color: 'yellow' },
  REJECTED: { label: 'Não aprovada', color: 'red' },
};

// Visão padrão da tabela de catequizandos: quem está NA turma hoje — ativos,
// concluídos e inscrições aguardando aprovação (estas pedem ação da equipe).
// Transferidos/não aprovados/desistentes só em "Todas".
const CURRENT_ENROLLMENT_STATUSES = ['ACTIVE', 'COMPLETED', 'PENDING_APPROVAL', 'WAITLISTED'];

const CatechesisPage: React.FC = () => {
  const { user } = useAuth();
  const isDiocesan = user?.role === 'DIOCESAN_ADMIN' || user?.role === 'SYSTEM_ADMIN';
  const [tab, setTab] = useState<'classes' | 'stages' | 'diocese' | 'panorama' | 'encerramento'>('classes');
  const [loading, setLoading] = useState(true);
  const [stages, setStages] = useState<Stage[]>([]);
  const [classes, setClasses] = useState<CatechesisClass[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [selectedClass, setSelectedClass] = useState<CatechesisClass | null>(null);
  const [report, setReport] = useState<ClassReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const [showStageModal, setShowStageModal] = useState(false);
  const [stageForm, setStageForm] = useState({ name: '', description: '', ordering: 0, sacramentType: '', color: '' });

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

  // Filtro da tabela de catequizandos (padrão: só quem está na turma)
  const [studentsFilter, setStudentsFilter] = useState<'current' | 'active' | 'completed' | 'all'>('current');

  // Turmas em cards ou lista (preferência lembrada neste navegador)
  const [classesView, setClassesView] = useState<'cards' | 'list'>(() => {
    try {
      return localStorage.getItem('cate-classes-view') === 'list' ? 'list' : 'cards';
    } catch {
      return 'cards';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('cate-classes-view', classesView);
    } catch {
      // navegação privada: segue sem lembrar
    }
  }, [classesView]);

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
    enrollmentOpen: true,
    enrollmentOpensAt: '',
    enrollmentClosesAt: '',
    fullBehavior: 'WAITLIST' as 'WAITLIST' | 'BLOCK',
  });

  // Board de distribuição (renovação multi-destino): rascunho 100% no cliente,
  // commit por coluna via POST /renew existente — nada é gravado até Confirmar
  const [renewal, setRenewal] = useState<RenewalPreview | null>(null);
  const [renewalSelection, setRenewalSelection] = useState<Record<string, boolean>>({});
  /** enrollmentId → turma destino escolhida no rascunho */
  const [renewalDraft, setRenewalDraft] = useState<Record<string, string>>({});
  /** Pilha de movimentos para o Desfazer (cada entrada = um lote movido;
   * `prev` guarda, por card, a coluna de onde ele saiu — null = origem) */
  const [draftMoves, setDraftMoves] = useState<Array<{ enrollmentIds: string[]; targetClassId: string | null; prev: Record<string, string | null> }>>([]);
  // Drag and drop nativo: os ids em voo ficam num ref (dataTransfer não é
  // legível durante o dragover) e o destaque da coluna sob o cursor em estado
  const dragIdsRef = useRef<string[]>([]);
  const dragGhostRef = useRef<HTMLElement | null>(null);
  const [draggingIds, setDraggingIds] = useState<string[]>([]);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  /** Gravados nesta sessão do board quando a prévia não recarregou (falha
   * parcial): render trata como "já realocado" para não parecer pendente */
  const [placedLocalIds, setPlacedLocalIds] = useState<Record<string, string>>({});
  const boardRef = useRef<HTMLDivElement | null>(null);
  // Board aberto: o foco entra no overlay — sem isso, Tab continuava nos
  // controles invisíveis atrás da tela cheia
  const boardOpen = renewal !== null;
  useEffect(() => {
    if (boardOpen) boardRef.current?.focus();
  }, [boardOpen]);
  /** Colunas onde a coordenação confirmou passar do limite (auditado no backend) */
  const [overrideColumns, setOverrideColumns] = useState<Record<string, boolean>>({});
  const [columnStatus, setColumnStatus] = useState<Record<string, 'saving' | 'ok' | 'error'>>({});
  const [renewing, setRenewing] = useState(false);

  // Conclusão em lote: uma data e um ministro para a turma toda
  const [showBatchComplete, setShowBatchComplete] = useState(false);
  const [batchCompleteSelection, setBatchCompleteSelection] = useState<Record<string, boolean>>({});
  const [batchCompleteForm, setBatchCompleteForm] = useState({ date: '', minister: '' });
  const [savingBatchComplete, setSavingBatchComplete] = useState(false);

  // Painel "Encerramento do ano" (concluir → distribuir, por comunidade)
  const [yearEndRows, setYearEndRows] = useState<YearEndRow[] | null>(null);
  const [yearEndLoading, setYearEndLoading] = useState(false);
  const [yearEndCommunityId, setYearEndCommunityId] = useState('');
  const yearEndSeq = useRef(0);

  // Filtros por ano: lista de turmas, painel de encerramento e destino do board
  const [classesYearFilter, setClassesYearFilter] = useState<'all' | number>('all');
  // Só turmas com pendência acionável (o Início conta, aqui mostra ONDE)
  const [classesAttentionOnly, setClassesAttentionOnly] = useState(false);
  const [yearEndYearFilter, setYearEndYearFilter] = useState<'all' | number>('all');
  const [boardYearFilter, setBoardYearFilter] = useState<'all' | number>('all');

  // Virada de ano da turma: criar a sucessora (mesma etapa, ano seguinte)
  const [rolloverSource, setRolloverSource] = useState<CatechesisClass | null>(null);
  const [rolloverForm, setRolloverForm] = useState({ year: '', name: '', weekday: '', time: '', room: '', capacity: '' });
  // null = carregando os catequistas atuais
  const [rolloverCatechists, setRolloverCatechists] = useState<Array<{ memberId: string; fullName: string; role: string }> | null>(null);
  const [rolloverKeep, setRolloverKeep] = useState<Record<string, boolean>>({});
  const [savingRollover, setSavingRollover] = useState(false);
  // Só a resposta do ÚLTIMO openRollover vale (modal trocado/cancelado no meio)
  const rolloverSeq = useRef(0);

  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [enrollForm, setEnrollForm] = useState({ memberId: '', waiveBaptism: false, overrideCapacity: false, unbaptized: false });

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
  // Requisitos de documentos da turma (no modal da matrícula e na configuração)
  const [docReqs, setDocReqs] = useState<DocRequirement[] | null>(null);
  const [docReqsError, setDocReqsError] = useState(false);
  const [showDocReqModal, setShowDocReqModal] = useState(false);
  const [docReqItems, setDocReqItems] = useState<DocRequirement[]>([]);
  const [loadingDocReq, setLoadingDocReq] = useState(false);
  const [savingDocReq, setSavingDocReq] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const docFileInputRef = useRef<HTMLInputElement | null>(null);
  const docUploadKindRef = useRef<string>('');

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
  // Seção Encontros recolhível: minimizada mostra só o resumo — preferência lembrada
  const [sessionsCollapsed, setSessionsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('cate:sessionsCollapsed') !== 'no';
    } catch {
      return true;
    }
  });
  const [sessionsFilter, setSessionsFilter] = useState<'all' | 'open' | 'done'>('all');
  // Quantos cards cabem numa linha do grid (medido do layout real; 6 é chute
  // inicial até a primeira medição) — recolhido renderiza SÓ a 1ª linha
  const sessionsGridRef = useRef<HTMLDivElement | null>(null);
  const [sessionsPerRow, setSessionsPerRow] = useState(6);
  useEffect(() => {
    const el = sessionsGridRef.current;
    if (!el) return;
    const measure = () => {
      const cols = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length;
      if (cols > 0) setSessionsPerRow(cols);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [selectedClass?.id, sessions.length]);
  const toggleSessionsCollapsed = () => {
    setSessionsCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem('cate:sessionsCollapsed', next ? 'yes' : 'no');
      } catch {
        // sem storage (modo privado etc.) a preferência só não persiste
      }
      return next;
    });
  };
  // Folha de presença (grade alunos × encontros)
  const [gridData, setGridData] = useState<AttendanceGridData | null>(null);
  const [gridSavingCells, setGridSavingCells] = useState<Record<string, boolean>>({});
  const gridCertInputRef = useRef<HTMLInputElement | null>(null);
  const gridCertTargetRef = useRef<{ sessionId: string; enrollmentId: string } | null>(null);
  const [chatTarget, setChatTarget] = useState<{ enrollmentId: string; fullName: string } | null>(null);
  const [chatThread, setChatThread] = useState<ChatThread | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatMessageCount = chatThread?.messages.length ?? 0;
  // Conversa aberta/nova mensagem: rola para o fim (as recentes ficam embaixo)
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessageCount]);
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

  const openClassDetail = async (klass: CatechesisClass): Promise<ClassReport | null> => {
    setSelectedClass(klass);
    setStudentsFilter('current');
    // Limpa o report da turma ANTERIOR já — handlers que leem `report` durante
    // o carregamento não podem operar com a equipe/lista de outra turma
    setReport(null);
    setSessions([]);
    setReportLoading(true);
    try {
      const [reportRes, sessionsRes] = await Promise.all([
        api.get(`/catechesis/classes/${klass.id}/report`),
        api.get(`/catechesis/classes/${klass.id}/sessions`),
      ]);
      setReport(reportRes.data);
      setSessions(sessionsRes.data ?? []);
      return reportRes.data as ClassReport;
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar o relatório da turma'));
      setReport(null);
      setSessions([]);
      return null;
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

  // Refresh CIRÚRGICO: só a lista de turmas (ocupação/vagas), sem rebaixar a
  // tela inteira — o fetchData completo refazia GET /members (a comunidade
  // toda, 400+) a cada ação em série na turma
  const refreshClassesOnly = useCallback(async (): Promise<CatechesisClass[] | null> => {
    try {
      const res = await api.get('/catechesis/classes');
      setClasses(res.data);
      return res.data as CatechesisClass[];
    } catch {
      // silencioso — a lista atual continua na tela
      return null;
    }
  }, []);

  const refreshDetail = async () => {
    if (selectedClass) await openClassDetail(selectedClass);
    void refreshClassesOnly();
  };

  // Cor da etapa direto na tabela (um clique por bolinha — PATCH imediato)
  const handleStageColor = async (stageId: string, color: string | null) => {
    try {
      await api.patch(`/catechesis/stages/${stageId}`, { color });
      setStages((prev) => prev.map((s) => (s.id === stageId ? { ...s, color } : s)));
      // recarrega as turmas para os cards/lista refletirem a cor nova
      void refreshClassesOnly();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao salvar a cor da etapa'));
    }
  };

  const handleCreateStage = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/catechesis/stages', {
        name: stageForm.name,
        description: stageForm.description || undefined,
        ordering: Number(stageForm.ordering) || 0,
        sacramentType: stageForm.sacramentType || undefined,
        color: stageForm.color || undefined,
      });
      notify.success('Etapa criada com sucesso!');
      setShowStageModal(false);
      setStageForm({ name: '', description: '', ordering: 0, sacramentType: '', color: '' });
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
      enrollmentOpen: selectedClass.enrollmentOpen !== false,
      enrollmentOpensAt: selectedClass.enrollmentOpensAt ? selectedClass.enrollmentOpensAt.slice(0, 10) : '',
      enrollmentClosesAt: selectedClass.enrollmentClosesAt ? selectedClass.enrollmentClosesAt.slice(0, 10) : '',
      fullBehavior: selectedClass.fullBehavior === 'BLOCK' ? 'BLOCK' : 'WAITLIST',
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
        enrollmentOpen: editClassForm.enrollmentOpen,
        enrollmentOpensAt: editClassForm.enrollmentOpensAt || null,
        enrollmentClosesAt: editClassForm.enrollmentClosesAt || null,
        fullBehavior: editClassForm.fullBehavior,
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
        ...(enrollForm.unbaptized ? { unbaptized: true } : {}),
      });
      notify.success('Catequizando matriculado!');
      setShowEnrollModal(false);
      setEnrollForm({ memberId: '', waiveBaptism: false, overrideCapacity: false, unbaptized: false });
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

  const handleTransfer = async (enrollmentId: string, targetClassId: string, fullName: string) => {
    if (!targetClassId) return;
    const target = classes.find((c) => c.id === targetClassId);
    // O select executava no primeiro clique, sem volta — confirmação nomeando
    // aluno e turma evita a transferência acidental
    if (
      !window.confirm(
        `Transferir ${fullName} para a ${target ? `${target.name} (${target.year})` : 'turma escolhida'}? A matrícula atual fica como "Transferido" (o histórico é preservado).`,
      )
    ) {
      return;
    }
    try {
      await api.patch(`/catechesis/enrollments/${enrollmentId}/transfer`, { targetClassId });
      notify.success('Matrícula transferida!');
      refreshDetail();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao transferir matrícula'));
    }
  };

  /** Concluídos aplicados na tela SEM refetch: status/contadores do report e a
   * ocupação da turma na lista (concluído libera vaga — occupied conta só
   * ativos + aguardando). */
  const applyCompletionLocally = (enrollmentIds: string[]) => {
    const idSet = new Set(enrollmentIds);
    // Contado a partir do estado ATUAL (fora do updater — o updater só roda no
    // próximo render, e o setClasses abaixo precisa do número agora)
    const freed = (report?.students ?? []).filter((s) => idSet.has(s.enrollmentId) && s.status === 'ACTIVE').length;
    setReport((current) => {
      if (!current) return current;
      const students = current.students.map((s) =>
        idSet.has(s.enrollmentId) && s.status === 'ACTIVE' ? { ...s, status: 'COMPLETED' } : s,
      );
      return {
        ...current,
        students,
        active: students.filter((s) => s.status === 'ACTIVE').length,
        completed: students.filter((s) => s.status === 'COMPLETED').length,
      };
    });
    if (selectedClass) {
      const classId = selectedClass.id;
      setClasses((prev) =>
        prev.map((klass) => {
          if (klass.id !== classId || klass.occupied === undefined) return klass;
          const occupied = Math.max(0, klass.occupied - freed);
          return {
            ...klass,
            occupied,
            openSpots: klass.capacity == null ? null : Math.max(0, klass.capacity - occupied),
            isFull: klass.capacity != null && occupied >= klass.capacity,
            _count: { ...klass._count, enrollments: Math.max(0, klass._count.enrollments - freed) },
          };
        }),
      );
    }
  };

  const handleComplete = async (enrollmentId: string, fullName: string) => {
    const generatesSacrament = selectedClass?.stage.sacramentType
      ? SACRAMENT_LABELS[selectedClass.stage.sacramentType] ?? selectedClass.stage.sacramentType
      : null;
    // Um clique criava sacramento permanente sem confirmação (e não há
    // exclusão no módulo) — confirmar explicitando o efeito
    const message = generatesSacrament
      ? `Concluir a etapa para ${fullName}? O sacramento ${generatesSacrament} será registrado na ficha (data de hoje — para outra data, use "Concluir turma").`
      : `Concluir a etapa para ${fullName}?`;
    if (!window.confirm(message)) return;
    try {
      await api.patch(`/catechesis/enrollments/${enrollmentId}/complete`, {});
      notify.success('Etapa concluída — sacramento registrado quando aplicável!');
      applyCompletionLocally([enrollmentId]);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao concluir matrícula'));
    }
  };

  const openBatchComplete = (reportArg?: ClassReport | null) => {
    // null EXPLÍCITO = o report da turma-alvo falhou ao carregar; cair no
    // report do closure abriria o lote com a seleção da turma ANTERIOR
    const source = reportArg !== undefined ? reportArg : report;
    if (!source) return;
    const selection: Record<string, boolean> = {};
    source.students
      .filter((student) => student.status === 'ACTIVE')
      .forEach((student) => {
        selection[student.enrollmentId] = true;
      });
    setBatchCompleteSelection(selection);
    // Data de hoje (dia civil local) como padrão — editável para lançamentos retroativos
    const now = new Date();
    const todayIso = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10);
    setBatchCompleteForm({ date: todayIso, minister: '' });
    setShowBatchComplete(true);
  };

  const handleBatchComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClass) return;
    const enrollmentIds = Object.entries(batchCompleteSelection)
      .filter(([, checked]) => checked)
      .map(([id]) => id);
    if (!enrollmentIds.length) {
      notify.error('Selecione ao menos um catequizando');
      return;
    }
    setSavingBatchComplete(true);
    try {
      const res = await api.post(`/catechesis/classes/${selectedClass.id}/complete-batch`, {
        enrollmentIds,
        date: batchCompleteForm.date || undefined,
        minister: batchCompleteForm.minister.trim() || undefined,
      });
      const { completed, sacraments, skipped, aborted, remaining } = res.data as {
        completed: number;
        sacraments: number;
        skipped: Array<{ enrollmentId: string; member: string | null; reason: string }>;
        aborted?: boolean;
        remaining?: string[];
      };
      notify.success(
        `${completed} conclusão(ões) registrada(s)${sacraments ? ` · ${sacraments} sacramento(s)` : ''}${skipped.length ? ` · ${skipped.length} pulada(s)` : ''}.`,
      );
      if (skipped.length) {
        notify.warning(
          skipped
            .slice(0, 4)
            .map((s) => `${s.member ?? s.enrollmentId}: ${s.reason}`)
            .join(' · ') + (skipped.length > 4 ? ` · +${skipped.length - 4}` : ''),
        );
      }
      if (aborted && remaining?.length) {
        // Falha temporária no meio do lote: o modal fica aberto só com os
        // restantes marcados — repetir é seguro (concluídos são pulados)
        notify.error(`Falha temporária no meio do lote — ${remaining.length} restante(s) já marcados. Clique de novo para concluí-los.`);
        setBatchCompleteSelection(Object.fromEntries(remaining.map((id) => [id, true])));
        await refreshDetail();
        return;
      }
      setShowBatchComplete(false);
      // Lote grande: recarrega o report (datas/certificados) mas sem o
      // fetchData completo — a ocupação vem do refreshClassesOnly
      await refreshDetail();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao concluir a turma'));
    } finally {
      setSavingBatchComplete(false);
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

  const refreshDocList = async (enrollmentId: string) => {
    try {
      const res = await api.get(`/catechesis/enrollments/${enrollmentId}/documents`);
      setDocList(res.data ?? []);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar os documentos'));
      setDocList([]);
    }
  };

  const refreshDocReqs = (classId: string) => {
    setDocReqsError(false);
    api
      .get(`/catechesis/classes/${classId}/doc-requirements`)
      .then((res) => setDocReqs(res.data ?? []))
      .catch(() => {
        // Sem os requisitos, as ações de balcão somem — avisa em vez de fingir
        // que a turma não pede nada
        setDocReqs(null);
        setDocReqsError(true);
      });
  };

  const openDocuments = async (enrollmentId: string, fullName: string) => {
    setDocList(null);
    setDocReqs(null);
    setDocReqsError(false);
    setDocTarget({ enrollmentId, fullName });
    void refreshDocList(enrollmentId);
    if (selectedClass) refreshDocReqs(selectedClass.id);
  };

  /** Divergência lida do documento → corrige o cadastro do membro (auditado;
   * a conferência automática reexecuta e o badge deve virar "confere"). */
  const handleApplyCorrection = async (doc: EnrollmentDocument) => {
    if (!docTarget) return;
    const parts: string[] = [];
    if (doc.extractedName) parts.push(`Nome: "${docTarget.fullName}" → "${doc.extractedName}"`);
    if (doc.extractedBirthDate) {
      parts.push(`Nascimento: ${new Date(doc.extractedBirthDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' })} (conforme o documento)`);
    }
    if (!window.confirm(`Corrigir o cadastro conforme o documento?\n\n${parts.join('\n')}\n\nA alteração fica registrada em auditoria e o documento é conferido de novo.`)) {
      return;
    }
    try {
      await api.post(`/catechesis/documents/${doc.id}/apply-correction`, {});
      notify.success('Cadastro corrigido — o documento será conferido de novo em instantes (↻).');
      void refreshDocList(docTarget.enrollmentId);
      void refreshDetail();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao corrigir o cadastro'));
    }
  };

  /** Balcão: a secretaria registra a declaração em nome da família. */
  const handleDeclare = async (kind: string, declaration: 'NOT_HAVE' | 'OTHER_DENOMINATION') => {
    if (!docTarget) return;
    let denomination: string | undefined;
    if (declaration === 'OTHER_DENOMINATION') {
      const typed = window.prompt('Batismo realizado em qual denominação? (ex.: Assembleia de Deus)');
      if (typed === null) return;
      denomination = typed.trim();
      if (denomination.length < 2) {
        notify.error('Informe a denominação');
        return;
      }
    } else if (!window.confirm(`Registrar que ${docTarget.fullName} NÃO TEM "${kind}"? A equipe ainda precisa aceitar a declaração.`)) {
      return;
    }
    try {
      await api.post(`/catechesis/enrollments/${docTarget.enrollmentId}/documents/declaration`, {
        kind,
        declaration,
        ...(denomination ? { denomination } : {}),
      });
      notify.success('Declaração registrada — aceite ou recuse na lista abaixo.');
      void refreshDocList(docTarget.enrollmentId);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao registrar a declaração'));
    }
  };

  /** Balcão: upload de arquivo pela equipe para um requisito da turma. */
  const startDocUpload = (kind: string) => {
    docUploadKindRef.current = kind;
    docFileInputRef.current?.click();
  };

  const handleDocFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !docTarget || !docUploadKindRef.current) return;
    if (file.size > 8 * 1024 * 1024) {
      notify.error('Arquivo muito grande — máximo de 8 MB');
      return;
    }
    setUploadingDoc(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', docUploadKindRef.current);
      await api.post(`/catechesis/enrollments/${docTarget.enrollmentId}/documents`, form);
      notify.success('Documento enviado — a conferência automática roda em segundos (use ↻ para atualizar).');
      void refreshDocList(docTarget.enrollmentId);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao enviar o documento'));
    } finally {
      setUploadingDoc(false);
    }
  };

  /** Configuração dos documentos pedidos pela turma. */
  const openDocReqModal = async () => {
    if (!selectedClass) return;
    setDocReqItems([]);
    setLoadingDocReq(true);
    setShowDocReqModal(true);
    try {
      const res = await api.get(`/catechesis/classes/${selectedClass.id}/doc-requirements`);
      setDocReqItems(
        (res.data ?? []).map((r: DocRequirement) => ({
          kind: r.kind,
          required: !!r.required,
          allowNotHave: !!r.allowNotHave,
          allowOtherDenomination: !!r.allowOtherDenomination,
        })),
      );
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar os documentos da turma'));
      setShowDocReqModal(false);
    } finally {
      setLoadingDocReq(false);
    }
  };

  const handleSaveDocReq = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClass) return;
    setSavingDocReq(true);
    try {
      const res = await api.put(`/catechesis/classes/${selectedClass.id}/doc-requirements`, { items: docReqItems });
      notify.success('Documentos da inscrição atualizados!');
      setDocReqs(res.data ?? null);
      setShowDocReqModal(false);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao salvar os documentos da turma'));
    } finally {
      setSavingDocReq(false);
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

  // ===== Folha de presença (grade alunos × encontros, como o formulário de papel) =====
  const openAttendanceGrid = async () => {
    if (!selectedClass) return;
    try {
      const res = await api.get(`/catechesis/classes/${selectedClass.id}/attendance-grid`);
      setGridData(res.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao abrir a folha de presença'));
    }
  };

  const closeAttendanceGrid = () => {
    setGridData(null);
    // Badges "sem chamada"/X/Y da lista de encontros mudaram com os lançamentos
    void refreshDetail();
  };

  const upsertGridMark = (
    marks: AttendanceGridMark[],
    next: AttendanceGridMark,
  ): AttendanceGridMark[] => {
    const rest = marks.filter(
      (m) => !(m.sessionId === next.sessionId && m.enrollmentId === next.enrollmentId),
    );
    return [...rest, next];
  };

  /** Grava uma célula da folha (otimista; reverte se o POST falhar). */
  const setGridCell = async (
    sessionId: string,
    enrollmentId: string,
    entry: { present: boolean; late?: boolean; justified?: boolean; clear?: boolean },
    keepCertificate: boolean,
  ) => {
    const key = `${sessionId}:${enrollmentId}`;
    const previousMarks = gridData?.marks ?? [];
    setGridSavingCells((prev) => ({ ...prev, [key]: true }));
    setGridData((current) => {
      if (!current) return current;
      if (entry.clear) {
        // Limpar = a célula volta a "sem chamada"
        return {
          ...current,
          marks: current.marks.filter((m) => !(m.sessionId === sessionId && m.enrollmentId === enrollmentId)),
        };
      }
      return {
        ...current,
        marks: upsertGridMark(current.marks, {
          sessionId,
          enrollmentId,
          present: entry.present || entry.late === true,
          late: entry.late === true,
          justified: !entry.present && entry.justified === true,
          hasCertificate: keepCertificate && !entry.present && entry.justified === true,
        }),
      };
    });
    try {
      await api.post(`/catechesis/sessions/${sessionId}/attendance`, {
        entries: [
          {
            enrollmentId,
            present: entry.present,
            late: entry.late ?? false,
            justified: entry.justified ?? false,
            clear: entry.clear ?? false,
          },
        ],
      });
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao gravar a chamada'));
      setGridData((current) => (current ? { ...current, marks: previousMarks } : current));
    } finally {
      setGridSavingCells((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  /** Clique na célula: — → presente → falta → falta justificada → limpar (—). */
  const cycleGridCell = (sessionId: string, enrollmentId: string, mark: AttendanceGridMark | undefined) => {
    if (!mark) {
      void setGridCell(sessionId, enrollmentId, { present: true }, false);
      return;
    }
    if (mark.present) {
      void setGridCell(sessionId, enrollmentId, { present: false }, false);
      return;
    }
    if (!mark.justified) {
      void setGridCell(sessionId, enrollmentId, { present: false, justified: true }, false);
      return;
    }
    if (
      mark.hasCertificate &&
      !window.confirm('Limpar este lançamento remove também o atestado anexado à falta. Continuar?')
    ) {
      return;
    }
    // Fecha o ciclo desfazendo o lançamento — clique por engano tem volta
    void setGridCell(sessionId, enrollmentId, { present: false, clear: true }, false);
  };

  /** Abre o atestado numa guia (visualizar); o blob autenticado vira URL temporária. */
  const openAbsenceCertificate = async (sessionId: string, enrollmentId: string) => {
    try {
      const res = await api.get(`/catechesis/sessions/${sessionId}/attendance/${enrollmentId}/certificate`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const win = window.open(url, '_blank');
      if (!win) {
        notify.error('O navegador bloqueou a nova guia — libere pop-ups para visualizar o atestado');
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error: any) {
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
      notify.error(getErrorMessage(error, 'Erro ao abrir o atestado'));
    }
  };

  const promptGridCertificate = (sessionId: string, enrollmentId: string) => {
    gridCertTargetRef.current = { sessionId, enrollmentId };
    gridCertInputRef.current?.click();
  };

  const handleGridCertificateFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const target = gridCertTargetRef.current;
    gridCertTargetRef.current = null;
    if (!file || !target) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      await api.post(
        `/catechesis/sessions/${target.sessionId}/attendance/${target.enrollmentId}/certificate`,
        formData,
      );
      notify.success('Atestado anexado — a falta ficou justificada.');
      setGridData((current) =>
        current
          ? {
              ...current,
              marks: upsertGridMark(current.marks, {
                sessionId: target.sessionId,
                enrollmentId: target.enrollmentId,
                present: false,
                late: false,
                justified: true,
                hasCertificate: true,
              }),
            }
          : current,
      );
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao anexar o atestado'));
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

  const chatDayKey = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
  const chatDayLabel = (iso: string) => {
    const key = chatDayKey(iso);
    const today = new Date();
    if (key === today.toLocaleDateString('pt-BR')) return 'Hoje';
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (key === yesterday.toLocaleDateString('pt-BR')) return 'Ontem';
    return key;
  };
  /** Ticks estilo mensageiro: ✓ enviada, ✓✓ entregue, ✓✓ azul lida. */
  const renderChatTicks = (message: ChatMessage) => {
    const read = !!message.readAt;
    const delivered = !!message.deliveredAt;
    const label = read
      ? `Lida em ${new Date(message.readAt!).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
      : delivered
        ? 'Entregue'
        : 'Enviada';
    return (
      <span className={`cate-chat__ticks${read ? ' is-read' : ''}`} title={label} aria-label={label}>
        {read || delivered ? '✓✓' : '✓'}
      </span>
    );
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

  const openRenewal = async (classArg?: CatechesisClass) => {
    const klass = classArg ?? selectedClass;
    if (!klass) return;
    try {
      const res = await api.get(`/catechesis/classes/${klass.id}/renewal-preview`);
      const preview: RenewalPreview = res.data;
      const selection: Record<string, boolean> = {};
      preview.students.forEach((s) => {
        // Já realocados ficam fora da pré-seleção (o board mostra onde estão)
        selection[s.enrollmentId] = s.eligible && !s.alreadyEnrolledIn;
      });
      setRenewalSelection(selection);
      setRenewalDraft({});
      setDraftMoves([]);
      setOverrideColumns({});
      setColumnStatus({});
      setPlacedLocalIds({});
      dragIdsRef.current = [];
      setDraggingIds([]);
      setDragOverCol(null);
      // Destino padrão: o ANO SEGUINTE ao da turma de origem (2026 → 2027).
      // Sem turmas criadas nele, o board abre no aviso que guia o 📆 Criar —
      // melhor do que oferecer as turmas do ano que está encerrando
      setBoardYearFilter(klass.year + 1);
      setRenewal(preview);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao preparar a renovação'));
    }
  };

  const closeBoard = () => {
    if (Object.keys(renewalDraft).length > 0 && !window.confirm('Descartar a distribuição em rascunho?')) return;
    setRenewal(null);
  };

  /** Quantos cards o rascunho já coloca em cada coluna destino. */
  const draftCountFor = (targetClassId: string) =>
    Object.values(renewalDraft).filter((id) => id === targetClassId).length;

  /** Move ids para a coluna (rascunho) — serve à seleção e ao drag and drop.
   * Aceita cards vindos da origem OU de outra coluna destino (re-arrasto). */
  const moveIdsTo = (target: RenewalTargetClass, ids: string[]) => {
    if (renewing) return;
    const moving = ids.filter((id) => renewalDraft[id] !== target.id);
    if (!moving.length) return;
    if (target.capacity != null) {
      const free = target.capacity - target.occupied - draftCountFor(target.id);
      if (moving.length > free && !overrideColumns[target.id]) {
        // Recusa explícita por padrão; a exceção é consciente e auditada
        const projected = target.occupied + draftCountFor(target.id) + moving.length;
        const proceed = window.confirm(
          `A ${target.name} ficará com ${projected}/${target.capacity} (acima do limite). Mover mesmo assim? A exceção fica registrada em auditoria.`,
        );
        if (!proceed) return;
        setOverrideColumns((prev) => ({ ...prev, [target.id]: true }));
      }
    }
    const prevMap: Record<string, string | null> = {};
    moving.forEach((id) => {
      prevMap[id] = renewalDraft[id] ?? null;
    });
    const nextDraft = { ...renewalDraft };
    moving.forEach((id) => {
      nextDraft[id] = target.id;
    });
    setRenewalDraft(nextDraft);
    // Re-arrasto que esvazia a coluna de onde os cards saíram também derruba a
    // exceção de capacidade dela — a próxima leva pede confirmação de novo
    const emptied = [...new Set(Object.values(prevMap))].filter(
      (col): col is string => !!col && col !== target.id && !Object.values(nextDraft).includes(col),
    );
    if (emptied.length) {
      setOverrideColumns((prev) => {
        const cleaned = { ...prev };
        emptied.forEach((col) => delete cleaned[col]);
        return cleaned;
      });
    }
    setRenewalSelection((prev) => {
      const next = { ...prev };
      moving.forEach((id) => {
        next[id] = false;
      });
      return next;
    });
    setDraftMoves((prev) => [...prev, { enrollmentIds: moving, targetClassId: target.id, prev: prevMap }]);
    setColumnStatus({});
  };

  /** Move os selecionados (ainda na origem) para a coluna — só rascunho, nada gravado. */
  const moveSelectedTo = (target: RenewalTargetClass) => {
    const moving = Object.entries(renewalSelection)
      .filter(([id, checked]) => checked && !renewalDraft[id])
      .map(([id]) => id);
    if (!moving.length) {
      notify.error('Selecione catequizandos na coluna de origem');
      return;
    }
    moveIdsTo(target, moving);
  };

  /** Devolve cards do destino para a origem (rascunho) — botão × ou drop na origem. */
  const returnToOrigin = (enrollmentIds: string[]) => {
    // Durante o Confirmar o snapshot já foi tirado — retratação aqui gravaria
    // a matrícula contra a ação do usuário
    if (renewing) return;
    const moving = enrollmentIds.filter((id) => renewalDraft[id]);
    if (!moving.length) return;
    const prevMap: Record<string, string | null> = {};
    moving.forEach((id) => {
      prevMap[id] = renewalDraft[id] ?? null;
    });
    const next = { ...renewalDraft };
    moving.forEach((id) => {
      delete next[id];
    });
    setRenewalDraft(next);
    // Coluna esvaziada perde a exceção de capacidade concedida — a próxima
    // leva pede confirmação de novo
    const emptied = [...new Set(Object.values(prevMap))].filter(
      (col): col is string => !!col && !Object.values(next).includes(col),
    );
    if (emptied.length) {
      setOverrideColumns((prev) => {
        const cleaned = { ...prev };
        emptied.forEach((col) => delete cleaned[col]);
        return cleaned;
      });
    }
    setDraftMoves((prev) => [...prev, { enrollmentIds: moving, targetClassId: null, prev: prevMap }]);
  };

  /** Início do arrasto: os ids em voo vão para o ref (dataTransfer não é legível
   * no dragover) e o ghost sob o cursor vira um card com badge de quantidade
   * (pilha, quando a leva tem mais de um). */
  const startDrag = (e: React.DragEvent, ids: string[], label: string) => {
    dragIdsRef.current = ids;
    setDraggingIds(ids);
    e.dataTransfer.effectAllowed = 'move';
    // Firefox só inicia o arrasto quando algum dado é posto no dataTransfer
    e.dataTransfer.setData('text/plain', String(ids.length));
    // O ghost precisa estar no DOM quando setDragImage roda; o snapshot é
    // tirado sincronamente, então o nó pode sair no próximo tick
    const ghost = document.createElement('div');
    ghost.className = `cate-drag-ghost${ids.length > 1 ? ' cate-drag-ghost--stack' : ''}`;
    const name = document.createElement('span');
    name.className = 'cate-drag-ghost__name';
    name.textContent = ids.length > 1 ? `${label} + ${ids.length - 1}` : label;
    ghost.appendChild(name);
    if (ids.length > 1) {
      const badge = document.createElement('span');
      badge.className = 'cate-drag-ghost__badge';
      badge.textContent = String(ids.length);
      ghost.appendChild(badge);
    }
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 24, 22);
    dragGhostRef.current = ghost;
    window.setTimeout(() => {
      if (dragGhostRef.current === ghost) dragGhostRef.current = null;
      ghost.remove();
    }, 0);
  };
  const endDrag = () => {
    dragIdsRef.current = [];
    setDraggingIds([]);
    setDragOverCol(null);
    dragGhostRef.current?.remove();
    dragGhostRef.current = null;
  };
  const dragOverColumn = (e: React.DragEvent, col: string) => {
    if (!dragIdsRef.current.length || renewing) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCol((cur) => (cur === col ? cur : col));
  };
  const dragLeaveColumn = (e: React.DragEvent, col: string) => {
    // Entrar num filho da coluna também dispara dragleave — só apaga o
    // destaque quando o cursor sai da coluna de verdade
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOverCol((cur) => (cur === col ? null : cur));
  };

  const undoLastMove = () => {
    const last = draftMoves[draftMoves.length - 1];
    if (!last) return;
    if (last.targetClassId === null) {
      // Desfazer um "voltar para origem": cada card retorna à coluna de onde saiu
      setRenewalDraft((prev) => {
        const next = { ...prev };
        last.enrollmentIds.forEach((id) => {
          const back = last.prev[id];
          if (back) next[id] = back;
        });
        return next;
      });
      setRenewalSelection((prev) => {
        const next = { ...prev };
        last.enrollmentIds.forEach((id) => {
          next[id] = false;
        });
        return next;
      });
      setDraftMoves((prev) => prev.slice(0, -1));
      return;
    }
    // Desfazer um "mover para a coluna": quem veio da origem volta selecionado;
    // quem veio de OUTRA coluna (re-arrasto) volta para ela
    setRenewalDraft((prev) => {
      const next = { ...prev };
      last.enrollmentIds.forEach((id) => {
        if (next[id] !== last.targetClassId) return;
        const back = last.prev[id];
        if (back) next[id] = back;
        else delete next[id];
      });
      return next;
    });
    setRenewalSelection((prev) => {
      const next = { ...prev };
      last.enrollmentIds.forEach((id) => {
        next[id] = !last.prev[id];
      });
      return next;
    });
    setDraftMoves((prev) => prev.slice(0, -1));
  };

  /** Confirmar: um POST /renew por coluna, sequencial. Falha de uma coluna
   * mantém os cards dela em rascunho (as demais já valeram — o renew é
   * idempotente: já-renovados são pulados no retry). */
  const handleConfirmBoard = async () => {
    if (!selectedClass || !renewal) return;
    const byTarget = new Map<string, string[]>();
    Object.entries(renewalDraft).forEach(([enrollmentId, targetClassId]) => {
      const list = byTarget.get(targetClassId) ?? [];
      list.push(enrollmentId);
      byTarget.set(targetClassId, list);
    });
    if (byTarget.size === 0) {
      notify.error('Distribua ao menos um catequizando');
      return;
    }
    // Rascunho em colunas OCULTAS pelo filtro de ano também será gravado —
    // confirmação explícita, o sufixo do contador é fácil de não ver
    if (boardYearFilter !== 'all') {
      const hiddenNow = Object.values(renewalDraft).filter((tgt) => {
        const target = renewal.targetClasses.find((t) => t.id === tgt);
        return target && target.year !== boardYearFilter;
      }).length;
      if (
        hiddenNow > 0 &&
        !window.confirm(`${hiddenNow} catequizando(s) estão em colunas de outro ano (ocultas pelo filtro) e serão gravados juntos. Continuar?`)
      ) {
        return;
      }
    }
    setRenewing(true);
    let renewedTotal = 0;
    let reactivatedTotal = 0;
    const skippedAll: Array<{ member: string; reason: string }> = [];
    const failedColumns: string[] = [];
    // Cópia local do rascunho: o estado muda via setState durante o laço e a
    // closure ficaria velha para a poda/estado pós-commit
    const draftLocal: Record<string, string> = { ...renewalDraft };
    const placedNow: Record<string, string> = {};
    for (const [targetClassId, enrollmentIds] of byTarget) {
      setColumnStatus((prev) => ({ ...prev, [targetClassId]: 'saving' }));
      try {
        const res = await api.post(`/catechesis/classes/${selectedClass.id}/renew`, {
          targetClassId,
          enrollmentIds,
          ...(overrideColumns[targetClassId] ? { overrideCapacity: true } : {}),
        });
        renewedTotal += res.data.renewed ?? 0;
        reactivatedTotal += res.data.reactivated ?? 0;
        (res.data.skippedDetails ?? []).forEach((s: { member: string; reason: string }) => skippedAll.push(s));
        setColumnStatus((prev) => ({ ...prev, [targetClassId]: 'ok' }));
        const targetName = renewal.targetClasses.find((t) => t.id === targetClassId)?.name ?? 'turma nova';
        enrollmentIds.forEach((id) => {
          delete draftLocal[id];
          placedNow[id] = targetName;
        });
        // Coluna gravada sai do rascunho e perde a exceção de capacidade —
        // a próxima leva acima do limite pede confirmação de novo
        setRenewalDraft((prev) => {
          const next = { ...prev };
          enrollmentIds.forEach((id) => delete next[id]);
          return next;
        });
        setOverrideColumns((prev) => {
          const next = { ...prev };
          delete next[targetClassId];
          return next;
        });
      } catch (error) {
        setColumnStatus((prev) => ({ ...prev, [targetClassId]: 'error' }));
        failedColumns.push(targetClassId);
        notify.error(getErrorMessage(error, 'Erro ao renovar para uma das turmas'));
      }
    }
    // Coluna que falhou está oculta pelo filtro de ano? Mostra todos — o
    // badge de erro e o rascunho remanescente precisam ficar visíveis
    if (
      boardYearFilter !== 'all' &&
      failedColumns.some((id) => renewal.targetClasses.find((t) => t.id === id)?.year !== boardYearFilter)
    ) {
      setBoardYearFilter('all');
    }
    setDraftMoves([]);
    const placed = renewedTotal + reactivatedTotal;
    if (placed > 0) {
      notify.success(
        `${placed} matrícula(s) em ${byTarget.size - failedColumns.length} turma(s)${skippedAll.length ? ` · ${skippedAll.length} pulada(s)` : ''}!`,
      );
    }
    if (skippedAll.length) {
      notify.warning(
        skippedAll
          .slice(0, 4)
          .map((s) => `${s.member}: ${s.reason}`)
          .join(' · ') + (skippedAll.length > 4 ? ` · +${skippedAll.length - 4}` : ''),
      );
    }
    // Recarrega a PRÉVIA (progresso/vagas atualizados) em vez de fechar — o
    // coordenador emenda a próxima leva; falha de coluna mantém o rascunho dela
    try {
      const res = await api.get(`/catechesis/classes/${selectedClass.id}/renewal-preview`);
      const preview: RenewalPreview = res.data;
      // Poda o rascunho contra a prévia nova: uma coluna que deixou de existir
      // (turma encerrada) não pode segurar cards invisíveis e inconfirmáveis
      const validTargets = new Set(preview.targetClasses.map((t) => t.id));
      const validStudents = new Set(preview.students.map((s) => s.enrollmentId));
      const orphanedIds = Object.entries(draftLocal)
        .filter(([id, tgt]) => !validTargets.has(tgt) || !validStudents.has(id))
        .map(([id]) => id);
      setRenewalDraft(Object.fromEntries(Object.entries(draftLocal).filter(([id]) => !orphanedIds.includes(id))));
      if (orphanedIds.length) {
        notify.warning('Uma turma de destino deixou de estar disponível — os catequizandos voltaram à coluna de origem.');
      }
      setRenewal(preview);
      setPlacedLocalIds({});
      // Ano filtrado sumiu da prévia (última turma dele encerrada)? Mostra todos
      setBoardYearFilter((prev) => (prev !== 'all' && !preview.targetClasses.some((t) => t.year === prev) ? 'all' : prev));
      setRenewalSelection((prev) => {
        const selection: Record<string, boolean> = {};
        preview.students.forEach((s) => {
          selection[s.enrollmentId] =
            (prev[s.enrollmentId] === true || orphanedIds.includes(s.enrollmentId)) && s.eligible && !s.alreadyEnrolledIn;
        });
        return selection;
      });
    } catch {
      // prévia indisponível: fecha o board se nada falhou; senão, marca os já
      // gravados localmente para não voltarem à origem como se pendentes
      if (failedColumns.length === 0) setRenewal(null);
      else setPlacedLocalIds((prev) => ({ ...prev, ...placedNow }));
    }
    void refreshDetail();
    setRenewing(false);
  };

  // ===== Painel "Encerramento do ano" =====
  const loadYearEnd = async (communityId?: string) => {
    const seq = ++yearEndSeq.current;
    setYearEndLoading(true);
    try {
      const res = await api.get('/catechesis/year-end-overview', {
        params: communityId ? { communityId } : undefined,
      });
      if (seq !== yearEndSeq.current) return;
      setYearEndRows(res.data ?? []);
    } catch (error) {
      if (seq !== yearEndSeq.current) return;
      notify.error(getErrorMessage(error, 'Erro ao carregar o encerramento'));
      setYearEndRows(null);
    } finally {
      if (seq === yearEndSeq.current) setYearEndLoading(false);
    }
  };

  const openYearEndTab = () => {
    setTab('encerramento');
    const communityId = yearEndCommunityId || user?.communityId || communities[0]?.id || '';
    if (!yearEndCommunityId && communityId) setYearEndCommunityId(communityId);
    if (communityId) loadYearEnd(communityId);
  };

  /** Painel: resolve a turma na lista local, com refetch de fallback — a
   * linha do painel vem fresca do backend, a lista `classes` pode estar
   * velha (turma criada por outro coordenador) ou fora do escopo. */
  const resolveYearEndClass = async (row: YearEndRow): Promise<CatechesisClass | null> => {
    let klass = classes.find((k) => k.id === row.classId) ?? null;
    if (!klass) {
      const fresh = await refreshClassesOnly();
      klass = fresh?.find((k) => k.id === row.classId) ?? null;
    }
    if (!klass) notify.error('Turma fora do seu escopo de turmas — recarregue a página ou confira a paróquia selecionada');
    return klass;
  };

  /** Virada de ano: modal para criar a sucessora da turma (mesma etapa, ano
   * seguinte), herdando dados e catequistas — mantidos ou desmarcados. */
  const openRollover = async (klass: CatechesisClass) => {
    setRolloverSource(klass);
    setRolloverForm({
      year: String(klass.year + 1),
      name: klass.name,
      weekday: klass.weekday === null || klass.weekday === undefined ? '' : String(klass.weekday),
      time: klass.time ?? '',
      room: klass.room ?? '',
      capacity: klass.capacity == null ? '' : String(klass.capacity),
    });
    // Catequistas atuais: reusa o report se é a turma aberta E já carregou —
    // durante o loading o `report` ainda seria o da turma anterior
    if (selectedClass?.id === klass.id && report && !reportLoading) {
      setRolloverCatechists(report.catechists);
      setRolloverKeep(Object.fromEntries(report.catechists.map((c) => [c.memberId, true])));
      return;
    }
    setRolloverCatechists(null);
    const seq = ++rolloverSeq.current;
    try {
      const res = await api.get(`/catechesis/classes/${klass.id}/report`);
      if (seq !== rolloverSeq.current) return;
      const cats: Array<{ memberId: string; fullName: string; role: string }> = res.data?.catechists ?? [];
      setRolloverCatechists(cats);
      setRolloverKeep(Object.fromEntries(cats.map((c) => [c.memberId, true])));
    } catch (error) {
      if (seq !== rolloverSeq.current) return;
      // Falha não pode se disfarçar de "turma sem catequistas" (liberaria o
      // submit criando a sucessora sem equipe) — fecha e avisa
      notify.error(getErrorMessage(error, 'Erro ao carregar a equipe da turma'));
      setRolloverSource(null);
    }
  };

  const closeRollover = () => {
    rolloverSeq.current++;
    setRolloverSource(null);
  };

  const handleRollover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rolloverSource || rolloverCatechists === null) return;
    setSavingRollover(true);
    try {
      const keepIds = rolloverCatechists.filter((c) => rolloverKeep[c.memberId]).map((c) => c.memberId);
      const res = await api.post(`/catechesis/classes/${rolloverSource.id}/rollover`, {
        year: Number(rolloverForm.year),
        name: rolloverForm.name,
        weekday: rolloverForm.weekday === '' ? null : Number(rolloverForm.weekday),
        time: rolloverForm.time || null,
        room: rolloverForm.room || null,
        capacity: rolloverForm.capacity === '' ? null : Number(rolloverForm.capacity),
        catechistMemberIds: keepIds,
      });
      notify.success(`Turma "${res.data.name}" de ${res.data.year} criada com ${res.data.catechists} catequista(s)!`);
      if (res.data.skippedCatechists?.length) {
        notify.warning(`Fora da pastoral da Catequese (não copiados): ${res.data.skippedCatechists.join(', ')}`);
      }
      closeRollover();
      void refreshClassesOnly();
      if (tab === 'encerramento' && yearEndCommunityId) loadYearEnd(yearEndCommunityId);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao criar a turma do ano seguinte'));
    } finally {
      setSavingRollover(false);
    }
  };

  /** CTA do painel: abre a turma e já dispara a ação da vez. */
  const openFromYearEnd = async (row: YearEndRow, action: 'complete' | 'renew') => {
    const klass = await resolveYearEndClass(row);
    if (!klass) return;
    setTab('classes');
    const freshReport = await openClassDetail(klass);
    if (action === 'complete') {
      // report falhou? o modal NÃO abre com a seleção da turma anterior
      if (freshReport) openBatchComplete(freshReport);
    } else {
      void openRenewal(klass);
    }
  };

  // Filtro por ano da lista de turmas (na virada convivem 2026 e 2027)
  const classYears = [...new Set(classes.map((k) => k.year))].sort((a, b) => b - a);
  const classesWithAttention = classes.filter((k) => classAttention(k) > 0);
  const classesForView = classes.filter(
    (k) =>
      (classesYearFilter === 'all' || k.year === classesYearFilter) &&
      (!classesAttentionOnly || classAttention(k) > 0),
  );

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
        {isCoordinator && (
          <button className={`tab-btn ${tab === 'encerramento' ? 'active' : ''}`} onClick={openYearEndTab}>
            Encerramento do ano
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

      {tab === 'encerramento' && (
        <>
          {communities.length > 1 && (
            <div className="inline-form" style={{ marginBottom: '1rem' }}>
              <select
                className="filter-select"
                value={yearEndCommunityId}
                onChange={(e) => {
                  setYearEndCommunityId(e.target.value);
                  // Comunidade nova pode não ter o ano filtrado — sem o reset,
                  // a tabela ficava vazia sem chips para voltar
                  setYearEndYearFilter('all');
                  if (e.target.value) loadYearEnd(e.target.value);
                }}
              >
                {communities.map((community) => (
                  <option key={community.id} value={community.id}>{community.name}</option>
                ))}
              </select>
            </div>
          )}
          {yearEndLoading && <div className="loading">Carregando o encerramento...</div>}
          {!yearEndLoading && yearEndRows && yearEndRows.length === 0 && (
            <div className="cate-empty">Nenhuma turma ativa nesta comunidade.</div>
          )}
          {!yearEndLoading && yearEndRows && yearEndRows.length > 0 && (() => {
            const yearEndYears = [...new Set(yearEndRows.map((r) => r.year))].sort((a, b) => b - a);
            // Filtro apontando para ano que não existe aqui (reload/troca) → todos
            const effectiveYearFilter =
              yearEndYearFilter !== 'all' && !yearEndYears.includes(yearEndYearFilter) ? 'all' : yearEndYearFilter;
            const visibleRows = effectiveYearFilter === 'all' ? yearEndRows : yearEndRows.filter((r) => r.year === effectiveYearFilter);
            return (
            <>
              <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '0 0 0.8rem' }}>
                A virada do ano em três passos por turma: <strong>criar a turma do ano seguinte</strong> (mantendo ou
                trocando os catequistas), <strong>concluir</strong> os ativos e <strong>distribuir</strong> os concluídos
                nas turmas novas da próxima etapa.
              </p>
              {yearEndYears.length > 1 && (
                <div className="cate-filter" role="group" aria-label="Filtro por ano do encerramento" style={{ marginBottom: '0.8rem' }}>
                  <button
                    type="button"
                    className={`cate-filter__opt${effectiveYearFilter === 'all' ? ' is-on' : ''}`}
                    onClick={() => setYearEndYearFilter('all')}
                  >
                    Todos os anos
                  </button>
                  {yearEndYears.map((year) => (
                    <button
                      key={year}
                      type="button"
                      className={`cate-filter__opt${effectiveYearFilter === year ? ' is-on' : ''}`}
                      onClick={() => setYearEndYearFilter(year)}
                    >
                      {year}
                    </button>
                  ))}
                </div>
              )}
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Turma</th>
                      <th>Etapa</th>
                      <th>Ano seguinte</th>
                      <th style={{ textAlign: 'right' }}>A concluir</th>
                      <th style={{ textAlign: 'right' }}>Concluídos</th>
                      <th style={{ textAlign: 'right' }}>Distribuídos</th>
                      <th>Situação</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ color: '#64748b', fontSize: '0.85rem' }}>
                          Nenhuma turma {effectiveYearFilter !== 'all' ? `de ${effectiveYearFilter} ` : ''}nesta comunidade — use “Todos os anos”.
                        </td>
                      </tr>
                    )}
                    {visibleRows.map((row) => {
                      const done = row.active === 0 && row.toRelocate === 0;
                      return (
                        <tr key={row.classId}>
                          <td>
                            <strong>{row.name}</strong> <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{row.year}</span>
                          </td>
                          <td>
                            {row.stage.color && <span className="cate-stage-dot" style={{ background: row.stage.color }} />}
                            {row.stage.name}
                          </td>
                          <td>
                            {row.hasNextYearClass ? (
                              <span className="status-badge green">✓ {row.year + 1}</span>
                            ) : (
                              <button
                                className="btn-small"
                                title={`Criar a turma de ${row.year + 1} desta etapa, mantendo ou ajustando os catequistas`}
                                onClick={async () => {
                                  const klass = await resolveYearEndClass(row);
                                  if (klass) void openRollover(klass);
                                }}
                              >
                                📆 Criar {row.year + 1}
                              </button>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>{row.active > 0 ? <strong>{row.active}</strong> : '—'}</td>
                          <td style={{ textAlign: 'right' }}>{row.completed || '—'}</td>
                          <td style={{ textAlign: 'right' }}>
                            {row.completed > 0 ? `${row.relocated}/${row.completed}` : '—'}
                          </td>
                          <td>
                            {done ? (
                              <span className="status-badge green">Encerrada ✓</span>
                            ) : row.active > 0 ? (
                              <span className="status-badge yellow">Concluir {row.active}</span>
                            ) : (
                              <span className="status-badge yellow">Distribuir {row.toRelocate}</span>
                            )}
                          </td>
                          <td className="actions-cell">
                            {row.active > 0 && (
                              <button className="btn-small success" onClick={() => void openFromYearEnd(row, 'complete')}>
                                🎓 Concluir turma
                              </button>
                            )}
                            {row.toRelocate > 0 && (
                              <button className="btn-small" onClick={() => void openFromYearEnd(row, 'renew')}>
                                ↦ Distribuir
                              </button>
                            )}
                            {done && (
                              <button
                                className="btn-small"
                                onClick={async () => {
                                  const klass = await resolveYearEndClass(row);
                                  if (klass) {
                                    setTab('classes');
                                    void openClassDetail(klass);
                                  }
                                }}
                              >
                                Abrir
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
            );
          })()}
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
                <th>Cor</th>
                <th>Sacramento gerado</th>
                <th>Descrição</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((stage) => (
                <tr key={stage.id}>
                  <td>{stage.ordering}</td>
                  <td>
                    {stage.color && <span className="cate-stage-dot" style={{ background: stage.color }} />}
                    <strong>{stage.name}</strong>
                  </td>
                  <td>
                    <span className="cate-color-picker">
                      {STAGE_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          title={color}
                          className={`cate-color-swatch${stage.color === color ? ' is-on' : ''}`}
                          style={{ background: color }}
                          onClick={() => void handleStageColor(stage.id, color)}
                        />
                      ))}
                      <button
                        type="button"
                        title="Sem cor"
                        className={`cate-color-swatch cate-color-swatch--none${!stage.color ? ' is-on' : ''}`}
                        onClick={() => void handleStageColor(stage.id, null)}
                      >
                        ×
                      </button>
                    </span>
                  </td>
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
          {classes.length > 0 && (
            <div className="cate-viewbar">
              <div className="cate-filter" role="group" aria-label="Modo de exibição das turmas">
                <button
                  type="button"
                  className={`cate-filter__opt${classesView === 'cards' ? ' is-on' : ''}`}
                  onClick={() => setClassesView('cards')}
                >
                  ▦ Cards
                </button>
                <button
                  type="button"
                  className={`cate-filter__opt${classesView === 'list' ? ' is-on' : ''}`}
                  onClick={() => setClassesView('list')}
                >
                  ☰ Lista
                </button>
              </div>
              {classesWithAttention.length > 0 && (
                <div className="cate-filter" role="group" aria-label="Filtro de pendências">
                  <button
                    type="button"
                    className={`cate-filter__opt${classesAttentionOnly ? ' is-on' : ''}`}
                    title="Só as turmas com inscrições aguardando ou documentos para conferir"
                    onClick={() => setClassesAttentionOnly((v) => !v)}
                  >
                    ⚠ Pendências ({classesWithAttention.length})
                  </button>
                </div>
              )}
              {classYears.length > 1 && (
                <div className="cate-filter" role="group" aria-label="Filtro por ano">
                  <button
                    type="button"
                    className={`cate-filter__opt${classesYearFilter === 'all' ? ' is-on' : ''}`}
                    onClick={() => setClassesYearFilter('all')}
                  >
                    Todos os anos
                  </button>
                  {classYears.map((year) => (
                    <button
                      key={year}
                      type="button"
                      className={`cate-filter__opt${classesYearFilter === year ? ' is-on' : ''}`}
                      onClick={() => setClassesYearFilter(year)}
                    >
                      {year} ({classes.filter((k) => k.year === year).length})
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {classesView === 'list' && classesForView.length > 0 && (
            <div className="cate-table-wrap">
              <table className="cate-table cate-table--click">
                <thead>
                  <tr>
                    <th>Turma</th>
                    <th>Etapa</th>
                    <th>Comunidade</th>
                    <th>Dia e horário</th>
                    <th>Sala</th>
                    <th style={{ textAlign: 'right' }}>Ativos</th>
                    <th style={{ textAlign: 'right' }}>Encontros</th>
                    <th>Vagas</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {classesForView
                    .slice()
                    .sort((a, b) => a.stage.name.localeCompare(b.stage.name, 'pt-BR') || a.name.localeCompare(b.name, 'pt-BR'))
                    .map((klass) => (
                      <tr
                        key={klass.id}
                        style={klass.stage.color ? { boxShadow: `inset 3px 0 0 ${klass.stage.color}` } : undefined}
                        onClick={() => openClassDetail(klass)}
                      >
                        <td>
                          <strong>{klass.name}</strong> <span className="cate-list-year">{klass.year}</span>
                          {(klass.occupied ?? klass._count.enrollments) === 0 && (klass.completedCount ?? 0) > 0 && (
                            <span className="cate-badge cate-badge--done" style={{ marginLeft: 6 }} title={`${klass.completedCount} concluído(s) — pronta para distribuir`}>
                              ✓ Concluída
                            </span>
                          )}
                          {(() => {
                            const badge = enrollmentBadge(klass);
                            return badge ? (
                              <span className="cate-badge cate-badge--out" style={{ marginLeft: 6 }} title={badge.title}>
                                {badge.label}
                              </span>
                            ) : null;
                          })()}
                          {classAttention(klass) > 0 && (
                            <span
                              className="cate-badge cate-badge--waiting"
                              style={{ marginLeft: 6 }}
                              title="Abra a turma para resolver"
                            >
                              ⚠ {[
                                klass.pendingApprovalCount ? `${klass.pendingApprovalCount} aprovação(ões)` : null,
                                klass.docsToReviewCount ? `${klass.docsToReviewCount} doc(s)` : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          )}
                        </td>
                        <td>
                          {klass.stage.color && <span className="cate-stage-dot" style={{ background: klass.stage.color }} />}
                          {klass.stage.name}
                        </td>
                        <td>{klass.community.name}</td>
                        <td>
                          {klass.weekday !== null && klass.weekday !== undefined ? WEEKDAYS[klass.weekday] : 'Dia a definir'}
                          {klass.time ? ` às ${klass.time}` : ''}
                        </td>
                        <td>{klass.room || '—'}</td>
                        <td style={{ textAlign: 'right' }}><strong>{klass._count.enrollments}</strong></td>
                        <td style={{ textAlign: 'right' }}>{klass._count.sessions}</td>
                        <td>
                          {klass.capacity != null ? (
                            <span className={`cate-seats ${klass.isFull ? 'is-full' : ''}`}>
                              {klass.isFull ? 'Lotada' : `${klass.openSpots} vaga${klass.openSpots === 1 ? '' : 's'}`}
                              {' '}({klass.occupied ?? 0}/{klass.capacity})
                            </span>
                          ) : (
                            <span className="cate-seats is-open">Sem limite</span>
                          )}
                        </td>
                        <td className="cate-card__open">Abrir →</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          {classesView === 'cards' && (
          <div className="cate-grid">
            {classesForView.map((klass) => (
              <div
                key={klass.id}
                className="cate-card"
                style={klass.stage.color ? { borderTop: `3px solid ${klass.stage.color}` } : undefined}
                onClick={() => openClassDetail(klass)}
              >
                <div className="cate-card__head">
                  <div>
                    <h3 className="cate-card__title">{klass.name}</h3>
                    <p className="cate-card__stage">
                      {klass.stage.color && <span className="cate-stage-dot" style={{ background: klass.stage.color }} />}
                      {klass.stage.name}
                    </p>
                  </div>
                  <span className="cate-year">
                    {klass.year}
                    {(klass.occupied ?? klass._count.enrollments) === 0 && (klass.completedCount ?? 0) > 0 && (
                      <span className="cate-badge cate-badge--done" style={{ display: 'block', marginTop: 4 }}>✓ Concluída</span>
                    )}
                    {(() => {
                      const badge = enrollmentBadge(klass);
                      return badge ? (
                        <span className="cate-badge cate-badge--out" style={{ display: 'block', marginTop: 4 }} title={badge.title}>
                          {badge.label}
                        </span>
                      ) : null;
                    })()}
                  </span>
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
                {classAttention(klass) > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <span className="cate-badge cate-badge--waiting" title="Abra a turma para resolver">
                      ⚠ {[
                        klass.pendingApprovalCount ? `${klass.pendingApprovalCount} inscrição(ões) aguardando` : null,
                        klass.docsToReviewCount ? `${klass.docsToReviewCount} doc(s) p/ conferir` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                )}
                <div className="cate-card__foot">
                  <div className="cate-card__stats">
                    <span><strong>{klass._count.enrollments}</strong> ativos</span>
                    {(klass.completedCount ?? 0) > 0 && (
                      <span><strong>{klass.completedCount}</strong> concluídos</span>
                    )}
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
          )}
          {classes.length === 0 && <div className="cate-empty">Nenhuma turma cadastrada — crie a primeira em “+ Nova Turma”.</div>}
          {classes.length > 0 && classesForView.length === 0 && (
            <div className="cate-empty">
              {classesAttentionOnly
                ? 'Nenhuma turma com pendências neste filtro — desmarque “⚠ Pendências” ou troque o ano.'
                : `Nenhuma turma de ${classesYearFilter} — use “📆 Turma de ${Number(classesYearFilter)}” numa turma do ano anterior para criar a virada.`}
            </div>
          )}
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
              <div className="cate-toolbar__primary">
                <button
                  className="cate-btn cate-btn--primary"
                  onClick={() => {
                    // Sempre abre limpo — um "matricular mesmo assim" marcado num
                    // cancelamento anterior não pode vazar para a próxima matrícula
                    setEnrollForm({ memberId: '', waiveBaptism: false, overrideCapacity: false, unbaptized: false });
                    setShowEnrollModal(true);
                  }}
                >
                  + Matricular
                </button>
                <button className="cate-btn cate-btn--primary" onClick={() => setShowSessionModal(true)}>
                  + Encontro (chamada)
                </button>
                {selectedClass.capacity != null && (
                  <span className={`cate-seats ${selectedClass.isFull ? 'is-full' : ''}`}>
                    {selectedClass.isFull
                      ? `Lotada (${selectedClass.occupied ?? 0}/${selectedClass.capacity})`
                      : `${selectedClass.openSpots} vaga${selectedClass.openSpots === 1 ? '' : 's'} de ${selectedClass.capacity}`}
                  </span>
                )}
              </div>
              <div className="cate-toolbar__groups">
                <div className="cate-actiongroup">
                  <span className="cate-actiongroup__label">Turma</span>
                  <div className="cate-actiongroup__btns">
                    <button className="cate-btn" onClick={openEditClass}>
                      ✏️ Editar
                    </button>
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
                    <button className="cate-btn" title="Quais documentos a turma pede na inscrição e se são obrigatórios" onClick={() => void openDocReqModal()}>
                      📎 Docs da inscrição
                    </button>
                  </div>
                </div>
                <div className="cate-actiongroup">
                  <span className="cate-actiongroup__label">Ciclo do ano</span>
                  <div className="cate-actiongroup__btns">
                    {report && report.active > 0 && (
                      <button className="cate-btn" onClick={() => openBatchComplete()}>🎓 Concluir turma</button>
                    )}
                    {report && report.completed > 0 && (
                      <button className="cate-btn" onClick={() => void openRenewal()}>↻ Renovar / distribuir</button>
                    )}
                    <button className="cate-btn" title="Criar a turma do ano seguinte, mantendo ou ajustando os catequistas" onClick={() => void openRollover(selectedClass)}>
                      📆 Turma de {selectedClass.year + 1}
                    </button>
                  </div>
                </div>
                <div className="cate-actiongroup">
                  <span className="cate-actiongroup__label">Registros</span>
                  <div className="cate-actiongroup__btns">
                    <button className="cate-btn" onClick={() => void openSentNotices()}>
                      ✉ Avisos enviados
                    </button>
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
                </div>
              </div>
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
                  {(report.waitlisted ?? 0) > 0 && (
                    <div className="cate-stat">
                      <div className="cate-stat__value cate-stat__value--warn">{report.waitlisted}</div>
                      <div className="cate-stat__label">Fila de espera</div>
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
                  <section className="cate-sessioncard">
                    <div className="cate-section__head">
                      <h3 className="cate-section__title">Encontros</h3>
                      <button className="cate-btn" onClick={() => void openAttendanceGrid()}>
                        🗒 Folha de presença
                      </button>
                      {sessions.length > 0 && (
                        <div className="cate-filter" role="group" aria-label="Filtro de encontros">
                          <button
                            type="button"
                            className={`cate-filter__opt${sessionsFilter === 'all' ? ' is-on' : ''}`}
                            onClick={() => setSessionsFilter('all')}
                          >
                            Todos ({sessions.length})
                          </button>
                          <button
                            type="button"
                            className={`cate-filter__opt${sessionsFilter === 'open' ? ' is-on' : ''}`}
                            onClick={() => setSessionsFilter('open')}
                          >
                            Abertos ({sessions.filter((s) => s.marked === 0).length})
                          </button>
                          <button
                            type="button"
                            className={`cate-filter__opt${sessionsFilter === 'done' ? ' is-on' : ''}`}
                            onClick={() => setSessionsFilter('done')}
                          >
                            Concluídos ({sessions.filter((s) => s.marked > 0).length})
                          </button>
                        </div>
                      )}
                      <span className="cate-section__hint">Clique num encontro para abrir/editar a chamada</span>
                    </div>
                    {sessions.length === 0 ? (
                      <div className="cate-empty">
                        Nenhum encontro ainda — use “+ Encontro (chamada)” ou gere a agenda do ano.
                      </div>
                    ) : (() => {
                      // Ordem crescente (o ano se lê da esquerda para a direita) + filtro
                      const visibleSessions = sessions
                        .filter((s) =>
                          sessionsFilter === 'all' ? true : sessionsFilter === 'open' ? s.marked === 0 : s.marked > 0,
                        )
                        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                      if (visibleSessions.length === 0) {
                        return (
                          <div className="cate-empty">
                            {sessionsFilter === 'open'
                              ? 'Nenhum encontro aberto — todas as chamadas foram feitas 🎉'
                              : 'Nenhum encontro com chamada ainda.'}
                          </div>
                        );
                      }
                      const shownSessions = sessionsCollapsed
                        ? visibleSessions.slice(0, sessionsPerRow)
                        : visibleSessions;
                      return (
                      <>
                      <div className="cate-sessions" ref={sessionsGridRef}>
                        {shownSessions.map((session) => {
                          const d = new Date(session.date);
                          const fmt = (opts: Intl.DateTimeFormatOptions) =>
                            d.toLocaleDateString('pt-BR', { timeZone: 'UTC', ...opts });
                          return (
                            <div
                              key={session.id}
                              className="cate-session"
                              role="button"
                              tabIndex={0}
                              title={fmt({ weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
                              onClick={() => void openSessionAttendance(session)}
                              onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && void openSessionAttendance(session)}
                            >
                              <span className="cate-session__cal">
                                <span className="cate-session__cal-day">{fmt({ day: '2-digit' })}</span>
                                <span className="cate-session__cal-mon">
                                  {fmt({ month: 'short' }).replace('.', '')} {fmt({ year: '2-digit' })}
                                </span>
                              </span>
                              <span className="cate-session__main">
                                <span className={`cate-session__topic${session.topic ? '' : ' cate-session__topic--none'}`}>
                                  {session.topic || 'Sem tema'}
                                </span>
                                {session.marked === 0 ? (
                                  <span className="cate-session__badge cate-session__badge--todo">sem chamada</span>
                                ) : (
                                  <span className="cate-session__badge cate-session__badge--done">
                                    {session.present}/{session.marked} presentes
                                  </span>
                                )}
                              </span>
                              <span className="cate-session__actions">
                                <button
                                  type="button"
                                  className="cate-session__action"
                                  title="Editar encontro"
                                  aria-label="Editar encontro"
                                  onClick={(e) => { e.stopPropagation(); void handleEditSession(session); }}
                                >
                                  ✏️
                                </button>
                                <button
                                  type="button"
                                  className="cate-session__action cate-session__action--danger"
                                  title="Excluir encontro"
                                  aria-label="Excluir encontro"
                                  onClick={(e) => { e.stopPropagation(); void handleDeleteSession(session); }}
                                >
                                  🗑
                                </button>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {visibleSessions.length > sessionsPerRow && (
                        <button
                          type="button"
                          className="cate-sessions__expand"
                          aria-expanded={!sessionsCollapsed}
                          onClick={toggleSessionsCollapsed}
                        >
                          {sessionsCollapsed ? `⌄ Ver todos os ${visibleSessions.length} encontros ⌄` : '⌃ Recolher ⌃'}
                        </button>
                      )}
                      </>
                      );
                    })()}
                  </section>

                  <section>
                    <div className="cate-section__head">
                      <h3 className="cate-section__title">Catequizandos</h3>
                      {report.active + report.completed > 0 && (
                        <span className="cate-section__hint">
                          Conclusão: <strong>{report.completed}/{report.active + report.completed}</strong>
                        </span>
                      )}
                      {report.students.length > 0 && (
                        <div className="cate-filter" role="group" aria-label="Filtro de catequizandos">
                          <button
                            type="button"
                            className={`cate-filter__opt${studentsFilter === 'current' ? ' is-on' : ''}`}
                            onClick={() => setStudentsFilter('current')}
                          >
                            Na turma ({report.students.filter((s) => CURRENT_ENROLLMENT_STATUSES.includes(s.status)).length})
                          </button>
                          <button
                            type="button"
                            className={`cate-filter__opt${studentsFilter === 'active' ? ' is-on' : ''}`}
                            onClick={() => setStudentsFilter('active')}
                          >
                            Ativos ({report.active})
                          </button>
                          <button
                            type="button"
                            className={`cate-filter__opt${studentsFilter === 'completed' ? ' is-on' : ''}`}
                            onClick={() => setStudentsFilter('completed')}
                          >
                            Concluídos ({report.completed})
                          </button>
                          <button
                            type="button"
                            className={`cate-filter__opt${studentsFilter === 'all' ? ' is-on' : ''}`}
                            onClick={() => setStudentsFilter('all')}
                          >
                            Todas ({report.students.length})
                          </button>
                        </div>
                      )}
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
                            {(() => {
                              const visibleStudents = report.students.filter((s) =>
                                studentsFilter === 'all'
                                  ? true
                                  : studentsFilter === 'active'
                                    ? s.status === 'ACTIVE'
                                    : studentsFilter === 'completed'
                                      ? s.status === 'COMPLETED'
                                      : CURRENT_ENROLLMENT_STATUSES.includes(s.status),
                              );
                              if (visibleStudents.length === 0) {
                                const emptyMessage =
                                  studentsFilter === 'active'
                                    ? 'Nenhum catequizando ativo — todos já concluíram ou saíram da turma.'
                                    : studentsFilter === 'completed'
                                      ? 'Ninguém concluído ainda nesta turma.'
                                      : 'Ninguém ativo, concluído ou aguardando — as matrículas desta turma estão em “Todas”.';
                                return (
                                  <tr>
                                    <td colSpan={5} style={{ color: '#64748b', fontSize: '0.85rem' }}>{emptyMessage}</td>
                                  </tr>
                                );
                              }
                              return visibleStudents.map((student) => {
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
                                    <span className={`cate-badge ${badgeClass}`}>
                                      {st.label}
                                      {student.status === 'WAITLISTED' && student.waitlistPosition ? ` · nº ${student.waitlistPosition}` : ''}
                                    </span>
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
                                        {student.unbaptized && (
                                          <span className={student.baptismReady ? 'cate-baptism cate-baptism--ready' : 'cate-baptism'}>
                                            🕊{' '}
                                            {student.baptismReady
                                              ? 'Apto ao Batismo (1+ ano de catequese)'
                                              : `Preparação p/ Batismo${
                                                  student.baptismSince
                                                    ? ` · desde ${new Date(student.baptismSince).toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric', timeZone: 'UTC' })}`
                                                    : ''
                                                }`}
                                          </span>
                                        )}
                                        {student.pendingDocuments ? (
                                          <span className="cate-doc-pending">📄 {student.pendingDocuments}</span>
                                        ) : student.docsCount === 0 && !student.unbaptized ? (
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
                                      {(student.status === 'PENDING_APPROVAL' || student.status === 'WAITLISTED') && (
                                        <>
                                          <button
                                            className="cate-mini cate-mini--ok"
                                            onClick={() => {
                                              // Aceite da fila é consciente: entra mesmo com a turma
                                              // cheia (+1 vaga acima do limite, auditado)
                                              if (
                                                student.status === 'WAITLISTED' &&
                                                !window.confirm(
                                                  `Aceitar ${student.member.fullName} da fila de espera${student.waitlistPosition ? ` (posição nº ${student.waitlistPosition})` : ''}? Se a turma estiver cheia, entra mesmo assim (+1 vaga acima do limite).`,
                                                )
                                              ) {
                                                return;
                                              }
                                              void handleApprove(student.enrollmentId);
                                            }}
                                          >
                                            {student.status === 'WAITLISTED' ? '✓ Aceitar da fila' : '✓ Aprovar'}
                                          </button>
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
                                          <button
                                            className="cate-mini cate-mini--ok"
                                            onClick={() => handleComplete(student.enrollmentId, student.member.fullName)}
                                          >
                                            Concluir
                                          </button>
                                          <select
                                            className="cate-select"
                                            // Controlado em "": o valor não fica preso após erro e a
                                            // mesma opção pode ser escolhida de novo
                                            value=""
                                            onChange={(e) => handleTransfer(student.enrollmentId, e.target.value, student.member.fullName)}
                                          >
                                            <option value="" disabled>Transferir…</option>
                                            {Object.entries(
                                              classes
                                                .filter((c) => c.id !== selectedClass.id && (c.status === undefined || c.status === 'ACTIVE'))
                                                .reduce<Record<string, CatechesisClass[]>>((acc, c) => {
                                                  (acc[c.stage.name] = acc[c.stage.name] ?? []).push(c);
                                                  return acc;
                                                }, {}),
                                            ).map(([stageName, group]) => (
                                              <optgroup key={stageName} label={stageName}>
                                                {group.map((c) => (
                                                  <option key={c.id} value={c.id} disabled={!!c.isFull}>
                                                    {c.name} · {c.year}
                                                    {c.capacity != null
                                                      ? c.isFull
                                                        ? ' — lotada'
                                                        : ` — ${c.openSpots} vaga${c.openSpots === 1 ? '' : 's'}`
                                                      : ''}
                                                  </option>
                                                ))}
                                              </optgroup>
                                            ))}
                                          </select>
                                        </>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                              });
                            })()}
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
                <label>Cor do tempo (cards e listas)</label>
                <span className="cate-color-picker">
                  {STAGE_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      title={color}
                      className={`cate-color-swatch${stageForm.color === color ? ' is-on' : ''}`}
                      style={{ background: color }}
                      onClick={() => setStageForm({ ...stageForm, color })}
                    />
                  ))}
                  <button
                    type="button"
                    title="Sem cor"
                    className={`cate-color-swatch cate-color-swatch--none${!stageForm.color ? ' is-on' : ''}`}
                    onClick={() => setStageForm({ ...stageForm, color: '' })}
                  >
                    ×
                  </button>
                </span>
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
                  <RoomSelect
                    communityId={classForm.communityId || undefined}
                    value={classForm.room}
                    onChange={(room) => setClassForm({ ...classForm, room })}
                  />
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
                  checked={enrollForm.unbaptized}
                  onChange={(e) => setEnrollForm({ ...enrollForm, unbaptized: e.target.checked })}
                />
                Ainda não foi batizado(a) — entra em preparação para o Batismo (1 ano de catequese antes de receber o sacramento)
              </label>
              {!enrollForm.unbaptized && (
                <label className="form-check">
                  <input
                    type="checkbox"
                    checked={enrollForm.waiveBaptism}
                    onChange={(e) => setEnrollForm({ ...enrollForm, waiveBaptism: e.target.checked })}
                  />
                  Dispensar comprovação de Batismo (ex.: etapa de preparação para o próprio Batismo)
                </label>
              )}
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
                <RoomSelect
                  communityId={selectedClass.communityId}
                  value={editClassForm.room}
                  onChange={(room) => setEditClassForm({ ...editClassForm, room })}
                />
              </div>
              <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 0.8rem' }}>
                Deixe as vagas em branco para turma sem limite. O limite vale para a inscrição online e para a matrícula na secretaria.
              </p>

              <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '0.7rem 0.9rem', marginBottom: '0.6rem' }}>
                <strong style={{ fontSize: '0.85rem' }}>Inscrições online</strong>
                <label className="form-check" style={{ marginTop: 6 }}>
                  <input
                    type="checkbox"
                    checked={editClassForm.enrollmentOpen}
                    onChange={(e) => setEditClassForm({ ...editClassForm, enrollmentOpen: e.target.checked })}
                  />
                  Inscrições abertas (desligue no fim do ano — a turma some da inscrição do app)
                </label>
                <div className="form-row">
                  <div className="form-group">
                    <label>Abrem em (opcional)</label>
                    <input
                      type="date"
                      value={editClassForm.enrollmentOpensAt}
                      onChange={(e) => setEditClassForm({ ...editClassForm, enrollmentOpensAt: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Encerram em (opcional)</label>
                    <input
                      type="date"
                      value={editClassForm.enrollmentClosesAt}
                      onChange={(e) => setEditClassForm({ ...editClassForm, enrollmentClosesAt: e.target.value })}
                    />
                  </div>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Quando a turma estiver cheia</label>
                  <select
                    value={editClassForm.fullBehavior}
                    onChange={(e) => setEditClassForm({ ...editClassForm, fullBehavior: e.target.value as 'WAITLIST' | 'BLOCK' })}
                  >
                    <option value="WAITLIST">Aceitar em fila de espera (a coordenação decide, abrindo +1 vaga)</option>
                    <option value="BLOCK">Bloquear — avisar que a turma não aceita mais inscrições no ano</option>
                  </select>
                </div>
              </div>

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
          <div className="module-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680 }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              Documentos · {docTarget.fullName}
              <button
                type="button"
                className="cate-mini"
                aria-label="Atualizar documentos"
                title="Atualizar (a conferência automática roda em segundos)"
                onClick={() => {
                  void refreshDocList(docTarget.enrollmentId);
                  if (selectedClass) refreshDocReqs(selectedClass.id);
                }}
              >
                <span aria-hidden="true">↻</span>
              </button>
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 0.8rem' }}>
              Documento <strong>aceito fica armazenado</strong> no prontuário da matrícula (e some junto dela);
              documento <strong>recusado é apagado</strong> na hora. A <strong>conferência automática 🤖</strong> envia
              o arquivo para leitura por IA de provedor externo (Anthropic — que não o retém) e compara nome e
              nascimento com o cadastro; a decisão final é <strong>sempre da equipe</strong> — trate o resultado
              como sugestão.
            </p>
            <input
              ref={docFileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              style={{ display: 'none' }}
              onChange={(e) => void handleDocFileChosen(e)}
            />

            {docReqsError && (
              <p style={{ color: '#b45309', fontSize: '0.85rem' }}>
                Não foi possível carregar o que a turma pede —{' '}
                <button type="button" className="link-button" onClick={() => selectedClass && refreshDocReqs(selectedClass.id)}>
                  tentar de novo
                </button>
              </p>
            )}
            {docReqs && docReqs.length > 0 && docList !== null && (
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '0.6rem 0.8rem', marginBottom: '0.8rem', background: '#f8fafc' }}>
                <strong style={{ fontSize: '0.82rem', color: '#475569' }}>O que a turma pede{docReqs[0]?.isDefault ? ' (padrão)' : ''}:</strong>
                {docReqs.map((req) => {
                  const docs = (docList ?? []).filter((d) => d.kind.toLowerCase() === req.kind.toLowerCase());
                  const verified = docs.find((d) => d.status === 'VERIFIED');
                  const submitted = docs.find((d) => d.status === 'SUBMITTED');
                  // SUBMITTED tem precedência: reenvio novo não pode ficar
                  // escondido atrás de um "✓ conferido" antigo
                  const state = submitted
                    ? submitted.declaration
                      ? { label: 'declaração aguarda aceite', cls: 'cate-badge--waiting' }
                      : { label: 'aguarda conferência', cls: 'cate-badge--waiting' }
                    : verified
                      ? verified.declaration === 'NOT_HAVE'
                        ? { label: 'não tem (aceito)', cls: 'cate-badge--done' }
                        : verified.declaration === 'OTHER_DENOMINATION'
                          ? { label: 'outra denominação (aceito)', cls: 'cate-badge--done' }
                          : { label: '✓ conferido', cls: 'cate-badge--done' }
                      : docs.some((d) => d.status === 'REJECTED')
                        ? { label: 'recusado — pedir de novo', cls: 'cate-badge--out' }
                        : { label: 'faltando', cls: 'cate-badge--out' };
                  return (
                    <div key={req.kind} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '0.3rem 0' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                        {req.kind}
                        {req.required && <span style={{ color: '#b91c1c', fontSize: '0.7rem', fontWeight: 700 }}> · obrigatório</span>}
                      </span>
                      <span className={`cate-badge ${state.cls}`}>{state.label}</span>
                      {!verified && !submitted && (
                        <span style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                          <button className="cate-mini" disabled={uploadingDoc} onClick={() => startDocUpload(req.kind)}>
                            📤 Enviar arquivo
                          </button>
                          {req.allowNotHave && (
                            <button className="cate-mini" disabled={uploadingDoc} onClick={() => void handleDeclare(req.kind, 'NOT_HAVE')}>
                              Não tem
                            </button>
                          )}
                          {req.allowOtherDenomination && (
                            <button className="cate-mini" disabled={uploadingDoc} onClick={() => void handleDeclare(req.kind, 'OTHER_DENOMINATION')}>
                              Outra denominação…
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

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
                {doc.declaration ? (
                  <span style={{ color: '#b45309', fontSize: '0.84rem', fontWeight: 600 }}>
                    {' '}· {doc.declaration === 'NOT_HAVE' ? 'Declarou que NÃO TEM o documento' : `Batismo em outra denominação: ${doc.denomination}`}
                  </span>
                ) : (
                  <span style={{ color: '#64748b', fontSize: '0.82rem' }}>
                    {' '}· {doc.fileName} · {(doc.sizeBytes / 1024 / 1024).toFixed(1)} MB ·{' '}
                    {new Date(doc.createdAt).toLocaleDateString('pt-BR')}
                  </span>
                )}
                {!doc.declaration && doc.status === 'SUBMITTED' && (
                  <div style={{ marginTop: 4 }}>
                    {doc.autoCheckStatus === 'MATCH' && (
                      <span style={{ fontSize: '0.78rem', color: '#15803d', fontWeight: 600 }}>🤖 {doc.autoCheckNotes}</span>
                    )}
                    {doc.autoCheckStatus === 'MISMATCH' && (
                      <>
                        <span style={{ fontSize: '0.78rem', color: '#b45309', fontWeight: 700 }}>🤖 {doc.autoCheckNotes}</span>
                        {(doc.extractedName || doc.extractedBirthDate) && (
                          <button
                            className="cate-mini"
                            style={{ marginLeft: 6 }}
                            onClick={() => void handleApplyCorrection(doc)}
                          >
                            ✎ Corrigir cadastro pelo documento
                          </button>
                        )}
                      </>
                    )}
                    {doc.autoCheckStatus === 'UNREADABLE' && (
                      <span style={{ fontSize: '0.78rem', color: '#64748b' }}>🤖 {doc.autoCheckNotes}</span>
                    )}
                    {doc.autoCheckStatus === 'SKIPPED' && (
                      <span style={{ fontSize: '0.78rem', color: '#94a3b8' }} title={doc.autoCheckNotes ?? undefined}>🤖 sem conferência automática</span>
                    )}
                    {!doc.autoCheckStatus && (
                      <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>🤖 conferindo automaticamente… (↻ para atualizar)</span>
                    )}
                  </div>
                )}
                <div style={{ marginTop: '0.45rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {!doc.declaration && doc.hasFile && doc.status !== 'SUBMITTED' && (
                    <button className="cate-mini" onClick={() => openDocumentFile(doc.id)}>👁 Ver arquivo</button>
                  )}
                  {doc.status === 'SUBMITTED' && (
                    <>
                      {!doc.declaration && (
                        <button className="cate-mini" onClick={() => openDocumentFile(doc.id)}>👁 Ver arquivo</button>
                      )}
                      <button
                        className="cate-mini cate-mini--ok"
                        disabled={reviewingDoc === doc.id}
                        onClick={() => handleReviewDocument(doc.id, true)}
                      >
                        {doc.declaration ? '✓ Aceitar declaração' : '✓ Conferido (dar baixa)'}
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
                      {doc.declaration === 'OTHER_DENOMINATION'
                        ? 'Aceito — batismo registrado na ficha'
                        : doc.declaration === 'NOT_HAVE'
                          ? 'Declaração aceita'
                          : 'Conferido'}{' '}
                      em {doc.reviewedAt ? new Date(doc.reviewedAt).toLocaleDateString('pt-BR') : '—'}
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

      {showDocReqModal && selectedClass && (
        <div className="module-modal-overlay" onClick={() => setShowDocReqModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h2>📎 Documentos da inscrição · {selectedClass.name}</h2>
            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 0.8rem' }}>
              O que a turma pede na matrícula. <strong>Obrigatório</strong> = precisa ser resolvido;{' '}
              <strong>“não tenho”</strong> = a família pode declarar que o catequizando não tem o documento;{' '}
              <strong>outra denominação</strong> = aceita batismo de outra igreja cristã (a equipe aceita ou recusa).
            </p>
            <form onSubmit={handleSaveDocReq}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                {docReqItems.map((item, index) => (
                  <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #e2e8f0', borderRadius: 10, padding: '0.45rem 0.6rem', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      required
                      maxLength={80}
                      placeholder="Nome do documento"
                      value={item.kind}
                      style={{ flex: '1 1 180px', minWidth: 140 }}
                      onChange={(e) => setDocReqItems(docReqItems.map((it, i) => (i === index ? { ...it, kind: e.target.value } : it)))}
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={item.required}
                        style={{ width: 'auto' }}
                        onChange={(e) => setDocReqItems(docReqItems.map((it, i) => (i === index ? { ...it, required: e.target.checked } : it)))}
                      />
                      obrigatório
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={item.allowNotHave}
                        style={{ width: 'auto' }}
                        onChange={(e) => setDocReqItems(docReqItems.map((it, i) => (i === index ? { ...it, allowNotHave: e.target.checked } : it)))}
                      />
                      aceita “não tenho”
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={item.allowOtherDenomination}
                        style={{ width: 'auto' }}
                        onChange={(e) => setDocReqItems(docReqItems.map((it, i) => (i === index ? { ...it, allowOtherDenomination: e.target.checked } : it)))}
                      />
                      outra denominação
                    </label>
                    <button
                      type="button"
                      className="cate-chip__remove"
                      aria-label={`Remover ${item.kind || 'documento'}`}
                      title="Remover documento"
                      onClick={() => setDocReqItems(docReqItems.filter((_, i) => i !== index))}
                    >
                      <span aria-hidden="true">🗑</span>
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="btn-small"
                style={{ marginTop: 8 }}
                disabled={docReqItems.length >= 12}
                onClick={() => setDocReqItems([...docReqItems, { kind: '', required: false, allowNotHave: false, allowOtherDenomination: false }])}
              >
                + Adicionar documento
              </button>
              <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '8px 0 0' }}>
                Padrão sugerido: Certidão de nascimento (obrigatório) · CPF (aceita “não tenho”) · Certidão de
                Batismo (aceita “não tenho” e outra denominação).
              </p>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowDocReqModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit" disabled={savingDocReq || loadingDocReq || docReqItems.length === 0}>
                  {loadingDocReq ? 'Carregando…' : savingDocReq ? 'Salvando…' : 'Salvar documentos'}
                </button>
              </div>
            </form>
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

      {gridData && selectedClass && (() => {
        const markMap = new Map(gridData.marks.map((m) => [`${m.sessionId}:${m.enrollmentId}`, m]));
        return (
          <div className="cate-board-overlay" role="dialog" aria-modal="true" aria-label="Folha de presença">
            <div className="cate-board__top">
              <div>
                <strong className="cate-board__title">
                  🗒 Folha de presença · {selectedClass.name} ({selectedClass.year})
                </strong>
                <span className="cate-board__count">
                  Clique na célula para lançar: presente → falta → falta justificada → limpar · cada clique já grava
                </span>
              </div>
              <div className="cate-board__topbtns">
                <button type="button" className="cate-btn" onClick={closeAttendanceGrid}>
                  Fechar
                </button>
              </div>
            </div>
            {gridData.sessions.length === 0 ? (
              <p className="cate-board__emptycol">Nenhum encontro criado ainda — use “+ Encontro (chamada)” ou gere a agenda do ano.</p>
            ) : (
              <div className="cate-gridwrap">
                <table className="cate-gridtable">
                  <thead>
                    <tr>
                      <th className="cate-gridtable__name">Catequizando</th>
                      {gridData.sessions.map((session) => (
                        <th key={session.id} title={session.topic || undefined}>
                          {new Date(session.date).toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit' })}
                        </th>
                      ))}
                      <th className="cate-gridtable__pct">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gridData.students.map((student) => {
                      let presentCount = 0;
                      let markedCount = 0;
                      gridData.sessions.forEach((session) => {
                        const mark = markMap.get(`${session.id}:${student.enrollmentId}`);
                        if (mark) {
                          markedCount += 1;
                          if (mark.present) presentCount += 1;
                        }
                      });
                      const pct = markedCount === 0 ? null : Math.round((presentCount / markedCount) * 100);
                      return (
                        <tr key={student.enrollmentId}>
                          <td className="cate-gridtable__name">
                            {student.member.fullName}
                            {student.status === 'COMPLETED' && <span className="cate-gridtable__done"> · concluído</span>}
                          </td>
                          {gridData.sessions.map((session) => {
                            const key = `${session.id}:${student.enrollmentId}`;
                            const mark = markMap.get(key);
                            const saving = !!gridSavingCells[key];
                            let cellClass = 'cate-cell';
                            let label = '·';
                            let title = 'Sem chamada — clique para marcar presente';
                            if (mark) {
                              if (mark.present) {
                                cellClass += ' is-p';
                                label = 'P';
                                title = mark.late ? 'Presente (com atraso) — clique para marcar falta' : 'Presente — clique para marcar falta';
                                if (mark.late) cellClass += ' is-late';
                              } else if (mark.justified) {
                                cellClass += ' is-j';
                                label = 'FJ';
                                title = 'Falta justificada — clique para limpar o lançamento';
                              } else {
                                cellClass += ' is-f';
                                label = 'F';
                                title = 'Falta — clique para marcar falta justificada';
                              }
                            }
                            return (
                              <td key={session.id}>
                                <span className="cate-cellwrap">
                                  <button
                                    type="button"
                                    className={cellClass}
                                    disabled={saving}
                                    title={title}
                                    onClick={() => cycleGridCell(session.id, student.enrollmentId, mark)}
                                  >
                                    {saving ? '…' : label}
                                  </button>
                                  {mark && !mark.present && mark.justified && (
                                    <button
                                      type="button"
                                      className={`cate-cell__clip${mark.hasCertificate ? ' has-file' : ''}`}
                                      title={mark.hasCertificate ? 'Visualizar o atestado anexado' : 'Anexar atestado desta falta'}
                                      onClick={() =>
                                        mark.hasCertificate
                                          ? void openAbsenceCertificate(session.id, student.enrollmentId)
                                          : promptGridCertificate(session.id, student.enrollmentId)
                                      }
                                    >
                                      📎
                                    </button>
                                  )}
                                </span>
                              </td>
                            );
                          })}
                          <td className="cate-gridtable__pct">{pct === null ? '—' : `${pct}%`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="cate-gridtable__name">Presentes</td>
                      {gridData.sessions.map((session) => {
                        let present = 0;
                        let marked = 0;
                        gridData.students.forEach((student) => {
                          const mark = markMap.get(`${session.id}:${student.enrollmentId}`);
                          if (mark) {
                            marked += 1;
                            if (mark.present) present += 1;
                          }
                        });
                        return (
                          <td key={session.id} className="cate-gridtable__total">
                            {marked === 0 ? '—' : `${present}/${marked}`}
                          </td>
                        );
                      })}
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <p className="cate-grid__legend">
              <span className="cate-cell is-p cate-cell--legend">P</span> presente
              <span className="cate-cell is-p is-late cate-cell--legend">P</span> com atraso
              <span className="cate-cell is-f cate-cell--legend">F</span> falta
              <span className="cate-cell is-j cate-cell--legend">FJ</span> falta justificada
              <span className="cate-cell__clip has-file cate-cell--legend">📎</span> atestado anexado
            </p>
            <input
              type="file"
              hidden
              ref={gridCertInputRef}
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => void handleGridCertificateFile(e)}
            />
          </div>
        );
      })()}

      {renewal && selectedClass && (!renewal.nextStage || renewal.targetClasses.length === 0 || renewal.students.length === 0) && (
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
                etapa nesta comunidade — na aba <strong>“Encerramento do ano”</strong>, use{' '}
                <strong>📆 Criar</strong> na turma dessa etapa para gerar a versão do ano novo
                (mantendo ou trocando os catequistas) e depois volte aqui para distribuir.
              </p>
            ) : (
              <p>Nenhum catequizando concluído nesta turma para renovar.</p>
            )}
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setRenewal(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {renewal && selectedClass && renewal.nextStage && renewal.targetClasses.length > 0 && renewal.students.length > 0 && (() => {
        const placedBefore = renewal.students.filter((s) => s.alreadyEnrolledIn || placedLocalIds[s.enrollmentId]).length;
        const draftCount = Object.keys(renewalDraft).length;
        const selectedCount = Object.entries(renewalSelection).filter(([id, on]) => on && !renewalDraft[id]).length;
        const originCards = renewal.students.filter((s) => !renewalDraft[s.enrollmentId]);
        const nextColor = renewal.nextStage!.color ?? undefined;
        // Filtro de ano de destino: na virada, 2026 conclui e 2027 recebe.
        // O ano seguinte entra SEMPRE como opção, mesmo sem turmas criadas —
        // selecioná-lo mostra o aviso de criar as turmas do ano novo
        const targetYears = [...new Set([selectedClass.year + 1, ...renewal.targetClasses.map((t) => t.year)])].sort(
          (a, b) => b - a,
        );
        const visibleTargets = boardYearFilter === 'all' ? renewal.targetClasses : renewal.targetClasses.filter((t) => t.year === boardYearFilter);
        const hiddenDraftCount = Object.values(renewalDraft).filter((tgt) => !visibleTargets.some((t) => t.id === tgt)).length;
        return (
          <div
            className="cate-board-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Distribuir concluídos"
            ref={boardRef}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                if (!renewing) closeBoard();
              } else if (e.key === 'Tab') {
                // Trap simples: Tab circula dentro do overlay
                const focusables = boardRef.current?.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), [href], input, select, textarea',
                );
                if (focusables && focusables.length) {
                  const first = focusables[0];
                  const last = focusables[focusables.length - 1];
                  if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                  } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                  }
                }
              }
            }}
          >
            <div className="cate-board__top">
              <div>
                <strong className="cate-board__title">
                  Distribuir concluídos · {selectedClass.name} ({selectedClass.year}) → {renewal.nextStage!.name}
                </strong>
                <span className="cate-board__count">
                  {placedBefore > 0 ? `${placedBefore} já realocado(s) · ` : ''}
                  {draftCount} em rascunho — nada é gravado até confirmar
                  {hiddenDraftCount > 0 ? ` · ${hiddenDraftCount} em coluna(s) de outro ano (oculta)` : ''}
                  {draftCount === 0 ? ' · arraste os nomes para as turmas' : ''}
                </span>
              </div>
              <div className="cate-filter" role="group" aria-label="Ano das turmas de destino">
                {targetYears.map((year) => (
                  <button
                    key={year}
                    type="button"
                    className={`cate-filter__opt${boardYearFilter === year ? ' is-on' : ''}`}
                    onClick={() => setBoardYearFilter(year)}
                  >
                    Destino {year}
                  </button>
                ))}
                <button
                  type="button"
                  className={`cate-filter__opt${boardYearFilter === 'all' ? ' is-on' : ''}`}
                  onClick={() => setBoardYearFilter('all')}
                >
                  Todos
                </button>
              </div>
              <div className="cate-board__topbtns">
                <button type="button" className="cate-btn" disabled={!draftMoves.length || renewing} onClick={undoLastMove}>
                  ⌫ Desfazer
                </button>
                <button type="button" className="cate-btn" disabled={renewing} onClick={closeBoard}>
                  Fechar
                </button>
                <button
                  type="button"
                  className="cate-btn cate-btn--primary"
                  disabled={renewing || draftCount === 0}
                  onClick={() => void handleConfirmBoard()}
                >
                  {renewing ? 'Gravando…' : `Confirmar distribuição (${draftCount})`}
                </button>
              </div>
            </div>
            <div className="cate-board__cols">
              <div
                className={`cate-board__col${dragOverCol === 'origin' ? ' is-dragover' : ''}`}
                onDragOver={(e) => {
                  // A origem só recebe cards que estão em alguma coluna destino
                  if (dragIdsRef.current.some((id) => renewalDraft[id])) dragOverColumn(e, 'origin');
                }}
                onDragLeave={(e) => dragLeaveColumn(e, 'origin')}
                onDrop={(e) => {
                  e.preventDefault();
                  const ids = dragIdsRef.current;
                  endDrag();
                  returnToOrigin(ids);
                }}
              >
                <div className="cate-board__colhead">
                  {renewal.stage.color && <span className="cate-stage-dot" style={{ background: renewal.stage.color }} />}
                  <strong>Concluídos · {selectedClass.name}</strong>
                  <span className="cate-board__year">{selectedClass.year}</span>
                </div>
                <p className="cate-board__sub">
                  {selectedClass.weekday !== null && selectedClass.weekday !== undefined ? WEEKDAYS[selectedClass.weekday] : 'Dia a definir'}
                  {selectedClass.time ? ` às ${selectedClass.time}` : ''}
                  {selectedClass.room ? ` · ${selectedClass.room}` : ''}
                </p>
                <div className="cate-board__links">
                  <button
                    type="button"
                    className="link-button"
                    onClick={() =>
                      setRenewalSelection(() => {
                        const next: Record<string, boolean> = {};
                        renewal.students.forEach((s) => {
                          next[s.enrollmentId] =
                            s.eligible && !s.alreadyEnrolledIn && !renewalDraft[s.enrollmentId] && !placedLocalIds[s.enrollmentId];
                        });
                        return next;
                      })
                    }
                  >
                    Selecionar elegíveis
                  </button>
                  <button type="button" className="link-button" onClick={() => setRenewalSelection({})}>
                    Limpar
                  </button>
                </div>
                <div className="cate-board__cards">
                  {originCards.length === 0 && <p className="cate-board__emptycol">Todos distribuídos 🎉</p>}
                  {originCards.map((s) => {
                    const placed = s.alreadyEnrolledIn;
                    const placedLocal = placedLocalIds[s.enrollmentId];
                    if (placed || placedLocal) {
                      const note = placed
                        ? placed.outsideParish
                          ? 'já em outra paróquia'
                          : `já na ${placed.className}`
                        : `já na ${placedLocal}`;
                      return (
                        <div key={s.enrollmentId} className="cate-board__card cate-board__card--placed" title="Já realocado — resolva por transferência se precisar mudar">
                          <span>{s.member.fullName}</span>
                          <span className="cate-board__cardnote">{note}</span>
                        </div>
                      );
                    }
                    const on = !!renewalSelection[s.enrollmentId];
                    return (
                      <button
                        key={s.enrollmentId}
                        type="button"
                        className={`cate-board__card${on ? ' is-selected' : ''}${draggingIds.includes(s.enrollmentId) ? ' is-dragging' : ''}`}
                        aria-pressed={on}
                        draggable={!renewing}
                        onDragStart={(e) => {
                          // Arrastar um card selecionado leva a leva selecionada inteira
                          const group = on
                            ? Object.entries(renewalSelection)
                                .filter(([gid, checked]) => checked && !renewalDraft[gid])
                                .map(([gid]) => gid)
                            : [s.enrollmentId];
                          startDrag(e, group.length ? group : [s.enrollmentId], s.member.fullName);
                        }}
                        onDragEnd={endDrag}
                        onClick={() => setRenewalSelection((prev) => ({ ...prev, [s.enrollmentId]: !on }))}
                      >
                        <span>{s.member.fullName}</span>
                        {s.unbaptized && <span className="cate-board__tag cate-board__tag--dove">🕊</span>}
                        {s.missingDocuments && <span className="cate-board__tag cate-board__tag--warn">📄 {s.missingDocuments}</span>}
                        {on && <span className="cate-board__checkmark">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
              {visibleTargets.length === 0 && (
                <div className="cate-board__col">
                  <p className="cate-board__emptycol">
                    Nenhuma turma de destino {boardYearFilter !== 'all' ? `de ${boardYearFilter}` : ''} — crie as turmas do
                    ano novo na aba “Encerramento do ano” (📆 Criar) e reabra a distribuição.
                    {renewal.targetClasses.length > 0 ? ' Turmas de outros anos aparecem pelo filtro acima.' : ''}
                  </p>
                </div>
              )}
              {visibleTargets.map((t) => {
                const draftN = draftCountFor(t.id);
                const free = t.capacity == null ? null : t.capacity - t.occupied - draftN;
                const fullNow = free !== null && free <= 0;
                const status = columnStatus[t.id];
                const cards = renewal.students.filter((s) => renewalDraft[s.enrollmentId] === t.id);
                return (
                  <div
                    key={t.id}
                    className={`cate-board__col cate-board__col--dest${dragOverCol === t.id ? ' is-dragover' : ''}`}
                    style={nextColor ? { borderTopColor: nextColor } : undefined}
                    onDragOver={(e) => dragOverColumn(e, t.id)}
                    onDragLeave={(e) => dragLeaveColumn(e, t.id)}
                    onDrop={(e) => {
                      e.preventDefault();
                      const ids = dragIdsRef.current;
                      endDrag();
                      moveIdsTo(t, ids);
                    }}
                  >
                    <div className="cate-board__colhead">
                      <strong>{t.name}</strong>
                      <span className="cate-board__year">{t.year}</span>
                      {fullNow && <span className="cate-seats is-full">lotada</span>}
                      {status === 'saving' && <span className="cate-board__status">gravando…</span>}
                      {status === 'ok' && <span className="cate-board__status cate-board__status--ok">✓ gravada</span>}
                      {status === 'error' && <span className="cate-board__status cate-board__status--err">⚠ falhou — ajuste e confirme de novo</span>}
                    </div>
                    <p className="cate-board__sub">
                      {t.weekday !== null && t.weekday !== undefined ? WEEKDAYS[t.weekday] : 'Dia a definir'}
                      {t.time ? ` às ${t.time}` : ''}
                      {t.room ? ` · ${t.room}` : ''}
                    </p>
                    {t.capacity != null ? (
                      <>
                        <div className="cate-board__meter" title="Ocupadas = matrículas ativas + inscrições aguardando aprovação (elas seguram vaga até a análise)">
                          <span className="cate-board__meter-used" style={{ width: `${Math.min(100, (t.occupied / t.capacity) * 100)}%` }} />
                          <span
                            className="cate-board__meter-draft"
                            style={{ width: `${Math.min(100, (draftN / t.capacity) * 100)}%`, color: nextColor ?? 'currentColor' }}
                          />
                        </div>
                        <p className="cate-board__meterlabel">
                          {t.occupied}/{t.capacity} ocupadas
                          {draftN > 0 && <strong> · +{draftN} nesta distribuição</strong>}
                          {` · ${Math.max(0, free ?? 0)} livre${(free ?? 0) === 1 ? '' : 's'}`}
                        </p>
                      </>
                    ) : (
                      <p className="cate-board__meterlabel">Sem limite de vagas{draftN > 0 ? ` · +${draftN} nesta distribuição` : ''}</p>
                    )}
                    <div className="cate-board__cards">
                      {cards.map((s) => (
                        <div
                          key={s.enrollmentId}
                          className={`cate-board__card cate-board__card--draft${draggingIds.includes(s.enrollmentId) ? ' is-dragging' : ''}`}
                          draggable={!renewing}
                          onDragStart={(e) => startDrag(e, [s.enrollmentId], s.member.fullName)}
                          onDragEnd={endDrag}
                        >
                          <span>{s.member.fullName}</span>
                          {s.unbaptized && <span className="cate-board__tag cate-board__tag--dove">🕊</span>}
                          <button
                            type="button"
                            className="cate-chip__remove"
                            title="Voltar para a origem"
                            disabled={renewing}
                            onClick={() => returnToOrigin([s.enrollmentId])}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className={`cate-board__move${dragOverCol === t.id && draggingIds.length ? ' is-drop' : ''}`}
                      style={nextColor ? { borderColor: nextColor, color: nextColor } : undefined}
                      disabled={renewing || selectedCount === 0}
                      onClick={() => moveSelectedTo(t)}
                    >
                      {dragOverCol === t.id && draggingIds.length
                        ? `Soltar ${draggingIds.length} aqui`
                        : `Mover ${selectedCount || ''} para cá${free !== null && selectedCount > free ? ` (cabem ${Math.max(0, free)})` : ''}`}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {rolloverSource && (
        <div className="module-modal-overlay" onClick={closeRollover}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>📆 Criar turma de {rolloverForm.year || rolloverSource.year + 1}</h2>
            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 0.8rem' }}>
              A partir da <strong>{rolloverSource.name} ({rolloverSource.year})</strong> — mesma etapa
              ({rolloverSource.stage.name}) e comunidade. Dia, horário, sala, vagas e catequistas vêm
              preenchidos; ajuste o que mudar no ano novo.
            </p>
            <form onSubmit={handleRollover}>
              <div className="form-row">
                <div className="form-group">
                  <label>Nome da turma *</label>
                  <input type="text" required value={rolloverForm.name} onChange={(e) => setRolloverForm({ ...rolloverForm, name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Ano *</label>
                  <input
                    type="number"
                    required
                    min={rolloverSource.year + 1}
                    value={rolloverForm.year}
                    onChange={(e) => setRolloverForm({ ...rolloverForm, year: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Dia da semana</label>
                  <select value={rolloverForm.weekday} onChange={(e) => setRolloverForm({ ...rolloverForm, weekday: e.target.value })}>
                    <option value="">A definir</option>
                    {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Horário</label>
                  <input type="time" value={rolloverForm.time} onChange={(e) => setRolloverForm({ ...rolloverForm, time: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Sala/local</label>
                  <RoomSelect
                    communityId={rolloverSource.communityId}
                    value={rolloverForm.room}
                    onChange={(room) => setRolloverForm({ ...rolloverForm, room })}
                  />
                </div>
                <div className="form-group">
                  <label>Vagas</label>
                  <input
                    type="number"
                    min={1}
                    placeholder="Sem limite"
                    value={rolloverForm.capacity}
                    onChange={(e) => setRolloverForm({ ...rolloverForm, capacity: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-group">
                <div className="cate-team-pick__head">
                  <label style={{ margin: 0 }}>Equipe no ano novo</label>
                  {rolloverCatechists && rolloverCatechists.length > 0 && (
                    <span className="cate-team-pick__count">
                      {rolloverCatechists.filter((c) => rolloverKeep[c.memberId]).length} de {rolloverCatechists.length} continuam
                    </span>
                  )}
                </div>
                {rolloverCatechists === null ? (
                  <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Carregando a equipe atual...</p>
                ) : rolloverCatechists.length === 0 ? (
                  <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
                    Esta turma não tem catequistas vinculados — adicione na turma nova com “+ Catequista”.
                  </p>
                ) : (
                  <div className="cate-team-pick">
                    {rolloverCatechists.map((c) => {
                      const on = !!rolloverKeep[c.memberId];
                      return (
                        <button
                          type="button"
                          key={c.memberId}
                          className={`cate-team-pick__row${on ? ' is-on' : ''}`}
                          aria-pressed={on}
                          onClick={() => setRolloverKeep({ ...rolloverKeep, [c.memberId]: !on })}
                        >
                          <span className="cate-chip__avatar">{initials(c.fullName)}</span>
                          <span className="cate-team-pick__name">
                            {c.fullName}
                            <small>{c.role}</small>
                          </span>
                          <span className={`cate-team-pick__mark${on ? '' : ' is-off'}`}>{on ? '✓ continua' : 'sai'}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '0.4rem 0 0' }}>
                  Toque no catequista para alternar. Para <strong>adicionar</strong> gente nova, abra a turma criada e
                  use “+ Catequista” (a regra da pastoral da Catequese continua valendo).
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={closeRollover}>Cancelar</button>
                <button type="submit" className="btn-submit" disabled={savingRollover || rolloverCatechists === null}>
                  {savingRollover ? 'Criando…' : 'Criar turma do ano novo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showBatchComplete && selectedClass && report && (
        <div className="module-modal-overlay" onClick={() => setShowBatchComplete(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h2>🎓 Concluir turma · {selectedClass.name}</h2>
            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 0.8rem' }}>
              A mesma data e ministro valem para todos os selecionados.
              {selectedClass.stage.sacramentType && (
                <>
                  {' '}Esta etapa <strong>registra o sacramento
                  ({SACRAMENT_LABELS[selectedClass.stage.sacramentType] ?? selectedClass.stage.sacramentType})</strong> na
                  ficha de cada um.
                </>
              )}{' '}
              Uma pendência no meio do lote não derruba as demais — o resultado sai por catequizando.
            </p>
            <form onSubmit={handleBatchComplete}>
              <div className="cate-board__links" style={{ marginBottom: '0.4rem' }}>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    const next: Record<string, boolean> = {};
                    report.students.filter((s) => s.status === 'ACTIVE').forEach((s) => {
                      next[s.enrollmentId] = true;
                    });
                    setBatchCompleteSelection(next);
                  }}
                >
                  Marcar todos
                </button>
                <button type="button" className="link-button" onClick={() => setBatchCompleteSelection({})}>
                  Limpar
                </button>
              </div>
              <div className="checklist" style={{ maxHeight: 220, overflowY: 'auto', marginBottom: '0.8rem' }}>
                {report.students
                  .filter((student) => student.status === 'ACTIVE')
                  .map((student) => (
                    <label key={student.enrollmentId}>
                      <input
                        type="checkbox"
                        checked={!!batchCompleteSelection[student.enrollmentId]}
                        onChange={(e) =>
                          setBatchCompleteSelection({ ...batchCompleteSelection, [student.enrollmentId]: e.target.checked })
                        }
                      />
                      {student.member.fullName}
                      {student.unbaptized ? ' 🕊' : ''}
                    </label>
                  ))}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Data da conclusão *</label>
                  <input
                    type="date"
                    required
                    value={batchCompleteForm.date}
                    onChange={(e) => setBatchCompleteForm({ ...batchCompleteForm, date: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Ministro {selectedClass.stage.sacramentType ? '(sai no registro do sacramento)' : '(opcional)'}</label>
                  <input
                    type="text"
                    maxLength={120}
                    placeholder="Ex.: Pe. João"
                    value={batchCompleteForm.minister}
                    onChange={(e) => setBatchCompleteForm({ ...batchCompleteForm, minister: e.target.value })}
                  />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowBatchComplete(false)}>Cancelar</button>
                <button type="submit" className="btn-submit" disabled={savingBatchComplete}>
                  {savingBatchComplete
                    ? 'Concluindo…'
                    : `Concluir ${Object.values(batchCompleteSelection).filter(Boolean).length} catequizando(s)`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {chatTarget && (
        <div className="module-modal-overlay" onClick={() => setChatTarget(null)}>
          <div className="module-modal cate-chat-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="cate-chat__head">
              <div>
                <h2>💬 {chatTarget.fullName}</h2>
                <span className="cate-chat__headsub">
                  {chatThread ? `${chatThread.className} · ` : ''}conversa entre a família e a equipe da turma
                </span>
              </div>
              <button
                type="button"
                className="cate-chat__close"
                aria-label="Fechar conversa"
                onClick={() => setChatTarget(null)}
              >
                ✕
              </button>
            </div>
            {chatThread === null && <div className="loading">Carregando...</div>}
            {chatThread && (
              <div className="cate-chat" ref={chatScrollRef}>
                {chatThread.messages.length === 0 && (
                  <p className="cate-chat__empty">Nenhuma mensagem ainda — escreva a primeira.</p>
                )}
                {chatThread.messages.map((message, index) => {
                  const previous = chatThread.messages[index - 1];
                  const showDay = !previous || chatDayKey(previous.createdAt) !== chatDayKey(message.createdAt);
                  const ownSide = message.fromTeam === chatThread.isTeam;
                  return (
                    <React.Fragment key={message.id}>
                      {showDay && (
                        <div className="cate-chat__day">
                          <span>{chatDayLabel(message.createdAt)}</span>
                        </div>
                      )}
                      <div className={`cate-chat__msg${ownSide ? ' cate-chat__msg--own' : ''}`}>
                        <div className="cate-chat__bubble">
                          <span className="cate-chat__author">
                            {message.fromTeam ? `Equipe · ${message.authorName}` : `Família · ${message.authorName}`}
                          </span>
                          <p>{message.body}</p>
                          <span className="cate-chat__foot">
                            {new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            {ownSide && renderChatTicks(message)}
                          </span>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            )}
            {chatThread && chatThread.canWrite && (
              <>
                <div className="cate-chat__compose">
                  <input
                    type="text"
                    maxLength={1000}
                    placeholder={chatThread.isTeam ? 'Escreva para a família…' : 'Escreva para a equipe…'}
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void sendChat();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="cate-chat__send"
                    aria-label="Enviar mensagem"
                    disabled={sendingChat || !chatText.trim()}
                    onClick={() => void sendChat()}
                  >
                    {sendingChat ? '…' : 'Enviar ➤'}
                  </button>
                </div>
                <p className="cate-chat__hint">🔒 Tudo fica registrado · Enter envia</p>
              </>
            )}
            {chatThread && !chatThread.canWrite && (
              <p className="cate-chat__hint">Matrícula encerrada — conversa somente para leitura.</p>
            )}
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

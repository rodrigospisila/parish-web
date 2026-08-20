import React, { useState, useEffect, useCallback } from 'react';
import TitleIcon from '../../components/TitleIcon';
import api, { getErrorMessage } from '../../services/api';
import { notify } from '../../services/notification.service';
import { useAuth } from '../../contexts/AuthContext';
import './ModulePages.css';

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
    attendanceRate: number | null;
    sessions: number;
  }>;
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
  }>;
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

interface Member {
  id: string;
  fullName: string;
}

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
  const [tab, setTab] = useState<'classes' | 'stages' | 'diocese'>('classes');
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

  const [renewal, setRenewal] = useState<RenewalPreview | null>(null);
  const [renewalTarget, setRenewalTarget] = useState('');
  const [renewalSelection, setRenewalSelection] = useState<Record<string, boolean>>({});
  const [renewing, setRenewing] = useState(false);

  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [enrollForm, setEnrollForm] = useState({ memberId: '', waiveBaptism: false });

  const [showCatechistModal, setShowCatechistModal] = useState(false);
  const [catechistForm, setCatechistForm] = useState({ memberId: '', role: 'Catequista' });

  const [showSessionModal, setShowSessionModal] = useState(false);
  const [sessionForm, setSessionForm] = useState({ date: '', topic: '' });

  const [attendanceSessionId, setAttendanceSessionId] = useState<string | null>(null);
  const [attendance, setAttendance] = useState<Record<string, boolean>>({});

  // Pareceres por período (Fase 5)
  const [assessmentTarget, setAssessmentTarget] = useState<{ enrollmentId: string; fullName: string } | null>(null);
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

  const openClassDetail = async (klass: CatechesisClass) => {
    setSelectedClass(klass);
    setReportLoading(true);
    try {
      const res = await api.get(`/catechesis/classes/${klass.id}/report`);
      setReport(res.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar o relatório da turma'));
      setReport(null);
    } finally {
      setReportLoading(false);
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

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClass) return;
    try {
      await api.post('/catechesis/enrollments', {
        classId: selectedClass.id,
        memberId: enrollForm.memberId,
        ...(enrollForm.waiveBaptism ? { requireBaptism: false } : {}),
      });
      notify.success('Catequizando matriculado!');
      setShowEnrollModal(false);
      setEnrollForm({ memberId: '', waiveBaptism: false });
      refreshDetail();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao matricular'));
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
      const initial: Record<string, boolean> = {};
      (report?.students ?? [])
        .filter((s) => s.status === 'ACTIVE')
        .forEach((s) => {
          initial[s.enrollmentId] = true;
        });
      setAttendance(initial);
      setAttendanceSessionId(res.data.id);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao registrar encontro'));
    }
  };

  const handleSaveAttendance = async () => {
    if (!attendanceSessionId) return;
    try {
      await api.post(`/catechesis/sessions/${attendanceSessionId}/attendance`, {
        entries: Object.entries(attendance).map(([enrollmentId, present]) => ({ enrollmentId, present })),
      });
      notify.success('Chamada registrada!');
      setAttendanceSessionId(null);
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
        dates[cursor.toISOString().slice(0, 10)] = true;
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
        {isDiocesan && (
          <button
            className={`tab-btn ${tab === 'diocese' ? 'active' : ''}`}
            onClick={() => void openDioceseTab()}
          >
            Visão diocesana
          </button>
        )}
      </div>

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

      {tab === 'classes' && (
        <>
          <div className="module-grid">
            {classes.map((klass) => (
              <div key={klass.id} className="module-card">
                <h3>{klass.name} · {klass.year}</h3>
                <p><strong>Etapa:</strong> {klass.stage.name}</p>
                <p><strong>Comunidade:</strong> {klass.community.name}</p>
                <p>
                  <strong>Encontros:</strong>{' '}
                  {klass.weekday !== null && klass.weekday !== undefined ? WEEKDAYS[klass.weekday] : 'a definir'}
                  {klass.time ? ` às ${klass.time}` : ''}
                  {klass.room ? ` · ${klass.room}` : ''}
                </p>
                <p>
                  <span className="status-badge blue">{klass._count.enrollments} matriculados</span>{' '}
                  <span className="status-badge gray">{klass._count.sessions} encontros</span>
                </p>
                <div className="card-footer">
                  <button className="btn-small" onClick={() => openClassDetail(klass)}>Abrir turma</button>
                </div>
              </div>
            ))}
          </div>
          {classes.length === 0 && <div className="empty-state">Nenhuma turma cadastrada.</div>}

          {selectedClass && (
            <div className="detail-panel">
              <h2>Turma: {selectedClass.name} · {selectedClass.year}</h2>
              <div className="detail-section">
                <div className="inline-form">
                  <button className="btn-small success" onClick={() => setShowEnrollModal(true)}>+ Matricular</button>
                  <button className="btn-small" onClick={() => setShowCatechistModal(true)}>+ Catequista</button>
                  <button className="btn-small" onClick={() => setShowSessionModal(true)}>+ Encontro (chamada)</button>
                  {report && report.completed > 0 && (
                    <button className="btn-small" onClick={openRenewal}>↻ Renovar turma</button>
                  )}
                  <button
                    className="btn-small"
                    onClick={() => {
                      // Sempre abre limpo — prévia de outra turma/período não vaza
                      setAgendaDates({});
                      setAgendaRange({ from: '', to: '' });
                      setShowAgendaModal(true);
                    }}
                  >
                    📅 Gerar agenda
                  </button>
                  <button
                    className="btn-small"
                    onClick={() => downloadPdf(`/catechesis/classes/${selectedClass.id}/roster.pdf`, `lista_${selectedClass.name.replace(/\s+/g, '_').toLowerCase()}.pdf`)}
                  >
                    🖨 Lista da turma
                  </button>
                  {report && report.completed > 0 && (
                    <button
                      className="btn-small"
                      onClick={() => downloadPdf(`/catechesis/classes/${selectedClass.id}/certificates.pdf`, `certificados_${selectedClass.name.replace(/\s+/g, '_').toLowerCase()}.pdf`)}
                    >
                      🎓 Certificados (lote)
                    </button>
                  )}
                  <button
                    className="btn-small"
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
                  <button className="btn-small" onClick={() => setSelectedClass(null)}>Fechar</button>
                </div>
              </div>

              {reportLoading && <div className="loading">Carregando relatório...</div>}

              {report && !reportLoading && (
                <>
                  <p style={{ margin: '0 0 0.75rem', fontSize: '0.95rem' }}>
                    <strong>Catequistas:</strong>{' '}
                    {report.catechists.length === 0 && (
                      <span style={{ color: '#b05a12' }}>
                        nenhum vinculado — use "+ Catequista" (o membro precisa estar na pastoral da Catequese da comunidade)
                      </span>
                    )}
                    {report.catechists.map((catechist, index) => (
                      <span key={catechist.memberId}>
                        {index > 0 && ' · '}
                        {catechist.fullName} <em style={{ color: '#666' }}>({catechist.role})</em>{' '}
                        <button
                          className="btn-small danger"
                          style={{ padding: '0 0.45rem', fontSize: '0.75rem' }}
                          title="Remover da turma"
                          onClick={() => handleRemoveCatechist(catechist.memberId, catechist.fullName)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </p>
                  <div className="summary-cards">
                    <div className="summary-card"><div className="label">Matriculados</div><div className="value">{report.total}</div></div>
                    <div className="summary-card"><div className="label">Ativos</div><div className="value positive">{report.active}</div></div>
                    {report.pending > 0 && (
                      <div className="summary-card"><div className="label">Aguardando aprovação</div><div className="value">{report.pending}</div></div>
                    )}
                    <div className="summary-card"><div className="label">Concluídos</div><div className="value">{report.completed}</div></div>
                    <div className="summary-card"><div className="label">Desistências</div><div className="value negative">{report.dropouts}</div></div>
                  </div>

                  <div className="table-container">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Catequizando</th>
                          <th>Status</th>
                          <th>Frequência</th>
                          <th>Docs pendentes</th>
                          <th>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.students.map((student) => {
                          const st = ENROLLMENT_STATUS[student.status] ?? { label: student.status, color: 'gray' };
                          return (
                            <tr key={student.enrollmentId}>
                              <td><strong>{student.member.fullName}</strong></td>
                              <td><span className={`status-badge ${st.color}`}>{st.label}</span></td>
                              <td>{student.attendanceRate === null ? '—' : `${student.attendanceRate}% (${student.sessions} chamadas)`}</td>
                              <td>{student.pendingDocuments || '—'}</td>
                              <td className="actions-cell">
                                {student.status === 'PENDING_APPROVAL' && (
                                  <>
                                    <button className="btn-small success" onClick={() => handleApprove(student.enrollmentId)}>Aprovar</button>
                                    <button className="btn-small danger" onClick={() => handleReject(student.enrollmentId)}>Recusar</button>
                                  </>
                                )}
                                {(student.status === 'ACTIVE' || student.status === 'COMPLETED') && (
                                  <button
                                    className="btn-small"
                                    onClick={() => openAssessments(student.enrollmentId, student.member.fullName)}
                                  >
                                    📝 Parecer
                                  </button>
                                )}
                                {student.status === 'COMPLETED' && (
                                  <button
                                    className="btn-small"
                                    onClick={() => downloadPdf(`/catechesis/enrollments/${student.enrollmentId}/certificate.pdf`, `certificado_${student.member.fullName.replace(/\s+/g, '_').toLowerCase()}.pdf`)}
                                  >
                                    🎓 Certificado
                                  </button>
                                )}
                                {student.status === 'ACTIVE' && (
                                  <>
                                    <button
                                      className="btn-small"
                                      onClick={() => downloadPdf(`/catechesis/enrollments/${student.enrollmentId}/declaration.pdf`, `declaracao_${student.member.fullName.replace(/\s+/g, '_').toLowerCase()}.pdf`)}
                                    >
                                      📄 Declaração
                                    </button>
                                    <button className="btn-small success" onClick={() => handleComplete(student.enrollmentId)}>Concluir</button>
                                    <select
                                      className="filter-select"
                                      style={{ minWidth: 140, padding: '0.3rem 0.4rem', fontSize: '0.85rem' }}
                                      defaultValue=""
                                      onChange={(e) => handleTransfer(student.enrollmentId, e.target.value)}
                                    >
                                      <option value="" disabled>Transferir para...</option>
                                      {classes.filter((c) => c.id !== selectedClass.id).map((c) => (
                                        <option key={c.id} value={c.id}>{c.name} · {c.year}</option>
                                      ))}
                                    </select>
                                  </>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {report.students.length === 0 && <div className="empty-state">Nenhum catequizando matriculado ainda.</div>}
                  </div>
                </>
              )}
            </div>
          )}
        </>
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
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowEnrollModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Matricular</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCatechistModal && selectedClass && (
        <div className="module-modal-overlay" onClick={() => setShowCatechistModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Adicionar catequista</h2>
            <form onSubmit={handleAddCatechist}>
              <div className="form-group">
                <label>Membro *</label>
                <select required value={catechistForm.memberId} onChange={(e) => setCatechistForm({ ...catechistForm, memberId: e.target.value })}>
                  <option value="">Selecione</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Função</label>
                <input type="text" value={catechistForm.role} onChange={(e) => setCatechistForm({ ...catechistForm, role: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowCatechistModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Adicionar</button>
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
              no período. Desmarque feriados e recessos antes de criar — as famílias recebem um
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
                {Object.keys(agendaDates).sort().map((date) => (
                  <label key={date}>
                    <input
                      type="checkbox"
                      checked={agendaDates[date]}
                      onChange={(e) => setAgendaDates({ ...agendaDates, [date]: e.target.checked })}
                    />
                    {new Date(date).toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </label>
                ))}
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

      {attendanceSessionId && (
        <div className="module-modal-overlay" onClick={() => setAttendanceSessionId(null)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Chamada do encontro</h2>
            <div className="checklist">
              {Object.keys(attendance).length === 0 && <p>Nenhum catequizando ativo para a chamada.</p>}
              {(report?.students ?? [])
                .filter((s) => s.enrollmentId in attendance)
                .map((s) => (
                  <label key={s.enrollmentId}>
                    <input
                      type="checkbox"
                      checked={attendance[s.enrollmentId]}
                      onChange={(e) => setAttendance({ ...attendance, [s.enrollmentId]: e.target.checked })}
                    />
                    {s.member.fullName}
                  </label>
                ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setAttendanceSessionId(null)}>Fechar sem salvar</button>
              <button type="button" className="btn-submit" onClick={handleSaveAttendance}>Salvar chamada</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CatechesisPage;

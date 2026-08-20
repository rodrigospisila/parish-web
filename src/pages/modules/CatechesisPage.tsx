import React, { useState, useEffect, useCallback } from 'react';
import TitleIcon from '../../components/TitleIcon';
import api, { getErrorMessage } from '../../services/api';
import { notify } from '../../services/notification.service';
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
  const [tab, setTab] = useState<'classes' | 'stages'>('classes');
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

  const downloadPdf = async (path: string, filename: string) => {
    try {
      const res = await api.get(path, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
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
    const dates: Record<string, boolean> = {};
    const cursor = new Date(agendaRange.from);
    const end = new Date(agendaRange.to);
    let guard = 0;
    while (cursor.getTime() <= end.getTime() && guard < 400) {
      if (cursor.getUTCDay() === selectedClass.weekday) {
        dates[cursor.toISOString().slice(0, 10)] = true;
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      guard++;
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
      </div>

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
                  <button className="btn-small" onClick={() => setShowAgendaModal(true)}>📅 Gerar agenda</button>
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
                  <button className="btn-small" onClick={() => setSelectedClass(null)}>Fechar</button>
                </div>
              </div>

              {reportLoading && <div className="loading">Carregando relatório...</div>}

              {report && !reportLoading && (
                <>
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
                <input type="date" value={agendaRange.from} onChange={(e) => setAgendaRange({ ...agendaRange, from: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Fim *</label>
                <input type="date" value={agendaRange.to} onChange={(e) => setAgendaRange({ ...agendaRange, to: e.target.value })} />
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

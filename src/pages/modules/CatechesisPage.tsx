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
  students: Array<{
    enrollmentId: string;
    member: { id: string; fullName: string };
    status: string;
    pendingDocuments?: string | null;
    attendanceRate: number | null;
    sessions: number;
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
  });

  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [enrollForm, setEnrollForm] = useState({ memberId: '', waiveBaptism: false });

  const [showCatechistModal, setShowCatechistModal] = useState(false);
  const [catechistForm, setCatechistForm] = useState({ memberId: '', role: 'Catequista' });

  const [showSessionModal, setShowSessionModal] = useState(false);
  const [sessionForm, setSessionForm] = useState({ date: '', topic: '' });

  const [attendanceSessionId, setAttendanceSessionId] = useState<string | null>(null);
  const [attendance, setAttendance] = useState<Record<string, boolean>>({});

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
      });
      notify.success('Turma criada com sucesso!');
      setShowClassModal(false);
      setClassForm({ name: '', year: new Date().getFullYear(), stageId: '', communityId: '', weekday: '', time: '', room: '' });
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
        date: new Date(sessionForm.date).toISOString(),
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
                  <button className="btn-small" onClick={() => setSelectedClass(null)}>Fechar</button>
                </div>
              </div>

              {reportLoading && <div className="loading">Carregando relatório...</div>}

              {report && !reportLoading && (
                <>
                  <div className="summary-cards">
                    <div className="summary-card"><div className="label">Matriculados</div><div className="value">{report.total}</div></div>
                    <div className="summary-card"><div className="label">Ativos</div><div className="value positive">{report.active}</div></div>
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
                                {student.status === 'ACTIVE' && (
                                  <>
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
              <div className="form-group">
                <label>Sala/local</label>
                <input type="text" value={classForm.room} onChange={(e) => setClassForm({ ...classForm, room: e.target.value })} />
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
                <label>Data e hora *</label>
                <input type="datetime-local" required value={sessionForm.date} onChange={(e) => setSessionForm({ ...sessionForm, date: e.target.value })} />
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

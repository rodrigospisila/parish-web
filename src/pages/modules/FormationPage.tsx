import React, { useState, useEffect, useCallback } from 'react';
import TitleIcon from '../../components/TitleIcon';
import api, { getErrorMessage } from '../../services/api';
import { notify } from '../../services/notification.service';
import './ModulePages.css';

interface Track {
  id: string;
  name: string;
  description?: string | null;
  _count?: { courses: number };
}

interface Course {
  id: string;
  name: string;
  description?: string | null;
  validityMonths?: number | null;
  requiredForRole?: string | null;
  track?: { name: string } | null;
  _count: { enrollments: number };
}

interface Enrollment {
  id: string;
  status: string;
  completedAt?: string | null;
  expiresAt?: string | null;
  certificateIssuedAt?: string | null;
  member: { id: string; fullName: string };
}

interface PendingRow {
  enrollmentId: string;
  member: { id: string; fullName: string };
  course: string;
  situation: 'pendente' | 'vencida';
  expiresAt?: string | null;
}

interface Member {
  id: string;
  fullName: string;
}

const FormationPage: React.FC = () => {
  const [tab, setTab] = useState<'courses' | 'pending'>('courses');
  const [loading, setLoading] = useState(true);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);

  const [showTrackModal, setShowTrackModal] = useState(false);
  const [trackForm, setTrackForm] = useState({ name: '', description: '' });

  const [showCourseModal, setShowCourseModal] = useState(false);
  const [courseForm, setCourseForm] = useState({ name: '', description: '', trackId: '', validityMonths: '', requiredForRole: '' });

  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [enrollMemberId, setEnrollMemberId] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [tracksRes, coursesRes, pendingRes, membersRes] = await Promise.all([
        api.get('/formation/tracks'),
        api.get('/formation/courses'),
        api.get('/formation/pending'),
        api.get('/members'),
      ]);
      setTracks(tracksRes.data);
      setCourses(coursesRes.data);
      setPending(pendingRes.data);
      setMembers(membersRes.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar formação'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCourse = async (course: Course) => {
    setSelectedCourse(course);
    try {
      const res = await api.get(`/formation/courses/${course.id}/enrollments`);
      setEnrollments(res.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar inscrições'));
      setEnrollments([]);
    }
  };

  const refreshDetail = async () => {
    if (selectedCourse) await openCourse(selectedCourse);
    fetchData();
  };

  const handleCreateTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/formation/tracks', {
        name: trackForm.name,
        description: trackForm.description || undefined,
      });
      notify.success('Trilha criada!');
      setShowTrackModal(false);
      setTrackForm({ name: '', description: '' });
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao criar trilha'));
    }
  };

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/formation/courses', {
        name: courseForm.name,
        description: courseForm.description || undefined,
        trackId: courseForm.trackId || undefined,
        validityMonths: courseForm.validityMonths ? Number(courseForm.validityMonths) : undefined,
        requiredForRole: courseForm.requiredForRole || undefined,
      });
      notify.success('Curso criado!');
      setShowCourseModal(false);
      setCourseForm({ name: '', description: '', trackId: '', validityMonths: '', requiredForRole: '' });
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao criar curso'));
    }
  };

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCourse) return;
    try {
      await api.post(`/formation/courses/${selectedCourse.id}/enroll`, { memberId: enrollMemberId });
      notify.success('Participante inscrito!');
      setShowEnrollModal(false);
      setEnrollMemberId('');
      refreshDetail();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao inscrever'));
    }
  };

  const handleComplete = async (enrollmentId: string) => {
    try {
      await api.patch(`/formation/enrollments/${enrollmentId}/complete`, {});
      notify.success('Formação concluída!');
      refreshDetail();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao concluir'));
    }
  };

  const downloadCertificate = async (enrollmentId: string, memberName: string) => {
    try {
      const res = await api.get(`/formation/enrollments/${enrollmentId}/certificate.pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `certificado_${memberName.replace(/\s+/g, '_').toLowerCase()}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao gerar certificado'));
    }
  };

  const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleDateString('pt-BR') : '—');

  if (loading) return <div className="module-page"><div className="loading">Carregando...</div></div>;

  return (
    <div className="module-page">
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center' }}><TitleIcon name="biblia" /> Formação de Agentes</h1>
        <div className="header-actions">
          <button className="btn-secondary" onClick={() => setShowTrackModal(true)}>+ Trilha</button>
          <button className="btn-primary" onClick={() => setShowCourseModal(true)}>+ Curso</button>
        </div>
      </div>

      <div className="module-tabs">
        <button className={`tab-btn ${tab === 'courses' ? 'active' : ''}`} onClick={() => setTab('courses')}>
          Cursos ({courses.length})
        </button>
        <button className={`tab-btn ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>
          Pendências e vencidas ({pending.length})
        </button>
      </div>

      {tab === 'courses' && (
        <>
          <div className="module-grid">
            {courses.map((course) => (
              <div key={course.id} className="module-card">
                <h3>{course.name}</h3>
                {course.track && <p><strong>Trilha:</strong> {course.track.name}</p>}
                {course.requiredForRole && <p><strong>Exigido para:</strong> {course.requiredForRole}</p>}
                <p>
                  <strong>Validade:</strong>{' '}
                  {course.validityMonths ? `${course.validityMonths} meses (renovável)` : 'não expira'}
                </p>
                <p><span className="status-badge blue">{course._count.enrollments} inscritos</span></p>
                <div className="card-footer">
                  <button className="btn-small" onClick={() => openCourse(course)}>Abrir curso</button>
                </div>
              </div>
            ))}
          </div>
          {courses.length === 0 && <div className="empty-state">Nenhum curso de formação cadastrado.</div>}

          {selectedCourse && (
            <div className="detail-panel">
              <h2>Curso: {selectedCourse.name}</h2>
              <div className="detail-section">
                <div className="inline-form">
                  <button className="btn-small success" onClick={() => setShowEnrollModal(true)}>+ Inscrever participante</button>
                  <button className="btn-small" onClick={() => setSelectedCourse(null)}>Fechar</button>
                </div>
              </div>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Participante</th>
                      <th>Status</th>
                      <th>Conclusão</th>
                      <th>Validade</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrollments.map((enrollment) => {
                      const expired = enrollment.expiresAt && new Date(enrollment.expiresAt).getTime() < Date.now();
                      return (
                        <tr key={enrollment.id}>
                          <td><strong>{enrollment.member.fullName}</strong></td>
                          <td>
                            {enrollment.status === 'COMPLETED'
                              ? <span className={`status-badge ${expired ? 'red' : 'green'}`}>{expired ? 'Vencida' : 'Concluída'}</span>
                              : <span className="status-badge yellow">Em formação</span>}
                          </td>
                          <td>{formatDate(enrollment.completedAt)}</td>
                          <td>{enrollment.expiresAt ? formatDate(enrollment.expiresAt) : 'não expira'}</td>
                          <td className="actions-cell">
                            {enrollment.status !== 'COMPLETED' && (
                              <button className="btn-small success" onClick={() => handleComplete(enrollment.id)}>Concluir</button>
                            )}
                            {enrollment.status === 'COMPLETED' && (
                              <button className="btn-small" onClick={() => downloadCertificate(enrollment.id, enrollment.member.fullName)}>
                                📄 Certificado
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {enrollments.length === 0 && <div className="empty-state">Nenhum inscrito neste curso.</div>}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'pending' && (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Agente</th>
                <th>Curso</th>
                <th>Situação</th>
                <th>Venceu em</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((row) => (
                <tr key={row.enrollmentId}>
                  <td><strong>{row.member.fullName}</strong></td>
                  <td>{row.course}</td>
                  <td>
                    <span className={`status-badge ${row.situation === 'vencida' ? 'red' : 'yellow'}`}>
                      {row.situation === 'vencida' ? 'Formação vencida' : 'Em formação'}
                    </span>
                  </td>
                  <td>{formatDate(row.expiresAt)}</td>
                  <td className="actions-cell">
                    {row.situation === 'pendente' && (
                      <button className="btn-small success" onClick={() => handleComplete(row.enrollmentId)}>Concluir</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pending.length === 0 && <div className="empty-state">Nenhuma pendência — todos os agentes com formação em dia. 🎉</div>}
        </div>
      )}

      {showTrackModal && (
        <div className="module-modal-overlay" onClick={() => setShowTrackModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Nova Trilha de Formação</h2>
            <form onSubmit={handleCreateTrack}>
              <div className="form-group">
                <label>Nome *</label>
                <input type="text" required value={trackForm.name} onChange={(e) => setTrackForm({ ...trackForm, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Descrição</label>
                <textarea rows={3} value={trackForm.description} onChange={(e) => setTrackForm({ ...trackForm, description: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowTrackModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Criar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCourseModal && (
        <div className="module-modal-overlay" onClick={() => setShowCourseModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Novo Curso</h2>
            <form onSubmit={handleCreateCourse}>
              <div className="form-group">
                <label>Nome *</label>
                <input type="text" required value={courseForm.name} onChange={(e) => setCourseForm({ ...courseForm, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Trilha (opcional)</label>
                <select value={courseForm.trackId} onChange={(e) => setCourseForm({ ...courseForm, trackId: e.target.value })}>
                  <option value="">Sem trilha</option>
                  {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Validade (meses)</label>
                  <input
                    type="number"
                    min={1}
                    placeholder="vazio = não expira"
                    value={courseForm.validityMonths}
                    onChange={(e) => setCourseForm({ ...courseForm, validityMonths: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Exigido para a função</label>
                  <input
                    type="text"
                    placeholder="Ex.: Ministro"
                    value={courseForm.requiredForRole}
                    onChange={(e) => setCourseForm({ ...courseForm, requiredForRole: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Descrição</label>
                <textarea rows={3} value={courseForm.description} onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowCourseModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Criar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEnrollModal && selectedCourse && (
        <div className="module-modal-overlay" onClick={() => setShowEnrollModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Inscrever em {selectedCourse.name}</h2>
            <form onSubmit={handleEnroll}>
              <div className="form-group">
                <label>Membro *</label>
                <select required value={enrollMemberId} onChange={(e) => setEnrollMemberId(e.target.value)}>
                  <option value="">Selecione</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowEnrollModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Inscrever</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FormationPage;

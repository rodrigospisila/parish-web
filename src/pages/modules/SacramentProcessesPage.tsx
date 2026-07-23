import React, { useState, useEffect, useCallback } from 'react';
import api, { getErrorMessage } from '../../services/api';
import { notify } from '../../services/notification.service';
import './ModulePages.css';

interface ChecklistItem {
  label: string;
  done: boolean;
}

interface SacramentProcess {
  id: string;
  type: string;
  status: string;
  scheduledDate?: string | null;
  celebrant?: string | null;
  documentsChecklist?: ChecklistItem[] | null;
  member: { id: string; fullName: string };
  communityId: string;
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

const COLUMNS: Array<{ status: string; label: string }> = [
  { status: 'REQUESTED', label: 'Solicitado' },
  { status: 'DOCUMENTS', label: 'Documentos' },
  { status: 'COURSE', label: 'Preparação' },
  { status: 'SCHEDULED', label: 'Agendado' },
  { status: 'CELEBRATED', label: 'Celebrado' },
  { status: 'CANCELLED', label: 'Cancelado' },
];

const NEXT_STATUS: Record<string, string | null> = {
  REQUESTED: 'DOCUMENTS',
  DOCUMENTS: 'COURSE',
  COURSE: 'SCHEDULED',
  SCHEDULED: null, // avança via "Celebrar"
  CELEBRATED: null,
  CANCELLED: null,
};

const SacramentProcessesPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [processes, setProcesses] = useState<SacramentProcess[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ type: 'BAPTISM', memberId: '', communityId: '', scheduledDate: '', celebrant: '' });

  const [checklistProcess, setChecklistProcess] = useState<SacramentProcess | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [newItem, setNewItem] = useState('');

  const [celebrateProcess, setCelebrateProcess] = useState<SacramentProcess | null>(null);
  const [celebrateForm, setCelebrateForm] = useState({ date: '', minister: '', book: '', page: '', term: '', place: '' });

  const fetchData = useCallback(async () => {
    try {
      const [processesRes, communitiesRes, membersRes] = await Promise.all([
        api.get('/sacrament-processes'),
        api.get('/communities'),
        api.get('/members'),
      ]);
      setProcesses(processesRes.data);
      setCommunities(communitiesRes.data);
      setMembers(membersRes.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar processos'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/sacrament-processes', {
        type: createForm.type,
        memberId: createForm.memberId,
        communityId: createForm.communityId,
        scheduledDate: createForm.scheduledDate ? new Date(createForm.scheduledDate).toISOString() : undefined,
        celebrant: createForm.celebrant || undefined,
      });
      notify.success('Processo aberto!');
      setShowCreateModal(false);
      setCreateForm({ type: 'BAPTISM', memberId: '', communityId: '', scheduledDate: '', celebrant: '' });
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao abrir processo'));
    }
  };

  const handleStatus = async (process: SacramentProcess, status: string) => {
    try {
      await api.patch(`/sacrament-processes/${process.id}/status`, { status });
      notify.success('Etapa atualizada!');
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao atualizar etapa'));
    }
  };

  const openChecklist = (process: SacramentProcess) => {
    setChecklistProcess(process);
    setChecklist(Array.isArray(process.documentsChecklist) ? process.documentsChecklist : []);
    setNewItem('');
  };

  const handleSaveChecklist = async () => {
    if (!checklistProcess) return;
    try {
      await api.patch(`/sacrament-processes/${checklistProcess.id}/checklist`, { documentsChecklist: checklist });
      notify.success('Checklist salvo!');
      setChecklistProcess(null);
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao salvar checklist'));
    }
  };

  const handleCelebrate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!celebrateProcess) return;
    try {
      await api.patch(`/sacrament-processes/${celebrateProcess.id}/celebrate`, {
        date: celebrateForm.date ? new Date(celebrateForm.date).toISOString() : undefined,
        minister: celebrateForm.minister || undefined,
        book: celebrateForm.book || undefined,
        page: celebrateForm.page || undefined,
        term: celebrateForm.term || undefined,
        place: celebrateForm.place || undefined,
      });
      notify.success('Sacramento celebrado e registrado no livro!');
      setCelebrateProcess(null);
      setCelebrateForm({ date: '', minister: '', book: '', page: '', term: '', place: '' });
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao registrar celebração'));
    }
  };

  const downloadCertificate = async (process: SacramentProcess) => {
    try {
      const res = await api.get(`/sacrament-processes/${process.id}/certificate.pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `certidao_${process.member.fullName.replace(/\s+/g, '_').toLowerCase()}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao emitir certidão'));
    }
  };

  const checklistProgress = (process: SacramentProcess) => {
    const items = Array.isArray(process.documentsChecklist) ? process.documentsChecklist : [];
    if (!items.length) return null;
    const done = items.filter((i) => i.done).length;
    return `${done}/${items.length} docs`;
  };

  if (loading) return <div className="module-page"><div className="loading">Carregando...</div></div>;

  return (
    <div className="module-page">
      <div className="page-header">
        <h1>✝️ Preparação de Sacramentos</h1>
        <div className="header-actions">
          <button className="btn-primary" onClick={() => setShowCreateModal(true)}>+ Novo Processo</button>
        </div>
      </div>

      <div className="kanban">
        {COLUMNS.map((column) => {
          const cards = processes.filter((p) => p.status === column.status);
          return (
            <div key={column.status} className="kanban-column">
              <h4>{column.label} <span>{cards.length}</span></h4>
              {cards.map((process) => (
                <div key={process.id} className="kanban-card">
                  <strong>{process.member.fullName}</strong>
                  <span className="status-badge blue">{SACRAMENT_LABELS[process.type] ?? process.type}</span>
                  {process.scheduledDate && (
                    <p style={{ margin: '0.3rem 0 0 0', color: '#666' }}>
                      📅 {new Date(process.scheduledDate).toLocaleDateString('pt-BR')}
                    </p>
                  )}
                  {checklistProgress(process) && (
                    <p style={{ margin: '0.3rem 0 0 0', color: '#666' }}>📋 {checklistProgress(process)}</p>
                  )}
                  <div className="kanban-actions">
                    {process.status !== 'CELEBRATED' && process.status !== 'CANCELLED' && (
                      <>
                        <button className="btn-small" onClick={() => openChecklist(process)}>Docs</button>
                        {NEXT_STATUS[process.status] && (
                          <button className="btn-small" onClick={() => handleStatus(process, NEXT_STATUS[process.status]!)}>
                            Avançar →
                          </button>
                        )}
                        {process.status === 'SCHEDULED' && (
                          <button className="btn-small success" onClick={() => setCelebrateProcess(process)}>Celebrar</button>
                        )}
                        <button className="btn-small danger" onClick={() => handleStatus(process, 'CANCELLED')}>Cancelar</button>
                      </>
                    )}
                    {process.status === 'CELEBRATED' && (
                      <button className="btn-small" onClick={() => downloadCertificate(process)}>📄 Certidão (2ª via)</button>
                    )}
                    {process.status === 'CANCELLED' && (
                      <button className="btn-small" onClick={() => handleStatus(process, 'REQUESTED')}>Reabrir</button>
                    )}
                  </div>
                </div>
              ))}
              {cards.length === 0 && <p style={{ color: '#999', fontSize: '0.85rem', textAlign: 'center' }}>vazio</p>}
            </div>
          );
        })}
      </div>

      {showCreateModal && (
        <div className="module-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Novo Processo de Sacramento</h2>
            <form onSubmit={handleCreate}>
              <div className="form-row">
                <div className="form-group">
                  <label>Sacramento *</label>
                  <select value={createForm.type} onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })}>
                    {Object.entries(SACRAMENT_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Comunidade *</label>
                  <select required value={createForm.communityId} onChange={(e) => setCreateForm({ ...createForm, communityId: e.target.value })}>
                    <option value="">Selecione</option>
                    {communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Membro *</label>
                <select required value={createForm.memberId} onChange={(e) => setCreateForm({ ...createForm, memberId: e.target.value })}>
                  <option value="">Selecione</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Data prevista</label>
                  <input type="date" value={createForm.scheduledDate} onChange={(e) => setCreateForm({ ...createForm, scheduledDate: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Celebrante</label>
                  <input type="text" placeholder="Ex.: Pe. João" value={createForm.celebrant} onChange={(e) => setCreateForm({ ...createForm, celebrant: e.target.value })} />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowCreateModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Abrir processo</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {checklistProcess && (
        <div className="module-modal-overlay" onClick={() => setChecklistProcess(null)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Checklist de documentos — {checklistProcess.member.fullName}</h2>
            <div className="checklist" style={{ marginBottom: '1rem' }}>
              {checklist.map((item, index) => (
                <label key={index}>
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={(e) => {
                      const next = [...checklist];
                      next[index] = { ...item, done: e.target.checked };
                      setChecklist(next);
                    }}
                  />
                  {item.label}
                  <button
                    type="button"
                    className="btn-small danger"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => setChecklist(checklist.filter((_, i) => i !== index))}
                  >
                    remover
                  </button>
                </label>
              ))}
              {checklist.length === 0 && <p style={{ color: '#888' }}>Nenhum documento no checklist (ex.: certidão de nascimento, comprovante de batismo...).</p>}
            </div>
            <div className="inline-form" style={{ marginBottom: '1rem' }}>
              <input
                type="text"
                style={{ flex: 1 }}
                placeholder="Novo documento exigido"
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
              />
              <button
                type="button"
                className="btn-small success"
                onClick={() => {
                  if (!newItem.trim()) return;
                  setChecklist([...checklist, { label: newItem.trim(), done: false }]);
                  setNewItem('');
                }}
              >
                Adicionar
              </button>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setChecklistProcess(null)}>Cancelar</button>
              <button type="button" className="btn-submit" onClick={handleSaveChecklist}>Salvar checklist</button>
            </div>
          </div>
        </div>
      )}

      {celebrateProcess && (
        <div className="module-modal-overlay" onClick={() => setCelebrateProcess(null)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Celebrar {SACRAMENT_LABELS[celebrateProcess.type] ?? celebrateProcess.type} — {celebrateProcess.member.fullName}</h2>
            <p style={{ color: '#666', marginTop: '-0.75rem', marginBottom: '1rem', fontSize: '0.9rem' }}>
              Gera o registro sacramental oficial com numeração de livro/folha/termo e habilita a certidão em PDF.
            </p>
            <form onSubmit={handleCelebrate}>
              <div className="form-row">
                <div className="form-group">
                  <label>Data da celebração</label>
                  <input type="date" value={celebrateForm.date} onChange={(e) => setCelebrateForm({ ...celebrateForm, date: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Ministro</label>
                  <input type="text" placeholder="Ex.: Pe. João" value={celebrateForm.minister} onChange={(e) => setCelebrateForm({ ...celebrateForm, minister: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Livro</label>
                  <input type="text" value={celebrateForm.book} onChange={(e) => setCelebrateForm({ ...celebrateForm, book: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Folha</label>
                  <input type="text" value={celebrateForm.page} onChange={(e) => setCelebrateForm({ ...celebrateForm, page: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Termo</label>
                  <input type="text" value={celebrateForm.term} onChange={(e) => setCelebrateForm({ ...celebrateForm, term: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Local</label>
                  <input type="text" value={celebrateForm.place} onChange={(e) => setCelebrateForm({ ...celebrateForm, place: e.target.value })} />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setCelebrateProcess(null)}>Cancelar</button>
                <button type="submit" className="btn-submit">Registrar celebração</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SacramentProcessesPage;

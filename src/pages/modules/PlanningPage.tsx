import React, { useState, useEffect, useCallback } from 'react';
import TitleIcon from '../../components/TitleIcon';
import api, { getErrorMessage } from '../../services/api';
import { notify, confirm } from '../../services/notification.service';
import './ModulePages.css';

interface PlanSummary {
  id: string;
  title: string;
  year: number;
  status: string;
  communityId?: string | null;
}

interface Goal {
  id: string;
  description: string;
  indicator?: string | null;
  targetValue?: string | null;
  currentValue?: string | null;
}

interface Action {
  id: string;
  title: string;
  status: string;
  dueDate?: string | null;
  resultNotes?: string | null;
  responsibleMember?: { id: string; fullName: string } | null;
}

interface Objective {
  id: string;
  description: string;
  goals: Goal[];
  actions: Action[];
  _count?: { events: number };
}

interface PlanDetail extends PlanSummary {
  objectives: Objective[];
}

interface Community {
  id: string;
  name: string;
}

interface Member {
  id: string;
  fullName: string;
}

const PLAN_STATUS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Rascunho', color: 'gray' },
  ACTIVE: { label: 'Ativo', color: 'green' },
  COMPLETED: { label: 'Concluído', color: 'blue' },
  ARCHIVED: { label: 'Arquivado', color: 'yellow' },
};

const ACTION_STATUS: Record<string, { label: string; color: string }> = {
  PLANNED: { label: 'Planejada', color: 'gray' },
  IN_PROGRESS: { label: 'Em andamento', color: 'blue' },
  DONE: { label: 'Concluída', color: 'green' },
  CANCELLED: { label: 'Cancelada', color: 'red' },
};

const PlanningPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [plan, setPlan] = useState<PlanDetail | null>(null);

  const [showPlanModal, setShowPlanModal] = useState(false);
  const [planForm, setPlanForm] = useState({ title: '', year: new Date().getFullYear(), communityId: '' });

  const [objectiveText, setObjectiveText] = useState('');

  const [goalModalObjective, setGoalModalObjective] = useState<Objective | null>(null);
  const [goalForm, setGoalForm] = useState({ description: '', indicator: '', targetValue: '' });

  const [actionModalObjective, setActionModalObjective] = useState<Objective | null>(null);
  const [actionForm, setActionForm] = useState({ title: '', dueDate: '', responsibleMemberId: '' });

  const fetchData = useCallback(async () => {
    try {
      const [plansRes, communitiesRes, membersRes] = await Promise.all([
        api.get('/planning/plans'),
        api.get('/communities'),
        api.get('/members'),
      ]);
      setPlans(plansRes.data);
      setCommunities(communitiesRes.data);
      setMembers(membersRes.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar planos pastorais'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openPlan = async (id: string) => {
    try {
      const res = await api.get(`/planning/plans/${id}`);
      setPlan(res.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar o plano'));
    }
  };

  const refreshPlan = async () => {
    if (plan) await openPlan(plan.id);
  };

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post('/planning/plans', {
        title: planForm.title,
        year: Number(planForm.year),
        communityId: planForm.communityId || undefined,
      });
      notify.success('Plano criado!');
      setShowPlanModal(false);
      setPlanForm({ title: '', year: new Date().getFullYear(), communityId: '' });
      await fetchData();
      openPlan(res.data.id);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao criar plano'));
    }
  };

  const handlePlanStatus = async (status: string) => {
    if (!plan) return;
    try {
      await api.patch(`/planning/plans/${plan.id}/status`, { status });
      notify.success('Status do plano atualizado!');
      refreshPlan();
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao atualizar status'));
    }
  };

  const handleAddObjective = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!plan || !objectiveText.trim()) return;
    try {
      await api.post(`/planning/plans/${plan.id}/objectives`, { description: objectiveText.trim() });
      notify.success('Objetivo adicionado!');
      setObjectiveText('');
      refreshPlan();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao adicionar objetivo'));
    }
  };

  const handleAddGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goalModalObjective) return;
    try {
      await api.post(`/planning/objectives/${goalModalObjective.id}/goals`, {
        description: goalForm.description,
        indicator: goalForm.indicator || undefined,
        targetValue: goalForm.targetValue || undefined,
      });
      notify.success('Meta adicionada!');
      setGoalModalObjective(null);
      setGoalForm({ description: '', indicator: '', targetValue: '' });
      refreshPlan();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao adicionar meta'));
    }
  };

  const handleGoalProgress = async (goal: Goal) => {
    const value = await confirm.withInput('Atualizar progresso', `Meta: ${goal.description}`, goal.currentValue ?? '');
    if (value === null) return;
    try {
      await api.patch(`/planning/goals/${goal.id}/progress`, { currentValue: value });
      notify.success('Progresso atualizado!');
      refreshPlan();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao atualizar progresso'));
    }
  };

  const handleAddAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionModalObjective) return;
    try {
      await api.post(`/planning/objectives/${actionModalObjective.id}/actions`, {
        title: actionForm.title,
        dueDate: actionForm.dueDate ? new Date(actionForm.dueDate).toISOString() : undefined,
        responsibleMemberId: actionForm.responsibleMemberId || undefined,
      });
      notify.success('Ação adicionada!');
      setActionModalObjective(null);
      setActionForm({ title: '', dueDate: '', responsibleMemberId: '' });
      refreshPlan();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao adicionar ação'));
    }
  };

  const handleActionStatus = async (actionId: string, status: string) => {
    try {
      await api.patch(`/planning/actions/${actionId}`, { status });
      notify.success('Ação atualizada!');
      refreshPlan();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao atualizar ação'));
    }
  };

  const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleDateString('pt-BR') : '—');

  if (loading) return <div className="module-page"><div className="loading">Carregando...</div></div>;

  return (
    <div className="module-page">
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center' }}><TitleIcon name="planejamento" /> Planejamento Pastoral</h1>
        <div className="header-actions">
          <button className="btn-primary" onClick={() => setShowPlanModal(true)}>+ Novo Plano</button>
        </div>
      </div>

      <div className="module-grid">
        {plans.map((p) => {
          const st = PLAN_STATUS[p.status] ?? { label: p.status, color: 'gray' };
          return (
            <div key={p.id} className="module-card">
              <h3>{p.title}</h3>
              <p><strong>Ano:</strong> {p.year} · <span className={`status-badge ${st.color}`}>{st.label}</span></p>
              <p><strong>Abrangência:</strong> {p.communityId ? communities.find((c) => c.id === p.communityId)?.name ?? 'Comunidade' : 'Paróquia inteira'}</p>
              <div className="card-footer">
                <button className="btn-small" onClick={() => openPlan(p.id)}>Abrir plano</button>
              </div>
            </div>
          );
        })}
      </div>
      {plans.length === 0 && <div className="empty-state">Nenhum plano pastoral. Crie o plano do ano para organizar objetivos, metas e ações.</div>}

      {plan && (
        <div className="detail-panel">
          <h2>{plan.title} · {plan.year}</h2>
          <div className="detail-section">
            <div className="inline-form">
              <select className="filter-select" value={plan.status} onChange={(e) => handlePlanStatus(e.target.value)}>
                {Object.entries(PLAN_STATUS).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
              </select>
              <button className="btn-small" onClick={() => setPlan(null)}>Fechar</button>
            </div>
          </div>

          <div className="detail-section">
            <h4>Adicionar objetivo</h4>
            <form className="inline-form" onSubmit={handleAddObjective}>
              <input
                type="text"
                style={{ flex: 1, minWidth: 260 }}
                placeholder="Ex.: Fortalecer a pastoral familiar"
                value={objectiveText}
                onChange={(e) => setObjectiveText(e.target.value)}
              />
              <button type="submit" className="btn-small success">Adicionar</button>
            </form>
          </div>

          {plan.objectives.map((objective, index) => (
            <div key={objective.id} className="detail-section" style={{ border: '1px solid #eee', borderRadius: 10, padding: '1rem' }}>
              <h4>Objetivo {index + 1}: {objective.description}</h4>
              <div className="inline-form" style={{ marginBottom: '0.75rem' }}>
                <button className="btn-small" onClick={() => setGoalModalObjective(objective)}>+ Meta</button>
                <button className="btn-small" onClick={() => setActionModalObjective(objective)}>+ Ação</button>
                {objective._count && objective._count.events > 0 && (
                  <span className="status-badge blue">{objective._count.events} evento(s) vinculado(s)</span>
                )}
              </div>

              {objective.goals.length > 0 && (
                <div className="table-container" style={{ marginBottom: '0.75rem' }}>
                  <table className="data-table">
                    <thead>
                      <tr><th>Meta</th><th>Indicador</th><th>Alvo</th><th>Atual</th><th></th></tr>
                    </thead>
                    <tbody>
                      {objective.goals.map((goal) => (
                        <tr key={goal.id}>
                          <td>{goal.description}</td>
                          <td>{goal.indicator || '—'}</td>
                          <td>{goal.targetValue || '—'}</td>
                          <td>{goal.currentValue || '—'}</td>
                          <td><button className="btn-small" onClick={() => handleGoalProgress(goal)}>Atualizar progresso</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {objective.actions.length > 0 && (
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr><th>Ação</th><th>Responsável</th><th>Prazo</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {objective.actions.map((action) => (
                        <tr key={action.id}>
                          <td>{action.title}</td>
                          <td>{action.responsibleMember?.fullName ?? '—'}</td>
                          <td>{formatDate(action.dueDate)}</td>
                          <td>
                            <select
                              className="filter-select"
                              style={{ minWidth: 150, padding: '0.3rem 0.4rem', fontSize: '0.85rem' }}
                              value={action.status}
                              onChange={(e) => handleActionStatus(action.id, e.target.value)}
                            >
                              {Object.entries(ACTION_STATUS).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {objective.goals.length === 0 && objective.actions.length === 0 && (
                <p style={{ color: '#888', fontSize: '0.9rem' }}>Sem metas ou ações ainda.</p>
              )}
            </div>
          ))}
          {plan.objectives.length === 0 && <div className="empty-state">Nenhum objetivo cadastrado neste plano.</div>}
        </div>
      )}

      {showPlanModal && (
        <div className="module-modal-overlay" onClick={() => setShowPlanModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Novo Plano Pastoral</h2>
            <form onSubmit={handleCreatePlan}>
              <div className="form-group">
                <label>Título *</label>
                <input type="text" required value={planForm.title} onChange={(e) => setPlanForm({ ...planForm, title: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Ano *</label>
                  <input type="number" required value={planForm.year} onChange={(e) => setPlanForm({ ...planForm, year: Number(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Comunidade (opcional)</label>
                  <select value={planForm.communityId} onChange={(e) => setPlanForm({ ...planForm, communityId: e.target.value })}>
                    <option value="">Paróquia inteira</option>
                    {communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowPlanModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Criar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {goalModalObjective && (
        <div className="module-modal-overlay" onClick={() => setGoalModalObjective(null)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Nova meta</h2>
            <p style={{ color: '#666', marginTop: '-0.75rem', marginBottom: '1rem' }}>{goalModalObjective.description}</p>
            <form onSubmit={handleAddGoal}>
              <div className="form-group">
                <label>Descrição *</label>
                <input type="text" required value={goalForm.description} onChange={(e) => setGoalForm({ ...goalForm, description: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Indicador</label>
                  <input type="text" placeholder="Ex.: nº de famílias visitadas" value={goalForm.indicator} onChange={(e) => setGoalForm({ ...goalForm, indicator: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Valor alvo</label>
                  <input type="text" placeholder="Ex.: 50" value={goalForm.targetValue} onChange={(e) => setGoalForm({ ...goalForm, targetValue: e.target.value })} />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setGoalModalObjective(null)}>Cancelar</button>
                <button type="submit" className="btn-submit">Adicionar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {actionModalObjective && (
        <div className="module-modal-overlay" onClick={() => setActionModalObjective(null)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Nova ação</h2>
            <p style={{ color: '#666', marginTop: '-0.75rem', marginBottom: '1rem' }}>{actionModalObjective.description}</p>
            <form onSubmit={handleAddAction}>
              <div className="form-group">
                <label>Título *</label>
                <input type="text" required value={actionForm.title} onChange={(e) => setActionForm({ ...actionForm, title: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Prazo</label>
                  <input type="date" value={actionForm.dueDate} onChange={(e) => setActionForm({ ...actionForm, dueDate: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Responsável</label>
                  <select value={actionForm.responsibleMemberId} onChange={(e) => setActionForm({ ...actionForm, responsibleMemberId: e.target.value })}>
                    <option value="">Sem responsável</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
                  </select>
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setActionModalObjective(null)}>Cancelar</button>
                <button type="submit" className="btn-submit">Adicionar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlanningPage;

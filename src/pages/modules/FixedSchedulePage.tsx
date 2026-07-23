import React, { useState, useEffect, useCallback } from 'react';
import api, { getErrorMessage } from '../../services/api';
import { notify, confirm } from '../../services/notification.service';
import SearchSelect from '../../components/SearchSelect';
import './ModulePages.css';

interface Community {
  id: string;
  name: string;
  parish?: { id: string; name: string };
}

interface MassSchedule {
  id: string;
  dayOfWeek: number;
  time: string;
  type: 'MASS' | 'CONFESSION' | 'ADORATION' | 'ROSARY';
  notes?: string | null;
  isSpecial: boolean;
  specialDate?: string | null;
  community: { id: string; name: string; parish?: { name: string } | null };
}

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const TYPE_META: Record<MassSchedule['type'], { label: string; color: string; icon: string }> = {
  MASS: { label: 'Missa', color: 'blue', icon: '⛪' },
  CONFESSION: { label: 'Confissão', color: 'yellow', icon: '🙏' },
  ADORATION: { label: 'Adoração', color: 'green', icon: '✨' },
  ROSARY: { label: 'Terço', color: 'gray', icon: '📿' },
};

const FixedSchedulePage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState<MassSchedule[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [communityFilter, setCommunityFilter] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<MassSchedule | null>(null);
  const [form, setForm] = useState({
    communityId: '',
    type: 'MASS' as MassSchedule['type'],
    dayOfWeek: 0,
    time: '',
    notes: '',
    isSpecial: false,
    specialDate: '',
  });

  const fetchData = useCallback(async () => {
    try {
      const [schedulesRes, communitiesRes] = await Promise.all([
        api.get('/mass-schedules/managed', { params: { communityId: communityFilter || undefined } }),
        api.get('/communities'),
      ]);
      setSchedules(schedulesRes.data);
      setCommunities(communitiesRes.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar a agenda fixa'));
    } finally {
      setLoading(false);
    }
  }, [communityFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreate = () => {
    setEditing(null);
    setForm({ communityId: communityFilter || '', type: 'MASS', dayOfWeek: 0, time: '', notes: '', isSpecial: false, specialDate: '' });
    setShowModal(true);
  };

  const openEdit = (schedule: MassSchedule) => {
    setEditing(schedule);
    setForm({
      communityId: schedule.community.id,
      type: schedule.type,
      dayOfWeek: schedule.dayOfWeek,
      time: schedule.time,
      notes: schedule.notes ?? '',
      isSpecial: schedule.isSpecial,
      specialDate: schedule.specialDate ? schedule.specialDate.slice(0, 10) : '',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.communityId) {
      notify.warning('Selecione a comunidade.');
      return;
    }
    if (!/^\d{1,2}:\d{2}$/.test(form.time)) {
      notify.warning('Informe o horário no formato HH:MM.');
      return;
    }
    const payload = {
      communityId: form.communityId,
      type: form.type,
      dayOfWeek: Number(form.dayOfWeek),
      time: form.time,
      notes: form.notes || undefined,
      isSpecial: form.isSpecial,
      specialDate: form.isSpecial && form.specialDate ? new Date(form.specialDate).toISOString() : undefined,
    };
    try {
      if (editing) {
        await api.patch(`/mass-schedules/${editing.id}`, payload);
        notify.success('Horário atualizado!');
      } else {
        await api.post('/mass-schedules', payload);
        notify.success('Horário fixo criado — já aparece no calendário de Eventos!');
      }
      setShowModal(false);
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao salvar horário'));
    }
  };

  const handleDelete = async (schedule: MassSchedule) => {
    const confirmed = await confirm.delete(`o horário fixo de ${TYPE_META[schedule.type].label}`);
    if (!confirmed) return;
    try {
      await api.delete(`/mass-schedules/${schedule.id}`);
      notify.success('Horário removido.');
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao remover horário'));
    }
  };

  // Agrupa por comunidade → tipo para exibição
  const grouped = schedules.reduce<Record<string, MassSchedule[]>>((acc, schedule) => {
    (acc[schedule.community.name] ??= []).push(schedule);
    return acc;
  }, {});

  if (loading) return <div className="module-page"><div className="loading">Carregando...</div></div>;

  return (
    <div className="module-page">
      <div className="page-header">
        <h1>🕐 Agenda Fixa</h1>
        <div className="header-actions">
          <button className="btn-primary" onClick={openCreate}>+ Novo Horário Fixo</button>
        </div>
      </div>

      <div className="privacy-note" style={{ background: '#eef6ff', borderColor: '#b6d4fe', color: '#084298' }}>
        Horários fixos semanais (Missa, Confissão, Adoração, Terço) da comunidade. Eles aparecem
        automaticamente no <strong>calendário de Eventos</strong> semana após semana e no export .ics.
      </div>

      <div className="filters">
        <SearchSelect
          options={communities.map((c) => ({ value: c.id, label: c.name, sublabel: c.parish?.name }))}
          value={communityFilter}
          onChange={setCommunityFilter}
          placeholder="Todas as comunidades"
          allOption
          searchPlaceholder="Buscar comunidade..."
        />
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="empty-state">Nenhum horário fixo cadastrado ainda.</div>
      ) : (
        Object.entries(grouped).map(([communityName, list]) => (
          <div key={communityName} className="detail-section">
            <h4 style={{ color: '#555', textTransform: 'uppercase', fontSize: '0.9rem' }}>{communityName}</h4>
            <div className="table-container entity-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Dia</th>
                    <th>Horário</th>
                    <th>Observação</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((schedule) => {
                    const meta = TYPE_META[schedule.type];
                    return (
                      <tr key={schedule.id}>
                        <td>
                          <span className={`status-badge ${meta.color}`}>{meta.icon} {meta.label}</span>
                        </td>
                        <td>
                          {schedule.isSpecial && schedule.specialDate
                            ? `Especial · ${new Date(schedule.specialDate).toLocaleDateString('pt-BR')}`
                            : WEEKDAYS[schedule.dayOfWeek]}
                        </td>
                        <td><strong>{schedule.time}</strong></td>
                        <td>{schedule.notes || '—'}</td>
                        <td className="actions-cell">
                          <button className="entity-icon-btn" onClick={() => openEdit(schedule)} title="Editar">✏️</button>
                          <button className="entity-icon-btn danger" onClick={() => handleDelete(schedule)} title="Excluir">🗑️</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      {showModal && (
        <div className="module-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? 'Editar horário fixo' : 'Novo horário fixo'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Comunidade *</label>
                <SearchSelect
                  options={communities.map((c) => ({ value: c.id, label: c.name, sublabel: c.parish?.name }))}
                  value={form.communityId}
                  onChange={(communityId) => setForm({ ...form, communityId })}
                  placeholder="Selecione a comunidade"
                  searchPlaceholder="Buscar comunidade..."
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Tipo *</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as MassSchedule['type'] })}>
                    {Object.entries(TYPE_META).map(([value, meta]) => (
                      <option key={value} value={value}>{meta.icon} {meta.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Horário (HH:MM) *</label>
                  <input type="time" required value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
                </div>
              </div>

              <label className="form-check">
                <input
                  type="checkbox"
                  checked={form.isSpecial}
                  onChange={(e) => setForm({ ...form, isSpecial: e.target.checked })}
                />
                Horário especial (data única — festa/solenidade) em vez de semanal
              </label>

              {form.isSpecial ? (
                <div className="form-group">
                  <label>Data especial *</label>
                  <input type="date" required value={form.specialDate} onChange={(e) => setForm({ ...form, specialDate: e.target.value })} />
                </div>
              ) : (
                <div className="form-group">
                  <label>Dia da semana *</label>
                  <select value={form.dayOfWeek} onChange={(e) => setForm({ ...form, dayOfWeek: Number(e.target.value) })}>
                    {WEEKDAYS.map((day, i) => <option key={day} value={i}>{day}</option>)}
                  </select>
                </div>
              )}

              <div className="form-group">
                <label>Observação</label>
                <input type="text" placeholder="Ex.: Missa com bênção das crianças" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">{editing ? 'Salvar' : 'Criar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FixedSchedulePage;

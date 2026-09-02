import React, { useState, useEffect, useCallback } from 'react';
import TitleIcon from '../../components/TitleIcon';
import api, { getErrorMessage } from '../../services/api';
import { notify, confirm } from '../../services/notification.service';
import SearchSelect from '../../components/SearchSelect';
import { useAuth } from '../../contexts/AuthContext';
import './ModulePages.css';

// Papéis que gerenciam a agenda fixa (criam/editam). O coordenador de pastoral
// só pode GERAR ESCALA a partir de um horário já configurado.
const MANAGE_ROLES = ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN', 'COMMUNITY_COORDINATOR'];

interface Community {
  id: string;
  name: string;
  parish?: { id: string; name: string };
}

interface CommunityPastoral {
  id: string;
  name?: string;
  globalPastoral?: { id: string; name: string };
  communityId?: string;
  community?: { id: string; name: string };
}

interface MassPastoral {
  id: string;
  requiredPeople: number;
  communityPastoral: {
    id: string;
    communityId?: string;
    community?: { id: string; name: string } | null;
    globalPastoral?: { id: string; name: string } | null;
  };
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
  pastorals?: MassPastoral[];
}

interface SelectedPastoral {
  communityPastoralId: string;
  name: string;
  requiredPeople: number;
}

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const TYPE_META: Record<MassSchedule['type'], { label: string; color: string; icon: string }> = {
  MASS: { label: 'Missa', color: 'blue', icon: '⛪' },
  CONFESSION: { label: 'Confissão', color: 'yellow', icon: '🙏' },
  ADORATION: { label: 'Adoração', color: 'green', icon: '✨' },
  ROSARY: { label: 'Terço', color: 'gray', icon: '📿' },
};

const pastoralName = (p: CommunityPastoral) => p.globalPastoral?.name || p.name || 'Pastoral';

/** Próxima data (YYYY-MM-DD) em que cai o dia da semana informado. */
function nextOccurrence(dayOfWeek: number): string {
  const today = new Date();
  const d = new Date(today);
  const diff = (dayOfWeek - today.getDay() + 7) % 7;
  d.setDate(today.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

const FixedSchedulePage: React.FC = () => {
  const { user } = useAuth();
  const canManage = MANAGE_ROLES.includes(user?.role ?? '');
  // Coordenador de pastoral: vincula/desvincula a PRÓPRIA pastoral aos
  // horários (o backend valida que ele coordena a pastoral em questão)
  const isPastoralCoord = user?.role === 'PASTORAL_COORDINATOR';

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

  // Pastorais vinculadas ao horário fixo
  const [communityPastorals, setCommunityPastorals] = useState<CommunityPastoral[]>([]);
  const [selectedPastorals, setSelectedPastorals] = useState<SelectedPastoral[]>([]);

  // Pendencias: datas dos proximos 30 dias sem escala, por horario fixo
  const [pendingByMass, setPendingByMass] = useState<Record<string, string[]>>({});

  // Modal de gerar escala
  const [genTarget, setGenTarget] = useState<MassSchedule | null>(null);
  const [genDate, setGenDate] = useState('');
  const [generating, setGenerating] = useState(false);

  // Vincular a própria pastoral (coordenador de pastoral)
  const [myPastorals, setMyPastorals] = useState<CommunityPastoral[]>([]);
  const [linkTarget, setLinkTarget] = useState<MassSchedule | null>(null);
  const [linkPastoralId, setLinkPastoralId] = useState('');
  const [linkRequired, setLinkRequired] = useState('0');
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    if (!isPastoralCoord) return;
    api
      .get('/pastorals/community/coordinated-by-me')
      .then((res) => setMyPastorals(res.data ?? []))
      .catch(() => setMyPastorals([]));
  }, [isPastoralCoord]);

  const fetchData = useCallback(async () => {
    try {
      const [schedulesRes, communitiesRes] = await Promise.all([
        api.get('/mass-schedules/managed', { params: { communityId: communityFilter || undefined } }),
        api.get('/communities'),
      ]);
      setSchedules(schedulesRes.data);
      setCommunities(communitiesRes.data);

      const from = new Date().toISOString().slice(0, 10);
      const to = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      api
        .get('/mass-schedules/pending', {
          params: { from, to, communityId: communityFilter || undefined },
        })
        .then((res) => {
          const map: Record<string, string[]> = {};
          for (const item of res.data || []) {
            (map[item.massScheduleId] ??= []).push(item.date);
          }
          setPendingByMass(map);
        })
        .catch(() => setPendingByMass({}));
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar a agenda fixa'));
    } finally {
      setLoading(false);
    }
  }, [communityFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Carrega as pastorais da comunidade selecionada no modal
  useEffect(() => {
    if (!showModal || !form.communityId) {
      setCommunityPastorals([]);
      return;
    }
    let active = true;
    // Ministérios de outras comunidades da MESMA paróquia também podem servir
    const parish = communities.find((c) => c.id === form.communityId)?.parish;
    api
      .get('/pastorals/community', {
        params: parish ? { parishId: parish.id } : { communityId: form.communityId },
      })
      .then((res) => {
        if (active) setCommunityPastorals(res.data || []);
      })
      .catch(() => {
        if (active) setCommunityPastorals([]);
      });
    return () => {
      active = false;
    };
  }, [showModal, form.communityId]);

  const openCreate = () => {
    setEditing(null);
    setForm({ communityId: communityFilter || '', type: 'MASS', dayOfWeek: 0, time: '', notes: '', isSpecial: false, specialDate: '' });
    setSelectedPastorals([]);
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
    setSelectedPastorals(
      (schedule.pastorals ?? []).map((p) => ({
        communityPastoralId: p.communityPastoral.id,
        name: p.communityPastoral.globalPastoral?.name || 'Pastoral',
        requiredPeople: p.requiredPeople ?? 0,
      })),
    );
    setShowModal(true);
  };

  const togglePastoral = (p: CommunityPastoral) => {
    setSelectedPastorals((prev) => {
      const exists = prev.find((s) => s.communityPastoralId === p.id);
      if (exists) return prev.filter((s) => s.communityPastoralId !== p.id);
      return [...prev, { communityPastoralId: p.id, name: pastoralName(p), requiredPeople: 0 }];
    });
  };

  const setPastoralRequired = (communityPastoralId: string, requiredPeople: number) => {
    setSelectedPastorals((prev) =>
      prev.map((s) => (s.communityPastoralId === communityPastoralId ? { ...s, requiredPeople } : s)),
    );
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
      pastoralSettings: selectedPastorals.map((s) => ({
        communityPastoralId: s.communityPastoralId,
        requiredPeople: Number(s.requiredPeople || 0),
      })),
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

  const openLink = (schedule: MassSchedule) => {
    const linked = new Set((schedule.pastorals ?? []).map((p) => p.communityPastoral.id));
    const available = myPastorals.filter((p) => !linked.has(p.id));
    if (available.length === 0) {
      notify.warning('Todas as pastorais que você coordena já estão vinculadas a este horário.');
      return;
    }
    setLinkTarget(schedule);
    setLinkPastoralId(available[0].id);
    setLinkRequired('0');
  };

  const handleLink = async () => {
    if (!linkTarget || !linkPastoralId) return;
    setLinking(true);
    try {
      await api.post(`/mass-schedules/${linkTarget.id}/pastorals`, {
        communityPastoralId: linkPastoralId,
        requiredPeople: Math.max(0, Number(linkRequired) || 0),
      });
      notify.success('Pastoral vinculada — ela entra nas próximas escalas geradas deste horário.');
      setLinkTarget(null);
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao vincular a pastoral'));
    } finally {
      setLinking(false);
    }
  };

  const handleUnlink = async (schedule: MassSchedule, pastoral: MassPastoral) => {
    const name = pastoral.communityPastoral.globalPastoral?.name || 'a pastoral';
    if (!window.confirm(`Desvincular ${name} deste horário? Escalas já geradas não mudam.`)) return;
    try {
      await api.delete(`/mass-schedules/${schedule.id}/pastorals/${pastoral.communityPastoral.id}`);
      notify.success('Pastoral desvinculada.');
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao desvincular a pastoral'));
    }
  };

  const openGenerate = (schedule: MassSchedule) => {
    if (!schedule.pastorals || schedule.pastorals.length === 0) {
      notify.warning('Vincule ao menos uma pastoral a este horário (Editar) antes de gerar a escala.');
      return;
    }
    setGenTarget(schedule);
    setGenDate(
      schedule.isSpecial && schedule.specialDate
        ? schedule.specialDate.slice(0, 10)
        : nextOccurrence(schedule.dayOfWeek),
    );
  };

  const handleGenerate = async () => {
    if (!genTarget || !genDate) return;
    setGenerating(true);
    try {
      await api.post(`/mass-schedules/${genTarget.id}/schedule`, {
        date: new Date(genDate).toISOString(),
      });
      notify.success('Escala gerada! Gerencie as atribuições na página Escalas.');
      setGenTarget(null);
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao gerar escala'));
    } finally {
      setGenerating(false);
    }
  };

  // Agrupa por comunidade para exibição
  const grouped = schedules.reduce<Record<string, MassSchedule[]>>((acc, schedule) => {
    (acc[schedule.community.name] ??= []).push(schedule);
    return acc;
  }, {});

  if (loading) return <div className="module-page"><div className="loading">Carregando...</div></div>;

  return (
    <div className="module-page">
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center' }}><TitleIcon name="missa-proxima" /> Agenda Fixa</h1>
        <div className="header-actions">
          {canManage && <button className="btn-primary" onClick={openCreate}>+ Novo Horário Fixo</button>}
        </div>
      </div>

      <div className="privacy-note" style={{ background: '#eef6ff', borderColor: '#b6d4fe', color: '#084298' }}>
        Horários fixos semanais (Missa, Confissão, Adoração, Terço) da comunidade. Aparecem no
        <strong> calendário de Eventos</strong> semana após semana. Vincule as <strong>pastorais</strong> que
        servem em cada horário e use <strong>Gerar escala</strong> para criar a escala de uma data — as
        atribuições são feitas na página <strong>Escalas</strong>.
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
                    <th>Pastorais</th>
                    <th>Pendências</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((schedule) => {
                    const meta = TYPE_META[schedule.type];
                    const pastorals = schedule.pastorals ?? [];
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
                        <td>
                          {pastorals.length === 0 ? (
                            <span style={{ color: '#999' }}>—</span>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {pastorals.map((p) => {
                                const mine =
                                  isPastoralCoord && myPastorals.some((mp) => mp.id === p.communityPastoral.id);
                                return (
                                  <span
                                    key={p.id}
                                    className="status-badge blue"
                                    style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                    title={
                                      p.communityPastoral.communityId &&
                                      p.communityPastoral.communityId !== schedule.community.id
                                        ? `Ministério de ${p.communityPastoral.community?.name ?? 'outra comunidade'}`
                                        : undefined
                                    }
                                  >
                                    {p.communityPastoral.globalPastoral?.name || 'Pastoral'}
                                    {p.communityPastoral.communityId &&
                                    p.communityPastoral.communityId !== schedule.community.id
                                      ? ` (${p.communityPastoral.community?.name ?? 'outra'})`
                                      : ''}
                                    {p.requiredPeople ? ` · ${p.requiredPeople}` : ''}
                                    {mine && (
                                      <button
                                        type="button"
                                        title="Desvincular a minha pastoral deste horário"
                                        style={{
                                          border: 'none',
                                          background: 'transparent',
                                          color: 'inherit',
                                          cursor: 'pointer',
                                          fontWeight: 800,
                                          padding: 0,
                                          lineHeight: 1,
                                        }}
                                        onClick={() => void handleUnlink(schedule, p)}
                                      >
                                        ×
                                      </button>
                                    )}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </td>
                        <td>
                          {(() => {
                            const pendingDates = pendingByMass[schedule.id] ?? [];
                            if (pastorals.length === 0) {
                              return <span style={{ color: '#999' }}>—</span>;
                            }
                            if (pendingDates.length === 0) {
                              return <span className="status-badge green">✓ Em dia (30d)</span>;
                            }
                            const [year, month, day] = pendingDates[0].split('-');
                            return (
                              <button
                                className="status-badge yellow"
                                style={{ border: 'none', cursor: 'pointer' }}
                                title={`Próxima sem escala: ${day}/${month}/${year} — clique para gerar`}
                                onClick={() => {
                                  openGenerate(schedule);
                                  setGenDate(pendingDates[0]);
                                }}
                              >
                                ⚠ {pendingDates.length} sem escala
                              </button>
                            );
                          })()}
                        </td>
                        <td className="actions-cell">
                          <button
                            className="btn-secondary"
                            style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                            onClick={() => openGenerate(schedule)}
                            title="Gerar escala para uma data"
                          >
                            📋 Gerar escala
                          </button>
                          {isPastoralCoord && myPastorals.length > 0 && (
                            <button
                              className="btn-secondary"
                              style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                              onClick={() => openLink(schedule)}
                              title="Vincular uma pastoral que você coordena a este horário"
                            >
                              ➕ Minha pastoral
                            </button>
                          )}
                          {canManage && (
                            <>
                              <button className="entity-icon-btn" onClick={() => openEdit(schedule)} title="Editar">✏️</button>
                              <button className="entity-icon-btn danger" onClick={() => handleDelete(schedule)} title="Excluir">🗑️</button>
                            </>
                          )}
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

              {/* Pastorais vinculadas */}
              <div className="form-group">
                <label>
                  Pastorais que servem neste horário
                  {selectedPastorals.length > 0 && (
                    <span style={{ color: '#075AA9', fontWeight: 700 }}> · {selectedPastorals.length} selecionada{selectedPastorals.length > 1 ? 's' : ''}</span>
                  )}
                </label>
                {!form.communityId ? (
                  <p style={{ color: '#888', fontSize: '0.85rem', margin: 0 }}>Selecione a comunidade para listar as pastorais.</p>
                ) : communityPastorals.length === 0 ? (
                  <p style={{ color: '#888', fontSize: '0.85rem', margin: 0 }}>Nenhuma pastoral cadastrada nesta comunidade.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto', padding: 2 }}>
                    {communityPastorals.map((p) => {
                      const sel = selectedPastorals.find((s) => s.communityPastoralId === p.id);
                      return (
                        <div
                          key={p.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '9px 12px',
                            borderRadius: 10,
                            border: `1px solid ${sel ? '#0A84FF' : '#e5e7eb'}`,
                            background: sel ? '#eaf4ff' : '#fff',
                            transition: 'border-color .15s, background .15s',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => togglePastoral(p)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              flex: 1,
                              minWidth: 0,
                              background: 'transparent',
                              border: 'none',
                              padding: 0,
                              margin: 0,
                              cursor: 'pointer',
                              font: 'inherit',
                              color: 'inherit',
                              textAlign: 'left',
                            }}
                          >
                            <span
                              aria-hidden="true"
                              style={{
                                width: 20,
                                height: 20,
                                flexShrink: 0,
                                borderRadius: 6,
                                border: `2px solid ${sel ? '#0A84FF' : '#c3ccd6'}`,
                                background: sel ? '#0A84FF' : '#fff',
                                color: '#fff',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 13,
                                lineHeight: 1,
                                fontWeight: 800,
                              }}
                            >
                              {sel ? '✓' : ''}
                            </span>
                            <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {pastoralName(p)}
                              {p.communityId && p.communityId !== form.communityId && (
                                <small style={{ color: '#8a6d1b', fontWeight: 600 }}>
                                  {' '}
                                  · {p.community?.name ?? 'outra comunidade'}
                                </small>
                              )}
                            </span>
                          </button>
                          {sel && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#52606d', margin: 0, flexShrink: 0 }}>
                              vagas
                              <input
                                type="number"
                                min={0}
                                value={sel.requiredPeople}
                                onChange={(e) => setPastoralRequired(p.id, Math.max(0, Number(e.target.value)))}
                                style={{ width: 62, padding: '5px 8px', textAlign: 'center' }}
                              />
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <p style={{ color: '#888', fontSize: '0.78rem', margin: '6px 2px 0' }}>
                  As pastorais marcadas são copiadas para a escala ao clicar em “Gerar escala”. “Vagas” = quantidade sugerida de pessoas.
                </p>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">{editing ? 'Salvar' : 'Criar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de vincular a própria pastoral (coordenador de pastoral) */}
      {linkTarget && (
        <div className="module-modal-overlay" onClick={() => setLinkTarget(null)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <h2>Vincular minha pastoral</h2>
            <p style={{ color: '#555', marginBottom: 12 }}>
              {TYPE_META[linkTarget.type].label} ·{' '}
              {linkTarget.isSpecial && linkTarget.specialDate
                ? `Especial ${new Date(linkTarget.specialDate).toLocaleDateString('pt-BR')}`
                : WEEKDAYS[linkTarget.dayOfWeek]}{' '}
              às <strong>{linkTarget.time}</strong> · {linkTarget.community.name}
            </p>
            <div className="form-group">
              <label>Pastoral *</label>
              <select value={linkPastoralId} onChange={(e) => setLinkPastoralId(e.target.value)}>
                {myPastorals
                  .filter((p) => !(linkTarget.pastorals ?? []).some((lp) => lp.communityPastoral.id === p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {pastoralName(p)}
                      {p.communityId && p.communityId !== linkTarget.community.id
                        ? ` · ${p.community?.name ?? 'outra comunidade'}`
                        : ''}
                    </option>
                  ))}
              </select>
            </div>
            <div className="form-group">
              <label>Vagas sugeridas (0 = sem número fixo)</label>
              <input type="number" min={0} value={linkRequired} onChange={(e) => setLinkRequired(e.target.value)} />
            </div>
            <p style={{ fontSize: '0.85rem', color: '#666' }}>
              A pastoral vinculada é copiada para as escalas geradas deste horário. Você vincula e
              desvincula apenas as pastorais que <strong>coordena</strong> — as demais seguem com a
              coordenação da comunidade.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setLinkTarget(null)}>Cancelar</button>
              <button type="button" className="btn-submit" disabled={linking || !linkPastoralId} onClick={() => void handleLink()}>
                {linking ? 'Vinculando…' : 'Vincular'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de gerar escala */}
      {genTarget && (
        <div className="module-modal-overlay" onClick={() => setGenTarget(null)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <h2>Gerar escala</h2>
            <p style={{ color: '#555', marginBottom: 12 }}>
              {TYPE_META[genTarget.type].label} das <strong>{genTarget.time}</strong> ·{' '}
              {genTarget.community.name}
            </p>
            <div className="form-group">
              <label>Data da celebração *</label>
              <input type="date" value={genDate} onChange={(e) => setGenDate(e.target.value)} />
            </div>
            <p style={{ fontSize: '0.85rem', color: '#666' }}>
              As pastorais vinculadas ({(genTarget.pastorals ?? []).length}) serão copiadas para a escala.
              As atribuições de membros são feitas na página <strong>Escalas</strong>.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setGenTarget(null)}>Cancelar</button>
              <button type="button" className="btn-submit" disabled={generating || !genDate} onClick={handleGenerate}>
                {generating ? 'Gerando...' : 'Gerar escala'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FixedSchedulePage;

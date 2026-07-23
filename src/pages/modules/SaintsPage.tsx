import React, { useState, useEffect, useCallback } from 'react';
import api, { getErrorMessage } from '../../services/api';
import { notify, confirm } from '../../services/notification.service';
import { useAuth } from '../../contexts/AuthContext';
import SaintAvatar from '../../components/SaintAvatar';
import './ModulePages.css';

interface Saint {
  id: string;
  name: string;
  feastMonth?: number | null;
  feastDay?: number | null;
  patronOf?: string | null;
  biography?: string | null;
  imageUrl?: string | null;
  _count?: { patronages: number };
}

interface Patronage {
  id: string;
  isPrimary: boolean;
  notes?: string | null;
  diocese?: { id: string; name: string } | null;
  parish?: { id: string; name: string } | null;
  community?: { id: string; name: string } | null;
}

interface SaintDetail extends Saint {
  patronages: Patronage[];
}

interface Option {
  id: string;
  name: string;
}

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const SaintsPage: React.FC = () => {
  const { user } = useAuth();
  const canManageCatalog = user?.role === 'SYSTEM_ADMIN' || user?.role === 'DIOCESAN_ADMIN';
  const canLink = ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN', 'COMMUNITY_COORDINATOR'].includes(user?.role ?? '');

  const [loading, setLoading] = useState(true);
  const [saints, setSaints] = useState<Saint[]>([]);
  const [todaySaints, setTodaySaints] = useState<Saint[]>([]);
  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState('');

  const [dioceses, setDioceses] = useState<Option[]>([]);
  const [parishes, setParishes] = useState<Option[]>([]);
  const [communities, setCommunities] = useState<Option[]>([]);

  const [detail, setDetail] = useState<SaintDetail | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editingSaint, setEditingSaint] = useState<Saint | null>(null);
  const [form, setForm] = useState({ name: '', feastMonth: '', feastDay: '', patronOf: '', biography: '', imageUrl: '' });

  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkForm, setLinkForm] = useState({ level: 'community', targetId: '', isPrimary: true, notes: '' });

  const fetchData = useCallback(async () => {
    try {
      const [saintsRes, todayRes] = await Promise.all([
        api.get('/saints', { params: { search: search || undefined, month: monthFilter || undefined } }),
        api.get('/saints/today'),
      ]);
      setSaints(saintsRes.data);
      setTodaySaints(todayRes.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar santos'));
    } finally {
      setLoading(false);
    }
  }, [search, monthFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    api.get('/dioceses').then((res) => setDioceses(res.data)).catch(() => setDioceses([]));
    api.get('/parishes').then((res) => setParishes(res.data)).catch(() => setParishes([]));
    api.get('/communities').then((res) => setCommunities(res.data)).catch(() => setCommunities([]));
  }, []);

  const openDetail = async (id: string) => {
    try {
      const res = await api.get(`/saints/${id}`);
      setDetail(res.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar o santo'));
    }
  };

  const openEdit = (saint: Saint) => {
    setEditingSaint(saint);
    setForm({
      name: saint.name,
      feastMonth: saint.feastMonth ? String(saint.feastMonth) : '',
      feastDay: saint.feastDay ? String(saint.feastDay) : '',
      patronOf: saint.patronOf ?? '',
      biography: saint.biography ?? '',
      imageUrl: saint.imageUrl ?? '',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name: form.name,
      feastMonth: form.feastMonth ? Number(form.feastMonth) : undefined,
      feastDay: form.feastDay ? Number(form.feastDay) : undefined,
      patronOf: form.patronOf || undefined,
      biography: form.biography || undefined,
      imageUrl: form.imageUrl || undefined,
    };
    try {
      if (editingSaint) {
        await api.patch(`/saints/${editingSaint.id}`, payload);
        notify.success('Santo atualizado!');
      } else {
        await api.post('/saints', payload);
        notify.success('Santo cadastrado!');
      }
      setShowModal(false);
      setEditingSaint(null);
      setForm({ name: '', feastMonth: '', feastDay: '', patronOf: '', biography: '', imageUrl: '' });
      fetchData();
      if (detail && editingSaint?.id === detail.id) openDetail(detail.id);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao salvar santo'));
    }
  };

  const handleDelete = async (saint: Saint) => {
    const confirmed = await confirm.delete(`"${saint.name}" do catálogo`);
    if (!confirmed) return;
    try {
      await api.delete(`/saints/${saint.id}`);
      notify.success('Santo removido do catálogo.');
      if (detail?.id === saint.id) setDetail(null);
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao remover santo'));
    }
  };

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    const payload: Record<string, unknown> = { isPrimary: linkForm.isPrimary, notes: linkForm.notes || undefined };
    if (linkForm.level === 'diocese') payload.dioceseId = linkForm.targetId;
    if (linkForm.level === 'parish') payload.parishId = linkForm.targetId;
    if (linkForm.level === 'community') payload.communityId = linkForm.targetId;
    try {
      await api.post(`/saints/${detail.id}/patronages`, payload);
      notify.success('Padroeiro vinculado!');
      setShowLinkModal(false);
      setLinkForm({ level: 'community', targetId: '', isPrimary: true, notes: '' });
      openDetail(detail.id);
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao vincular padroeiro'));
    }
  };

  const handleUnlink = async (patronage: Patronage) => {
    if (!detail) return;
    const target = patronage.diocese?.name ?? patronage.parish?.name ?? patronage.community?.name ?? 'este vínculo';
    const confirmed = await confirm.delete(`o vínculo com ${target}`);
    if (!confirmed) return;
    try {
      await api.delete(`/saints/patronages/${patronage.id}`);
      notify.success('Vínculo removido.');
      openDetail(detail.id);
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao remover vínculo'));
    }
  };

  const feastLabel = (saint: Saint) =>
    saint.feastMonth && saint.feastDay ? `${String(saint.feastDay).padStart(2, '0')} de ${MONTHS[saint.feastMonth - 1]}` : '—';

  const patronageLabel = (p: Patronage) => {
    if (p.diocese) return { level: 'Diocese', name: p.diocese.name };
    if (p.parish) return { level: 'Paróquia', name: p.parish.name };
    if (p.community) return { level: 'Comunidade', name: p.community.name };
    return { level: '—', name: '—' };
  };

  const levelOptions: Record<string, Option[]> = {
    diocese: dioceses,
    parish: parishes,
    community: communities,
  };

  if (loading) return <div className="module-page"><div className="loading">Carregando...</div></div>;

  return (
    <div className="module-page">
      <div className="page-header">
        <h1>🕊️ Santos</h1>
        <div className="header-actions">
          {canManageCatalog && (
            <button className="btn-primary" onClick={() => { setEditingSaint(null); setShowModal(true); }}>
              + Novo Santo
            </button>
          )}
        </div>
      </div>

      {todaySaints.length > 0 && (
        <div className="privacy-note" style={{ background: '#eef6ff', borderColor: '#b6d4fe', color: '#084298' }}>
          ✨ <strong>Santo do dia:</strong>{' '}
          {todaySaints.map((s) => s.name).join(', ')}
          {todaySaints[0].patronOf ? ` — padroeiro(a) de ${todaySaints[0].patronOf}` : ''}
        </div>
      )}

      <div className="filters">
        <input
          type="text"
          className="search-input"
          placeholder="Buscar por nome..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="filter-select" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
          <option value="">Todos os meses</option>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
      </div>

      <div className="module-grid">
        {saints.map((saint) => (
          <div key={saint.id} className="module-card">
            <div className="card-with-avatar">
              <SaintAvatar saint={saint} />
              <div className="card-avatar-info">
                <h3>{saint.name}</h3>
                <p><strong>Festa:</strong> {feastLabel(saint)}</p>
              </div>
            </div>
            {saint.patronOf && <p><strong>Padroeiro(a) de:</strong> {saint.patronOf}</p>}
            <p><span className="status-badge blue">{saint._count?.patronages ?? 0} vínculo(s)</span></p>
            <div className="card-footer">
              <button className="btn-small" onClick={() => openDetail(saint.id)}>Detalhes</button>
              {canManageCatalog && <button className="btn-small" onClick={() => openEdit(saint)}>Editar</button>}
              {user?.role === 'SYSTEM_ADMIN' && (
                <button className="btn-small danger" onClick={() => handleDelete(saint)}>Excluir</button>
              )}
            </div>
          </div>
        ))}
      </div>
      {saints.length === 0 && <div className="empty-state">Nenhum santo no catálogo ainda.</div>}

      {detail && (
        <div className="module-modal-overlay" onClick={() => setDetail(null)}>
          <div className="module-modal wide" onClick={(e) => e.stopPropagation()}>
            <div className="card-with-avatar" style={{ marginBottom: '1rem' }}>
              <SaintAvatar saint={detail} large />
              <div className="card-avatar-info">
                <h2 style={{ margin: 0 }}>{detail.name}</h2>
                <p style={{ margin: '0.25rem 0 0 0', color: '#666' }}>
                  <strong>Festa:</strong> {feastLabel(detail)}
                  {detail.patronOf ? <> · <strong>Padroeiro(a) de:</strong> {detail.patronOf}</> : null}
                </p>
              </div>
            </div>
            {detail.biography && <p style={{ color: '#555', marginBottom: '1rem', lineHeight: 1.55 }}>{detail.biography}</p>}

            <h4 style={{ margin: '0 0 0.6rem 0', color: '#555', textTransform: 'uppercase', fontSize: '0.9rem' }}>
              Padroado (vínculos)
            </h4>
            <div className="table-container" style={{ marginBottom: '1rem' }}>
              <table className="data-table">
                <thead>
                  <tr><th>Nível</th><th>Entidade</th><th>Tipo</th><th>Observações</th><th></th></tr>
                </thead>
                <tbody>
                  {detail.patronages.map((p) => {
                    const label = patronageLabel(p);
                    return (
                      <tr key={p.id}>
                        <td><span className="status-badge gray">{label.level}</span></td>
                        <td><strong>{label.name}</strong></td>
                        <td>{p.isPrimary ? <span className="status-badge green">Padroeiro principal</span> : <span className="status-badge blue">Co-padroeiro</span>}</td>
                        <td>{p.notes || '—'}</td>
                        <td className="actions-cell">
                          {canLink && <button className="btn-small danger" onClick={() => handleUnlink(p)}>Remover</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {detail.patronages.length === 0 && <div className="empty-state">Sem vínculos de padroado ainda.</div>}
            </div>

            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setDetail(null)}>Fechar</button>
              {canManageCatalog && (
                <button type="button" className="btn-small" style={{ padding: '0.65rem 1.25rem' }} onClick={() => openEdit(detail)}>
                  Editar (foto, biografia...)
                </button>
              )}
              {canLink && (
                <button type="button" className="btn-submit" onClick={() => setShowLinkModal(true)}>
                  + Vincular como padroeiro
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="module-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingSaint ? `Editar ${editingSaint.name}` : 'Novo Santo'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Nome *</label>
                <input type="text" required placeholder="Ex.: São Francisco de Assis" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Mês da festa</label>
                  <select value={form.feastMonth} onChange={(e) => setForm({ ...form, feastMonth: e.target.value })}>
                    <option value="">—</option>
                    {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Dia da festa</label>
                  <input type="number" min={1} max={31} value={form.feastDay} onChange={(e) => setForm({ ...form, feastDay: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Padroeiro(a) de</label>
                <input type="text" placeholder="Ex.: dos animais e da ecologia" value={form.patronOf} onChange={(e) => setForm({ ...form, patronOf: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Biografia / história</label>
                <textarea rows={4} value={form.biography} onChange={(e) => setForm({ ...form, biography: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Imagem (URL)</label>
                <input type="url" placeholder="https://..." value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">{editingSaint ? 'Salvar' : 'Cadastrar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showLinkModal && detail && (
        <div className="module-modal-overlay" onClick={() => setShowLinkModal(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Vincular {detail.name} como padroeiro</h2>
            <form onSubmit={handleLink}>
              <div className="form-row">
                <div className="form-group">
                  <label>Nível *</label>
                  <select value={linkForm.level} onChange={(e) => setLinkForm({ ...linkForm, level: e.target.value, targetId: '' })}>
                    <option value="community">Comunidade</option>
                    <option value="parish">Paróquia</option>
                    <option value="diocese">Diocese</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Entidade *</label>
                  <select required value={linkForm.targetId} onChange={(e) => setLinkForm({ ...linkForm, targetId: e.target.value })}>
                    <option value="">Selecione</option>
                    {(levelOptions[linkForm.level] ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              </div>
              <label className="form-check">
                <input type="checkbox" checked={linkForm.isPrimary} onChange={(e) => setLinkForm({ ...linkForm, isPrimary: e.target.checked })} />
                Padroeiro principal (desmarque para co-padroeiro)
              </label>
              <div className="form-group">
                <label>Observações</label>
                <input type="text" value={linkForm.notes} onChange={(e) => setLinkForm({ ...linkForm, notes: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowLinkModal(false)}>Cancelar</button>
                <button type="submit" className="btn-submit">Vincular</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SaintsPage;

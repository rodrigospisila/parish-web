import React, { useState, useEffect, useCallback } from 'react';
import api, { getErrorMessage } from '../../services/api';
import { notify, confirm } from '../../services/notification.service';
import { useAuth } from '../../contexts/AuthContext';
import './ModulePages.css';

interface ClergyMessage {
  id: string;
  title: string;
  body?: string | null;
  videoUrl?: string | null;
  senderTitle?: string | null;
  senderLabel?: string; // rótulo dinâmico: "Palavra do Bispo/Pároco/Diácono"
  audience: 'DIOCESE' | 'PARISH' | 'COMMUNITY' | 'PASTORAL' | 'MEMBER';
  publishedAt: string;
  sender?: { id: string; name: string; role: string } | null;
  diocese?: { id: string; name: string } | null;
  parish?: { id: string; name: string } | null;
  community?: { id: string; name: string } | null;
  communityPastoral?: { id: string; globalPastoral?: { name: string } | null } | null;
  member?: { id: string; fullName: string } | null;
}

interface Option {
  id: string;
  name: string;
}

interface PastoralOption {
  id: string;
  globalPastoral?: { name: string } | null;
}

interface MemberOption {
  id: string;
  fullName: string;
}

const AUDIENCE_META: Record<ClergyMessage['audience'], { label: string; color: string }> = {
  DIOCESE: { label: 'Diocese inteira', color: 'blue' },
  PARISH: { label: 'Paróquia inteira', color: 'blue' },
  COMMUNITY: { label: 'Comunidade', color: 'green' },
  PASTORAL: { label: 'Pastoral', color: 'yellow' },
  MEMBER: { label: 'Pessoal', color: 'gray' },
};

/** Extrai o id de vídeo do YouTube para embed; null para outros provedores. */
function youtubeEmbedUrl(url?: string | null): string | null {
  if (!url) return null;
  const match = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i.exec(url);
  return match ? `https://www.youtube.com/embed/${match[1]}` : null;
}

const ClergyMessagesPage: React.FC = () => {
  const { user } = useAuth();
  const canSend = ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN', 'COMMUNITY_COORDINATOR'].includes(user?.role ?? '');

  const [tab, setTab] = useState<'feed' | 'mine'>('feed');
  const [loading, setLoading] = useState(true);
  const [feed, setFeed] = useState<ClergyMessage[]>([]);
  const [mine, setMine] = useState<ClergyMessage[]>([]);

  const [communities, setCommunities] = useState<Option[]>([]);
  const [parishes, setParishes] = useState<Option[]>([]);
  const [pastorals, setPastorals] = useState<PastoralOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);

  const isDiocesanOrHigher = user?.role === 'DIOCESAN_ADMIN' || user?.role === 'SYSTEM_ADMIN';

  const [showComposer, setShowComposer] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    title: '',
    body: '',
    videoUrl: '',
    senderTitle: '',
    audience: 'COMMUNITY',
    parishId: '',
    communityId: '',
    communityPastoralId: '',
    memberId: '',
  });

  const fetchData = useCallback(async () => {
    try {
      const requests: Promise<any>[] = [api.get('/clergy-messages')];
      if (canSend) requests.push(api.get('/clergy-messages/mine'));
      const [feedRes, mineRes] = await Promise.all(requests);
      setFeed(feedRes.data);
      if (mineRes) setMine(mineRes.data);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao carregar mensagens'));
    } finally {
      setLoading(false);
    }
  }, [canSend]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!canSend) return;
    api.get('/communities').then((res) => setCommunities(res.data)).catch(() => setCommunities([]));
    api.get('/members').then((res) => setMembers(res.data)).catch(() => setMembers([]));
    if (isDiocesanOrHigher) {
      api.get('/parishes').then((res) => setParishes(res.data)).catch(() => setParishes([]));
    }
  }, [canSend, isDiocesanOrHigher]);

  useEffect(() => {
    if (!form.communityId) {
      setPastorals([]);
      return;
    }
    api
      .get('/pastorals/community', { params: { communityId: form.communityId } })
      .then((res) => setPastorals(res.data))
      .catch(() => setPastorals([]));
  }, [form.communityId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/clergy-messages', {
        title: form.title,
        body: form.body || undefined,
        videoUrl: form.videoUrl || undefined,
        senderTitle: form.senderTitle || undefined,
        audience: form.audience,
        parishId: form.audience === 'PARISH' ? form.parishId || undefined : undefined,
        communityId: form.audience === 'COMMUNITY' ? form.communityId || undefined : undefined,
        communityPastoralId: form.audience === 'PASTORAL' ? form.communityPastoralId : undefined,
        memberId: form.audience === 'MEMBER' ? form.memberId : undefined,
      });
      notify.success('Mensagem publicada!');
      setShowComposer(false);
      setForm({ title: '', body: '', videoUrl: '', senderTitle: form.senderTitle, audience: 'COMMUNITY', parishId: '', communityId: '', communityPastoralId: '', memberId: '' });
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao publicar mensagem'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (message: ClergyMessage) => {
    const confirmed = await confirm.delete(`a mensagem "${message.title}"`);
    if (!confirmed) return;
    try {
      await api.delete(`/clergy-messages/${message.id}`);
      notify.success('Mensagem removida.');
      fetchData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao remover mensagem'));
    }
  };

  const targetLabel = (m: ClergyMessage) => {
    if (m.audience === 'DIOCESE') return m.diocese?.name ?? 'Diocese';
    if (m.audience === 'PARISH') return m.parish?.name ?? 'Paróquia';
    if (m.audience === 'COMMUNITY') return m.community?.name ?? 'Comunidade';
    if (m.audience === 'PASTORAL') return m.communityPastoral?.globalPastoral?.name ?? 'Pastoral';
    return m.member?.fullName ?? 'Membro';
  };

  const formatDate = (value: string) =>
    new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const renderMessageCard = (message: ClergyMessage, manageable: boolean) => {
    const meta = AUDIENCE_META[message.audience];
    const embed = youtubeEmbedUrl(message.videoUrl);
    return (
      <div key={message.id} className="module-card" style={{ maxWidth: 720 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="status-badge blue">📜 {message.senderLabel || 'Palavra Pastoral'}</span>
          <span className={`status-badge ${meta.color}`}>{meta.label}: {targetLabel(message)}</span>
        </div>
        <h3 style={{ margin: '0.5rem 0 0.15rem 0' }}>{message.title}</h3>
        <p style={{ color: '#888', fontSize: '0.85rem' }}>
          {message.senderTitle || message.sender?.name || 'Clero'} · {formatDate(message.publishedAt)}
        </p>
        {message.body && <p style={{ whiteSpace: 'pre-wrap', color: '#444' }}>{message.body}</p>}
        {embed ? (
          <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: 8, overflow: 'hidden' }}>
            <iframe
              src={embed}
              title={message.title}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          message.videoUrl && (
            <a className="btn-small" style={{ textDecoration: 'none', alignSelf: 'flex-start' }} href={message.videoUrl} target="_blank" rel="noreferrer">
              ▶️ Assistir vídeo
            </a>
          )
        )}
        {manageable && (
          <div className="card-footer">
            <button className="btn-small danger" onClick={() => handleDelete(message)}>Excluir</button>
          </div>
        )}
      </div>
    );
  };

  if (loading) return <div className="module-page"><div className="loading">Carregando...</div></div>;

  return (
    <div className="module-page">
      <div className="page-header">
        <h1>📜 Palavra Pastoral</h1>
        <div className="header-actions">
          {canSend && (
            <button className="btn-primary" onClick={() => setShowComposer(true)}>+ Nova Mensagem</button>
          )}
        </div>
      </div>

      {canSend && (
        <div className="module-tabs">
          <button className={`tab-btn ${tab === 'feed' ? 'active' : ''}`} onClick={() => setTab('feed')}>
            Feed ({feed.length})
          </button>
          <button className={`tab-btn ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>
            Minhas mensagens ({mine.length})
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {(tab === 'feed' ? feed : mine).map((message) => renderMessageCard(message, tab === 'mine'))}
      </div>
      {(tab === 'feed' ? feed : mine).length === 0 && (
        <div className="empty-state">
          {tab === 'feed' ? 'Nenhuma mensagem para você ainda.' : 'Você ainda não publicou mensagens.'}
        </div>
      )}

      {showComposer && (
        <div className="module-modal-overlay" onClick={() => setShowComposer(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Nova mensagem</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Título *</label>
                <input type="text" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Assinatura pastoral</label>
                <input
                  type="text"
                  placeholder='Ex.: "Pe. João — Pároco", "Dom Carlos", "Diác. José"'
                  value={form.senderTitle}
                  onChange={(e) => setForm({ ...form, senderTitle: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Mensagem</label>
                <textarea rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Link de vídeo (YouTube etc.)</label>
                <input type="url" placeholder="https://youtube.com/..." value={form.videoUrl} onChange={(e) => setForm({ ...form, videoUrl: e.target.value })} />
              </div>

              <div className="form-group">
                <label>Enviar para *</label>
                <select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
                  <option value="COMMUNITY">Comunidade inteira</option>
                  <option value="PASTORAL">Uma pastoral</option>
                  <option value="MEMBER">Um membro</option>
                  {(user?.role === 'PARISH_ADMIN' || user?.role === 'DIOCESAN_ADMIN' || user?.role === 'SYSTEM_ADMIN') && (
                    <option value="PARISH">Paróquia inteira</option>
                  )}
                  {(user?.role === 'DIOCESAN_ADMIN' || user?.role === 'SYSTEM_ADMIN') && (
                    <option value="DIOCESE">Diocese inteira</option>
                  )}
                </select>
              </div>

              {form.audience === 'PARISH' && isDiocesanOrHigher && (
                <div className="form-group">
                  <label>Paróquia *</label>
                  <select required value={form.parishId} onChange={(e) => setForm({ ...form, parishId: e.target.value })}>
                    <option value="">Selecione</option>
                    {parishes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}

              {(form.audience === 'COMMUNITY' || form.audience === 'PASTORAL') && (
                <div className="form-group">
                  <label>Comunidade *</label>
                  <select
                    required
                    value={form.communityId}
                    onChange={(e) => setForm({ ...form, communityId: e.target.value, communityPastoralId: '' })}
                  >
                    <option value="">Selecione</option>
                    {communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}

              {form.audience === 'PASTORAL' && (
                <div className="form-group">
                  <label>Pastoral *</label>
                  <select required value={form.communityPastoralId} onChange={(e) => setForm({ ...form, communityPastoralId: e.target.value })}>
                    <option value="">Selecione</option>
                    {pastorals.map((p) => <option key={p.id} value={p.id}>{p.globalPastoral?.name ?? 'Pastoral'}</option>)}
                  </select>
                </div>
              )}

              {form.audience === 'MEMBER' && (
                <div className="form-group">
                  <label>Membro *</label>
                  <select required value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })}>
                    <option value="">Selecione</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
                  </select>
                </div>
              )}

              <p style={{ color: '#777', fontSize: '0.85rem' }}>
                Membro, pastoral e comunidade recebem notificação push. Paróquia/diocese inteira aparecem no feed.
              </p>

              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowComposer(false)}>Cancelar</button>
                <button type="submit" className="btn-submit" disabled={submitting}>
                  {submitting ? 'Publicando...' : 'Publicar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClergyMessagesPage;

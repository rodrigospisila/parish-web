import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import TitleIcon from '../components/TitleIcon';
import { useAuth } from '../contexts/AuthContext';
import { notify, confirm } from '../services/notification.service';

const API_URL = import.meta.env.VITE_API_URL;

interface CommunityLink {
  id: string;
  communityId: string;
  isPrimary: boolean;
  isActive: boolean;
  community: { id: string; name: string; parish?: { id: string; name: string } };
}

interface DioceseOption {
  id: string;
  name: string;
}

interface ParishTree {
  id: string;
  name: string;
  communities?: { id: string; name: string }[];
}

const ROLE_LABELS: Record<string, string> = {
  SYSTEM_ADMIN: 'Administração do Sistema',
  DIOCESAN_ADMIN: 'Administração Diocesana',
  PARISH_ADMIN: 'Administração Paroquial',
  COMMUNITY_COORDINATOR: 'Coordenação de Comunidade',
  PASTORAL_COORDINATOR: 'Coordenação de Pastoral',
  VOLUNTEER: 'Voluntariado',
  FAITHFUL: 'Fiel',
};

/** Minha conta: dados básicos + vínculos multi-comunidade (Fase 3). */
const MyAccountPage: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const [links, setLinks] = useState<CommunityLink[]>([]);
  const [memberMissing, setMemberMissing] = useState(false);
  const [dioceses, setDioceses] = useState<DioceseOption[]>([]);
  const [dioceseId, setDioceseId] = useState('');
  const [parishes, setParishes] = useState<ParishTree[]>([]);
  const [parishId, setParishId] = useState('');
  const [communityId, setCommunityId] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  const headers = () => ({
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
  });

  const loadLinks = async () => {
    try {
      const response = await axios.get(`${API_URL}/members/me/communities`, headers());
      setLinks((response.data || []).filter((link: CommunityLink) => link.isActive !== false));
      setMemberMissing(false);
    } catch (error: any) {
      if (error.response?.status === 404) {
        setMemberMissing(true);
      }
      setLinks([]);
    }
  };

  useEffect(() => {
    void loadLinks();
    axios
      .get(`${API_URL}/dioceses`, headers())
      .then((response) => setDioceses(response.data || []))
      .catch(() => setDioceses([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cascata: carregar paróquias/comunidades da diocese escolhida
  useEffect(() => {
    if (!dioceseId) {
      setParishes([]);
      setParishId('');
      setCommunityId('');
      return;
    }
    axios
      .get(`${API_URL}/dioceses/${dioceseId}`, headers())
      .then((response) => setParishes(response.data?.parishes || []))
      .catch(() => setParishes([]));
    setParishId('');
    setCommunityId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dioceseId]);

  const communities = parishes.find((parish) => parish.id === parishId)?.communities ?? [];
  const alreadyLinked = new Set(links.map((link) => link.communityId));
  // Papéis de gestão têm o escopo atrelado à comunidade — a troca de principal
  // é feita por um administrador (o backend também bloqueia).
  const canChangePrimary = ['FAITHFUL', 'VOLUNTEER'].includes(user?.role ?? '');

  const handleAdd = async () => {
    if (!communityId) {
      notify.warning('Selecione a comunidade para vincular');
      return;
    }
    if (!consent) {
      notify.warning('Confirme o consentimento (LGPD) para criar o vínculo');
      return;
    }
    setBusy(true);
    try {
      await axios.post(
        `${API_URL}/members/me/communities`,
        { communityId, consentGiven: true },
        headers(),
      );
      notify.success('Comunidade vinculada! Você já aparece para os coordenadores de lá.');
      setCommunityId('');
      setConsent(false);
      await loadLinks();
    } catch (error: any) {
      notify.error(error.response?.data?.message || 'Erro ao vincular comunidade');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (link: CommunityLink) => {
    const ok = await confirm.action(
      'Remover vínculo',
      `Remover seu vínculo com ${link.community.name}? Você deixa de ser visível/escalável nessa comunidade (as participações em pastorais de lá são encerradas).`,
      'Remover vínculo',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await axios.delete(`${API_URL}/members/me/communities/${link.communityId}`, headers());
      notify.success('Vínculo removido.');
      await loadLinks();
    } catch (error: any) {
      notify.error(error.response?.data?.message || 'Erro ao remover vínculo');
    } finally {
      setBusy(false);
    }
  };

  const handleMakePrimary = async (link: CommunityLink) => {
    const ok = await confirm.action(
      'Trocar comunidade principal',
      `${link.community.name} vira sua comunidade principal (a atual passa a ser vínculo secundário). Seu acesso e suas telas passam a usar a nova comunidade.`,
      'Tornar principal',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await axios.patch(
        `${API_URL}/users/me/community`,
        { communityId: link.communityId },
        headers(),
      );
      notify.success(`${link.community.name} agora é sua comunidade principal.`);
      await refreshUser();
      await loadLinks();
    } catch (error: any) {
      notify.error(error.response?.data?.message || 'Erro ao trocar a comunidade principal');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="members-page">
      <div className="page-header">
        <h1>
          <TitleIcon name="membros" /> Minha conta
        </h1>
      </div>

      <div
        style={{
          background: '#fff',
          border: '1px solid #e4ebf4',
          borderRadius: 14,
          padding: '1.2rem 1.4rem',
          marginBottom: '1rem',
          maxWidth: 760,
        }}
      >
        <h3 style={{ margin: '0 0 0.8rem' }}>Dados</h3>
        <p style={{ margin: '0.2rem 0' }}>
          <strong>{user?.name}</strong> · {user?.email}
        </p>
        <p style={{ margin: '0.2rem 0', color: '#66788c' }}>
          {ROLE_LABELS[user?.role ?? ''] ?? user?.role}
        </p>
      </div>

      <div
        style={{
          background: '#fff',
          border: '1px solid #e4ebf4',
          borderRadius: 14,
          padding: '1.2rem 1.4rem',
          marginBottom: '1rem',
          maxWidth: 760,
        }}
      >
        <h3 style={{ margin: '0 0 0.4rem' }}>🔐 Segurança</h3>
        <p style={{ margin: '0 0 0.8rem', color: '#66788c', fontSize: '0.9rem' }}>
          Autenticação em duas etapas:{' '}
          <strong style={{ color: user?.twoFactorEnabled ? '#1f9d61' : '#a96a0d' }}>
            {user?.twoFactorEnabled ? 'ativa' : 'inativa'}
          </strong>
          . Gerencie o 2FA, os dispositivos conectados e veja a atividade recente da conta.
        </p>
        <Link
          to="/admin/security"
          className="btn-small btn-surface"
          style={{ display: 'inline-block', textDecoration: 'none' }}
        >
          Abrir Segurança
        </Link>
      </div>

      <div
        style={{
          background: '#fff',
          border: '1px solid #e4ebf4',
          borderRadius: 14,
          padding: '1.2rem 1.4rem',
          maxWidth: 760,
        }}
      >
        <h3 style={{ margin: '0 0 0.4rem' }}>⛪ Minhas comunidades</h3>
        <p style={{ margin: '0 0 1rem', color: '#66788c', fontSize: '0.9rem' }}>
          A <strong>principal</strong> é sua comunidade de referência. Vínculos secundários deixam
          você visível para os coordenadores daquela comunidade — para servir nas pastorais e
          escalas de lá.
        </p>

        {memberMissing ? (
          <p style={{ color: '#a96a0d' }}>
            Seu usuário não possui cadastro de membro — os vínculos de comunidade valem para
            membros das comunidades.
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '1rem' }}>
              {links.map((link) => (
                <div
                  key={link.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    border: '1px solid #e2e8f0',
                    borderRadius: 10,
                    padding: '10px 14px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ flex: 1, fontWeight: 600, minWidth: 200 }}>
                    {link.isPrimary ? '⭐ ' : '🔗 '}
                    {link.community.name}
                    {link.community.parish?.name && (
                      <small style={{ color: '#66788c', fontWeight: 500 }}>
                        {' '}
                        · {link.community.parish.name}
                      </small>
                    )}
                    {link.isPrimary && (
                      <small style={{ color: '#1f9d61', fontWeight: 700 }}> · principal</small>
                    )}
                  </span>
                  {!link.isPrimary && (
                    <span style={{ display: 'inline-flex', gap: 8 }}>
                      {canChangePrimary && (
                        <button
                          type="button"
                          className="btn-small btn-surface"
                          disabled={busy}
                          onClick={() => void handleMakePrimary(link)}
                        >
                          Tornar principal
                        </button>
                      )}
                      <button
                        type="button"
                        className="remove-button"
                        style={{ padding: '6px 12px' }}
                        disabled={busy}
                        onClick={() => void handleRemove(link)}
                      >
                        Remover
                      </button>
                    </span>
                  )}
                </div>
              ))}
              {links.length === 0 && (
                <p style={{ color: '#888', fontStyle: 'italic' }}>Nenhum vínculo encontrado.</p>
              )}
            </div>

            <h4 style={{ margin: '0 0 0.6rem' }}>Vincular outra comunidade</h4>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select
                value={dioceseId}
                onChange={(event) => setDioceseId(event.target.value)}
                style={{ flex: 1, minWidth: 180 }}
              >
                <option value="">Diocese</option>
                {dioceses.map((diocese) => (
                  <option key={diocese.id} value={diocese.id}>
                    {diocese.name}
                  </option>
                ))}
              </select>
              <select
                value={parishId}
                onChange={(event) => {
                  setParishId(event.target.value);
                  setCommunityId('');
                }}
                disabled={!dioceseId}
                style={{ flex: 1, minWidth: 180 }}
              >
                <option value="">Paróquia</option>
                {parishes.map((parish) => (
                  <option key={parish.id} value={parish.id}>
                    {parish.name}
                  </option>
                ))}
              </select>
              <select
                value={communityId}
                onChange={(event) => setCommunityId(event.target.value)}
                disabled={!parishId}
                style={{ flex: 1, minWidth: 180 }}
              >
                <option value="">Comunidade</option>
                {communities
                  .filter((community) => !alreadyLinked.has(community.id))
                  .map((community) => (
                    <option key={community.id} value={community.id}>
                      {community.name}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                className="btn-small btn-submit"
                disabled={busy || !communityId || !consent}
                onClick={() => void handleAdd()}
              >
                {busy ? 'Salvando...' : 'Vincular'}
              </button>
            </div>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginTop: 10,
                fontSize: '0.87rem',
                color: '#48607a',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              Autorizo que os coordenadores dessa comunidade vejam meus dados de membro (LGPD)
            </label>
          </>
        )}
      </div>
    </div>
  );
};

export default MyAccountPage;

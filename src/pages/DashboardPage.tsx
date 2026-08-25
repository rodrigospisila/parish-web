import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TitleIcon from '../components/TitleIcon';
import api, { getErrorMessage } from '../services/api';
import { notify } from '../services/notification.service';
import { useAuth } from '../contexts/AuthContext';
import './modules/ModulePages.css';
import './DashboardPage.css';

interface Overview {
  scope: { communityIds: string[]; pastoralScoped: boolean; pastoralIds: string[] };
  catechesis: {
    pendingApprovals: number;
    documentsToReview: number;
    sessionsWithoutAttendance: number;
    unreadFamilyMessages: number;
  };
  schedules: { pendingResponses: number; declinedToReplace: number; upcomingWeek: number };
  swaps: { pending: number };
  pastorals: { joinRequests: number };
  prayers: { pendingModeration: number };
  canModeratePrayers?: boolean;
  total: number;
}

interface PendingPrayer {
  id: string;
  title: string;
  description: string;
  category: string;
  isAnonymous: boolean;
  createdAt: string;
  member?: { fullName: string } | null;
  community?: { name: string } | null;
}

interface Community {
  id: string;
  name: string;
}

const PRAYER_CATEGORY: Record<string, string> = {
  HEALTH: 'Saúde',
  FAMILY: 'Família',
  WORK: 'Trabalho',
  STUDIES: 'Estudos',
  OTHER: 'Outros',
};

/**
 * Dashboard do coordenador (Onda 4): pendências acionáveis do escopo do usuário.
 * Cada cartão leva para a tela onde a pendência se resolve; orações são
 * moderadas aqui mesmo (não há outra tela para isso na web).
 */
const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN'].includes(user?.role ?? '');

  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [communityId, setCommunityId] = useState('');
  const [prayers, setPrayers] = useState<PendingPrayer[]>([]);
  const [prayerBusy, setPrayerBusy] = useState<string | null>(null);

  const load = useCallback(
    async (targetCommunityId: string) => {
      setLoading(true);
      try {
        const [overviewRes, prayersRes] = await Promise.all([
          api.get('/dashboard/coordinator', {
            params: targetCommunityId ? { communityId: targetCommunityId } : undefined,
          }),
          api.get('/prayer-requests/pending', {
            params: targetCommunityId ? { communityId: targetCommunityId } : undefined,
          }).catch(() => ({ data: [] })),
        ]);
        setOverview(overviewRes.data);
        const scope: string[] = overviewRes.data?.scope?.communityIds ?? [];
        const pending: PendingPrayer[] = Array.isArray(prayersRes.data) ? prayersRes.data : [];
        // O backend já recorta pelo escopo do moderador; aqui só a comunidade escolhida
        // (escopo vazio = nada a moderar, nunca "tudo")
        const communityOf = (p: any) => p.communityId ?? p.community?.id;
        setPrayers(
          targetCommunityId
            ? pending.filter((p) => communityOf(p) === targetCommunityId)
            : pending.filter((p) => scope.includes(communityOf(p))),
        );
      } catch (error) {
        notify.error(getErrorMessage(error, 'Erro ao carregar as pendências'));
        setOverview(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (isAdmin) {
      api
        .get('/communities')
        .then((res) => setCommunities(res.data ?? []))
        .catch(() => setCommunities([]));
    }
  }, [isAdmin]);

  useEffect(() => {
    void load(communityId);
  }, [communityId, load]);

  const moderatePrayer = async (id: string, approve: boolean) => {
    setPrayerBusy(id);
    try {
      await api.patch(`/prayer-requests/${id}/${approve ? 'approve' : 'reject'}`, {});
      notify.success(approve ? 'Pedido publicado no mural' : 'Pedido recusado');
      setPrayers((current) => current.filter((p) => p.id !== id));
      setOverview((current) =>
        current
          ? {
              ...current,
              prayers: { pendingModeration: Math.max(0, current.prayers.pendingModeration - 1) },
              total: Math.max(0, current.total - 1),
            }
          : current,
      );
    } catch (error) {
      notify.error(getErrorMessage(error, 'Erro ao moderar o pedido'));
    } finally {
      setPrayerBusy(null);
    }
  };

  const Card: React.FC<{ value: number; label: string; hint?: string; to: string; tone?: 'warn' | 'bad' | 'ok' }> = ({
    value,
    label,
    hint,
    to,
    tone,
  }) => (
    <button
      type="button"
      className={`dash-card${value > 0 ? ` dash-card--${tone ?? 'warn'}` : ''}`}
      onClick={() => navigate(to)}
    >
      <span className="dash-card__value">{value}</span>
      <span className="dash-card__label">{label}</span>
      {hint && <span className="dash-card__hint">{hint}</span>}
    </button>
  );

  return (
    <div className="module-page">
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center' }}>
          <TitleIcon name="planejamento" /> Início
        </h1>
        <div className="header-actions">
          {isAdmin && communities.length > 0 && (
            <select className="filter-select" value={communityId} onChange={(e) => setCommunityId(e.target.value)}>
              <option value="">Todas as comunidades do meu escopo</option>
              {communities.map((community) => (
                <option key={community.id} value={community.id}>
                  {community.name}
                </option>
              ))}
            </select>
          )}
          <button className="btn-small" onClick={() => void load(communityId)} disabled={loading}>
            ↻ Atualizar
          </button>
        </div>
      </div>

      {loading && !overview && <div className="loading">Carregando as pendências...</div>}

      {overview && (
        <>
          <p className="dash-lede">
            {overview.total === 0
              ? 'Tudo em dia — nenhuma pendência no seu escopo. 🙌'
              : `${overview.total} pendência(s) aguardando a coordenação${
                  overview.scope.pastoralScoped ? ' (escalas e pedidos só das suas pastorais)' : ''
                }.`}
          </p>

          <section className="dash-group">
            <h2 className="dash-group__title">Catequese</h2>
            <div className="dash-grid">
              <Card value={overview.catechesis.pendingApprovals} label="Inscrições aguardando aprovação" to="/admin/catechesis" />
              <Card value={overview.catechesis.documentsToReview} label="Documentos para conferir" to="/admin/catechesis" />
              <Card
                value={overview.catechesis.sessionsWithoutAttendance}
                label="Encontros sem chamada"
                hint="já ocorridos"
                to="/admin/catechesis"
                tone="bad"
              />
              <Card value={overview.catechesis.unreadFamilyMessages} label="Mensagens de famílias não lidas" to="/admin/catechesis" />
            </div>
          </section>

          <section className="dash-group">
            <h2 className="dash-group__title">Escalas</h2>
            <div className="dash-grid">
              <Card value={overview.schedules.pendingResponses} label="Respostas pendentes" hint="escalas futuras" to="/admin/schedules" />
              <Card value={overview.schedules.declinedToReplace} label="Recusas a substituir" to="/admin/schedules" tone="bad" />
              <Card value={overview.swaps.pending} label="Trocas aguardando" to="/admin/swaps" />
              <Card value={overview.schedules.upcomingWeek} label="Escalas nos próximos 7 dias" to="/admin/schedules" tone="ok" />
            </div>
          </section>

          <section className="dash-group">
            <h2 className="dash-group__title">Comunidade</h2>
            <div className="dash-grid">
              <Card
                value={overview.pastorals.joinRequests}
                label="Pedidos “quero participar”"
                hint="aprovar na página da pastoral"
                to={user?.role === 'PASTORAL_COORDINATOR' ? '/admin/pastorals/my' : '/admin/pastorals/community'}
              />
              {overview.canModeratePrayers !== false && (
                <Card value={overview.prayers.pendingModeration} label="Pedidos de oração para moderar" hint="modere logo abaixo" to="/admin/dashboard" />
              )}
            </div>
          </section>

          {prayers.length > 0 && (
            <section className="dash-group">
              <h2 className="dash-group__title">Moderar pedidos de oração</h2>
              <div className="dash-prayers">
                {prayers.map((prayer) => (
                  <div key={prayer.id} className="dash-prayer">
                    <div className="dash-prayer__body">
                      <strong>{prayer.title}</strong>
                      <span className="dash-prayer__meta">
                        {PRAYER_CATEGORY[prayer.category] ?? prayer.category} ·{' '}
                        {prayer.isAnonymous ? 'anônimo' : prayer.member?.fullName ?? 'sem autor'}
                        {prayer.community?.name ? ` · ${prayer.community.name}` : ''} ·{' '}
                        {new Date(prayer.createdAt).toLocaleDateString('pt-BR')}
                      </span>
                      <p>{prayer.description}</p>
                    </div>
                    <div className="dash-prayer__actions">
                      <button
                        className="btn-small success"
                        disabled={prayerBusy === prayer.id}
                        onClick={() => void moderatePrayer(prayer.id, true)}
                      >
                        Publicar
                      </button>
                      <button
                        className="btn-small danger"
                        disabled={prayerBusy === prayer.id}
                        onClick={() => void moderatePrayer(prayer.id, false)}
                      >
                        Recusar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default DashboardPage;

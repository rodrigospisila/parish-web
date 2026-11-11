import React, { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import UserPhotoAvatar from './UserPhotoAvatar';
import api from '../services/api';
import {
  installPlanErrorHandler,
  managesPlan,
  MY_PLAN_PATH,
  PLAN_FEATURES_PATH,
  PLAN_REQUIRED_EVENT,
  planFeaturePath,
  type PlanRequiredDetail,
} from '../services/planErrors';
import { FEATURE_CATALOG } from '../pages/plan/featureCatalog';
import { trackOnce } from '../services/analytics';
import { usePlanEntitlements } from '../hooks/usePlanEntitlements';
import { useModuleAccess } from '../hooks/useModuleAccess';
import { COORDINATION_ROLES, canOpen } from './accessRules';
import ErrorBoundary from './ErrorBoundary';
import './AdminLayout.css';
import { displayEmail } from '../utils/displayEmail';

/** Aviso da plataforma (GET /announcements/active — saas-implantacao-29). */
interface PlatformAnnouncement {
  id: string;
  title: string;
  body: string;
  kind?: 'NEWS' | 'MAINTENANCE' | 'INCIDENT' | string;
}

const DISMISSED_KEY = 'parish.dismissedAnnouncements';

/** Ids dos avisos dispensados neste navegador (localStorage pode falhar: aba privada etc.). */
function readDismissed(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeDismissed(ids: string[]) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids.slice(-100)));
  } catch {
    // sem armazenamento: o aviso some só nesta sessão
  }
}

// Aviso amigável para 403 PLAN_REQUIRED/PLAN_SCOPE/PLAN_MEMBER_LIMIT (uma vez
// por app; o main.tsx já instala — aqui é só garantia, é idempotente)
installPlanErrorHandler();

/** Banner "teste até dd/mm": datas em pt-BR, sem hora. */
const dataCurta = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

/** Selo dos itens da seção "Recursos do plano" (recurso pago bloqueado — só no modo "on"). */
const PlanLock: React.FC = () => (
  <span className="nav-plan-lock" title="Faz parte do plano completo">
    plano
    <span className="nav-sr"> completo — não ativo nesta comunidade</span>
  </span>
);

/** Item do menu. `feature` = recurso do plano (contrato 1): bloqueado, vai para "Recursos do plano". */
interface NavItem {
  to: string;
  icon: string;
  label: string;
  show: boolean;
  feature?: string;
  highlight?: boolean;
  end?: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  SYSTEM_ADMIN: 'Administrador do Sistema',
  DIOCESAN_ADMIN: 'Administração Diocesana',
  PARISH_ADMIN: 'Administração Paroquial',
  COMMUNITY_COORDINATOR: 'Coordenação de Comunidade',
  PASTORAL_COORDINATOR: 'Coordenação de Pastoral',
  VOLUNTEER: 'Voluntário(a)',
  FAITHFUL: 'Fiel',
};

/**
 * Ícone católico da identidade v2.0. Os SVGs são traço em `currentColor`, então
 * usamos CSS mask para recolorir com a cor do item do menu (branco / destaque).
 */
const NavIcon: React.FC<{ name: string }> = ({ name }) => (
  <span
    className="nav-icon"
    aria-hidden="true"
    style={
      {
        WebkitMaskImage: `url('/icons/${name}.svg')`,
        maskImage: `url('/icons/${name}.svg')`,
        // Versão colorida (set v2.2 sem fundo) usada quando o item está ativo
        '--nav-icon-color': `url('/icons-color/${name}.svg')`,
      } as React.CSSProperties
    }
  />
);

const AdminLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isSystemAdmin = user?.role === 'SYSTEM_ADMIN';

  // Matriz do SYSTEM_ADMIN (Configurações): módulos desativados para o papel
  // deste usuário somem do menu — e as rotas usam a MESMA regra (accessRules),
  // então o que não aparece aqui também não abre pela URL. Enquanto a matriz
  // não chega, os itens controlados por ela ficam ESCONDIDOS.
  const { modOn } = useModuleAccess(user?.role);
  const can = (key: Parameters<typeof canOpen>[1]) => canOpen(user, key, modOn);

  // Início: coordenação por papel OU quem coordena pastoral pelo vínculo
  // (papel VOLUNTEER/FAITHFUL — ux-dashboards-22)
  const canSeeDashboard = can('dashboard');
  // Coordenação por papel (módulos das Fases 3–4)
  const isCoordination = (COORDINATION_ROLES as readonly string[]).includes(user?.role ?? '');

  const displayName = user?.name || displayEmail(user?.email) || 'Usuário';

  // Plano da comunidade (/me/entitlements): recurso pago bloqueado sai da sua
  // seção e vai para "Recursos do plano", no fim do menu, abrindo a vitrine
  // (só no modo "on" — fora dele, e para quem tem acesso, nada muda)
  const { entitlements, isLocked } = usePlanEntitlements();

  // Aviso de recurso fora do plano (o interceptor dispara; some ao trocar de tela)
  const location = useLocation();
  const [planNotice, setPlanNotice] = useState<PlanRequiredDetail | null>(null);
  useEffect(() => {
    const onPlan = (event: Event) => setPlanNotice((event as CustomEvent<PlanRequiredDetail>).detail ?? null);
    window.addEventListener(PLAN_REQUIRED_EVENT, onPlan);
    return () => window.removeEventListener(PLAN_REQUIRED_EVENT, onPlan);
  }, []);
  useEffect(() => setPlanNotice(null), [location.pathname]);

  // Uso do produto (só agregados): abriu o Início do painel
  useEffect(() => {
    if (location.pathname === '/admin/dashboard') trackOnce('web_dashboard');
  }, [location.pathname]);

  // Avisos da plataforma (novidade, manutenção, incidente), dispensáveis por aviso
  const [announcements, setAnnouncements] = useState<PlatformAnnouncement[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissed());
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    api
      .get('/announcements/active')
      .then((res) => {
        if (!active) return;
        const list = Array.isArray(res.data) ? res.data : Array.isArray(res.data?.items) ? res.data.items : [];
        setAnnouncements(
          list.filter((a: any) => a && typeof a.id === 'string' && typeof a.title === 'string').slice(0, 5),
        );
      })
      .catch(() => {
        if (active) setAnnouncements([]);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);
  const visibleAnnouncements = announcements.filter((a) => !dismissed.includes(a.id));
  const dismissAnnouncement = (id: string) => {
    const next = [...readDismissed().filter((x) => x !== id), id];
    writeDismissed(next);
    setDismissed(next);
  };

  // "Meu plano": administração da paróquia (e diocese/plataforma, com seletor)
  const canSeeMyPlan = managesPlan(user?.role ?? '');

  // Banner "teste até dd/mm" nos 15 dias finais — para quem administra ou
  // coordena, e só com o bloqueio ligado (no modo log o fim do teste não muda nada)
  const trials = canSeeDashboard && !isSystemAdmin && entitlements?.enforcement === 'on' ? (entitlements.trialsEndingSoon ?? []) : [];

  // Fiel/voluntário CATEQUISTA: o menu ganha "Catequese" (o backend lista só
  // as turmas onde ele está na equipe e valida cada ação)
  const isBaseRole = user?.role === 'FAITHFUL' || user?.role === 'VOLUNTEER';
  const [isCatechist, setIsCatechist] = useState(false);
  useEffect(() => {
    if (!isBaseRole) return;
    api
      .get('/catechesis/my-classes')
      .then((res) => setIsCatechist(Array.isArray(res.data) && res.data.length > 0))
      .catch(() => setIsCatechist(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Celular: menu recolhido; fecha ao trocar de tela
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [location.pathname]);

  // "Recursos do plano" abre recolhida no celular (o menu fica acima do conteúdo)
  const [planOpen, setPlanOpen] = useState(
    () => typeof window === 'undefined' || !window.matchMedia || !window.matchMedia('(max-width: 768px)').matches,
  );

  // ── Menu: mesma ordem de sempre; cada item pago leva a chave do recurso ──
  const role = user?.role ?? '';
  const managesCommunity = ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN', 'COMMUNITY_COORDINATOR'].includes(role);
  const allSections: { label: string; items: NavItem[] }[] = [
    {
      label: 'Estrutura',
      items: [
        { to: '/admin/dioceses', icon: 'diocese', label: 'Dioceses', show: can('dioceses') },
        { to: '/admin/parishes', icon: 'paroquia', label: 'Paróquias', show: can('parishes') },
        { to: '/admin/communities', icon: 'comunidade', label: 'Comunidades', show: can('communities') },
      ],
    },
    {
      label: 'Comunidade',
      items: [
        { to: '/admin/members', icon: 'membros', label: 'Membros', show: can('members') },
        { to: '/admin/importar', icon: 'documento', label: 'Importar planilha', show: can('members') && managesCommunity },
        { to: '/admin/events', icon: 'calendario-liturgico', label: 'Eventos', show: can('events'), feature: 'events' },
        { to: '/admin/fixed-schedule', icon: 'missa-proxima', label: 'Agenda Fixa', show: can('fixed-schedule') },
        // Plano grátis: pino e endereço das PRÓPRIAS comunidades
        { to: '/admin/minha-localizacao', icon: 'comunidade', label: 'Minha localização', show: can('minha-localizacao') },
        { to: '/admin/schedules', icon: 'escala', label: 'Escalas', show: can('schedules'), feature: 'schedules' },
        // Coordenador também é escalado: "Minha Escala" vale para todos
        { to: '/admin/my-schedule', icon: 'escala', label: 'Minha Escala', show: true, feature: 'schedules' },
        { to: '/admin/swaps', icon: 'trocas-escala', label: 'Trocas de Escala', show: can('swaps'), feature: 'swaps' },
      ],
    },
    {
      label: 'Pastoral',
      items: [
        { to: '/admin/clergy-messages', icon: 'sacerdote', label: 'Palavra Pastoral', show: can('clergy-messages'), feature: 'clergy-messages' },
        { to: '/admin/saints', icon: 'santo', label: 'Santos', show: can('saints') },
        { to: '/admin/pastorals/community', icon: 'pastoral', label: 'Pastorais', show: can('pastorals/community'), feature: 'pastorals' },
        { to: '/admin/pastorals/my', icon: 'pastoral', label: 'Minhas Pastorais', show: can('pastorals/my'), feature: 'pastorals', highlight: true },
        { to: '/admin/pastorals/global', icon: 'igreja', label: 'Pastorais Globais', show: can('pastorals/global') },
        // Fiel/voluntário CATEQUISTA entra pela turma dele; a coordenação, pela Catequese
        {
          to: '/admin/catechesis',
          icon: 'catequese',
          label: isCoordination ? 'Catequese' : 'Catequese (minha turma)',
          show: can('catechesis') && (isCoordination || isCatechist),
          feature: 'catechesis',
          highlight: !isCoordination,
        },
        { to: '/admin/planning', icon: 'planejamento', label: 'Planejamento', show: isCoordination && can('planning'), feature: 'planning' },
        { to: '/admin/documents', icon: 'documento', label: 'Documentos', show: isCoordination && can('documents'), feature: 'documents' },
        { to: '/admin/formation', icon: 'biblia', label: 'Formação', show: isCoordination && can('formation'), feature: 'formation' },
        { to: '/admin/rooms', icon: 'espacos', label: 'Espaços', show: isCoordination && can('rooms'), feature: 'rooms' },
        { to: '/admin/visitation', icon: 'visitacao', label: 'Visitação', show: isCoordination && can('visitation'), feature: 'visitation' },
      ],
    },
    {
      label: 'Gestão',
      items: [
        { to: '/admin/finance', icon: 'dizimo', label: 'Financeiro', show: can('finance'), feature: 'finance' },
        { to: '/admin/sacrament-processes', icon: 'cruz', label: 'Sacramentos', show: can('sacrament-processes'), feature: 'sacrament-processes' },
        { to: '/admin/users', icon: 'usuarios', label: 'Usuários', show: can('users') },
        { to: '/admin/audit', icon: 'documento', label: 'Auditoria', show: can('audit') },
        { to: MY_PLAN_PATH, icon: 'dizimo', label: 'Meu plano', show: canSeeMyPlan && !isSystemAdmin },
        { to: '/admin/minha-paroquia', icon: 'paroquia', label: 'Minha paróquia', show: role === 'PARISH_ADMIN' },
        { to: '/admin/settings', icon: 'planejamento', label: 'Configurações', show: can('settings') },
      ],
    },
    {
      label: 'Plataforma',
      items: [
        { to: '/admin/platform', icon: 'planejamento', label: 'Visão geral', show: can('platform'), end: true },
        { to: '/admin/platform/claims', icon: 'paroquia', label: 'Reivindicações', show: can('platform') },
        { to: '/admin/platform/leads', icon: 'usuarios', label: 'Leads', show: can('platform') },
        { to: '/admin/map', icon: 'comunidade', label: 'Mapa do território', show: can('platform') },
        { to: '/admin/platform/suggestions', icon: 'sino', label: 'Sugestões dos fiéis', show: can('platform') },
        { to: '/admin/platform/growth', icon: 'membros', label: 'Crescimento', show: can('platform') },
        { to: '/admin/platform/plans', icon: 'dizimo', label: 'Planos', show: can('platform') },
        { to: '/admin/platform/usage', icon: 'planejamento', label: 'Uso do produto', show: can('platform') },
        { to: '/admin/platform/announcements', icon: 'sino', label: 'Avisos aos clientes', show: can('platform') },
      ],
    },
    {
      label: 'Conta',
      items: [
        { to: '/admin/account', icon: 'membros', label: 'Minha conta', show: true },
        { to: '/admin/security', icon: 'sino', label: 'Segurança', show: true },
        // Direitos do titular (LGPD): consentimentos, exportação e exclusão — todos os papéis
        { to: '/admin/my-data', icon: 'documento', label: 'Privacidade', show: true },
      ],
    },
  ];
  const isItemLocked = (item: NavItem) => !!item.feature && isLocked(item.feature);
  // Seções só com o que abre de verdade (no plano grátis, o painel fica enxuto)
  const sections = allSections.map((section) => ({
    label: section.label,
    items: section.items.filter((item) => item.show && !isItemLocked(item)),
  }));
  // Recursos bloqueados que a pessoa teria no menu: um item por recurso, na ordem do catálogo
  const lockedKeys = new Set(
    allSections.flatMap((section) => section.items.filter((item) => item.show && isItemLocked(item)).map((item) => item.feature as string)),
  );
  const lockedFeatures = FEATURE_CATALOG.filter((feature) => lockedKeys.has(feature.key));

  return (
    <div className="admin-layout">
      <aside className={`sidebar${menuOpen ? ' is-open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <img src="/brand/parish-simbolo-cor.svg" alt="" className="sidebar-logo-mark" />
            <span className="sidebar-logo-word">Parish</span>
            {/* Celular: o menu fica recolhido acima do conteúdo e abre por este botão */}
            <button
              type="button"
              className="sidebar-menu-toggle"
              aria-expanded={menuOpen}
              aria-controls="sidebar-menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span aria-hidden="true">{menuOpen ? '✕' : '☰'}</span> Menu
            </button>
          </div>
          <div
            className="sidebar-user"
            onClick={() => navigate('/admin/account')}
            style={{ cursor: 'pointer' }}
            title="Minha conta"
          >
            <div className="sidebar-user-top">
              <UserPhotoAvatar userId={user?.id} name={displayName} size={40} className="sidebar-user-avatar" />
              <div className="sidebar-user-info">
                <span className="sidebar-user-name" title={displayName}>{displayName}</span>
                <span className="sidebar-user-email" title={displayEmail(user?.email)}>{displayEmail(user?.email)}</span>
              </div>
            </div>
            <span className="sidebar-user-role">{ROLE_LABELS[user?.role ?? ''] ?? user?.role}</span>
          </div>
        </div>

        <nav className="sidebar-nav" id="sidebar-menu" aria-label="Menu do painel">
          {canSeeDashboard && (
            <NavLink to="/admin/dashboard" className="nav-link highlight">
              <NavIcon name="planejamento" /> Início
            </NavLink>
          )}
          {sections.map((section) =>
            section.items.length === 0 || section.label === 'Conta' ? null : (
              <React.Fragment key={section.label}>
                <span className="nav-section-label">{section.label}</span>
                {section.items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} className={`nav-link${item.highlight ? ' highlight' : ''}`}>
                    <NavIcon name={item.icon} /> {item.label}
                  </NavLink>
                ))}
              </React.Fragment>
            ),
          )}

          {/* Plano grátis: os recursos do plano completo não somem — ficam aqui,
              com o selo, e abrem a vitrine do recurso (não a tela que daria erro) */}
          {lockedFeatures.length > 0 && (
            <details
              className="nav-plan-group"
              open={planOpen}
              onToggle={(event) => setPlanOpen((event.currentTarget as HTMLDetailsElement).open)}
            >
              <summary className="nav-section-label nav-section-label--plan">
                Recursos do plano <span className="nav-plan-count">{lockedFeatures.length}</span>
              </summary>
              {lockedFeatures.map((feature) => (
                <NavLink key={feature.key} to={planFeaturePath(feature.key)} className="nav-link nav-link--plan">
                  <NavIcon name={feature.icon} /> {feature.name}
                  <PlanLock />
                </NavLink>
              ))}
              {can('recursos') && (
                <NavLink to={PLAN_FEATURES_PATH} end className="nav-link nav-link--plan-all">
                  <NavIcon name="igreja" /> Conheça o plano completo
                </NavLink>
              )}
            </details>
          )}

          {/* Conta fica por último: a vitrine do plano vem antes, à vista */}
          {sections.map((section) =>
            section.items.length === 0 || section.label !== 'Conta' ? null : (
              <React.Fragment key={section.label}>
                <span className="nav-section-label">{section.label}</span>
                {section.items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} className={`nav-link${item.highlight ? ' highlight' : ''}`}>
                    <NavIcon name={item.icon} /> {item.label}
                  </NavLink>
                ))}
              </React.Fragment>
            ),
          )}

        </nav>

        <div className="sidebar-footer">
          <button onClick={handleLogout} className="logout-btn">
            <span>Sair da conta</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        {visibleAnnouncements.map((a) => (
          <div
            key={a.id}
            className={`platform-announcement platform-announcement-${String(a.kind ?? 'NEWS').toLowerCase()}`}
            role={a.kind === 'INCIDENT' ? 'alert' : 'status'}
          >
            <div className="platform-announcement-text">
              <strong>{a.title}</strong>
              {a.body && <span>{a.body}</span>}
            </div>
            <button
              type="button"
              className="plan-banner-close"
              onClick={() => dismissAnnouncement(a.id)}
              aria-label={`Dispensar o aviso: ${a.title}`}
            >
              ×
            </button>
          </div>
        ))}
        {trials.length > 0 && (
          <div className="plan-banner plan-banner-trial" role="status">
            {trials.length === 1
              ? `O teste do plano de ${trials[0].communityName} vai até ${dataCurta(trials[0].trialEndsAt)}. `
              : `Testes do plano terminando: ${trials.map((t) => `${t.communityName} (${dataCurta(t.trialEndsAt)})`).join(', ')}. `}
            Depois disso a comunidade volta ao plano grátis: o cadastro de membros, os horários de missa e confissão e a
            localização continuam; os demais recursos dependem do plano. Nenhum dado é apagado.
            {canSeeMyPlan && (
              <>
                {' '}
                <Link to={MY_PLAN_PATH} className="plan-banner-link">
                  Ver meu plano
                </Link>
              </>
            )}
          </div>
        )}
        {planNotice && (
          <div className="plan-banner" role="alert">
            <span>
              {planNotice.message}
              {planNotice.action && (
                <>
                  {' '}
                  <Link to={planNotice.action.href} className="plan-banner-link">
                    {planNotice.action.label}
                  </Link>
                </>
              )}
            </span>
            <button type="button" className="plan-banner-close" onClick={() => setPlanNotice(null)} aria-label="Fechar aviso">
              ×
            </button>
          </div>
        )}
        {/* Erro numa tela não derruba o painel: o menu fica e a tela mostra
            "Algo deu errado" com recarregar (trocar de tela limpa o erro) */}
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
};

export default AdminLayout;

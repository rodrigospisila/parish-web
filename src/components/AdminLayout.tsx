import React, { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import UserPhotoAvatar from './UserPhotoAvatar';
import api from '../services/api';
import { installPlanErrorHandler, managesPlan, MY_PLAN_PATH, PLAN_REQUIRED_EVENT, type PlanRequiredDetail } from '../services/planErrors';
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

/** Selo no item de menu de recurso pago fora do plano (só no modo "on"). */
const PlanLock: React.FC = () => (
  <span className="nav-plan-lock" title="Disponível no plano da comunidade">
    plano
  </span>
);

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

  // Plano da comunidade (/me/entitlements): recurso pago fora do plano ganha o
  // selo "plano" no menu (só no modo "on" — fora dele nada é bloqueado)
  const { entitlements, isLocked } = usePlanEntitlements();
  const lock = (feature: string) => (isLocked(feature) ? <PlanLock /> : null);

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

  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <img src="/brand/parish-simbolo-cor.svg" alt="" className="sidebar-logo-mark" />
            <span className="sidebar-logo-word">Parish</span>
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

        <nav className="sidebar-nav">
          {canSeeDashboard && (
            <NavLink to="/admin/dashboard" className="nav-link highlight">
              <NavIcon name="planejamento" /> Início
            </NavLink>
          )}
          {(can('dioceses') || can('parishes') || can('communities')) && <span className="nav-section-label">Estrutura</span>}
          {can('dioceses') && (
            <NavLink to="/admin/dioceses" className="nav-link">
              <NavIcon name="diocese" /> Dioceses
            </NavLink>
          )}
          {can('parishes') && (
            <NavLink to="/admin/parishes" className="nav-link">
              <NavIcon name="paroquia" /> Paróquias
            </NavLink>
          )}
          {can('communities') && (
            <NavLink to="/admin/communities" className="nav-link">
              <NavIcon name="comunidade" /> Comunidades
            </NavLink>
          )}

          {/* Sempre há ao menos "Minha Escala" nesta seção */}
          <span className="nav-section-label">Comunidade</span>
          {can('members') && (
            <NavLink to="/admin/members" className="nav-link">
              <NavIcon name="membros" /> Membros
            </NavLink>
          )}
          {can('members') && ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN', 'COMMUNITY_COORDINATOR'].includes(user?.role ?? '') && (
            <NavLink to="/admin/importar" className="nav-link">
              <NavIcon name="documento" /> Importar planilha
            </NavLink>
          )}
          {can('events') && (
            <NavLink to="/admin/events" className="nav-link">
              <NavIcon name="calendario-liturgico" /> Eventos
            </NavLink>
          )}
          {can('fixed-schedule') && (
            <NavLink to="/admin/fixed-schedule" className="nav-link">
              <NavIcon name="missa-proxima" /> Agenda Fixa
            </NavLink>
          )}
          {can('schedules') && (
            <NavLink to="/admin/schedules" className="nav-link">
              <NavIcon name="escala" /> Escalas{lock('schedules')}
            </NavLink>
          )}
          {/* Coordenador também é escalado: "Minha Escala" vale para todos */}
          <NavLink to="/admin/my-schedule" className="nav-link">
            <NavIcon name="escala" /> Minha Escala{lock('schedules')}
          </NavLink>
          {can('swaps') && (
            <NavLink to="/admin/swaps" className="nav-link">
              <NavIcon name="trocas-escala" /> Trocas de Escala{lock('swaps')}
            </NavLink>
          )}

          {(can('clergy-messages') || can('saints') || isCoordination) && <span className="nav-section-label">Pastoral</span>}
          {can('clergy-messages') && (
            <NavLink to="/admin/clergy-messages" className="nav-link">
              <NavIcon name="sacerdote" /> Palavra Pastoral
            </NavLink>
          )}
          {can('saints') && (
            <NavLink to="/admin/saints" className="nav-link">
              <NavIcon name="santo" /> Santos
            </NavLink>
          )}
          {can('pastorals/community') && (
            <NavLink to="/admin/pastorals/community" className="nav-link">
              <NavIcon name="pastoral" /> Pastorais{lock('pastorals')}
            </NavLink>
          )}
          {can('pastorals/my') && (
            <NavLink to="/admin/pastorals/my" className="nav-link highlight">
              <NavIcon name="pastoral" /> Minhas Pastorais{lock('pastorals')}
            </NavLink>
          )}
          {can('pastorals/global') && (
            <NavLink to="/admin/pastorals/global" className="nav-link">
              <NavIcon name="igreja" /> Pastorais Globais
            </NavLink>
          )}
          {isCatechist && !isCoordination && can('catechesis') && (
            <NavLink to="/admin/catechesis" className="nav-link highlight">
              <NavIcon name="catequese" /> Catequese (minha turma){lock('catechesis')}
            </NavLink>
          )}
          {isCoordination && (
            <>
              {can('catechesis') && (
                <NavLink to="/admin/catechesis" className="nav-link">
                  <NavIcon name="catequese" /> Catequese{lock('catechesis')}
                </NavLink>
              )}
              {can('planning') && (
                <NavLink to="/admin/planning" className="nav-link">
                  <NavIcon name="planejamento" /> Planejamento
                </NavLink>
              )}
              {can('documents') && (
                <NavLink to="/admin/documents" className="nav-link">
                  <NavIcon name="documento" /> Documentos{lock('documents')}
                </NavLink>
              )}
              {can('formation') && (
                <NavLink to="/admin/formation" className="nav-link">
                  <NavIcon name="biblia" /> Formação{lock('formation')}
                </NavLink>
              )}
              {can('rooms') && (
                <NavLink to="/admin/rooms" className="nav-link">
                  <NavIcon name="espacos" /> Espaços{lock('rooms')}
                </NavLink>
              )}
              {can('visitation') && (
                <NavLink to="/admin/visitation" className="nav-link">
                  <NavIcon name="visitacao" /> Visitação{lock('visitation')}
                </NavLink>
              )}
            </>
          )}

          {(can('finance') || can('sacrament-processes') || can('users') || can('audit') || isSystemAdmin || canSeeMyPlan) && (
            <span className="nav-section-label">Gestão</span>
          )}
          {can('finance') && (
            <NavLink to="/admin/finance" className="nav-link">
              <NavIcon name="dizimo" /> Financeiro
            </NavLink>
          )}
          {can('sacrament-processes') && (
            <NavLink to="/admin/sacrament-processes" className="nav-link">
              <NavIcon name="cruz" /> Sacramentos
            </NavLink>
          )}
          {can('users') && (
            <NavLink to="/admin/users" className="nav-link">
              <NavIcon name="usuarios" /> Usuários
            </NavLink>
          )}
          {can('audit') && (
            <NavLink to="/admin/audit" className="nav-link">
              <NavIcon name="documento" /> Auditoria
            </NavLink>
          )}
          {canSeeMyPlan && !isSystemAdmin && (
            <NavLink to={MY_PLAN_PATH} className="nav-link">
              <NavIcon name="dizimo" /> Meu plano
            </NavLink>
          )}
          {user?.role === 'PARISH_ADMIN' && (
            <NavLink to="/admin/minha-paroquia" className="nav-link">
              <NavIcon name="paroquia" /> Minha paróquia
            </NavLink>
          )}
          {can('settings') && (
            <NavLink to="/admin/settings" className="nav-link">
              <NavIcon name="planejamento" /> Configurações
            </NavLink>
          )}

          {can('platform') && (
            <>
              <span className="nav-section-label">Plataforma</span>
              <NavLink to="/admin/platform" end className="nav-link">
                <NavIcon name="planejamento" /> Visão geral
              </NavLink>
              <NavLink to="/admin/platform/claims" className="nav-link">
                <NavIcon name="paroquia" /> Reivindicações
              </NavLink>
              <NavLink to="/admin/platform/leads" className="nav-link">
                <NavIcon name="usuarios" /> Leads
              </NavLink>
              <NavLink to="/admin/map" className="nav-link">
                <NavIcon name="comunidade" /> Mapa do território
              </NavLink>
              <NavLink to="/admin/platform/suggestions" className="nav-link">
                <NavIcon name="sino" /> Sugestões dos fiéis
              </NavLink>
              <NavLink to="/admin/platform/growth" className="nav-link">
                <NavIcon name="membros" /> Crescimento
              </NavLink>
              <NavLink to="/admin/platform/plans" className="nav-link">
                <NavIcon name="dizimo" /> Planos
              </NavLink>
              <NavLink to="/admin/platform/usage" className="nav-link">
                <NavIcon name="planejamento" /> Uso do produto
              </NavLink>
              <NavLink to="/admin/platform/announcements" className="nav-link">
                <NavIcon name="sino" /> Avisos aos clientes
              </NavLink>
            </>
          )}

          <span className="nav-section-label">Conta</span>
          <NavLink to="/admin/account" className="nav-link">
            <NavIcon name="membros" /> Minha conta
          </NavLink>
          <NavLink to="/admin/security" className="nav-link">
            <NavIcon name="sino" /> Segurança
          </NavLink>
          {/* Direitos do titular (LGPD): consentimentos, exportação e exclusão — todos os papéis */}
          <NavLink to="/admin/my-data" className="nav-link">
            <NavIcon name="documento" /> Privacidade
          </NavLink>
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
            Depois disso, pastorais, escalas, catequese, formação, espaços, visitas e documentos dependem do plano da
            comunidade; calendário, mapa e liturgia continuam liberados.
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

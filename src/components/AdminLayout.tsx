import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import UserPhotoAvatar from './UserPhotoAvatar';
import api from '../services/api';
import { installPlanErrorHandler, PLAN_REQUIRED_EVENT, type PlanRequiredDetail } from '../services/planErrors';
import { usePlanEntitlements } from '../hooks/usePlanEntitlements';
import './AdminLayout.css';

// Aviso amigável para 403 PLAN_REQUIRED/PLAN_SCOPE/PLAN_MEMBER_LIMIT (uma vez por app)
installPlanErrorHandler();

/** Matriz de módulos do último carregamento (por papel): o menu abre já certo no F5. */
const MODULE_ACCESS_CACHE = 'parish:module-access:';

function readCachedDisabled(role: string | undefined): Set<string> | null {
  if (!role) return null;
  try {
    const raw = sessionStorage.getItem(MODULE_ACCESS_CACHE + role);
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

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
  const canSeeDashboard = ['PASTORAL_COORDINATOR', 'COMMUNITY_COORDINATOR', 'PARISH_ADMIN', 'DIOCESAN_ADMIN', 'SYSTEM_ADMIN'].includes(user?.role ?? '');

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isSystemAdmin = user?.role === 'SYSTEM_ADMIN';
  const isDiocesanAdmin = user?.role === 'DIOCESAN_ADMIN';
  const isParishAdmin = user?.role === 'PARISH_ADMIN';
  const isCommunityCoordinator = user?.role === 'COMMUNITY_COORDINATOR';
  const isPastoralCoordinator = user?.role === 'PASTORAL_COORDINATOR';

  const canManageDioceses = isSystemAdmin || isDiocesanAdmin;
  const canManageParishes = isSystemAdmin || isDiocesanAdmin || isParishAdmin;
  const canManageUsers = isSystemAdmin || isDiocesanAdmin || isParishAdmin || isCommunityCoordinator;
  const canManageSchedules = isSystemAdmin || isDiocesanAdmin || isParishAdmin || isCommunityCoordinator || isPastoralCoordinator;
  // Módulos de coordenação (Fases 3–4)
  const isCoordination = canManageSchedules;
  const isCommunityManagement = isSystemAdmin || isDiocesanAdmin || isParishAdmin || isCommunityCoordinator;

  const displayName = user?.name || user?.email || 'Usuário';

  // Matriz do SYSTEM_ADMIN (Configurações): módulos desativados para o papel
  // deste usuário somem do menu. SYSTEM_ADMIN sempre vê tudo. Enquanto a
  // matriz não chega, os itens controlados por ela ficam ESCONDIDOS (antes
  // apareciam e sumiam — o menu "piscava" itens desligados); a última matriz
  // do papel fica na sessão para o menu abrir certo no recarregamento.
  const [disabledModules, setDisabledModules] = useState<Set<string> | null>(() => readCachedDisabled(user?.role));
  useEffect(() => {
    if (!user?.role || isSystemAdmin) return;
    setDisabledModules(readCachedDisabled(user.role));
    api
      .get('/settings/module-access')
      .then((res) => {
        const keys: string[] = (res.data?.disabled ?? [])
          .filter((d: { role: string }) => d.role === user.role)
          .map((d: { moduleKey: string }) => d.moduleKey);
        setDisabledModules(new Set(keys));
        try {
          sessionStorage.setItem(MODULE_ACCESS_CACHE + user.role, JSON.stringify(keys));
        } catch {
          // sessão indisponível: só perde o atalho do próximo carregamento
        }
      })
      .catch(() => {
        // Falhou a consulta: menu completo (comportamento padrão do papel)
        setDisabledModules((current) => current ?? new Set());
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);
  const modOn = (key: string) => isSystemAdmin || (disabledModules !== null && !disabledModules.has(key));

  // Plano da comunidade (/me/entitlements): recurso pago fora do plano ganha o
  // selo "plano" no menu (só no modo "on" — fora dele nada é bloqueado)
  const { entitlements, isLocked } = usePlanEntitlements();
  const lock = (feature: string) => (isLocked(feature) ? <PlanLock /> : null);

  // Aviso de recurso fora do plano (o interceptor dispara; some ao trocar de tela)
  const location = useLocation();
  const [planNotice, setPlanNotice] = useState<string | null>(null);
  useEffect(() => {
    const onPlan = (event: Event) => setPlanNotice((event as CustomEvent<PlanRequiredDetail>).detail?.message ?? null);
    window.addEventListener(PLAN_REQUIRED_EVENT, onPlan);
    return () => window.removeEventListener(PLAN_REQUIRED_EVENT, onPlan);
  }, []);
  useEffect(() => setPlanNotice(null), [location.pathname]);

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
                <span className="sidebar-user-email" title={user?.email}>{user?.email}</span>
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
          {((canManageDioceses && modOn('dioceses')) || (canManageParishes && modOn('parishes')) || modOn('communities')) && (
            <span className="nav-section-label">Estrutura</span>
          )}
          {canManageDioceses && modOn('dioceses') && (
            <NavLink to="/admin/dioceses" className="nav-link">
              <NavIcon name="diocese" /> Dioceses
            </NavLink>
          )}
          {canManageParishes && modOn('parishes') && (
            <NavLink to="/admin/parishes" className="nav-link">
              <NavIcon name="paroquia" /> Paróquias
            </NavLink>
          )}
          {modOn('communities') && (
            <NavLink to="/admin/communities" className="nav-link">
              <NavIcon name="comunidade" /> Comunidades
            </NavLink>
          )}

          {/* Sempre há ao menos "Minha Escala" nesta seção */}
          <span className="nav-section-label">Comunidade</span>
          {modOn('members') && isCoordination && (
            <NavLink to="/admin/members" className="nav-link">
              <NavIcon name="membros" /> Membros
            </NavLink>
          )}
          {modOn('events') && (
            <NavLink to="/admin/events" className="nav-link">
              <NavIcon name="calendario-liturgico" /> Eventos
            </NavLink>
          )}
          {canManageSchedules && modOn('fixed-schedule') && (
            <NavLink to="/admin/fixed-schedule" className="nav-link">
              <NavIcon name="missa-proxima" /> Agenda Fixa
            </NavLink>
          )}
          {canManageSchedules && modOn('schedules') && (
            <NavLink to="/admin/schedules" className="nav-link">
              <NavIcon name="escala" /> Escalas{lock('schedules')}
            </NavLink>
          )}
          {/* Coordenador também é escalado: "Minha Escala" vale para todos */}
          <NavLink to="/admin/my-schedule" className="nav-link">
            <NavIcon name="escala" /> Minha Escala{lock('schedules')}
          </NavLink>
          {modOn('swaps') && (
            <NavLink to="/admin/swaps" className="nav-link">
              <NavIcon name="trocas-escala" /> Trocas de Escala{lock('swaps')}
            </NavLink>
          )}

          {(modOn('clergy-messages') || modOn('saints') || isCoordination) && (
            <span className="nav-section-label">Pastoral</span>
          )}
          {modOn('clergy-messages') && (
            <NavLink to="/admin/clergy-messages" className="nav-link">
              <NavIcon name="sacerdote" /> Palavra Pastoral
            </NavLink>
          )}
          {modOn('saints') && (
            <NavLink to="/admin/saints" className="nav-link">
              <NavIcon name="santo" /> Santos
            </NavLink>
          )}
          {isCoordination && modOn('pastorals') && (
            <NavLink to="/admin/pastorals/community" className="nav-link">
              <NavIcon name="pastoral" /> Pastorais{lock('pastorals')}
            </NavLink>
          )}
          {isPastoralCoordinator && modOn('my-pastorals') && (
            <NavLink to="/admin/pastorals/my" className="nav-link highlight">
              <NavIcon name="pastoral" /> Minhas Pastorais{lock('pastorals')}
            </NavLink>
          )}
          {isSystemAdmin && (
            <NavLink to="/admin/pastorals/global" className="nav-link">
              <NavIcon name="igreja" /> Pastorais Globais
            </NavLink>
          )}
          {isCatechist && !isCoordination && modOn('catechesis') && (
            <NavLink to="/admin/catechesis" className="nav-link highlight">
              <NavIcon name="catequese" /> Catequese (minha turma){lock('catechesis')}
            </NavLink>
          )}
          {isCoordination && (
            <>
              {modOn('catechesis') && (
                <NavLink to="/admin/catechesis" className="nav-link">
                  <NavIcon name="catequese" /> Catequese{lock('catechesis')}
                </NavLink>
              )}
              {modOn('planning') && (
                <NavLink to="/admin/planning" className="nav-link">
                  <NavIcon name="planejamento" /> Planejamento
                </NavLink>
              )}
              {modOn('documents') && (
                <NavLink to="/admin/documents" className="nav-link">
                  <NavIcon name="documento" /> Documentos{lock('documents')}
                </NavLink>
              )}
              {modOn('formation') && (
                <NavLink to="/admin/formation" className="nav-link">
                  <NavIcon name="biblia" /> Formação{lock('formation')}
                </NavLink>
              )}
              {modOn('rooms') && (
                <NavLink to="/admin/rooms" className="nav-link">
                  <NavIcon name="espacos" /> Espaços{lock('rooms')}
                </NavLink>
              )}
              {modOn('visitation') && (
                <NavLink to="/admin/visitation" className="nav-link">
                  <NavIcon name="visitacao" /> Visitação{lock('visitation')}
                </NavLink>
              )}
            </>
          )}

          {(isCommunityManagement || canManageUsers || isSystemAdmin) && <span className="nav-section-label">Gestão</span>}
          {isCommunityManagement && modOn('finance') && (
            <NavLink to="/admin/finance" className="nav-link">
              <NavIcon name="dizimo" /> Financeiro
            </NavLink>
          )}
          {isCommunityManagement && modOn('sacrament-processes') && (
            <NavLink to="/admin/sacrament-processes" className="nav-link">
              <NavIcon name="cruz" /> Sacramentos
            </NavLink>
          )}
          {canManageUsers && modOn('users') && (
            <NavLink to="/admin/users" className="nav-link">
              <NavIcon name="usuarios" /> Usuários
            </NavLink>
          )}
          {isCommunityManagement && modOn('audit') && (
            <NavLink to="/admin/audit" className="nav-link">
              <NavIcon name="documento" /> Auditoria
            </NavLink>
          )}
          {isSystemAdmin && (
            <NavLink to="/admin/settings" className="nav-link">
              <NavIcon name="planejamento" /> Configurações
            </NavLink>
          )}

          {isSystemAdmin && (
            <>
              <span className="nav-section-label">Plataforma</span>
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
        {trials.length > 0 && (
          <div className="plan-banner plan-banner-trial" role="status">
            {trials.length === 1
              ? `O teste do plano de ${trials[0].communityName} vai até ${dataCurta(trials[0].trialEndsAt)}. `
              : `Testes do plano terminando: ${trials.map((t) => `${t.communityName} (${dataCurta(t.trialEndsAt)})`).join(', ')}. `}
            Depois disso, pastorais, escalas, catequese, formação, espaços, visitas e documentos dependem do plano da
            comunidade; calendário, mapa e liturgia continuam liberados.
          </div>
        )}
        {planNotice && (
          <div className="plan-banner" role="alert">
            <span>{planNotice}</span>
            <button type="button" className="plan-banner-close" onClick={() => setPlanNotice(null)} aria-label="Fechar aviso">
              ×
            </button>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
};

export default AdminLayout;

import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import UserPhotoAvatar from './UserPhotoAvatar';
import api from '../services/api';
import './AdminLayout.css';

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
  // deste usuário somem do menu. SYSTEM_ADMIN sempre vê tudo.
  const [disabledModules, setDisabledModules] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!user?.role || isSystemAdmin) return;
    api
      .get('/settings/module-access')
      .then((res) => {
        setDisabledModules(
          new Set(
            (res.data?.disabled ?? [])
              .filter((d: { role: string }) => d.role === user.role)
              .map((d: { moduleKey: string }) => d.moduleKey),
          ),
        );
      })
      .catch(() => {
        // Falhou a consulta: menu completo (comportamento padrão do papel)
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);
  const modOn = (key: string) => isSystemAdmin || !disabledModules.has(key);

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
              <NavIcon name="planejamento" /> Início · pendências
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

          {(modOn('members') || modOn('events') || modOn('swaps') || (canManageSchedules && (modOn('fixed-schedule') || modOn('schedules')))) && (
            <span className="nav-section-label">Comunidade</span>
          )}
          {modOn('members') && (
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
              <NavIcon name="escala" /> Escalas
            </NavLink>
          )}
          {!canManageSchedules && (
            <NavLink to="/admin/my-schedule" className="nav-link">
              <NavIcon name="escala" /> Minha Escala
            </NavLink>
          )}
          {modOn('swaps') && (
            <NavLink to="/admin/swaps" className="nav-link">
              <NavIcon name="trocas-escala" /> Trocas de Escala
            </NavLink>
          )}

          {(modOn('clergy-messages') || modOn('saints') || modOn('pastorals') || isCoordination) && (
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
          {modOn('pastorals') && (
            <NavLink to="/admin/pastorals/community" className="nav-link">
              <NavIcon name="pastoral" /> Pastorais
            </NavLink>
          )}
          {isPastoralCoordinator && modOn('my-pastorals') && (
            <NavLink to="/admin/pastorals/my" className="nav-link highlight">
              <NavIcon name="pastoral" /> Minhas Pastorais
            </NavLink>
          )}
          {isSystemAdmin && (
            <NavLink to="/admin/pastorals/global" className="nav-link">
              <NavIcon name="igreja" /> Pastorais Globais
            </NavLink>
          )}
          {isCatechist && !isCoordination && modOn('catechesis') && (
            <NavLink to="/admin/catechesis" className="nav-link highlight">
              <NavIcon name="catequese" /> Catequese (minha turma)
            </NavLink>
          )}
          {isCoordination && (
            <>
              {modOn('catechesis') && (
                <NavLink to="/admin/catechesis" className="nav-link">
                  <NavIcon name="catequese" /> Catequese
                </NavLink>
              )}
              {modOn('planning') && (
                <NavLink to="/admin/planning" className="nav-link">
                  <NavIcon name="planejamento" /> Planejamento
                </NavLink>
              )}
              {modOn('documents') && (
                <NavLink to="/admin/documents" className="nav-link">
                  <NavIcon name="documento" /> Documentos
                </NavLink>
              )}
              {modOn('formation') && (
                <NavLink to="/admin/formation" className="nav-link">
                  <NavIcon name="biblia" /> Formação
                </NavLink>
              )}
              {modOn('rooms') && (
                <NavLink to="/admin/rooms" className="nav-link">
                  <NavIcon name="espacos" /> Espaços
                </NavLink>
              )}
              {modOn('visitation') && (
                <NavLink to="/admin/visitation" className="nav-link">
                  <NavIcon name="visitacao" /> Visitação
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

          <span className="nav-section-label">Conta</span>
          <NavLink to="/admin/account" className="nav-link">
            <NavIcon name="membros" /> Minha conta
          </NavLink>
          <NavLink to="/admin/security" className="nav-link">
            <NavIcon name="sino" /> Segurança
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
        <Outlet />
      </main>
    </div>
  );
};

export default AdminLayout;

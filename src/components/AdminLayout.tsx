import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { avatarColor, initials } from './SaintAvatar';
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
    style={{
      WebkitMaskImage: `url('/icons/${name}.svg')`,
      maskImage: `url('/icons/${name}.svg')`,
    }}
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

  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <img src="/brand/parish-logo-horizontal-branco.svg" alt="Parish" className="sidebar-logo" />
          </div>
          <div className="sidebar-user">
            <div className="sidebar-user-top">
              <div className="sidebar-user-avatar" style={{ background: avatarColor(displayName) }}>
                {initials(displayName)}
              </div>
              <div className="sidebar-user-info">
                <span className="sidebar-user-name" title={displayName}>{displayName}</span>
                <span className="sidebar-user-email" title={user?.email}>{user?.email}</span>
              </div>
            </div>
            <span className="sidebar-user-role">{ROLE_LABELS[user?.role ?? ''] ?? user?.role}</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <span className="nav-section-label">Estrutura</span>
          {canManageDioceses && (
            <NavLink to="/admin/dioceses" className="nav-link">
              <NavIcon name="diocese" /> Dioceses
            </NavLink>
          )}
          {canManageParishes && (
            <NavLink to="/admin/parishes" className="nav-link">
              <NavIcon name="paroquia" /> Paróquias
            </NavLink>
          )}
          <NavLink to="/admin/communities" className="nav-link">
            <NavIcon name="comunidade" /> Comunidades
          </NavLink>

          <span className="nav-section-label">Comunidade</span>
          <NavLink to="/admin/members" className="nav-link">
            <NavIcon name="membros" /> Membros
          </NavLink>
          <NavLink to="/admin/events" className="nav-link">
            <NavIcon name="calendario-liturgico" /> Eventos
          </NavLink>
          {canManageSchedules && (
            <NavLink to="/admin/fixed-schedule" className="nav-link">
              <NavIcon name="missa-proxima" /> Agenda Fixa
            </NavLink>
          )}
          {canManageSchedules && (
            <NavLink to="/admin/schedules" className="nav-link">
              <NavIcon name="escala" /> Escalas
            </NavLink>
          )}
          <NavLink to="/admin/swaps" className="nav-link">
            <NavIcon name="trocas-escala" /> Trocas de Escala
          </NavLink>

          <span className="nav-section-label">Pastoral</span>
          <NavLink to="/admin/clergy-messages" className="nav-link">
            <NavIcon name="sacerdote" /> Palavra Pastoral
          </NavLink>
          <NavLink to="/admin/saints" className="nav-link">
            <NavIcon name="santo" /> Santos
          </NavLink>
          <NavLink to="/admin/pastorals/community" className="nav-link">
            <NavIcon name="pastoral" /> Pastorais
          </NavLink>
          {isPastoralCoordinator && (
            <NavLink to="/admin/pastorals/my" className="nav-link highlight">
              <NavIcon name="pastoral" /> Minhas Pastorais
            </NavLink>
          )}
          {isSystemAdmin && (
            <NavLink to="/admin/pastorals/global" className="nav-link">
              <NavIcon name="igreja" /> Pastorais Globais
            </NavLink>
          )}
          {isCoordination && (
            <>
              <NavLink to="/admin/catechesis" className="nav-link">
                <NavIcon name="catequese" /> Catequese
              </NavLink>
              <NavLink to="/admin/planning" className="nav-link">
                <NavIcon name="planejamento" /> Planejamento
              </NavLink>
              <NavLink to="/admin/documents" className="nav-link">
                <NavIcon name="documento" /> Documentos
              </NavLink>
              <NavLink to="/admin/formation" className="nav-link">
                <NavIcon name="biblia" /> Formação
              </NavLink>
              <NavLink to="/admin/rooms" className="nav-link">
                <NavIcon name="espacos" /> Espaços
              </NavLink>
              <NavLink to="/admin/visitation" className="nav-link">
                <NavIcon name="visitacao" /> Visitação
              </NavLink>
            </>
          )}

          {(isCommunityManagement || canManageUsers) && <span className="nav-section-label">Gestão</span>}
          {isCommunityManagement && (
            <>
              <NavLink to="/admin/finance" className="nav-link">
                <NavIcon name="dizimo" /> Financeiro
              </NavLink>
              <NavLink to="/admin/sacrament-processes" className="nav-link">
                <NavIcon name="cruz" /> Sacramentos
              </NavLink>
            </>
          )}
          {canManageUsers && (
            <NavLink to="/admin/users" className="nav-link">
              <NavIcon name="usuarios" /> Usuários
            </NavLink>
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
        <Outlet />
      </main>
    </div>
  );
};

export default AdminLayout;

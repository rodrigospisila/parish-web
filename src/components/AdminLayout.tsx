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
            <span className="sidebar-brand-icon">⛪</span>
            <h2>Gestão Paroquial</h2>
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
              <span className="nav-icon">📍</span> Dioceses
            </NavLink>
          )}
          {canManageParishes && (
            <NavLink to="/admin/parishes" className="nav-link">
              <span className="nav-icon">⛪</span> Paróquias
            </NavLink>
          )}
          <NavLink to="/admin/communities" className="nav-link">
            <span className="nav-icon">🏘️</span> Comunidades
          </NavLink>

          <span className="nav-section-label">Comunidade</span>
          <NavLink to="/admin/members" className="nav-link">
            <span className="nav-icon">👥</span> Membros
          </NavLink>
          <NavLink to="/admin/events" className="nav-link">
            <span className="nav-icon">📅</span> Eventos
          </NavLink>
          {isCommunityManagement && (
            <NavLink to="/admin/fixed-schedule" className="nav-link">
              <span className="nav-icon">🕐</span> Agenda Fixa
            </NavLink>
          )}
          {canManageSchedules && (
            <NavLink to="/admin/schedules" className="nav-link">
              <span className="nav-icon">📋</span> Escalas
            </NavLink>
          )}
          <NavLink to="/admin/swaps" className="nav-link">
            <span className="nav-icon">🔄</span> Trocas de Escala
          </NavLink>

          <span className="nav-section-label">Pastoral</span>
          <NavLink to="/admin/clergy-messages" className="nav-link">
            <span className="nav-icon">📜</span> Palavra Pastoral
          </NavLink>
          <NavLink to="/admin/saints" className="nav-link">
            <span className="nav-icon">🕊️</span> Santos
          </NavLink>
          <NavLink to="/admin/pastorals/community" className="nav-link">
            <span className="nav-icon">🙏</span> Pastorais
          </NavLink>
          {isPastoralCoordinator && (
            <NavLink to="/admin/pastorals/my" className="nav-link highlight">
              <span className="nav-icon">🌟</span> Minhas Pastorais
            </NavLink>
          )}
          {isSystemAdmin && (
            <NavLink to="/admin/pastorals/global" className="nav-link">
              <span className="nav-icon">🌐</span> Pastorais Globais
            </NavLink>
          )}
          {isCoordination && (
            <>
              <NavLink to="/admin/catechesis" className="nav-link">
                <span className="nav-icon">📖</span> Catequese
              </NavLink>
              <NavLink to="/admin/planning" className="nav-link">
                <span className="nav-icon">🗺️</span> Planejamento
              </NavLink>
              <NavLink to="/admin/documents" className="nav-link">
                <span className="nav-icon">📁</span> Documentos
              </NavLink>
              <NavLink to="/admin/formation" className="nav-link">
                <span className="nav-icon">🎓</span> Formação
              </NavLink>
              <NavLink to="/admin/rooms" className="nav-link">
                <span className="nav-icon">🏛️</span> Espaços
              </NavLink>
              <NavLink to="/admin/visitation" className="nav-link">
                <span className="nav-icon">🏠</span> Visitação
              </NavLink>
            </>
          )}

          {(isCommunityManagement || canManageUsers) && <span className="nav-section-label">Gestão</span>}
          {isCommunityManagement && (
            <>
              <NavLink to="/admin/finance" className="nav-link">
                <span className="nav-icon">💰</span> Financeiro
              </NavLink>
              <NavLink to="/admin/sacrament-processes" className="nav-link">
                <span className="nav-icon">✝️</span> Sacramentos
              </NavLink>
            </>
          )}
          {canManageUsers && (
            <NavLink to="/admin/users" className="nav-link">
              <span className="nav-icon">🔐</span> Usuários
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

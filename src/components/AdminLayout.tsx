import React from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './AdminLayout.css';

const AdminLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isSystemAdmin = user?.role === 'SYSTEM_ADMIN';

  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Gestão Paroquial</h2>
          <p className="user-info">{user?.email}</p>
          <p className="user-role">{user?.role}</p>
        </div>

        <nav className="sidebar-nav">
          <Link to="/admin/dioceses" className="nav-link">
            📍 Dioceses
          </Link>
          <Link to="/admin/parishes" className="nav-link">
            ⛪ Paróquias
          </Link>
          <Link to="/admin/communities" className="nav-link">
            🏘️ Comunidades
          </Link>
          <Link to="/admin/members" className="nav-link">
            👥 Membros
          </Link>
          <Link to="/admin/events" className="nav-link">
            📅 Eventos
          </Link>
          {isSystemAdmin && (
            <Link to="/admin/users" className="nav-link">
              🔐 Usuários
            </Link>
          )}
        </nav>

        <div className="sidebar-footer">
          <button onClick={handleLogout} className="logout-btn">
            🚪 Sair
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

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AdminLayout from './components/AdminLayout';
import LoginPage from './pages/LoginPage';
import DiocesesPage from './pages/DiocesesPage';
import ParishesPage from './pages/ParishesPage';
import CommunitiesPage from './pages/CommunitiesPage';
import MembersPage from './pages/MembersPage';
import EventsPage from './pages/EventsPage';
import UsersPage from './pages/UsersPage';
import SchedulesPage from './pages/SchedulesPage';
import GlobalPastoralsPage from './pages/pastorals/GlobalPastoralsPage';
import CommunityPastoralsPage from './pages/pastorals/CommunityPastoralsPage';
import CommunityPastoralDetailsPage from './pages/pastorals/CommunityPastoralDetailsPage';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, loading } = useAuth();

  if (loading) {
    return <div>Carregando...</div>;
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

const RoleProtectedRoute: React.FC<{ children: React.ReactNode; allowedRoles: string[] }> = ({ children, allowedRoles }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>Carregando...</div>;
  }

  if (!user || !allowedRoles.includes(user.role)) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2 style={{ color: '#e74c3c' }}>Acesso Negado</h2>
        <p>Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }

  return <>{children}</>;
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/admin/parishes" replace />} />
            <Route path="dioceses" element={
              <RoleProtectedRoute allowedRoles={['SYSTEM_ADMIN', 'DIOCESAN_ADMIN']}>
                <DiocesesPage />
              </RoleProtectedRoute>
            } />
            <Route path="parishes" element={<ParishesPage />} />
            <Route path="communities" element={<CommunitiesPage />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="events" element={<EventsPage />} />
            <Route path="schedules" element={<SchedulesPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="pastorals/global" element={
              <RoleProtectedRoute allowedRoles={['SYSTEM_ADMIN']}>
                <GlobalPastoralsPage />
              </RoleProtectedRoute>
            } />
            <Route path="pastorals/community" element={<CommunityPastoralsPage />} />
            <Route path="pastorals/community/:id" element={<CommunityPastoralDetailsPage />} />
          </Route>

          <Route path="/" element={<Navigate to="/admin" replace />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;

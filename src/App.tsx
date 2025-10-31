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
            <Route index element={<Navigate to="/admin/dioceses" replace />} />
            <Route path="dioceses" element={<DiocesesPage />} />
            <Route path="parishes" element={<ParishesPage />} />
            <Route path="communities" element={<CommunitiesPage />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="events" element={<EventsPage />} />
            <Route path="users" element={<UsersPage />} />
          </Route>

          <Route path="/" element={<Navigate to="/admin" replace />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;

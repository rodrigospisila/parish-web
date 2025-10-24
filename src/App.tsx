import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AdminLayout from './layouts/AdminLayout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import { DiocesesPage } from './pages/DiocesesPage';
import { ParishesPage } from './pages/ParishesPage';
import { CommunitiesPage } from './pages/CommunitiesPage';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>Carregando...</div>;
  }

  return user ? <>{children}</> : <Navigate to="/login" />;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>Carregando...</div>;
  }

  return !user ? <>{children}</> : <Navigate to="/" />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <AdminLayout />
          </PrivateRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="dioceses" element={<DiocesesPage />} />
        <Route path="parishes" element={<ParishesPage />} />
        <Route path="communities" element={<CommunitiesPage />} />
        <Route path="members" element={<div style={{ padding: '24px' }}>Membros (em desenvolvimento)</div>} />
        <Route path="events" element={<div style={{ padding: '24px' }}>Eventos (em desenvolvimento)</div>} />
        <Route path="schedules" element={<div style={{ padding: '24px' }}>Escalas (em desenvolvimento)</div>} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}


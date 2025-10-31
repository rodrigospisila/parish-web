import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AdminLayout from './components/AdminLayout';
import LoginPage from './pages/LoginPage';
import EventsPage from './pages/EventsPage';

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
            <Route path="dioceses" element={<div style={{padding: '2rem'}}>Página de Dioceses (em desenvolvimento)</div>} />
            <Route path="parishes" element={<div style={{padding: '2rem'}}>Página de Paróquias (em desenvolvimento)</div>} />
            <Route path="communities" element={<div style={{padding: '2rem'}}>Página de Comunidades (em desenvolvimento)</div>} />
            <Route path="members" element={<div style={{padding: '2rem'}}>Página de Membros (em desenvolvimento)</div>} />
            <Route path="events" element={<EventsPage />} />
            <Route path="users" element={<div style={{padding: '2rem'}}>Página de Usuários (em desenvolvimento)</div>} />
          </Route>

          <Route path="/" element={<Navigate to="/admin" replace />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;

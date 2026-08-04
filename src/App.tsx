import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AdminLayout from './components/AdminLayout';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
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
import MyPastoralsPage from './pages/pastorals/MyPastoralsPage';
import CatechesisPage from './pages/modules/CatechesisPage';
import PlanningPage from './pages/modules/PlanningPage';
import DocumentsPage from './pages/modules/DocumentsPage';
import FormationPage from './pages/modules/FormationPage';
import RoomsPage from './pages/modules/RoomsPage';
import FinancePage from './pages/modules/FinancePage';
import SacramentProcessesPage from './pages/modules/SacramentProcessesPage';
import VisitationPage from './pages/modules/VisitationPage';
import SwapsPage from './pages/modules/SwapsPage';
import SaintsPage from './pages/modules/SaintsPage';
import ClergyMessagesPage from './pages/modules/ClergyMessagesPage';
import FixedSchedulePage from './pages/modules/FixedSchedulePage';
import { PrivacyPage, TermsPage, SupportPage } from './pages/LegalPages';

// Papéis com acesso às telas de coordenação (módulos das Fases 3–4)
const COORDINATION_ROLES = [
  'SYSTEM_ADMIN',
  'DIOCESAN_ADMIN',
  'PARISH_ADMIN',
  'COMMUNITY_COORDINATOR',
  'PASTORAL_COORDINATOR',
];

// Módulos restritos à coordenação de comunidade ou superior (financeiro, sacramentos)
const COMMUNITY_MANAGEMENT_ROLES = ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN', 'COMMUNITY_COORDINATOR'];
// Agenda Fixa: coordenador de pastoral acessa para GERAR ESCALA (CRUD segue restrito no componente/back)
const FIXED_SCHEDULE_ROLES = [...COMMUNITY_MANAGEMENT_ROLES, 'PASTORAL_COORDINATOR'];

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
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />

          {/* Páginas públicas exigidas pelas lojas (App Store / Google Play) */}
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/privacidade" element={<PrivacyPage />} />
          <Route path="/termos" element={<TermsPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/suporte" element={<SupportPage />} />
          <Route path="/support" element={<SupportPage />} />
          
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/admin/communities" replace />} />
            <Route path="dioceses" element={
              <RoleProtectedRoute allowedRoles={['SYSTEM_ADMIN', 'DIOCESAN_ADMIN']}>
                <DiocesesPage />
              </RoleProtectedRoute>
            } />
            <Route path="parishes" element={
              <RoleProtectedRoute allowedRoles={['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN']}>
                <ParishesPage />
              </RoleProtectedRoute>
            } />
            <Route path="communities" element={<CommunitiesPage />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="events" element={<EventsPage />} />
            <Route path="fixed-schedule" element={
              <RoleProtectedRoute allowedRoles={FIXED_SCHEDULE_ROLES}>
                <FixedSchedulePage />
              </RoleProtectedRoute>
            } />
            <Route path="schedules" element={<SchedulesPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="pastorals/my" element={
              <RoleProtectedRoute allowedRoles={['PASTORAL_COORDINATOR']}>
                <MyPastoralsPage />
              </RoleProtectedRoute>
            } />
            <Route path="pastorals/global" element={
              <RoleProtectedRoute allowedRoles={['SYSTEM_ADMIN']}>
                <GlobalPastoralsPage />
              </RoleProtectedRoute>
            } />
            <Route path="pastorals/community" element={
              <RoleProtectedRoute allowedRoles={['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN', 'COMMUNITY_COORDINATOR', 'PASTORAL_COORDINATOR']}>
                <CommunityPastoralsPage />
              </RoleProtectedRoute>
            } />
            <Route path="pastorals/community/:id" element={
              <RoleProtectedRoute allowedRoles={['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN', 'COMMUNITY_COORDINATOR', 'PASTORAL_COORDINATOR']}>
                <CommunityPastoralDetailsPage />
              </RoleProtectedRoute>
            } />

            {/* Módulos das Fases 3–4 */}
            <Route path="catechesis" element={
              <RoleProtectedRoute allowedRoles={COORDINATION_ROLES}>
                <CatechesisPage />
              </RoleProtectedRoute>
            } />
            <Route path="planning" element={
              <RoleProtectedRoute allowedRoles={COORDINATION_ROLES}>
                <PlanningPage />
              </RoleProtectedRoute>
            } />
            <Route path="documents" element={
              <RoleProtectedRoute allowedRoles={COORDINATION_ROLES}>
                <DocumentsPage />
              </RoleProtectedRoute>
            } />
            <Route path="formation" element={
              <RoleProtectedRoute allowedRoles={COORDINATION_ROLES}>
                <FormationPage />
              </RoleProtectedRoute>
            } />
            <Route path="rooms" element={
              <RoleProtectedRoute allowedRoles={COORDINATION_ROLES}>
                <RoomsPage />
              </RoleProtectedRoute>
            } />
            <Route path="finance" element={
              <RoleProtectedRoute allowedRoles={COMMUNITY_MANAGEMENT_ROLES}>
                <FinancePage />
              </RoleProtectedRoute>
            } />
            <Route path="sacrament-processes" element={
              <RoleProtectedRoute allowedRoles={COMMUNITY_MANAGEMENT_ROLES}>
                <SacramentProcessesPage />
              </RoleProtectedRoute>
            } />
            <Route path="visitation" element={
              <RoleProtectedRoute allowedRoles={COORDINATION_ROLES}>
                <VisitationPage />
              </RoleProtectedRoute>
            } />
            <Route path="swaps" element={<SwapsPage />} />
            {/* Santos e Palavra Pastoral: leitura aberta a todos os logados */}
            <Route path="saints" element={<SaintsPage />} />
            <Route path="clergy-messages" element={<ClergyMessagesPage />} />
          </Route>

          <Route path="/" element={<Navigate to="/admin" replace />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
        
        {/* Toast Container para notificações */}
        <ToastContainer
          position="top-right"
          autoClose={3000}
          hideProgressBar={false}
          newestOnTop
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
          theme="colored"
        />
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;

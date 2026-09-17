import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import api from './services/api';
import AdminLayout from './components/AdminLayout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import DiocesesPage from './pages/DiocesesPage';
import ParishesPage from './pages/ParishesPage';
import CommunitiesPage from './pages/CommunitiesPage';
import MembersPage from './pages/MembersPage';
import MyAccountPage from './pages/MyAccountPage';
import SystemSettingsPage from './pages/SystemSettingsPage';
import MySchedulePage from './pages/MySchedulePage';
import EventsPage from './pages/EventsPage';
import UsersPage from './pages/UsersPage';
import SecurityPage from './pages/SecurityPage';
import AuditPage from './pages/AuditPage';
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
import DonatePage from './pages/public/DonatePage';
import GiftStatusPage from './pages/public/GiftStatusPage';

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

// Tela exclusiva da coordenação. Papel de base que chegue pela URL (o painel de
// Escalas já foi o landing do fiel, então o endereço pode estar no histórico do
// navegador) volta para a própria área em vez de ver a gestão ou um "Acesso Negado".
const CoordinationOnlyRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>Carregando...</div>;
  }

  if (!user || !COORDINATION_ROLES.includes(user.role)) {
    return <Navigate to="/admin" replace />;
  }

  return <>{children}</>;
};

// Fiel/voluntário: o catequista entra pela turma dele (item em destaque do menu);
// os demais, pela própria escala. Mesmos critérios do menu do AdminLayout: a
// turma vem de /catechesis/my-classes e o módulo pode estar desligado para o
// papel na matriz do SYSTEM_ADMIN. Qualquer falha cai em "Minha Escala".
const BaseRoleLanding: React.FC<{ role: string }> = ({ role }) => {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get('/catechesis/my-classes'),
      api.get('/settings/module-access').catch(() => null),
    ])
      .then(([classes, access]) => {
        if (!active) return;
        const isCatechist = Array.isArray(classes.data) && classes.data.length > 0;
        const catechesisOff = (access?.data?.disabled ?? []).some(
          (d: { role: string; moduleKey: string }) => d.role === role && d.moduleKey === 'catechesis',
        );
        setTarget(isCatechist && !catechesisOff ? '/admin/catechesis' : '/admin/my-schedule');
      })
      .catch(() => {
        if (active) setTarget('/admin/my-schedule');
      });
    return () => {
      active = false;
    };
  }, [role]);

  if (!target) {
    return <div>Carregando...</div>;
  }

  return <Navigate to={target} replace />;
};

// Landing pós-login por papel: coordenador de pastoral caía em página de
// admin com "Acesso Negado" — cada papel entra pela sua área de trabalho.
const AdminIndexRedirect: React.FC = () => {
  const { user } = useAuth();
  const role = user?.role ?? '';
  // Coordenação cai nas pendências (Onda 4); administração segue na estrutura
  if (['SYSTEM_ADMIN', 'DIOCESAN_ADMIN'].includes(role)) {
    return <Navigate to="/admin/communities" replace />;
  }
  if (['PARISH_ADMIN', 'COMMUNITY_COORDINATOR', 'PASTORAL_COORDINATOR'].includes(role)) {
    return <Navigate to="/admin/dashboard" replace />;
  }
  // Fiel/voluntário caía no painel de Escalas da coordenação, que não é dele
  return <BaseRoleLanding role={role} />;
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

          {/* Doação pública (Dízimo D4.6): sem login, layout próprio */}
          <Route path="/doar/recibo/:token" element={<GiftStatusPage />} />
          <Route path="/doar/:parishId" element={<DonatePage />} />
          
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<AdminIndexRedirect />} />
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
            <Route path="account" element={<MyAccountPage />} />
            <Route path="settings" element={
              <RoleProtectedRoute allowedRoles={['SYSTEM_ADMIN']}>
                <SystemSettingsPage />
              </RoleProtectedRoute>
            } />
            <Route path="events" element={<EventsPage />} />
            <Route path="fixed-schedule" element={
              <RoleProtectedRoute allowedRoles={FIXED_SCHEDULE_ROLES}>
                <FixedSchedulePage />
              </RoleProtectedRoute>
            } />
            <Route path="schedules" element={
              <CoordinationOnlyRoute>
                <SchedulesPage />
              </CoordinationOnlyRoute>
            } />
            <Route path="users" element={<UsersPage />} />
            {/* Governança de acesso (D4.7): segurança da conta e auditoria escopada */}
            <Route path="security" element={<SecurityPage />} />
            <Route path="audit" element={
              <RoleProtectedRoute allowedRoles={COMMUNITY_MANAGEMENT_ROLES}>
                <AuditPage />
              </RoleProtectedRoute>
            } />
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

            <Route path="dashboard" element={
              <RoleProtectedRoute allowedRoles={COORDINATION_ROLES}>
                <DashboardPage />
              </RoleProtectedRoute>
            } />

            {/* Módulos das Fases 3–4 */}
            <Route path="my-schedule" element={<MySchedulePage />} />
            <Route path="catechesis" element={
              // Fiel/voluntário CATEQUISTA também entra: a página se limita às
              // turmas dele (backend restringe a lista e valida cada ação)
              <RoleProtectedRoute allowedRoles={[...COORDINATION_ROLES, 'VOLUNTEER', 'FAITHFUL']}>
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

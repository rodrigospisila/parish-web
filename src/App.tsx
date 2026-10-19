import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import api, { CHANGE_PASSWORD_PATH } from './services/api';
import AdminLayout from './components/AdminLayout';
import LoginPage from './pages/LoginPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import DashboardPage from './pages/DashboardPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import DiocesesPage from './pages/DiocesesPage';
import ParishesPage from './pages/ParishesPage';
import CommunitiesPage from './pages/CommunitiesPage';
import MembersPage from './pages/MembersPage';
import MyAccountPage from './pages/MyAccountPage';
import MyDataPage from './pages/MyDataPage';
import TermsAcceptanceGate from './components/TermsAcceptanceGate';
import SystemSettingsPage from './pages/SystemSettingsPage';
import TerritoryMapPage from './pages/TerritoryMapPage';
import SuggestionsPage from './pages/platform/SuggestionsPage';
import GrowthPage from './pages/platform/GrowthPage';
import PlansPage from './pages/platform/PlansPage';
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
import AccessDenied from './components/AccessDenied';
import { ROUTE_ACCESS, coordinatesAnyPastoral, roleAllows, type AccessRule } from './components/accessRules';
import { loadDisabledModules, useModuleAccess } from './hooks/useModuleAccess';
import DonatePage from './pages/public/DonatePage';
import GiftStatusPage from './pages/public/GiftStatusPage';
// Onda 1 (WEB-B): site de vendas, "Meu plano" e painel da plataforma
import { LandingRoute } from './pages/public/LandingPage';
import MyPlanPage, { MY_PLAN_ACCESS } from './pages/MyPlanPage';
import OverviewPage from './pages/platform/OverviewPage';
import ClaimsPage from './pages/platform/ClaimsPage';
import LeadsPage from './pages/platform/LeadsPage';
import AnnouncementsPage from './pages/platform/AnnouncementsPage';
import UsagePage from './pages/platform/UsagePage';
// Onda 1 (WEB-A): reivindicação, convite, importação e "Minha paróquia"
import ClaimParishPage from './pages/public/ClaimParishPage';
import InviteAcceptPage from './pages/public/InviteAcceptPage';
import ImportPage from './pages/ImportPage';
import MyParishPage from './pages/MyParishPage';

/** Importação de planilha: mesmos papéis do POST /members/import (Onda 1). */
const IMPORT_ACCESS: AccessRule = {
  roles: ['SYSTEM_ADMIN', 'DIOCESAN_ADMIN', 'PARISH_ADMIN', 'COMMUNITY_COORDINATOR'],
  module: 'members',
};
/** Minha paróquia (dados/CNPJ, exportação, encerramento): administração paroquial. */
const MY_PARISH_ACCESS: AccessRule = { roles: ['PARISH_ADMIN'] };

/** Carregando discreto (sem "Carregando..." cru no canto da tela). */
const RouteLoading: React.FC = () => (
  <div className="loading" role="status" style={{ padding: '2rem', textAlign: 'center', color: '#52606d' }}>
    Carregando…
  </div>
);

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <RouteLoading />;
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  // Senha definida pela gestão (conta nova/redefinida): troca antes de qualquer tela
  if (user?.forcePasswordChange && location.pathname !== CHANGE_PASSWORD_PATH) {
    return <Navigate to={CHANGE_PASSWORD_PATH} replace />;
  }

  return <>{children}</>;
};

/**
 * Guarda de rota com o MESMO critério do menu (accessRules + matriz de módulos):
 * quem chega pela URL sem acesso vê "Sem acesso a esta página" com a saída
 * para o Início (eng-acessos-25 / ux-acesso-30).
 */
const RequireAccess: React.FC<{ children: React.ReactNode; rule: AccessRule }> = ({ children, rule }) => {
  const { user, loading } = useAuth();
  const { modOn, ready } = useModuleAccess(user?.role);

  if (loading) {
    return <RouteLoading />;
  }

  if (!roleAllows(user, rule)) {
    return <AccessDenied reason="role" />;
  }

  if (rule.module) {
    if (!ready) return <RouteLoading />;
    if (!modOn(rule.module)) return <AccessDenied reason="module" />;
  }

  return <>{children}</>;
};

// Tela exclusiva da coordenação. Papel de base que chegue pela URL (o painel de
// Escalas já foi o landing do fiel, então o endereço pode estar no histórico do
// navegador) volta para a própria área em vez de ver a gestão ou um "Acesso Negado".
const CoordinationOnlyRoute: React.FC<{ children: React.ReactNode; rule: AccessRule }> = ({ children, rule }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <RouteLoading />;
  }

  if (!roleAllows(user, rule)) {
    return <Navigate to="/admin" replace />;
  }

  return <RequireAccess rule={rule}>{children}</RequireAccess>;
};

// Fiel/voluntário: o catequista entra pela turma dele (item em destaque do menu);
// os demais, pela própria escala. Mesmos critérios do menu do AdminLayout: a
// turma vem de /catechesis/my-classes e o módulo pode estar desligado para o
// papel na matriz do SYSTEM_ADMIN. Qualquer falha cai em "Minha Escala".
const BaseRoleLanding: React.FC<{ role: string }> = ({ role }) => {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api.get('/catechesis/my-classes'), loadDisabledModules(role)])
      .then(([classes, disabled]) => {
        if (!active) return;
        const isCatechist = Array.isArray(classes.data) && classes.data.length > 0;
        setTarget(isCatechist && !disabled.has('catechesis') ? '/admin/catechesis' : '/admin/my-schedule');
      })
      .catch(() => {
        if (active) setTarget('/admin/my-schedule');
      });
    return () => {
      active = false;
    };
  }, [role]);

  if (!target) {
    return <RouteLoading />;
  }

  return <Navigate to={target} replace />;
};

// Landing pós-login por papel: coordenador de pastoral caía em página de
// admin com "Acesso Negado" — cada papel entra pela sua área de trabalho.
const AdminIndexRedirect: React.FC = () => {
  const { user } = useAuth();
  const role = user?.role ?? '';
  // Coordenação cai nas pendências (Onda 4); administração segue na estrutura
  // Plataforma entra pela visão geral (ux-acesso-31); diocese segue na estrutura
  if (role === 'SYSTEM_ADMIN') {
    return <Navigate to="/admin/platform" replace />;
  }
  if (role === 'DIOCESAN_ADMIN') {
    return <Navigate to="/admin/communities" replace />;
  }
  // Quem coordena pastoral pelo vínculo (papel VOLUNTEER/FAITHFUL) também cai
  // no Início das suas pastorais (ux-dashboards-22)
  if (['PARISH_ADMIN', 'COMMUNITY_COORDINATOR', 'PASTORAL_COORDINATOR'].includes(role) || coordinatesAnyPastoral(user)) {
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
          <Route
            path={CHANGE_PASSWORD_PATH}
            element={
              <ProtectedRoute>
                <ChangePasswordPage />
              </ProtectedRoute>
            }
          />

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

          {/* Onda 1 (WEB-A): "esta paróquia é minha" e aceite de convite de equipe — sem login */}
          <Route path="/reivindicar/:parishId" element={<ClaimParishPage />} />
          <Route path="/convite/:token" element={<InviteAcceptPage />} />
          
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                {/* Aceite dos termos vigentes antes de usar o painel (M3/M4) */}
                <TermsAcceptanceGate />
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<AdminIndexRedirect />} />
            <Route path="dioceses" element={
              <RequireAccess rule={ROUTE_ACCESS.dioceses}>
                <DiocesesPage />
              </RequireAccess>
            } />
            <Route path="parishes" element={
              <RequireAccess rule={ROUTE_ACCESS.parishes}>
                <ParishesPage />
              </RequireAccess>
            } />
            <Route path="communities" element={
              <RequireAccess rule={ROUTE_ACCESS.communities}>
                <CommunitiesPage />
              </RequireAccess>
            } />
            {/* Cadastro de membros: só coordenação (o backend já devolve ao fiel
                apenas o próprio cadastro e os dependentes) */}
            <Route path="members" element={
              <CoordinationOnlyRoute rule={ROUTE_ACCESS.members}>
                <MembersPage />
              </CoordinationOnlyRoute>
            } />
            <Route path="account" element={<MyAccountPage />} />
            <Route path="my-data" element={<MyDataPage />} />
            <Route path="map" element={
              <RequireAccess rule={ROUTE_ACCESS.map}>
                <TerritoryMapPage />
              </RequireAccess>
            } />
            {/* Plataforma (SYSTEM_ADMIN): visão geral, reivindicações, leads, avisos e uso (Onda 1) */}
            <Route path="platform" element={
              <RequireAccess rule={ROUTE_ACCESS.platform}>
                <OverviewPage />
              </RequireAccess>
            } />
            <Route path="platform/claims" element={
              <RequireAccess rule={ROUTE_ACCESS.platform}>
                <ClaimsPage />
              </RequireAccess>
            } />
            <Route path="platform/leads" element={
              <RequireAccess rule={ROUTE_ACCESS.platform}>
                <LeadsPage />
              </RequireAccess>
            } />
            <Route path="platform/announcements" element={
              <RequireAccess rule={ROUTE_ACCESS.platform}>
                <AnnouncementsPage />
              </RequireAccess>
            } />
            <Route path="platform/usage" element={
              <RequireAccess rule={ROUTE_ACCESS.platform}>
                <UsagePage />
              </RequireAccess>
            } />
            {/* Meu plano (Onda 1): planos, cobranças e contratação da paróquia */}
            <Route path="meu-plano" element={
              <RequireAccess rule={MY_PLAN_ACCESS}>
                <MyPlanPage />
              </RequireAccess>
            } />
            {/* Plataforma (SYSTEM_ADMIN): sugestões dos fiéis, crescimento e planos */}
            <Route path="platform/suggestions" element={
              <RequireAccess rule={ROUTE_ACCESS.platform}>
                <SuggestionsPage />
              </RequireAccess>
            } />
            <Route path="platform/growth" element={
              <RequireAccess rule={ROUTE_ACCESS.platform}>
                <GrowthPage />
              </RequireAccess>
            } />
            <Route path="platform/plans" element={
              <RequireAccess rule={ROUTE_ACCESS.platform}>
                <PlansPage />
              </RequireAccess>
            } />
            <Route path="settings" element={
              <RequireAccess rule={ROUTE_ACCESS.settings}>
                <SystemSettingsPage />
              </RequireAccess>
            } />
            <Route path="events" element={
              <RequireAccess rule={ROUTE_ACCESS.events}>
                <EventsPage />
              </RequireAccess>
            } />
            {/* Agenda Fixa: coordenador de pastoral acessa para GERAR ESCALA (CRUD segue restrito no componente/back) */}
            <Route path="fixed-schedule" element={
              <RequireAccess rule={ROUTE_ACCESS['fixed-schedule']}>
                <FixedSchedulePage />
              </RequireAccess>
            } />
            <Route path="schedules" element={
              <CoordinationOnlyRoute rule={ROUTE_ACCESS.schedules}>
                <SchedulesPage />
              </CoordinationOnlyRoute>
            } />
            <Route path="users" element={
              <RequireAccess rule={ROUTE_ACCESS.users}>
                <UsersPage />
              </RequireAccess>
            } />
            {/* Onda 1 (WEB-A): assistente de importação e "Minha paróquia" */}
            <Route path="importar" element={
              <RequireAccess rule={IMPORT_ACCESS}>
                <ImportPage />
              </RequireAccess>
            } />
            <Route path="minha-paroquia" element={
              <RequireAccess rule={MY_PARISH_ACCESS}>
                <MyParishPage />
              </RequireAccess>
            } />
            {/* Governança de acesso (D4.7): segurança da conta e auditoria escopada */}
            <Route path="security" element={<SecurityPage />} />
            <Route path="audit" element={
              <RequireAccess rule={ROUTE_ACCESS.audit}>
                <AuditPage />
              </RequireAccess>
            } />
            <Route path="pastorals/my" element={
              <RequireAccess rule={ROUTE_ACCESS['pastorals/my']}>
                <MyPastoralsPage />
              </RequireAccess>
            } />
            <Route path="pastorals/global" element={
              <RequireAccess rule={ROUTE_ACCESS['pastorals/global']}>
                <GlobalPastoralsPage />
              </RequireAccess>
            } />
            <Route path="pastorals/community" element={
              <RequireAccess rule={ROUTE_ACCESS['pastorals/community']}>
                <CommunityPastoralsPage />
              </RequireAccess>
            } />
            <Route path="pastorals/community/:id" element={
              <RequireAccess rule={ROUTE_ACCESS['pastorals/community']}>
                <CommunityPastoralDetailsPage />
              </RequireAccess>
            } />

            {/* Início: coordenação e quem coordena pastoral pelo vínculo (ux-dashboards-22) */}
            <Route path="dashboard" element={
              <RequireAccess rule={ROUTE_ACCESS.dashboard}>
                <DashboardPage />
              </RequireAccess>
            } />

            {/* Módulos das Fases 3–4 */}
            <Route path="my-schedule" element={<MySchedulePage />} />
            <Route path="catechesis" element={
              // Fiel/voluntário CATEQUISTA também entra: a página se limita às
              // turmas dele (backend restringe a lista e valida cada ação)
              <RequireAccess rule={ROUTE_ACCESS.catechesis}>
                <CatechesisPage />
              </RequireAccess>
            } />
            <Route path="planning" element={
              <RequireAccess rule={ROUTE_ACCESS.planning}>
                <PlanningPage />
              </RequireAccess>
            } />
            <Route path="documents" element={
              <RequireAccess rule={ROUTE_ACCESS.documents}>
                <DocumentsPage />
              </RequireAccess>
            } />
            <Route path="formation" element={
              <RequireAccess rule={ROUTE_ACCESS.formation}>
                <FormationPage />
              </RequireAccess>
            } />
            <Route path="rooms" element={
              <RequireAccess rule={ROUTE_ACCESS.rooms}>
                <RoomsPage />
              </RequireAccess>
            } />
            <Route path="finance" element={
              <RequireAccess rule={ROUTE_ACCESS.finance}>
                <FinancePage />
              </RequireAccess>
            } />
            <Route path="sacrament-processes" element={
              <RequireAccess rule={ROUTE_ACCESS['sacrament-processes']}>
                <SacramentProcessesPage />
              </RequireAccess>
            } />
            <Route path="visitation" element={
              <RequireAccess rule={ROUTE_ACCESS.visitation}>
                <VisitationPage />
              </RequireAccess>
            } />
            <Route path="swaps" element={
              <RequireAccess rule={ROUTE_ACCESS.swaps}>
                <SwapsPage />
              </RequireAccess>
            } />
            {/* Santos e Palavra Pastoral: leitura aberta a todos os logados (salvo módulo desligado) */}
            <Route path="saints" element={
              <RequireAccess rule={ROUTE_ACCESS.saints}>
                <SaintsPage />
              </RequireAccess>
            } />
            <Route path="clergy-messages" element={
              <RequireAccess rule={ROUTE_ACCESS['clergy-messages']}>
                <ClergyMessagesPage />
              </RequireAccess>
            } />
          </Route>

          {/* Site de vendas (Onda 1); quem está logado segue para o painel */}
          <Route path="/" element={<LandingRoute />} />
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

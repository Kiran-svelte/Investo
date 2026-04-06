import React from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import LoginPage from './pages/auth/LoginPage';
import ChangePasswordPage from './pages/auth/ChangePasswordPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import DashboardLayout from './components/layout/DashboardLayout';
import DashboardPage from './pages/dashboard/DashboardPage';
import LeadsPage from './pages/leads/LeadsPage';
import LeadDetailPage from './pages/leads/LeadDetailPage';
import PropertiesPage from './pages/properties/PropertiesPage';
import PropertyImportPage from './pages/property-import/PropertyImportPage';
import CalendarPage from './pages/calendar/CalendarPage';
import ConversationsPage from './pages/conversations/ConversationsPage';
import AgentsPage from './pages/agents/AgentsPage';
import AnalyticsPage from './pages/analytics/AnalyticsPage';
import AISettingsPage from './pages/ai-settings/AISettingsPage';
import SettingsPage from './pages/settings/SettingsPage';
import NotificationsPage from './pages/notifications/NotificationsPage';
import OnboardingPage from './pages/onboarding/OnboardingPage';
import CompaniesPage from './pages/companies/CompaniesPage';
import BillingPage from './pages/billing/BillingPage';
import AuditLogsPage from './pages/audit-logs/AuditLogsPage';
import useCompanyFeatures from './hooks/useCompanyFeatures';
import { Loader2 } from 'lucide-react';
import './i18n/i18n';

const LoadingScreen: React.FC = () => (
  <div className="flex h-screen w-screen items-center justify-center bg-gray-50">
    <div className="flex flex-col items-center gap-4">
      <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
      <span className="text-sm text-gray-500">Loading...</span>
    </div>
  </div>
);

const ProtectedRoute: React.FC = () => {
  const { isAuthenticated, isLoading, mustChangePassword } = useAuth();
  const location = window.location.pathname;
  
  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  
  // If user must change password and not already on that page, redirect
  if (mustChangePassword && location !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  
  return <Outlet />;
};

// Guard for routes that require completed onboarding
const OnboardingGuard: React.FC = () => {
  const { user, isLoading } = useAuth();
  const [checkingOnboarding, setCheckingOnboarding] = React.useState(true);
  const [needsOnboarding, setNeedsOnboarding] = React.useState(false);
  const location = window.location.pathname;

  React.useEffect(() => {
    const checkOnboarding = async () => {
      // Super admin doesn't need onboarding
      if (user?.role === 'super_admin') {
        setCheckingOnboarding(false);
        return;
      }

      // Company admin or first user - check onboarding status
      if (user?.role === 'company_admin') {
        try {
          const { data } = await import('./services/api').then(m => m.default.get('/onboarding/status'));
          const status = data.data;
          // If onboarding not completed (no completedAt or step < 6), redirect
          if (!status.completedSteps.includes(6)) {
            setNeedsOnboarding(true);
          }
        } catch {
          // Error checking - don't block
        }
      }
      setCheckingOnboarding(false);
    };

    if (!isLoading && user) {
      checkOnboarding();
    }
  }, [user, isLoading]);

  if (isLoading || checkingOnboarding) return <LoadingScreen />;
  
  // If on onboarding page already, don't redirect
  if (location === '/onboarding') return <Outlet />;
  
  // If needs onboarding, redirect
  if (needsOnboarding) return <Navigate to="/onboarding" replace />;
  
  return <Outlet />;
};

const PublicRoute: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <Outlet />;
};

const FeatureRoute: React.FC<{ featureKey: string }> = ({ featureKey }) => {
  const { user } = useAuth();
  const { loading, isFeatureEnabled } = useCompanyFeatures();

  if (user?.role === 'super_admin') {
    return <Outlet />;
  }

  if (loading) {
    return <LoadingScreen />;
  }

  if (!isFeatureEnabled(featureKey)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SocketProvider>
          <Routes>
            <Route element={<PublicRoute />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
            </Route>

            <Route element={<ProtectedRoute />}>
              <Route path="/change-password" element={<ChangePasswordPage />} />
              <Route path="/onboarding" element={<OnboardingPage />} />
              
              {/* Dashboard routes - check onboarding first for company admins */}
              <Route element={<OnboardingGuard />}>
                <Route path="/" element={<DashboardLayout />}>
                  <Route index element={<DashboardPage />} />
                  <Route element={<FeatureRoute featureKey="lead_automation" />}>
                    <Route path="leads" element={<LeadsPage />} />
                    <Route path="leads/:id" element={<LeadDetailPage />} />
                  </Route>
                  <Route element={<FeatureRoute featureKey="property_management" />}>
                    <Route path="properties" element={<PropertiesPage />} />
                  </Route>
                  <Route path="properties/import" element={<PropertyImportPage />} />
                  <Route path="properties/import/:draftId" element={<PropertyImportPage />} />
                  <Route element={<FeatureRoute featureKey="visit_scheduling" />}>
                    <Route path="calendar" element={<CalendarPage />} />
                  </Route>
                  <Route element={<FeatureRoute featureKey="conversation_center" />}>
                    <Route path="conversations" element={<ConversationsPage />} />
                  </Route>
                  <Route element={<FeatureRoute featureKey="agent_management" />}>
                    <Route path="agents" element={<AgentsPage />} />
                  </Route>
                  <Route element={<FeatureRoute featureKey="analytics" />}>
                    <Route path="analytics" element={<AnalyticsPage />} />
                  </Route>
                  <Route element={<FeatureRoute featureKey="ai_bot" />}>
                    <Route path="ai-settings" element={<AISettingsPage />} />
                  </Route>
                  <Route path="settings" element={<SettingsPage />} />
                  <Route element={<FeatureRoute featureKey="notifications" />}>
                    <Route path="notifications" element={<NotificationsPage />} />
                  </Route>
                  <Route path="companies" element={<CompaniesPage />} />
                  <Route path="billing" element={<BillingPage />} />
                  <Route element={<FeatureRoute featureKey="audit_logs" />}>
                    <Route path="audit-logs" element={<AuditLogsPage />} />
                  </Route>
                </Route>
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SocketProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;

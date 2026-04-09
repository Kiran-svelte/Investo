import React from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
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
import EmiCalculatorPage from './pages/finance/EmiCalculatorPage';
import SettingsPage from './pages/settings/SettingsPage';
import NotificationsPage from './pages/notifications/NotificationsPage';
import OnboardingPage from './pages/onboarding/OnboardingPage';
import CompaniesPage from './pages/companies/CompaniesPage';
import BillingPage from './pages/billing/BillingPage';
import AuditLogsPage from './pages/audit-logs/AuditLogsPage';
import useCompanyFeatures from './hooks/useCompanyFeatures';
import { Loader2 } from 'lucide-react';
import './i18n/i18n';
import {
  getOnboardingCompletionFromCache,
  setOnboardingCompletionCache,
} from './utils/onboardingCompletionCache';

export const ONBOARDING_ALLOWED_ROLES = new Set(['company_admin', 'super_admin']);
export const PROPERTY_MANAGEMENT_FEATURE_KEY = 'property_management';

export const LoadingScreen: React.FC = () => (
  <div className="flex h-screen w-screen items-center justify-center bg-gray-50">
    <div className="flex flex-col items-center gap-4">
      <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
      <span className="text-sm text-gray-500">Loading...</span>
    </div>
  </div>
);

export const ProtectedRoute: React.FC = () => {
  const { isAuthenticated, isLoading, mustChangePassword } = useAuth();
  const location = useLocation();
  
  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  
  // If user must change password and not already on that page, redirect
  if (mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  
  return <Outlet />;
};

// Guard for routes that require completed onboarding
export const OnboardingGuard: React.FC = () => {
  const { user, isLoading } = useAuth();
  const [checkingOnboarding, setCheckingOnboarding] = React.useState(true);
  const [needsOnboarding, setNeedsOnboarding] = React.useState(false);
  const location = useLocation();

  React.useEffect(() => {
    const checkOnboarding = async () => {
      // Super admin doesn't need onboarding
      if (user?.role === 'super_admin') {
        setNeedsOnboarding(false);
        setCheckingOnboarding(false);
        return;
      }

      // Company admin or first user - check onboarding status
      if (user?.role === 'company_admin') {
        const companyId = typeof user.company_id === 'string' ? user.company_id : '';

        if (companyId) {
          const cached = getOnboardingCompletionFromCache(companyId);
          if (cached === true) {
            setNeedsOnboarding(false);
            setCheckingOnboarding(false);
            return;
          }
        }

        try {
          const { data } = await import('./services/api').then(m => m.default.get('/onboarding/status'));
          const status = data.data;
          const completedSteps = Array.isArray(status?.completedSteps) ? status.completedSteps : [];
          const isComplete = completedSteps.includes(6);
          setNeedsOnboarding(!isComplete);

          if (companyId) {
            setOnboardingCompletionCache(companyId, isComplete);
          }
        } catch {
          // Can't verify onboarding state; fail closed for company_admin.
          setNeedsOnboarding(true);
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
  if (location.pathname === '/onboarding') return <Outlet />;
  
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

export const OnboardingAccessRoute: React.FC = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!ONBOARDING_ALLOWED_ROLES.has(user?.role || '')) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

export const FeatureRoute: React.FC<{ featureKey: string }> = ({ featureKey }) => {
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
              <Route element={<OnboardingAccessRoute />}>
                <Route path="/onboarding" element={<OnboardingPage />} />
              </Route>
              
              {/* Dashboard routes - check onboarding first for company admins */}
              <Route element={<OnboardingGuard />}>
                <Route path="/" element={<DashboardLayout />}>
                  <Route index element={<DashboardPage />} />
                  <Route element={<FeatureRoute featureKey="lead_automation" />}>
                    <Route path="leads" element={<LeadsPage />} />
                    <Route path="leads/:id" element={<LeadDetailPage />} />
                  </Route>
                  <Route element={<FeatureRoute featureKey={PROPERTY_MANAGEMENT_FEATURE_KEY} />}>
                    <Route path="properties" element={<PropertiesPage />} />
                    <Route path="properties/import" element={<PropertyImportPage />} />
                    <Route path="properties/import/:draftId" element={<PropertyImportPage />} />
                  </Route>
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
                  <Route path="emi-calculator" element={<EmiCalculatorPage />} />
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

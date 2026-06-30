import React from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { NotificationProvider } from './context/NotificationContext';
import ToastContainer from './components/notifications/ToastContainer';
import ClarityAnalytics from './components/analytics/ClarityAnalytics';
import InvestoLoading from './components/loading/InvestoLoading';
import { CompanyFeaturesProvider, useCompanyFeatures } from './context/CompanyFeaturesContext';
import { TenantProvider } from './context/TenantContext';
import LoginPage from './pages/auth/LoginPage';
import SsoLoginPage from './pages/auth/SsoLoginPage';
import SsoCompletePage from './pages/auth/SsoCompletePage';
import MfaEnrollPage from './pages/auth/MfaEnrollPage';
import MfaVerifyPage from './pages/auth/MfaVerifyPage';
import ChangePasswordPage from './pages/auth/ChangePasswordPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import DashboardLayout from './components/layout/DashboardLayout';
import AccessFeedbackPage from './components/layout/AccessFeedbackPage';
import RootEntry from './components/layout/RootEntry';
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
import PrivacyPolicyPage from './pages/legal/PrivacyPolicyPage';
import CompaniesPage from './pages/companies/CompaniesPage';
import PlatformHealthPage from './pages/admin/PlatformHealthPage';
import ObservabilityPage from './pages/admin/ObservabilityPage';
import SecurityDashboardPage from './pages/admin/SecurityDashboardPage';
import DeadLetterPage from './pages/admin/DeadLetterPage';
import UsageQuotaPage from './pages/settings/UsageQuotaPage';
import SecuritySettingsPage from './pages/settings/SecuritySettingsPage';
import BranchesPage from './pages/settings/BranchesPage';
import CompliancePage from './pages/settings/CompliancePage';
import IntegrationsPage from './pages/settings/IntegrationsPage';
import AiGovernancePage from './pages/admin/AiGovernancePage';
import TenantHealthPage from './pages/admin/TenantHealthPage';
import SupportToolsPage from './pages/admin/SupportToolsPage';
import DrStatusPage from './pages/admin/DrStatusPage';
import AuditLogsPage from './pages/audit-logs/AuditLogsPage';
import AIActionLogsPage from './pages/ai-action-logs/AIActionLogsPage';
import CopilotPage from './pages/copilot/CopilotPage';
import ErrorLogsPage from './pages/error-logs/ErrorLogsPage';
import ProfilePage from './pages/profile/ProfilePage';
import './i18n/i18n';
import api from './services/api';
import {
  getOnboardingCompletionFromCache,
  setOnboardingCompletionCache,
} from './utils/onboardingCompletionCache';
import {
  DASHBOARD_BASE,
  dashboardPath,
  getRoleHomePath,
  isPathAllowedForRole,
  resolveDashboardPath,
} from './config/navigation.config';
import { SubscriptionProvider, useSubscription } from './context/SubscriptionContext';
import AcceptInvitePage from './pages/auth/AcceptInvitePage';
import AgencyInvitesPage from './pages/admin/AgencyInvitesPage';
import BillingPage from './pages/billing/BillingPage';
import { RESOLUTION_IDS } from './constants/resolutionIds';
import { isSubscriptionAccessEnforcementEnabled } from './config/subscriptionAccess';

export const ONBOARDING_ALLOWED_ROLES = new Set(['company_admin']);
export const PROPERTY_MANAGEMENT_FEATURE_KEY = 'property_management';

export type LoadingScreenVariant = 'workspace' | 'session' | 'route';

export const LoadingScreen: React.FC<{
  hint?: string;
  variant?: LoadingScreenVariant;
  category?: 'default' | 'features' | 'onboarding' | 'auth';
  message?: string;
  embedded?: boolean;
}> = ({ hint, variant = 'workspace', category = 'default', message, embedded }) => {
  const { t } = useTranslation();
  const [slow, setSlow] = React.useState(false);

  React.useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), 18_000);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="relative min-h-0 flex-1">
      <InvestoLoading
        variant={variant}
        category={category}
        message={message}
        hint={hint}
        embedded={embedded ?? variant === 'route'}
      />
      {slow && variant === 'workspace' ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-8 z-50 flex justify-center px-4">
          <div className="pointer-events-auto max-w-md rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-950 shadow-lg">
            <p className="font-medium">{t('loading.still_loading_title', { defaultValue: 'Still loading?' })}</p>
            <p className="mt-1 text-xs text-amber-800">
              {t('loading.still_loading_hint', {
                defaultValue: 'This is taking longer than expected. Try refreshing the page.',
              })}
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white"
                onClick={() => window.location.reload()}
              >
                {t('loading.refresh', { defaultValue: 'Refresh' })}
              </button>
              <a
                href="/onboarding"
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900"
              >
                {t('loading.open_onboarding', { defaultValue: 'Open onboarding' })}
              </a>
              <a
                href="/login"
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900"
              >
                {t('loading.back_to_login', { defaultValue: 'Back to login' })}
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const ProtectedRoute: React.FC = () => {
  const { isAuthenticated, isLoading, mustChangePassword } = useAuth();
  const location = useLocation();
  
  if (isLoading) return <LoadingScreen variant="session" category="auth" />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  
  // If user must change password and not already on that page, redirect
  if (mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  
  return <Outlet />;
};

/** Blocks app until WhatsApp phone is saved (all roles). */
export const ProfileGuard: React.FC = () => {
  const { profileComplete, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <LoadingScreen variant="session" category="auth" />;

  const profilePath = dashboardPath('/profile');
  const onProfile = location.pathname === profilePath || location.pathname.endsWith('/profile');
  const onOnboarding = location.pathname === '/onboarding';

  if (!profileComplete && !onProfile && !onOnboarding) {
    return <Navigate to={profilePath} replace state={{ profileRequired: true }} />;
  }

  return <Outlet />;
};

const ONBOARDING_STATUS_TIMEOUT_MS = 12_000;

function isProfileRoute(pathname: string): boolean {
  const profilePath = dashboardPath('/profile');
  return pathname === profilePath || pathname.endsWith('/profile');
}

// Guard for routes that require completed onboarding
export const OnboardingGuard: React.FC = () => {
  const { user, isLoading } = useAuth();
  const [checkingOnboarding, setCheckingOnboarding] = React.useState(true);
  const [needsOnboarding, setNeedsOnboarding] = React.useState(false);
  const location = useLocation();
  const onProfile = isProfileRoute(location.pathname);

  // Profile must render immediately (phone required) — never block on onboarding API.
  if (onProfile) {
    return <Outlet />;
  }

  React.useEffect(() => {
    if (isLoading) return;

    if (!user) {
      setCheckingOnboarding(false);
      return;
    }

    let cancelled = false;

    const finish = () => {
      if (!cancelled) setCheckingOnboarding(false);
    };

    const checkOnboarding = async () => {
      if (user.role === 'super_admin') {
        setNeedsOnboarding(false);
        finish();
        return;
      }

      if (user.role !== 'company_admin') {
        setNeedsOnboarding(false);
        finish();
        return;
      }

      const companyId = typeof user.company_id === 'string' ? user.company_id : '';

      if (companyId) {
        const cached = getOnboardingCompletionFromCache(companyId);
        if (cached === true) {
          setNeedsOnboarding(false);
          finish();
          return;
        }
      }

      try {
        const { data } = await api.get('/onboarding/status', {
          timeout: ONBOARDING_STATUS_TIMEOUT_MS,
        });
        const status = data.data;
        const completedSteps = Array.isArray(status?.completedSteps) ? status.completedSteps : [];
        const isComplete = completedSteps.includes(6);
        setNeedsOnboarding(!isComplete);
        if (companyId) {
          setOnboardingCompletionCache(companyId, isComplete);
        }
      } catch {
        // Cold server or network: prefer cached completion; otherwise send to onboarding.
        if (companyId && getOnboardingCompletionFromCache(companyId) === true) {
          setNeedsOnboarding(false);
        } else {
          setNeedsOnboarding(true);
        }
      } finally {
        finish();
      }
    };

    void checkOnboarding();

    const watchdog = window.setTimeout(finish, ONBOARDING_STATUS_TIMEOUT_MS + 2_000);

    return () => {
      cancelled = true;
      window.clearTimeout(watchdog);
    };
  }, [user, isLoading]);

  if (isLoading) return <LoadingScreen variant="session" category="auth" />;
  if (checkingOnboarding) {
    return <LoadingScreen variant="route" category="onboarding" embedded />;
  }
  
  // If on onboarding page already, don't redirect
  if (location.pathname === '/onboarding') return <Outlet />;
  
  // If needs onboarding, redirect
  if (needsOnboarding) return <Navigate to="/onboarding" replace />;
  
  return <Outlet />;
};

/** Pass-through — knowledge gate is a banner only (no hard redirect). */
export const PropertyKnowledgeGuard: React.FC = () => <Outlet />;

const PublicRoute: React.FC = () => {
  const { isAuthenticated, isLoading, user } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (isAuthenticated) return <Navigate to={getRoleHomePath(user?.role)} replace />;
  return <Outlet />;
};

/** Redirects authenticated users away from routes their role cannot access. */
export const RoleRoute: React.FC<{ path: string }> = ({ path }) => {
  const { user } = useAuth();
  const { isFeatureEnabled, loading: featuresLoading } = useCompanyFeatures();
  const role = user?.role;

  if (!role) {
    return <Navigate to="/login" replace />;
  }

  const guardedPath = path.startsWith(DASHBOARD_BASE) ? path : dashboardPath(path);

  if (featuresLoading && role !== 'super_admin') {
    return <LoadingScreen variant="session" category="auth" />;
  }

  if (!isPathAllowedForRole(guardedPath, role, isFeatureEnabled)) {
    return (
      <AccessFeedbackPage
        title="This page is not available for your role"
        description="Your workspace role does not include this page. Use your assigned home page or ask a company admin to update your role."
        primaryHref={getRoleHomePath(role)}
      />
    );
  }

  return <Outlet />;
};

export const RoleAwareIndex: React.FC = () => {
  const { user } = useAuth();
  if (user?.role === 'super_admin') {
    return <Navigate to={dashboardPath('/companies')} replace />;
  }
  return <DashboardPage />;
};

/** Redirect old top-level CRM URLs (/leads → /dashboard/leads) for bookmarks and emails. */
export const LegacyDashboardRedirect: React.FC = () => {
  const location = useLocation();
  return <Navigate to={resolveDashboardPath(location.pathname) + location.search + location.hash} replace />;
};

const RoleAwareNotFound: React.FC = () => {
  const { user, isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen variant="session" category="auth" />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return (
    <AccessFeedbackPage
      eyebrow="Page not found"
      title="We could not find that page"
      description="The link may be old, mistyped, or no longer part of this workspace."
      primaryHref={getRoleHomePath(user?.role)}
    />
  );
};

export const OnboardingAccessRoute: React.FC = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingScreen variant="session" category="auth" />;
  }

  if (!ONBOARDING_ALLOWED_ROLES.has(user?.role || '')) {
    return (
      <AccessFeedbackPage
        title="Onboarding is only for company admins"
        description="This setup flow changes company-wide settings, team roles, WhatsApp, and property knowledge. Use your assigned workspace instead."
        primaryHref={getRoleHomePath(user?.role)}
      />
    );
  }

  return <Outlet />;
};

export const FeatureRoute: React.FC<{ featureKey: string }> = ({ featureKey }) => {
  const { user } = useAuth();
  const { loading, isFeatureEnabled } = useCompanyFeatures();

  if (user?.role === 'super_admin') {
    return <Outlet />;
  }

  if (!isFeatureEnabled(featureKey) && !loading) {
    return (
      <AccessFeedbackPage
        eyebrow="Feature disabled"
        title="This feature is turned off"
        description="A company admin can enable this module from Settings if the team needs it."
        primaryHref={getRoleHomePath(user?.role)}
      />
    );
  }

  return <Outlet />;
};

export const SubscriptionAccessGuard: React.FC = () => {
  const { user } = useAuth();
  const { subscription, isLoading, hasAccess, needsPayment } = useSubscription();
  const location = useLocation();

  if (user?.role === 'super_admin' || !isSubscriptionAccessEnforcementEnabled()) {
    return <Outlet />;
  }

  if (isLoading) {
    return <LoadingScreen variant="route" category="auth" embedded />;
  }

  const billingPath = dashboardPath('/billing');
  const profilePath = dashboardPath('/profile');
  const allowedRecoveryPath =
    location.pathname === billingPath ||
    location.pathname.startsWith(`${billingPath}/`) ||
    location.pathname === profilePath ||
    location.pathname.startsWith(`${profilePath}/`);

  const locked = subscription != null && (hasAccess === false || needsPayment);
  if (!locked || allowedRecoveryPath) {
    return <Outlet />;
  }

  if (user?.role === 'company_admin') {
    return (
      <Navigate
        to={billingPath}
        replace
        state={{
          from: location.pathname,
          resolutionId: RESOLUTION_IDS.PAYMENT_LOCKOUT,
        }}
      />
    );
  }

  return (
    <AccessFeedbackPage
      eyebrow="Payment required"
      title="Workspace locked until billing is restored"
      description="Your company's trial has ended or payment is overdue. Ask a company admin to subscribe from Billing."
      primaryHref={profilePath}
      primaryLabel="Open my profile"
      showBackAction={false}
    />
  );
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TenantProvider>
        <CompanyFeaturesProvider>
        <NotificationProvider>
        <SocketProvider>
          <ClarityAnalytics />
          <ToastContainer />
          <Routes>
            <Route path="/" element={<RootEntry />} />

            <Route element={<PublicRoute />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/auth/sso" element={<SsoLoginPage />} />
              <Route path="/auth/sso/complete" element={<SsoCompletePage />} />
              <Route path="/auth/mfa/enroll" element={<MfaEnrollPage />} />
              <Route path="/auth/mfa/verify" element={<MfaVerifyPage />} />
              <Route path="/privacy" element={<PrivacyPolicyPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              {/* Public invite acceptance route — no auth required */}
              <Route path="/accept-invite/:token" element={<AcceptInvitePage />} />
            </Route>

            <Route element={<ProtectedRoute />}>
              <Route path="/change-password" element={<ChangePasswordPage />} />
              <Route element={<SubscriptionProvider><Outlet /></SubscriptionProvider>}>
              <Route element={<ProfileGuard />}>
              <Route element={<OnboardingAccessRoute />}>
                <Route path="/onboarding" element={<OnboardingPage />} />
              </Route>
              
              <Route element={<OnboardingGuard />}>
                <Route element={<PropertyKnowledgeGuard />}>
                <Route path={DASHBOARD_BASE} element={<DashboardLayout />}>
                  <Route element={<SubscriptionAccessGuard />}>
                  <Route path="profile" element={<ProfilePage />} />
                  <Route index element={<RoleAwareIndex />} />
                  <Route element={<RoleRoute path="/leads" />}>
                    <Route element={<FeatureRoute featureKey="lead_automation" />}>
                      <Route path="leads" element={<LeadsPage />} />
                      <Route path="leads/:id" element={<LeadDetailPage />} />
                    </Route>
                  </Route>
                  <Route element={<RoleRoute path="/properties" />}>
                    <Route element={<FeatureRoute featureKey={PROPERTY_MANAGEMENT_FEATURE_KEY} />}>
                      <Route path="properties" element={<PropertiesPage />} />
                    </Route>
                  </Route>
                  <Route element={<RoleRoute path="/properties/import" />}>
                    <Route element={<FeatureRoute featureKey={PROPERTY_MANAGEMENT_FEATURE_KEY} />}>
                      <Route path="properties/import" element={<PropertyImportPage />} />
                      <Route path="properties/import/:draftId" element={<PropertyImportPage />} />
                    </Route>
                  </Route>
                  <Route element={<RoleRoute path="/calendar" />}>
                    <Route element={<FeatureRoute featureKey="visit_scheduling" />}>
                      <Route path="calendar" element={<CalendarPage />} />
                    </Route>
                  </Route>
                  <Route element={<RoleRoute path="/conversations" />}>
                    <Route element={<FeatureRoute featureKey="conversation_center" />}>
                      <Route path="conversations" element={<ConversationsPage />} />
                    </Route>
                  </Route>
                  <Route element={<RoleRoute path="/agents" />}>
                    <Route element={<FeatureRoute featureKey="agent_management" />}>
                      <Route path="agents" element={<AgentsPage />} />
                    </Route>
                  </Route>
                  <Route element={<RoleRoute path="/analytics" />}>
                    <Route element={<FeatureRoute featureKey="analytics" />}>
                      <Route path="analytics" element={<AnalyticsPage />} />
                    </Route>
                  </Route>
                  <Route element={<RoleRoute path="/ai-settings" />}>
                    <Route element={<FeatureRoute featureKey="ai_bot" />}>
                      <Route path="ai-settings" element={<AISettingsPage />} />
                    </Route>
                  </Route>
                  <Route element={<RoleRoute path="/ai-action-logs" />}>
                    <Route element={<FeatureRoute featureKey="ai_bot" />}>
                      <Route path="ai-action-logs" element={<AIActionLogsPage />} />
                    </Route>
                  </Route>
                  <Route element={<RoleRoute path="/copilot" />}>
                    <Route element={<FeatureRoute featureKey="ai_bot" />}>
                      <Route path="copilot" element={<CopilotPage />} />
                    </Route>
                  </Route>
                  <Route element={<RoleRoute path="/emi-calculator" />}>
                    <Route path="emi-calculator" element={<EmiCalculatorPage />} />
                  </Route>
                  <Route element={<RoleRoute path="/settings" />}>
                    <Route path="settings" element={<SettingsPage />} />
                  </Route>
                  <Route element={<RoleRoute path="/usage" />}>
                    <Route path="usage" element={<UsageQuotaPage />} />
                  </Route>
                  <Route element={<RoleRoute path="/security" />}>
                    <Route path="security" element={<SecuritySettingsPage />} />
                  </Route>
                  <Route element={<RoleRoute path="/branches" />}>
                    <Route path="branches" element={<BranchesPage />} />
                  </Route>
                  <Route element={<RoleRoute path="/compliance" />}>
                    <Route path="compliance" element={<CompliancePage />} />
                  </Route>
                  <Route element={<RoleRoute path="/integrations" />}>
                    <Route path="integrations" element={<IntegrationsPage />} />
                  </Route>
                  <Route element={<RoleRoute path="/ai-governance" />}>
                    <Route path="ai-governance" element={<AiGovernancePage />} />
                  </Route>
                  <Route element={<RoleRoute path="/tenant-health" />}>
                    <Route path="tenant-health" element={<TenantHealthPage />} />
                  </Route>
                  <Route element={<RoleRoute path="/support-tools" />}>
                    <Route path="support-tools" element={<SupportToolsPage />} />
                  </Route>
                  <Route element={<RoleRoute path="/dr-status" />}>
                    <Route path="dr-status" element={<DrStatusPage />} />
                  </Route>
                  <Route element={<RoleRoute path="/notifications" />}>
                    <Route element={<FeatureRoute featureKey="notifications" />}>
                      <Route path="notifications" element={<NotificationsPage />} />
                    </Route>
                  </Route>
                  <Route element={<RoleRoute path="/companies" />}>
                    <Route path="companies" element={<CompaniesPage />} />
                  </Route>
                  <Route element={<RoleRoute path="/agency-invites" />}>
                    <Route path="agency-invites" element={<AgencyInvitesPage />} />
                  </Route>
                  <Route element={<RoleRoute path="/platform-health" />}>
                    <Route path="platform-health" element={<PlatformHealthPage />} />
                  </Route>
                  <Route element={<RoleRoute path="/observability" />}>
                    <Route path="observability" element={<ObservabilityPage />} />
                  </Route>
                  <Route element={<RoleRoute path="/security-dashboard" />}>
                    <Route path="security-dashboard" element={<SecurityDashboardPage />} />
                  </Route>
                  <Route element={<RoleRoute path="/message-failures" />}>
                    <Route path="message-failures" element={<DeadLetterPage />} />
                  </Route>
                  {/* Billing page — fully enabled */}
                  <Route element={<RoleRoute path="/billing" />}>
                    <Route path="billing" element={<BillingPage />} />
                  </Route>
                  <Route element={<RoleRoute path="/audit-logs" />}>
                    <Route element={<FeatureRoute featureKey="audit_logs" />}>
                      <Route path="audit-logs" element={<AuditLogsPage />} />
                    </Route>
                  </Route>
                  <Route element={<RoleRoute path="/error-logs" />}>
                    <Route path="error-logs" element={<ErrorLogsPage />} />
                  </Route>
                  </Route>
                </Route>
                </Route>
              </Route>
              </Route>
              </Route>

              {/* Legacy CRM paths without /dashboard prefix */}
              <Route path="/leads/*" element={<LegacyDashboardRedirect />} />
              <Route path="/billing/*" element={<LegacyDashboardRedirect />} />
              <Route path="/properties/*" element={<LegacyDashboardRedirect />} />
              <Route path="/conversations/*" element={<LegacyDashboardRedirect />} />
              <Route path="/calendar/*" element={<LegacyDashboardRedirect />} />
              <Route path="/agents/*" element={<LegacyDashboardRedirect />} />
              <Route path="/analytics/*" element={<LegacyDashboardRedirect />} />
              <Route path="/ai-settings/*" element={<LegacyDashboardRedirect />} />
              <Route path="/ai-action-logs/*" element={<LegacyDashboardRedirect />} />
              <Route path="/copilot/*" element={<LegacyDashboardRedirect />} />
              <Route path="/settings/*" element={<LegacyDashboardRedirect />} />
              <Route path="/notifications/*" element={<LegacyDashboardRedirect />} />
              <Route path="/companies/*" element={<LegacyDashboardRedirect />} />
              <Route path="/platform-health/*" element={<LegacyDashboardRedirect />} />
              <Route path="/message-failures/*" element={<LegacyDashboardRedirect />} />
              <Route path="/branches/*" element={<LegacyDashboardRedirect />} />
              <Route path="/compliance/*" element={<LegacyDashboardRedirect />} />
              <Route path="/integrations/*" element={<LegacyDashboardRedirect />} />
              <Route path="/ai-governance/*" element={<LegacyDashboardRedirect />} />
              <Route path="/tenant-health/*" element={<LegacyDashboardRedirect />} />
              <Route path="/support-tools/*" element={<LegacyDashboardRedirect />} />
              <Route path="/dr-status/*" element={<LegacyDashboardRedirect />} />
              <Route path="/emi-calculator/*" element={<LegacyDashboardRedirect />} />
              <Route path="/audit-logs/*" element={<LegacyDashboardRedirect />} />
            </Route>

            <Route path="*" element={<RoleAwareNotFound />} />
          </Routes>
        </SocketProvider>
        </NotificationProvider>
        </CompanyFeaturesProvider>
        </TenantProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;

/* @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FeatureRoute,
  OnboardingAccessRoute,
  OnboardingGuard,
  ProtectedRoute,
  PROPERTY_MANAGEMENT_FEATURE_KEY,
  RoleRoute,
  SubscriptionAccessGuard,
} from './App';
import { getOnboardingCompletionCacheKey } from './utils/onboardingCompletionCache';

const { authState, featureState, subscriptionState, apiMock } = vi.hoisted(() => ({
  authState: {
    isLoading: false,
    isAuthenticated: true,
    mustChangePassword: false,
    user: {
      id: 'user-1',
      name: 'User',
      email: 'user@investo.in',
      role: 'company_admin',
      company_id: 'company-1',
    },
  },
  featureState: {
    loading: false,
    isFeatureEnabled: vi.fn(() => true),
    features: {},
    error: null,
  },
  subscriptionState: {
    enforcementEnabled: false,
    isLoading: false,
    subscription: {
      billingStatus: 'active',
      hasAccess: true,
      needsPayment: false,
    },
    billingStatus: 'active',
    trialDaysRemaining: null,
    hasAccess: true,
    needsPayment: false,
    refresh: vi.fn(),
  },
  apiMock: {
    get: vi.fn(),
  },
}));

vi.mock('./context/AuthContext', () => ({
  useAuth: () => authState,
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('./context/CompanyFeaturesContext', () => ({
  useCompanyFeatures: () => featureState,
  CompanyFeaturesProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('./context/SubscriptionContext', () => ({
  useSubscription: () => subscriptionState,
  SubscriptionProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('./config/subscriptionAccess', () => ({
  isSubscriptionAccessEnforcementEnabled: () => subscriptionState.enforcementEnabled,
}));

vi.mock('./services/api', () => ({
  default: apiMock,
}));

vi.mock('./components/analytics/ClarityAnalytics', () => ({
  default: () => null,
}));

vi.mock('motion/react', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const Component = ({ children, ...props }: { children?: ReactNode }) => React.createElement('div', props, children);
  return {
    motion: new Proxy({}, { get: () => Component }),
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    LayoutGroup: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReducedMotion: () => true,
  };
});

vi.mock('./components/loading/InvestoLoading', () => ({
  default: () => <div>Loading</div>,
}));

vi.mock('./components/layout/DashboardLayout', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    default: () => <actual.Outlet />,
  };
});

vi.mock('./context/SocketContext', () => ({
  SocketProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

afterEach(() => {
  cleanup();
});

describe('route guard behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    authState.user.role = 'company_admin';
    authState.mustChangePassword = false;
    featureState.loading = false;
    featureState.isFeatureEnabled.mockReturnValue(true);
    subscriptionState.enforcementEnabled = false;
    subscriptionState.isLoading = false;
    subscriptionState.subscription = {
      billingStatus: 'active',
      hasAccess: true,
      needsPayment: false,
    };
    subscriptionState.billingStatus = 'active';
    subscriptionState.hasAccess = true;
    subscriptionState.needsPayment = false;
  });

  it('shows role feedback when super_admin opens a tenant leads route', () => {
    authState.user.role = 'super_admin';

    render(
      <MemoryRouter initialEntries={['/dashboard/leads']}>
        <Routes>
          <Route element={<RoleRoute path="/dashboard/leads" />}>
            <Route path="/dashboard/leads" element={<div>Leads page</div>} />
          </Route>
          <Route path="/dashboard/companies" element={<div>Companies page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Leads page')).not.toBeInTheDocument();
    expect(screen.queryByText('Companies page')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'This page is not available for your role' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to my home/i })).toHaveAttribute('href', '/dashboard/companies');
  });

  it('shows onboarding feedback for disallowed roles', () => {
    authState.user.role = 'sales_agent';

    render(
      <MemoryRouter initialEntries={['/onboarding']}>
        <Routes>
          <Route element={<OnboardingAccessRoute />}>
            <Route path="/onboarding" element={<div>Onboarding page</div>} />
          </Route>
          <Route path="/dashboard" element={<div>Home page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Onboarding page')).not.toBeInTheDocument();
    expect(screen.queryByText('Home page')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Onboarding is only for company admins' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to my home/i })).toHaveAttribute('href', '/dashboard');
  });

  it('allows onboarding route for company_admin', () => {
    render(
      <MemoryRouter initialEntries={['/onboarding']}>
        <Routes>
          <Route element={<OnboardingAccessRoute />}>
            <Route path="/onboarding" element={<div>Onboarding page</div>} />
          </Route>
          <Route path="/" element={<div>Home page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Onboarding page')).toBeInTheDocument();
  });

  it('shows onboarding feedback for super_admin', () => {
    authState.user.role = 'super_admin';

    render(
      <MemoryRouter initialEntries={['/onboarding']}>
        <Routes>
          <Route element={<OnboardingAccessRoute />}>
            <Route path="/onboarding" element={<div>Onboarding page</div>} />
          </Route>
          <Route path="/dashboard" element={<div>Home page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Onboarding page')).not.toBeInTheDocument();
    expect(screen.queryByText('Home page')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Onboarding is only for company admins' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to my home/i })).toHaveAttribute('href', '/dashboard/companies');
  });

  it('shows feature feedback when property import feature is disabled', () => {
    featureState.isFeatureEnabled.mockImplementation((featureKey?: string) => featureKey === 'analytics');

    render(
      <MemoryRouter initialEntries={['/dashboard/properties/import']}>
        <Routes>
          <Route element={<FeatureRoute featureKey={PROPERTY_MANAGEMENT_FEATURE_KEY} />}>
            <Route path="/dashboard/properties/import" element={<div>Property import page</div>} />
          </Route>
          <Route path="/dashboard" element={<div>Home page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Property import page')).not.toBeInTheDocument();
    expect(screen.queryByText('Home page')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'This feature is turned off' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to my home/i })).toHaveAttribute('href', '/dashboard');
  });

  it('renders profile without waiting for onboarding status', async () => {
    apiMock.get.mockImplementation(() => new Promise(() => {}));

    render(
      <MemoryRouter initialEntries={['/dashboard/profile']}>
        <Routes>
          <Route element={<OnboardingGuard />}>
            <Route path="/dashboard/profile" element={<div>Profile page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Profile page')).toBeInTheDocument();
  });

  it('redirects company_admin to onboarding when onboarding is incomplete', async () => {
    apiMock.get.mockResolvedValue({
      data: {
        data: {
          completedSteps: [1, 2, 3],
        },
      },
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<OnboardingGuard />}>
            <Route path="/" element={<div>Dashboard page</div>} />
          </Route>
          <Route path="/onboarding" element={<div>Onboarding page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Onboarding page')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard page')).not.toBeInTheDocument();
  });

  it('allows dashboard when onboarding completion is cached and status check fails', async () => {
    localStorage.setItem(getOnboardingCompletionCacheKey('company-1'), '1');
    apiMock.get.mockRejectedValue(new Error('Network error'));

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<OnboardingGuard />}>
            <Route path="/" element={<div>Dashboard page</div>} />
          </Route>
          <Route path="/onboarding" element={<div>Onboarding page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Dashboard page')).toBeInTheDocument();
    expect(screen.queryByText('Onboarding page')).not.toBeInTheDocument();
  });

  it('redirects to onboarding when status check fails and no cache exists', async () => {
    apiMock.get.mockRejectedValue(new Error('Network error'));

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<OnboardingGuard />}>
            <Route path="/" element={<div>Dashboard page</div>} />
          </Route>
          <Route path="/onboarding" element={<div>Onboarding page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Onboarding page')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard page')).not.toBeInTheDocument();
  });

  it('redirects to change-password when mustChangePassword is true', async () => {
    authState.mustChangePassword = true;

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<div>Dashboard page</div>} />
            <Route path="/change-password" element={<div>Change password page</div>} />
          </Route>
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Change password page')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard page')).not.toBeInTheDocument();
  });

  it('redirects locked company_admin users to billing', async () => {
    subscriptionState.enforcementEnabled = true;
    subscriptionState.subscription = {
      billingStatus: 'past_due',
      hasAccess: false,
      needsPayment: true,
    };
    subscriptionState.billingStatus = 'past_due';
    subscriptionState.hasAccess = false;
    subscriptionState.needsPayment = true;

    render(
      <MemoryRouter initialEntries={['/dashboard/leads']}>
        <Routes>
          <Route element={<SubscriptionAccessGuard />}>
            <Route path="/dashboard/leads" element={<div>Leads page</div>} />
            <Route path="/dashboard/billing" element={<div>Billing page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Billing page')).toBeInTheDocument();
    expect(screen.queryByText('Leads page')).not.toBeInTheDocument();
  });

  it('allows locked company_admin users to stay on billing', () => {
    subscriptionState.enforcementEnabled = true;
    subscriptionState.subscription = {
      billingStatus: 'suspended',
      hasAccess: false,
      needsPayment: true,
    };
    subscriptionState.billingStatus = 'suspended';
    subscriptionState.hasAccess = false;
    subscriptionState.needsPayment = true;

    render(
      <MemoryRouter initialEntries={['/dashboard/billing']}>
        <Routes>
          <Route element={<SubscriptionAccessGuard />}>
            <Route path="/dashboard/billing" element={<div>Billing page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Billing page')).toBeInTheDocument();
  });

  it('shows payment-required feedback for locked staff users', () => {
    subscriptionState.enforcementEnabled = true;
    authState.user.role = 'sales_agent';
    subscriptionState.subscription = {
      billingStatus: 'past_due',
      hasAccess: false,
      needsPayment: true,
    };
    subscriptionState.billingStatus = 'past_due';
    subscriptionState.hasAccess = false;
    subscriptionState.needsPayment = true;

    render(
      <MemoryRouter initialEntries={['/dashboard/leads']}>
        <Routes>
          <Route element={<SubscriptionAccessGuard />}>
            <Route path="/dashboard/leads" element={<div>Leads page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Leads page')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Workspace locked until billing is restored' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open my profile/i })).toHaveAttribute('href', '/dashboard/profile');
  });

  it('allows locked users through when subscription access enforcement is disabled', () => {
    subscriptionState.enforcementEnabled = false;
    subscriptionState.subscription = {
      billingStatus: 'past_due',
      hasAccess: false,
      needsPayment: true,
    };
    subscriptionState.billingStatus = 'past_due';
    subscriptionState.hasAccess = false;
    subscriptionState.needsPayment = true;

    render(
      <MemoryRouter initialEntries={['/dashboard/leads']}>
        <Routes>
          <Route element={<SubscriptionAccessGuard />}>
            <Route path="/dashboard/leads" element={<div>Leads page</div>} />
            <Route path="/dashboard/billing" element={<div>Billing page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Leads page')).toBeInTheDocument();
    expect(screen.queryByText('Billing page')).not.toBeInTheDocument();
  });
});

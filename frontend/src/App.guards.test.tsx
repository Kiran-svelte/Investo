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
} from './App';
import { getOnboardingCompletionCacheKey } from './utils/onboardingCompletionCache';

const { authState, featureState, apiMock } = vi.hoisted(() => ({
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
  apiMock: {
    get: vi.fn(),
  },
}));

vi.mock('./context/AuthContext', () => ({
  useAuth: () => authState,
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('./hooks/useCompanyFeatures', () => ({
  default: () => featureState,
}));

vi.mock('./services/api', () => ({
  default: apiMock,
}));

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
  });

  it('blocks onboarding route for disallowed roles', () => {
    authState.user.role = 'sales_agent';

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

    expect(screen.queryByText('Onboarding page')).not.toBeInTheDocument();
    expect(screen.getByText('Home page')).toBeInTheDocument();
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

  it('blocks property import route when property management feature is disabled', () => {
    featureState.isFeatureEnabled.mockImplementation((featureKey?: string) => featureKey === 'analytics');

    render(
      <MemoryRouter initialEntries={['/properties/import']}>
        <Routes>
          <Route element={<FeatureRoute featureKey={PROPERTY_MANAGEMENT_FEATURE_KEY} />}>
            <Route path="/properties/import" element={<div>Property import page</div>} />
          </Route>
          <Route path="/" element={<div>Home page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Property import page')).not.toBeInTheDocument();
    expect(screen.getByText('Home page')).toBeInTheDocument();
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
});

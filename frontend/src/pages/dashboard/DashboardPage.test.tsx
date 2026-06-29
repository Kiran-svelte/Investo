/* @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESOLUTION_IDS } from '../../constants/resolutionIds';
import DashboardPage from './DashboardPage';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
  },
}));

vi.mock('../../services/api', () => ({
  default: apiMock,
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      name: 'Company Admin',
      email: 'admin@example.com',
      role: 'company_admin',
      company_id: 'company-1',
    },
  }),
}));

vi.mock('../../hooks/useCompanyFeatures', () => ({
  default: () => ({
    loading: false,
    isFeatureEnabled: (key: string) => key === 'analytics',
  }),
}));

vi.mock('../../services/clarity', () => ({
  trackClarityEvent: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'dashboard.title': 'Dashboard',
        'common.welcome': 'Welcome',
        'common.today': 'Today',
        'common.this_week': 'This Week',
        'common.this_month': 'This Month',
        'dashboard.leads_today': 'Leads Today',
        'dashboard.visits_scheduled': 'Visits Scheduled',
        'dashboard.deals_closed': 'Deals Closed',
        'dashboard.conversion_rate': 'Conversion Rate',
        'dashboard.ai_conversations': 'AI Conversations',
        'dashboard.revenue': 'Revenue',
        'dashboard.recent_leads': 'Recent Leads',
        'dashboard.upcoming_visits': 'Upcoming Visits',
        'common.vs_last_period': 'vs last period',
      };
      return labels[key] ?? key;
    },
  }),
}));

describe('DashboardPage analytics compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/analytics/dashboard-bundle') {
        return Promise.reject({
          isAxiosError: true,
          response: { status: 404, data: { error: 'Endpoint not found' } },
          message: 'Request failed with status code 404',
        });
      }
      if (url === '/analytics/dashboard') {
        return Promise.resolve({
          data: {
            data: {
              leads_today: 2,
              leads_total: 10,
              visits_scheduled: 1,
              visits_completed: 0,
              deals_closed: 0,
              conversion_rate: 0,
              ai_conversations: 4,
              revenue: 0,
            },
          },
        });
      }
      if (url === '/analytics/trends') {
        return Promise.resolve({
          data: { data: { leads: 0, visits: 0, deals: 0, conversations: 0 } },
        });
      }
      if (url === '/analytics/recent-leads' || url === '/analytics/upcoming-visits') {
        return Promise.resolve({ data: { data: [] } });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('falls back to stable analytics endpoints when dashboard bundle is not deployed', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(apiMock.get).toHaveBeenCalledWith('/analytics/dashboard', { params: { period: 'week' } });
    });

    expect(apiMock.get).toHaveBeenCalledWith('/analytics/recent-leads');
    expect(apiMock.get).toHaveBeenCalledWith('/analytics/upcoming-visits');
    expect(screen.queryByText(/Endpoint not found/i)).not.toBeInTheDocument();
    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(document.querySelector(
      `[data-resolution-id="${RESOLUTION_IDS.DASHBOARD_BUNDLE_FALLBACK}"]`,
    )).toBeInTheDocument();
  });
});

/* @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationBell from './NotificationBell';

const { apiMock, featureState, tenantState } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    put: vi.fn(),
  },
  featureState: {
    isFeatureEnabled: vi.fn(),
  },
  tenantState: {
    targetCompanyId: null as string | null,
    targetCompanyName: null as string | null,
    isPlatformAdmin: false,
    setTargetCompany: vi.fn(),
    clearTargetCompany: vi.fn(),
  },
}));

vi.mock('../../services/api', () => ({
  default: apiMock,
}));

vi.mock('../../hooks/useCompanyFeatures', () => ({
  default: () => featureState,
}));

vi.mock('../../context/TenantContext', () => ({
  useTenantContext: () => tenantState,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

function renderBell() {
  render(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>,
  );
}

describe('NotificationBell tenant polling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.get.mockResolvedValue({
      data: {
        data: {
          notifications: [],
          unreadCount: 0,
        },
      },
    });
    featureState.isFeatureEnabled.mockReturnValue(true);
    tenantState.targetCompanyId = null;
    tenantState.targetCompanyName = null;
    tenantState.isPlatformAdmin = false;
  });

  afterEach(() => {
    cleanup();
  });

  it('does not poll tenant notifications for platform admin before agency selection', () => {
    tenantState.isPlatformAdmin = true;
    tenantState.targetCompanyId = null;

    renderBell();

    expect(screen.queryByRole('button', { name: 'Notifications' })).not.toBeInTheDocument();
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it('polls notifications for platform admin after agency selection', async () => {
    tenantState.isPlatformAdmin = true;
    tenantState.targetCompanyId = 'company-1';

    renderBell();

    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    await waitFor(() => {
      expect(apiMock.get).toHaveBeenCalledWith('/notifications?page=1&limit=8');
    });
  });

  it('keeps tenant users on normal feature-gated notification polling', async () => {
    tenantState.isPlatformAdmin = false;
    featureState.isFeatureEnabled.mockImplementation((key?: string) => key === 'notifications');

    renderBell();

    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    await waitFor(() => {
      expect(apiMock.get).toHaveBeenCalledWith('/notifications?page=1&limit=8');
    });
  });
});

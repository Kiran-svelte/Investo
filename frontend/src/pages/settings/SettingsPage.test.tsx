/* @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './SettingsPage';

const { apiMock, authState } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
  authState: {
    user: {
      id: 'user-1',
      name: 'Platform User',
      email: 'platform@example.com',
      role: 'super_admin' as string,
      company_id: null as string | null,
    },
  },
}));

vi.mock('../../services/api', () => ({
  default: apiMock,
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('../../hooks/useConfirmDialog', () => ({
  default: () => ({
    confirm: vi.fn(),
    Dialog: null,
  }),
}));

vi.mock('../../components/settings/LeadRoutingSettings', () => ({
  default: () => <div data-testid="lead-routing-settings" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

describe('SettingsPage role API mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = {
      id: 'user-1',
      name: 'Platform User',
      email: 'platform@example.com',
      role: 'super_admin',
      company_id: null,
    };
    apiMock.get.mockResolvedValue({
      data: {
        data: {
          name: 'Agency',
          description: '',
          whatsapp_phone: '',
          primary_color: '#3B82F6',
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows account-only settings for platform admin without tenant settings API calls', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Platform admin: manage agencies under/i)).toBeInTheDocument();
    expect(screen.getByText('Platform User')).toBeInTheDocument();
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it('loads editable tenant settings for company admin', async () => {
    authState.user = {
      id: 'admin-1',
      name: 'Company Admin',
      email: 'admin@example.com',
      role: 'company_admin',
      company_id: 'company-1',
    };

    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(apiMock.get).toHaveBeenCalledWith('/onboarding/setup');
    });
    expect(screen.getByText('settings.companyProfile')).toBeInTheDocument();
  });
});

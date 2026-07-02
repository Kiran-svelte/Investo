/* @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CopilotPage from './CopilotPage';

const { apiMock, authState, tenantState } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    post: vi.fn(),
  },
  authState: {
    user: {
      id: 'admin-1',
      role: 'company_admin' as string,
    },
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

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('../../context/TenantContext', () => ({
  useTenantContext: () => tenantState,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

describe('CopilotPage platform tenant guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.get.mockResolvedValue({
      data: {
        data: {
          messages: [],
        },
      },
    });
    authState.user.role = 'company_admin';
    tenantState.isPlatformAdmin = false;
    tenantState.targetCompanyId = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('does not call tenant copilot history for platform admin before agency selection', () => {
    authState.user.role = 'super_admin';
    tenantState.isPlatformAdmin = true;
    tenantState.targetCompanyId = null;

    render(<CopilotPage />);

    expect(screen.getByText('Select an agency in Tenant context before using Copilot.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ask copilot…')).toBeDisabled();
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it('loads tenant copilot history after platform admin selects an agency', async () => {
    authState.user.role = 'super_admin';
    tenantState.isPlatformAdmin = true;
    tenantState.targetCompanyId = 'company-1';

    render(<CopilotPage />);

    await waitFor(() => {
      expect(apiMock.get).toHaveBeenCalledWith('/copilot/history');
    });
    expect(screen.getByPlaceholderText('Ask copilot…')).not.toBeDisabled();
  });
});

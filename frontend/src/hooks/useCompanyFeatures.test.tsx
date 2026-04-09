/* @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCompanyFeatures } from './useCompanyFeatures';

const { authState, apiGetMock } = vi.hoisted(() => ({
  authState: {
    isAuthenticated: true,
    user: {
      id: 'user-1',
      name: 'Admin',
      email: 'admin@investo.in',
      role: 'company_admin',
      company_id: 'company-1',
    },
  },
  apiGetMock: vi.fn(),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('../services/api', () => ({
  default: {
    get: apiGetMock,
  },
}));

describe('useCompanyFeatures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.isAuthenticated = true;
    authState.user = {
      id: 'user-1',
      name: 'Admin',
      email: 'admin@investo.in',
      role: 'company_admin',
      company_id: 'company-1',
    };
  });

  it('fails closed for unknown feature keys', async () => {
    apiGetMock.mockResolvedValueOnce({
      data: {
        data: [{ key: 'analytics', enabled: true }],
      },
    });

    const { result } = renderHook(() => useCompanyFeatures());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isFeatureEnabled('analytics')).toBe(true);
    expect(result.current.isFeatureEnabled('property_management')).toBe(false);
  });

  it('returns explicit error and denies features when fetch fails', async () => {
    apiGetMock.mockRejectedValueOnce(new Error('network failure'));

    const { result } = renderHook(() => useCompanyFeatures());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Failed to load company features');
    expect(result.current.isFeatureEnabled('analytics')).toBe(false);
  });
});

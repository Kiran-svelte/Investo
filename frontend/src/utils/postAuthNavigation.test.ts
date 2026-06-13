import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolvePostAuthPath } from './postAuthNavigation';

vi.mock('../services/api', () => ({
  default: {
    get: vi.fn(),
  },
}));

import api from '../services/api';

describe('postAuthNavigation', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it('sends company_admin with incomplete onboarding to /onboarding', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { data: { completedSteps: [1, 2] } },
    });

    await expect(resolvePostAuthPath({
      role: 'company_admin',
      company_id: 'company-1',
      must_change_password: false,
    })).resolves.toBe('/onboarding');
  });

  it('sends company_admin with completed onboarding to dashboard', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { data: { completedSteps: [1, 2, 3, 4, 5, 6] } },
    });

    await expect(resolvePostAuthPath({
      role: 'company_admin',
      company_id: 'company-1',
      must_change_password: false,
    })).resolves.toBe('/dashboard');
  });

  it('keeps must-change-password users on change-password route', async () => {
    await expect(resolvePostAuthPath({
      role: 'company_admin',
      company_id: 'company-1',
      must_change_password: true,
    })).resolves.toBe('/change-password');
  });
});

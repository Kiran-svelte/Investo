/// <reference types="jest" />

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    features: { sso: true },
    identity: {
      ssoTestIdp: true,
      ssoCallbackBaseUrl: 'https://api.test',
    },
  },
}));

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    companyIdentityConfig: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
  },
}));

jest.mock('../../identity/identityConfig.service', () => ({
  resolveCompanyByEmailDomain: jest.fn().mockResolvedValue({
    companyId: 'company-1',
    config: { sso_enabled: true },
  }),
}));

jest.mock('../../services/auth.service', () => ({
  authService: {
    issueTokensForUser: jest.fn().mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: '1h',
    }),
  },
  normalizeAuthEmail: (email: string) => email.trim().toLowerCase(),
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import prisma from '../../config/prisma';
import { SsoService } from '../../identity/sso/sso.service';

describe('sso.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts test IdP login redirect for allowed domain', async () => {
    const service = new SsoService();
    const result = await service.startLogin('agent@acme.test');
    expect(result.redirect_url).toContain('/api/auth/sso/callback');
    expect(result.redirect_url).toContain('test=1');
    expect(result.state).toHaveLength(48);
  });

  it('creates or links user on test callback', async () => {
    (prisma as any).user.findFirst.mockResolvedValueOnce(null);
    (prisma as any).user.create.mockResolvedValueOnce({
      id: 'user-1',
      companyId: 'company-1',
      email: 'agent@acme.test',
    });

    const service = new SsoService();
    const tokens = await service.completeCallback({
      email: 'agent@acme.test',
      name: 'Agent',
      external_id: 'test:agent@acme.test',
    });

    expect(tokens.accessToken).toBe('access');
    expect((prisma as any).auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'sso_login' }),
    });
  });
});

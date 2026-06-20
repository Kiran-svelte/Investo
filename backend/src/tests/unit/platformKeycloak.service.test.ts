/// <reference types="jest" />

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    keycloak: {
      enabled: true,
      baseUrl: 'https://keycloak.example.com',
      realm: 'investo',
      clientId: 'investo-app',
      clientSecret: 'secret',
      ssoAllTenants: true,
    },
    features: { sso: true },
  },
}));

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('../../identity/identityConfig.service', () => ({
  getCompanyIdentityConfig: jest.fn().mockResolvedValue({ sso_enabled: true }),
  resolveCompanyByEmailDomain: jest.fn(),
}));

import prisma from '../../config/prisma';
import {
  getPlatformKeycloakOidcConfig,
  isPlatformKeycloakEnabled,
  resolveCompanyForSsoLogin,
} from '../../identity/keycloak/platformKeycloak.service';

describe('platformKeycloak.service', () => {
  it('returns platform OIDC config when enabled', () => {
    expect(isPlatformKeycloakEnabled()).toBe(true);
    expect(getPlatformKeycloakOidcConfig()).toEqual({
      publicUrl: 'https://keycloak.example.com',
      realm: 'investo',
      issuer: 'https://keycloak.example.com/realms/investo',
      clientId: 'investo-app',
      clientSecret: 'secret',
    });
  });

  it('resolves company by active user email when Keycloak is enabled', async () => {
    (prisma as any).user.findFirst.mockResolvedValueOnce({ companyId: 'company-1' });
    const result = await resolveCompanyForSsoLogin('agent@acme.test');
    expect(result?.companyId).toBe('company-1');
  });
});

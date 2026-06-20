/// <reference types="jest" />

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { buildOidcAuthorizeUrl, fetchOidcDiscovery } from '../../identity/sso/ssoOidc.service';

describe('ssoOidc.service', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('builds authorize URL from discovery document', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        issuer: 'https://issuer.example.com',
        authorization_endpoint: 'https://issuer.example.com/oauth2/authorize',
        token_endpoint: 'https://issuer.example.com/oauth2/token',
        userinfo_endpoint: 'https://issuer.example.com/oauth2/userinfo',
      }),
    }) as typeof fetch;

    const url = await buildOidcAuthorizeUrl({
      issuer: 'https://issuer.example.com/',
      clientId: 'client-id',
      redirectUri: 'https://api.example.com/api/auth/sso/callback',
      state: 'state-123',
      nonce: 'nonce-456',
      loginHint: 'user@example.com',
    });

    expect(url).toContain('https://issuer.example.com/oauth2/authorize');
    expect(url).toContain('client_id=client-id');
    expect(url).toContain('state=state-123');
    expect(url).toContain('login_hint=user%40example.com');
  });

  it('throws when discovery fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as typeof fetch;

    await expect(fetchOidcDiscovery('https://missing.example.com')).rejects.toThrow(/OIDC discovery failed/);
  });
});

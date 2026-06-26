/// <reference types="jest" />

import express, { Express } from 'express';
import request from 'supertest';

function createSsoApp(configOverrides: Record<string, unknown> = {}): {
  app: Express;
  completeCallback: jest.Mock;
} {
  jest.resetModules();

  const completeCallback = jest.fn().mockResolvedValue({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
  });

  jest.doMock('../../config', () => ({
    __esModule: true,
    default: {
      env: 'production',
      frontend: { baseUrl: 'https://app.example' },
      identity: {
        ssoTestIdp: true,
        ssoCallbackBaseUrl: 'https://api.example',
      },
      ...configOverrides,
    },
  }));

  jest.doMock('../../config/logger', () => ({
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  }));

  jest.doMock('../../config/prisma', () => ({
    __esModule: true,
    default: {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'user-1',
          companyId: 'company-1',
          email: 'admin@example.com',
          role: 'company_admin',
          name: 'Admin Example',
          mustChangePassword: false,
        }),
      },
    },
  }));

  jest.doMock(
    '../../identity/sso/sso.service',
    () => ({
      __esModule: true,
      ssoService: {
        startLogin: jest.fn(),
        completeOidcCallback: jest.fn(),
        completeCallback,
      },
    }),
    { virtual: true },
  );

  jest.doMock(
    '../../identity/keycloak/platformKeycloak.service',
    () => ({
      __esModule: true,
      getPublicSsoConfig: jest.fn().mockReturnValue({
        keycloak_enabled: false,
        keycloak_url: null,
        realm: null,
        login_hint_supported: true,
      }),
    }),
    { virtual: true },
  );

  jest.doMock('../../utils/authSessionCookies.util', () => ({
    __esModule: true,
    setAuthSessionCookies: jest.fn(),
    authSessionResponseMeta: jest.fn().mockReturnValue({ cookie: true }),
  }));

  let ssoRoutes: any;
  jest.isolateModules(() => {
    ssoRoutes = require('../../identity/sso/sso.routes').default;
  });

  const app = express();
  app.use('/api/auth/sso', ssoRoutes);
  return { app, completeCallback };
}

describe('sso routes', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('blocks test SSO callback in production even when SSO_TEST_IDP is enabled', async () => {
    const { app, completeCallback } = createSsoApp();

    const response = await request(app)
      .get('/api/auth/sso/callback?test=1&format=json&email=admin@example.com')
      .set('Accept', 'application/json');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'SSO test callback is not available' });
    expect(completeCallback).not.toHaveBeenCalled();
  });

  test('allows test SSO callback outside production when explicitly enabled', async () => {
    const { app, completeCallback } = createSsoApp({
      env: 'test',
      identity: {
        ssoTestIdp: true,
        ssoCallbackBaseUrl: 'https://api.example',
      },
    });

    const response = await request(app)
      .get('/api/auth/sso/callback?test=1&format=json&email=admin@example.com&name=Admin')
      .set('Accept', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.tokens).toEqual({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    });
    expect(completeCallback).toHaveBeenCalledWith({
      email: 'admin@example.com',
      name: 'Admin',
      external_id: 'test:admin@example.com',
    });
  });
});

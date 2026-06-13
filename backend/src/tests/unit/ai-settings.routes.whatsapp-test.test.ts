/// <reference types="jest" />

import express, { Express } from 'express';
import request from 'supertest';

const noopMiddleware = () => (_req: any, _res: any, next: any) => next();

type WhatsAppServiceMock = {
  testConnection: jest.Mock;
};

function createAiSettingsApp(params: {
  config: any;
  whatsappService: WhatsAppServiceMock;
}): { app: Express; whatsappService: WhatsAppServiceMock } {
  jest.resetModules();

  jest.doMock('../../config', () => ({
    __esModule: true,
    default: params.config,
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

  // Route module imports prisma even if this endpoint doesn't use it.
  jest.doMock('../../config/prisma', () => ({
    __esModule: true,
    default: {
      aiSetting: {
        findUnique: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
      },
      company: {
        findUnique: jest.fn().mockResolvedValue({ id: 'company-1', settings: {} }),
        update: jest.fn().mockResolvedValue({ id: 'company-1' }),
      },
    },
  }));

  jest.doMock('../../middleware/auth', () => ({
    __esModule: true,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { id: 'user-1', company_id: 'company-1', companyId: 'company-1', role: 'company_admin' };
      next();
    },
  }));

  jest.doMock('../../middleware/tenant', () => ({
    __esModule: true,
    tenantIsolation: noopMiddleware(),
    strictTenantIsolation: (req: any, _res: any, next: any) => {
      req.companyId = 'company-1';
      next();
    },
    getCompanyId: (req: any) => req.companyId || 'company-1',
  }));

  jest.doMock('../../middleware/featureGate', () => ({
    __esModule: true,
    requireFeature: () => noopMiddleware(),
  }));

  jest.doMock('../../middleware/rbac', () => ({
    __esModule: true,
    authorize: () => noopMiddleware(),
    hasRole: () => noopMiddleware(),
  }));

  jest.doMock('../../middleware/audit', () => ({
    __esModule: true,
    auditLog: () => noopMiddleware(),
  }));

  jest.doMock('../../middleware/validate', () => ({
    __esModule: true,
    validate: () => noopMiddleware(),
  }));

  jest.doMock('../../services/whatsapp.service', () => ({
    __esModule: true,
    whatsappService: params.whatsappService,
  }));

  let router: any;
  jest.isolateModules(() => {
    router = require('../../routes/ai-settings.routes').default;
  });

  const app = express();
  app.use(express.json());
  app.use('/api/ai-settings', router);

  return { app, whatsappService: params.whatsappService };
}

describe('POST /api/ai-settings/whatsapp/test (provider-aware)', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('meta provider requires phone_number_id and access_token and passes them through', async () => {
    const whatsappService: WhatsAppServiceMock = {
      testConnection: jest.fn().mockResolvedValue({ success: true }),
    };

    const { app } = createAiSettingsApp({
      config: {
        env: 'test',
        whatsapp: { provider: 'meta', apiUrl: 'https://graph.facebook.com/v18.0' },
      },
      whatsappService,
    });

    const response = await request(app)
      .post('/api/ai-settings/whatsapp/test')
      .send({ phone_number_id: '123456789', access_token: 'token-abc' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, provider: 'meta', message: 'WhatsApp connection successful' });
    expect(whatsappService.testConnection).toHaveBeenCalledTimes(1);
    expect(whatsappService.testConnection).toHaveBeenCalledWith({
      provider: 'meta',
      phoneNumberId: '123456789',
      accessToken: 'token-abc',
      verifyToken: '',
    });
  });

  test('returns 400 when meta credentials are missing even if an unsupported provider is requested', async () => {
    const whatsappService: WhatsAppServiceMock = {
      testConnection: jest.fn().mockResolvedValue({ success: true }),
    };

    const { app } = createAiSettingsApp({
      config: {
        env: 'test',
        whatsapp: { provider: 'meta', apiUrl: 'https://graph.facebook.com/v18.0' },
      },
      whatsappService,
    });

    // Server must always require Meta credentials regardless of what `provider` value is sent in the body.
    const response = await request(app)
      .post('/api/ai-settings/whatsapp/test')
      .send({ provider: 'unsupported_provider' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: 'phone_number_id and access_token are required',
    });
    expect(whatsappService.testConnection).not.toHaveBeenCalled();
  });
});

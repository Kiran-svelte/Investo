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
    },
  }));

  jest.doMock('../../middleware/auth', () => ({
    __esModule: true,
    authenticate: noopMiddleware(),
  }));

  jest.doMock('../../middleware/tenant', () => ({
    __esModule: true,
    tenantIsolation: noopMiddleware(),
    getCompanyId: () => 'company-1',
  }));

  jest.doMock('../../middleware/featureGate', () => ({
    __esModule: true,
    requireFeature: () => noopMiddleware(),
  }));

  jest.doMock('../../middleware/rbac', () => ({
    __esModule: true,
    authorize: () => noopMiddleware(),
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
        greenapi: { apiUrl: 'https://api.green-api.com', idInstance: '1', apiTokenInstance: 't' },
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

  test('greenapi provider requires id_instance and api_token_instance and passes them through', async () => {
    const whatsappService: WhatsAppServiceMock = {
      testConnection: jest.fn().mockResolvedValue({ success: true }),
    };

    const { app } = createAiSettingsApp({
      config: {
        env: 'test',
        whatsapp: { provider: 'greenapi', apiUrl: 'https://graph.facebook.com/v18.0' },
        greenapi: { apiUrl: 'https://api.green-api.com', idInstance: '1100000001', apiTokenInstance: 'token-abc' },
      },
      whatsappService,
    });

    const response = await request(app)
      .post('/api/ai-settings/whatsapp/test')
      .send({ provider: 'greenapi', id_instance: '1100000001', api_token_instance: 'token-abc' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, provider: 'greenapi', message: 'WhatsApp connection successful' });
    expect(whatsappService.testConnection).toHaveBeenCalledTimes(1);
    expect(whatsappService.testConnection).toHaveBeenCalledWith({
      provider: 'greenapi',
      phoneNumberId: '',
      accessToken: '',
      verifyToken: '',
      idInstance: '1100000001',
      apiTokenInstance: 'token-abc',
    });
  });

  test('greenapi provider returns 400 when credentials are missing', async () => {
    const whatsappService: WhatsAppServiceMock = {
      testConnection: jest.fn().mockResolvedValue({ success: true }),
    };

    const { app } = createAiSettingsApp({
      config: {
        env: 'test',
        whatsapp: { provider: 'greenapi', apiUrl: 'https://graph.facebook.com/v18.0' },
        greenapi: { apiUrl: 'https://api.green-api.com', idInstance: '', apiTokenInstance: '' },
      },
      whatsappService,
    });

    const response = await request(app).post('/api/ai-settings/whatsapp/test').send({ provider: 'greenapi' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: 'id_instance and api_token_instance are required',
    });
    expect(whatsappService.testConnection).not.toHaveBeenCalled();
  });
});

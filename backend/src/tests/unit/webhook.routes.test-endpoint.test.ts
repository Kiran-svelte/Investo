/// <reference types="jest" />

import express from 'express';
import request from 'supertest';

describe('POST /api/webhook/test provider routing', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('auto-switches to greenapi provider when resolved id matches company Green-API instance', async () => {
    jest.doMock('../../config', () => ({
      __esModule: true,
      default: {
        env: 'development',
        whatsapp: { provider: 'meta', phoneNumberId: '' },
      },
    }));

    jest.doMock('../../config/logger', () => ({
      __esModule: true,
      default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    jest.doMock('../../middleware/whatsappSecurity', () => ({
      __esModule: true,
      whatsappIpWhitelist: (_req: any, _res: any, next: any) => next(),
    }));

    const handleIncomingMessage = jest.fn().mockResolvedValue({ status: 'processed', propagation: { status: 'success' } });
    jest.doMock('../../services/whatsapp.service', () => ({
      __esModule: true,
      whatsappService: { handleIncomingMessage },
    }));

    const prismaMock = {
      company: {
        findMany: jest.fn().mockResolvedValue([
          {
            settings: {
              whatsapp: {
                provider: 'greenapi',
                greenapi: { idInstance: '1100000001' },
              },
            },
          },
        ]),
      },
      lead: { findFirst: jest.fn().mockResolvedValue({ id: 'lead-1' }) },
      conversation: { findFirst: jest.fn().mockResolvedValue({ id: 'conv-1' }) },
      message: { findMany: jest.fn().mockResolvedValue([]) },
    };
    jest.doMock('../../config/prisma', () => ({ __esModule: true, default: prismaMock }));

    let router: any;
    jest.isolateModules(() => {
      router = require('../../routes/webhook.routes').default;
    });

    const app = express();
    app.use('/api/webhook', router);

    const response = await request(app)
      .post('/api/webhook/test')
      .send({ phone: '+919999111222', message: 'hello' });

    expect(response.status).toBe(200);
    expect(handleIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'greenapi',
        phoneNumberId: '1100000001',
      }),
    );
  });
});

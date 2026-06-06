/// <reference types="jest" />

import express, { Express } from 'express';
import request from 'supertest';

jest.setTimeout(30000);

type Role = 'company_admin' | 'sales_agent' | 'viewer';

function createApp(role: Role): Express {
  jest.resetModules();

  jest.doMock('../../config/prisma', () => ({
    __esModule: true,
    default: {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'user-1',
          name: 'Test User',
          phone: '+919999999999',
          companyId: 'company-1',
          role,
        }),
      },
      company: {
        findFirst: jest.fn().mockResolvedValue({ name: 'Demo Realty' }),
      },
    },
  }));

  jest.doMock('../../config/logger', () => ({
    __esModule: true,
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  }));

  jest.doMock('../../middleware/auth', () => ({
    __esModule: true,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = {
        id: 'user-1',
        company_id: 'company-1',
        companyId: 'company-1',
        role,
        email: 'user@investo.in',
        name: 'Test User',
      };
      next();
    },
  }));

  jest.doMock('../../services/agent/agent-router.service', () => ({
    __esModule: true,
    handleAgentMessage: jest.fn().mockResolvedValue({
      text: 'Visits today: 2 scheduled.',
      replyKind: 'crm',
    }),
  }));

  let routes: any;
  jest.isolateModules(() => {
    routes = require('../../routes/copilot.routes').default;
  });

  const app = express();
  app.use(express.json());
  app.use('/api/copilot', routes);
  return app;
}

describe('copilot routes', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('returns 200 with reply for company_admin', async () => {
    const app = createApp('company_admin');
    const res = await request(app)
      .post('/api/copilot/chat')
      .send({ message: 'visits today' });

    expect(res.status).toBe(200);
    expect(res.body.data.reply).toContain('Visits today');
    expect(res.body.data.replyKind).toBe('crm');
  });

  it('returns 200 for viewer (read-only copilot)', async () => {
    const app = createApp('viewer');
    const res = await request(app)
      .post('/api/copilot/chat')
      .send({ message: 'visits today' });

    expect(res.status).toBe(200);
    expect(res.body.data.reply).toBeTruthy();
  });

  it('rejects empty message', async () => {
    const app = createApp('company_admin');
    const res = await request(app).post('/api/copilot/chat').send({ message: '   ' });
    expect(res.status).toBe(400);
  });
});

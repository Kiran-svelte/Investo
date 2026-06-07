/// <reference types="jest" />

import express, { Express } from 'express';
import request from 'supertest';

jest.setTimeout(30000);

type Role = 'company_admin' | 'sales_agent' | 'viewer' | 'guest';

interface AppOptions {
  role?: Role;
  authed?: boolean;
  copilotEnabled?: boolean;
  history?: Array<{ role: string; content: string; createdAt: Date }>;
}

function createApp(opts: AppOptions = {}): Express {
  const { role = 'company_admin', authed = true, copilotEnabled = true, history = [] } = opts;
  jest.resetModules();

  // Drive the kill-switch through config env before config is (re)loaded.
  if (copilotEnabled) {
    delete process.env.AGENT_AI_COPILOT_ENABLED;
  } else {
    process.env.AGENT_AI_COPILOT_ENABLED = 'false';
  }

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
      agentSession: {
        findFirst: jest.fn().mockResolvedValue(history.length ? { id: 'session-1' } : null),
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
      if (authed) {
        req.user = {
          id: 'user-1',
          company_id: 'company-1',
          companyId: 'company-1',
          role,
          email: 'user@investo.in',
          name: 'Test User',
        };
      }
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

  jest.doMock('../../services/agent/agent-session-messages.service', () => ({
    __esModule: true,
    getRecentAgentSessionMessages: jest.fn().mockResolvedValue(history),
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
    delete process.env.AGENT_AI_COPILOT_ENABLED;
  });

  it('returns 200 with reply + quickActions for company_admin', async () => {
    const app = createApp({ role: 'company_admin' });
    const res = await request(app).post('/api/copilot/chat').send({ message: 'visits today' });

    expect(res.status).toBe(200);
    expect(res.body.data.reply).toContain('Visits today');
    expect(res.body.data.replyKind).toBe('crm');
    expect(Array.isArray(res.body.data.quickActions)).toBe(true);
  });

  it('returns 200 for viewer (read-only copilot)', async () => {
    const app = createApp({ role: 'viewer' });
    const res = await request(app).post('/api/copilot/chat').send({ message: 'visits today' });

    expect(res.status).toBe(200);
    expect(res.body.data.reply).toBeTruthy();
  });

  it('rejects empty message', async () => {
    const app = createApp({ role: 'company_admin' });
    const res = await request(app).post('/api/copilot/chat').send({ message: '   ' });
    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    const app = createApp({ authed: false });
    const res = await request(app).post('/api/copilot/chat').send({ message: 'visits today' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a role not permitted', async () => {
    const app = createApp({ role: 'guest' });
    const res = await request(app).post('/api/copilot/chat').send({ message: 'visits today' });
    expect(res.status).toBe(403);
  });

  it('returns 503 when the copilot kill-switch is off', async () => {
    const app = createApp({ role: 'company_admin', copilotEnabled: false });
    const res = await request(app).post('/api/copilot/chat').send({ message: 'visits today' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('COPILOT_DISABLED');
  });

  it('returns recent history for the session', async () => {
    const app = createApp({
      role: 'company_admin',
      history: [
        { role: 'staff', content: 'visits today', createdAt: new Date('2026-06-07T10:00:00Z') },
        { role: 'assistant', content: '2 scheduled', createdAt: new Date('2026-06-07T10:00:01Z') },
      ],
    });
    const res = await request(app).get('/api/copilot/history');
    expect(res.status).toBe(200);
    expect(res.body.data.messages).toHaveLength(2);
    expect(res.body.data.messages[0].role).toBe('user');
    expect(res.body.data.messages[1].role).toBe('assistant');
  });

  it('returns empty history when no session exists', async () => {
    const app = createApp({ role: 'company_admin' });
    const res = await request(app).get('/api/copilot/history');
    expect(res.status).toBe(200);
    expect(res.body.data.messages).toEqual([]);
  });
});

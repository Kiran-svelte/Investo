/// <reference types="jest" />

import express, { Express } from 'express';
import request from 'supertest';

jest.setTimeout(30000);

type Role = 'company_admin' | 'sales_agent' | 'super_admin';

function createApp(role: Role, companyId = 'company-1'): Express {
  jest.resetModules();

  const mockFindMany = jest.fn();
  const mockCount = jest.fn();

  jest.doMock('../../config/prisma', () => ({
    __esModule: true,
    default: {
      agentActionLog: {
        findMany: (...args: unknown[]) => mockFindMany(...args),
        count: (...args: unknown[]) => mockCount(...args),
        findFirst: jest.fn(),
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
        company_id: companyId,
        companyId,
        role,
        email: 'admin@investo.in',
        name: 'Admin',
      };
      next();
    },
  }));

  jest.doMock('../../middleware/tenant', () => ({
    __esModule: true,
    tenantIsolation: noopMiddleware(),
    strictTenantIsolation: noopMiddleware(),
    getCompanyId: (req: any) => req.user?.companyId ?? req.user?.company_id,
  }));

  let routes: any;
  jest.isolateModules(() => {
    routes = require('../../routes/agent-action-log.routes').default;
    (global as any).__agentActionLogMocks = { mockFindMany, mockCount };
  });

  const app = express();
  app.use(express.json());
  app.use('/api/agent-action-logs', routes);
  return app;
}

function getMocks() {
  return (global as any).__agentActionLogMocks as {
    mockFindMany: jest.Mock;
    mockCount: jest.Mock;
  };
}

describe('agent-action-log routes', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('returns paginated logs for company_admin', async () => {
    const app = createApp('company_admin');
    const { mockFindMany, mockCount } = getMocks();
    const createdAt = new Date('2026-06-06T10:00:00.000Z');
    mockFindMany.mockResolvedValue([
      {
        id: 'log-1',
        companyId: 'company-1',
        triggeredBy: 'inbound_message',
        action: 'buyer_workflow',
        actorId: null,
        actorRole: null,
        resourceType: 'lead',
        resourceId: 'lead-1',
        inputs: { workflowId: 'brochure_request' },
        result: 'sent brochure',
        status: 'success',
        errorMessage: null,
        durationMs: 120,
        createdAt,
      },
    ]);
    mockCount.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/agent-action-logs')
      .query({ page: 1, limit: 25, status: 'success' });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].action).toBe('buyer_workflow');
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'company-1', status: 'success' }),
      }),
    );
  });

  it('forbids sales_agent access', async () => {
    const app = createApp('sales_agent');
    const res = await request(app).get('/api/agent-action-logs');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

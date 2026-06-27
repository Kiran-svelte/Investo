/// <reference types="jest" />

import express, { Express, RequestHandler } from 'express';
import request from 'supertest';

const quotaServiceMock = {
  getUsageSnapshot: jest.fn(),
  isEnabled: jest.fn(),
  isHardEnforce: jest.fn(),
};

function noopMiddleware(): RequestHandler {
  return (_req, _res, next) => next();
}

function createQuotaApp(role: 'super_admin' | 'company_admin' = 'super_admin'): Express {
  jest.resetModules();
  jest.clearAllMocks();

  quotaServiceMock.getUsageSnapshot.mockResolvedValue({
    tier: 'enterprise',
    limits: { users: 10 },
    usage: { users: 2 },
  });
  quotaServiceMock.isEnabled.mockReturnValue(true);
  quotaServiceMock.isHardEnforce.mockReturnValue(false);

  jest.doMock('../../middleware/auth', () => ({
    __esModule: true,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = {
        id: role === 'super_admin' ? 'platform-admin-1' : 'company-admin-1',
        role,
        company_id: role === 'super_admin' ? 'platform-company' : 'tenant-company',
      };
      next();
    },
  }));

  jest.doMock('../../middleware/rbac', () => ({
    __esModule: true,
    hasRole: () => noopMiddleware(),
  }));

  jest.doMock('../../services/tenantQuota.service', () => ({
    __esModule: true,
    tenantQuotaService: quotaServiceMock,
  }));

  let quotaRoutes: any;
  jest.isolateModules(() => {
    quotaRoutes = require('../../routes/quota.routes').default;
  });

  const app = express();
  app.use(express.json());
  app.use('/api/quota', quotaRoutes);
  return app;
}

describe('tenant-scoped enterprise routes', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('blocks super_admin quota usage without selected tenant context', async () => {
    const app = createQuotaApp('super_admin');

    const response = await request(app).get('/api/quota/usage');

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Select a tenant company/i);
    expect(quotaServiceMock.getUsageSnapshot).not.toHaveBeenCalled();
  });

  test('uses target_company_id for super_admin quota usage', async () => {
    const app = createQuotaApp('super_admin');

    const response = await request(app).get('/api/quota/usage?target_company_id=tenant-1');

    expect(response.status).toBe(200);
    expect(quotaServiceMock.getUsageSnapshot).toHaveBeenCalledWith('tenant-1');
  });

  test('uses own company for company_admin quota usage', async () => {
    const app = createQuotaApp('company_admin');

    const response = await request(app).get('/api/quota/usage');

    expect(response.status).toBe(200);
    expect(quotaServiceMock.getUsageSnapshot).toHaveBeenCalledWith('tenant-company');
  });
});

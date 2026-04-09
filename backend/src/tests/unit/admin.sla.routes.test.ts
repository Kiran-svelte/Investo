/// <reference types="jest" />

import express, { Express, RequestHandler } from 'express';
import request from 'supertest';

jest.setTimeout(30000);

type MockPrisma = {
  $queryRaw: jest.Mock;
  message: { count: jest.Mock };
  invoice: { count: jest.Mock };
  company: { count: jest.Mock };
  propertyImportJob: { count: jest.Mock };
};

function noopMiddleware(): RequestHandler {
  return (_req, _res, next) => next();
}

function createAdminApp(): { app: Express; mockPrisma: MockPrisma } {
  jest.resetModules();

  const mockPrisma: MockPrisma = {
    $queryRaw: jest.fn(),
    message: { count: jest.fn() },
    invoice: { count: jest.fn() },
    company: { count: jest.fn() },
    propertyImportJob: { count: jest.fn() },
  };

  jest.doMock('../../config/prisma', () => ({
    __esModule: true,
    default: mockPrisma,
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

  jest.doMock('../../middleware/auth', () => ({
    __esModule: true,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = {
        id: 'admin-1',
        company_id: 'company-admin',
        companyId: 'company-admin',
        role: 'super_admin',
        email: 'superadmin@investo.in',
        name: 'Super Admin',
      };
      next();
    },
  }));

  jest.doMock('../../middleware/rbac', () => ({
    __esModule: true,
    hasRole: () => noopMiddleware(),
  }));

  let adminRoutes: any;
  jest.isolateModules(() => {
    adminRoutes = require('../../routes/admin.routes').default;
  });

  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);

  return { app, mockPrisma };
}

describe('admin SLA route', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('returns SLA summary payload with breach flags', async () => {
    const { app, mockPrisma } = createAdminApp();

    mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mockPrisma.message.count
      .mockResolvedValueOnce(1000)
      .mockResolvedValueOnce(3);
    mockPrisma.invoice.count.mockResolvedValue(5);
    mockPrisma.company.count.mockResolvedValue(400);
    mockPrisma.propertyImportJob.count.mockResolvedValue(0);

    const response = await request(app).get('/api/admin/sla');

    expect(response.status).toBe(200);
    expect(response.body.data).toBeDefined();
    expect(response.body.data.sli).toBeDefined();
    expect(response.body.data.targets).toBeDefined();
    expect(response.body.data.breaches).toEqual(
      expect.objectContaining({
        db_latency: expect.any(Boolean),
        message_delivery: expect.any(Boolean),
        billing_overdue_ratio: expect.any(Boolean),
        import_stalls: expect.any(Boolean),
      }),
    );
    expect(response.body.data.sli.message_delivery_success_rate).toBeCloseTo(0.997, 3);
  });
});

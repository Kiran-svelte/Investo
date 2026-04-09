/// <reference types="jest" />

import express, { Express } from 'express';
import request from 'supertest';

jest.setTimeout(30000);

type MockPrisma = {
  invoice: {
    findMany: jest.Mock;
    count: jest.Mock;
    findFirst: jest.Mock;
  };
};

function createInvoiceApp(userRole: string): { app: Express; mockPrisma: MockPrisma } {
  jest.resetModules();

  const mockPrisma: MockPrisma = {
    invoice: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
    },
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
        id: 'user-1',
        company_id: 'company-1',
        companyId: 'company-1',
        role: userRole,
        email: 'user@investo.in',
        name: 'User',
      };
      next();
    },
  }));

  jest.doMock('../../middleware/rbac', () => ({
    __esModule: true,
    hasRole: () => (_req: any, _res: any, next: any) => next(),
  }));

  jest.doMock('../../middleware/audit', () => ({
    __esModule: true,
    auditLog: () => (_req: any, _res: any, next: any) => next(),
  }));

  let invoiceRoutes: any;
  jest.isolateModules(() => {
    invoiceRoutes = require('../../routes/invoice.routes').default;
  });

  const app = express();
  app.use(express.json());
  app.use('/api/subscriptions/invoices', invoiceRoutes);

  return { app, mockPrisma };
}

describe('tenant boundary - invoice routes', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('company admin cannot override company scope using query company_id', async () => {
    const { app, mockPrisma } = createInvoiceApp('company_admin');

    const response = await request(app).get('/api/subscriptions/invoices?company_id=company-2');

    expect(response.status).toBe(200);
    expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'company-1' }),
      }),
    );
  });

  test('super admin can query invoices for a target company', async () => {
    const { app, mockPrisma } = createInvoiceApp('super_admin');

    const response = await request(app).get('/api/subscriptions/invoices?company_id=company-2');

    expect(response.status).toBe(200);
    expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'company-2' }),
      }),
    );
  });

  test('company admin cannot fetch invoice from another company by id', async () => {
    const { app, mockPrisma } = createInvoiceApp('company_admin');

    mockPrisma.invoice.findFirst.mockResolvedValue(null);

    const response = await request(app).get('/api/subscriptions/invoices/invoice-2');

    expect(response.status).toBe(404);
    expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'invoice-2',
          companyId: 'company-1',
        }),
      }),
    );
  });
});

/// <reference types="jest" />

/**
 * Tenant boundary tests for invoice routes.
 *
 * BILLING DISABLED: Invoice routes return 410 Gone for all requests.
 * Tests verify the 410 behavior — no DB access should occur.
 *
 * When billing is re-enabled, restore the original tenant isolation tests
 * from git history (tagged at the commit before billing was disabled).
 */

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

/**
 * Builds a test Express app with the invoice routes wired in.
 *
 * @param userRole - The role to assign the mocked user
 * @returns Express app and Prisma mock
 */
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

  let invoiceRoutes: unknown;
  jest.isolateModules(() => {
    invoiceRoutes = require('../../routes/invoice.routes').default;
  });

  const app = express();
  app.use(express.json());
  app.use('/api/subscriptions/invoices', invoiceRoutes as any);

  return { app, mockPrisma };
}

describe('tenant boundary - invoice routes (billing disabled)', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('all invoice endpoints return 410 Gone when billing is disabled', async () => {
    /**
     * BILLING DISABLED: Invoice routes return 410 for all requests.
     * When billing is re-enabled, replace with the original tenant isolation tests.
     */
    const { app, mockPrisma } = createInvoiceApp('company_admin');

    const listResponse = await request(app).get('/api/subscriptions/invoices?company_id=company-2');
    expect(listResponse.status).toBe(410);
    expect(listResponse.body.error.code).toBe('billing_disabled');

    // No DB access should occur when billing is disabled
    expect(mockPrisma.invoice.findMany).not.toHaveBeenCalled();
  });

  test('super admin also receives 410 when billing is disabled', async () => {
    const { app, mockPrisma } = createInvoiceApp('super_admin');

    const response = await request(app).get('/api/subscriptions/invoices?company_id=company-2');
    expect(response.status).toBe(410);
    expect(response.body.error.code).toBe('billing_disabled');

    expect(mockPrisma.invoice.findMany).not.toHaveBeenCalled();
  });

  test('fetching a specific invoice by id returns 410 when billing is disabled', async () => {
    const { app, mockPrisma } = createInvoiceApp('company_admin');

    const response = await request(app).get('/api/subscriptions/invoices/invoice-2');
    expect(response.status).toBe(410);
    expect(response.body.error.code).toBe('billing_disabled');

    // No DB access occurs
    expect(mockPrisma.invoice.findFirst).not.toHaveBeenCalled();
  });
});

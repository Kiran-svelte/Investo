/// <reference types="jest" />

import express, { Express, RequestHandler } from 'express';
import request from 'supertest';
import { RESOLUTION_IDS } from '../../constants/resolutionIds';

type MockPrisma = {
  company: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
  };
  companySubscription: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
};

type MockBillingService = {
  ensureTrialSubscriptionForCompany: jest.Mock;
  logBillingEvent: jest.Mock;
  suspendForNonPayment: jest.Mock;
  activateSubscription: jest.Mock;
  markPastDue: jest.Mock;
  buildSubscriptionSummary: jest.Mock;
  countBillableSeats: jest.Mock;
};

function noopMiddleware(): RequestHandler {
  return (_req, _res, next) => next();
}

function createBillingAdminApp(): {
  app: Express;
  prisma: MockPrisma;
  billingService: MockBillingService;
} {
  jest.resetModules();

  const prisma: MockPrisma = {
    company: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: 'company-1' }),
    },
    companySubscription: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
  };

  const billingService: MockBillingService = {
    ensureTrialSubscriptionForCompany: jest.fn().mockResolvedValue({
      companyId: 'company-1',
      negotiatedMonthlyPrice: null,
    }),
    logBillingEvent: jest.fn().mockResolvedValue(undefined),
    suspendForNonPayment: jest.fn().mockResolvedValue(undefined),
    activateSubscription: jest.fn().mockResolvedValue(undefined),
    markPastDue: jest.fn().mockResolvedValue(undefined),
    buildSubscriptionSummary: jest.fn(),
    countBillableSeats: jest.fn().mockResolvedValue(1),
  };

  jest.doMock('../../config', () => ({
    __esModule: true,
    default: {
      features: { billing: true },
    },
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

  jest.doMock('../../config/prisma', () => ({
    __esModule: true,
    default: prisma,
  }));

  jest.doMock('../../middleware/auth', () => ({
    __esModule: true,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { id: 'admin-1', role: 'super_admin', email: 'admin@example.com' };
      next();
    },
  }));

  jest.doMock('../../middleware/rbac', () => ({
    __esModule: true,
    hasRole: () => noopMiddleware(),
  }));

  jest.doMock('../../services/billing/subscription.service', () => ({
    __esModule: true,
    ...billingService,
  }));

  let billingAdminRoutes: any;
  jest.isolateModules(() => {
    billingAdminRoutes = require('../../routes/billing-admin.routes').default;
  });

  const app = express();
  app.use(express.json());
  app.use('/api/billing-admin', billingAdminRoutes);
  return { app, prisma, billingService };
}

describe('billing admin routes', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('price update backfills subscription for an existing company without one', async () => {
    const { app, prisma, billingService } = createBillingAdminApp();

    const response = await request(app)
      .patch('/api/billing-admin/companies/company-1/price')
      .send({ negotiated_monthly_price: 2 });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      success: true,
      negotiatedMonthlyPrice: 2,
      subscriptionBackfilled: true,
      resolutionId: RESOLUTION_IDS.BILLING_SUBSCRIPTION_BACKFILL,
    });
    expect(prisma.company.findUnique).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      select: { id: true },
    });
    expect(billingService.ensureTrialSubscriptionForCompany).toHaveBeenCalledWith('company-1', {
      adminId: 'admin-1',
      reason: 'price_update',
      negotiatedMonthlyPrice: 2,
    });
    expect(prisma.companySubscription.update).not.toHaveBeenCalled();
    expect(billingService.logBillingEvent).toHaveBeenCalledWith(
      'company-1',
      'price_updated',
      expect.objectContaining({
        oldPrice: null,
        newPrice: 2,
        adminId: 'admin-1',
        subscriptionBackfilled: true,
        resolutionId: RESOLUTION_IDS.BILLING_SUBSCRIPTION_BACKFILL,
      }),
    );
  });

  test('overview returns complete no-subscription rows for legacy companies', async () => {
    const { app, prisma } = createBillingAdminApp();
    prisma.company.findMany.mockResolvedValueOnce([
      {
        id: 'company-legacy',
        name: 'Legacy Realty',
        slug: 'legacy-realty',
        status: 'active',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        subscription: null,
        _count: { users: 3 },
      },
    ]);

    const response = await request(app).get('/api/billing-admin/overview');

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({
      companyId: 'company-legacy',
      billingStatus: 'no_subscription',
      monthlyTotal: null,
      negotiatedMonthlyPrice: null,
      basePriceMonthly: null,
      includedSeats: null,
      extraSeats: null,
      seatCount: 3,
    });
  });
});

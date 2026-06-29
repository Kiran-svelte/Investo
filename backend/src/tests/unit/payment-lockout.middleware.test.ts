import express, { Express } from 'express';
import request from 'supertest';
import { RESOLUTION_IDS } from '../../constants/resolutionIds';

jest.setTimeout(30000);

function createLockoutApp(options?: { hasAccess?: boolean }): {
  app: Express;
  prisma: { company: { findUnique: jest.Mock } };
} {
  jest.resetModules();

  const prisma = {
    company: {
      findUnique: jest.fn().mockResolvedValue({
        status: 'active',
        subscription: {
          billingStatus: options?.hasAccess === true ? 'active' : 'past_due',
          graceUntil: null,
          trialEndsAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      }),
    },
  };

  jest.doMock('../../config', () => ({
    __esModule: true,
    default: { features: { billing: true } },
  }));

  jest.doMock('../../config/prisma', () => ({
    __esModule: true,
    default: prisma,
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

  jest.doMock('../../services/billing/subscription.service', () => ({
    resolveHasAccess: jest.fn(() => options?.hasAccess === true),
    countBillableSeats: jest.fn(),
    computeMonthlyTotal: jest.fn(),
  }));

  const {
    isSubscriptionRecoveryPath,
    requireActivePaidSubscription,
  } = require('../../middleware/subscriptionEnforcement');

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = {
      id: 'user-1',
      company_id: 'company-1',
      companyId: 'company-1',
      role: 'company_admin',
      email: 'admin@example.com',
      name: 'Admin User',
    };
    next();
  });

  app.use('/api', (req, res, next) => {
    if (isSubscriptionRecoveryPath(req.path)) {
      next();
      return;
    }
    void requireActivePaidSubscription(req as any, res, next);
  });

  app.get('/api/leads', (_req, res) => res.json({ data: [] }));
  app.post('/api/subscriptions/checkout', (_req, res) => res.json({ data: { ok: true } }));

  return { app, prisma };
}

describe('payment lockout middleware', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('blocks product APIs for inactive billing access', async () => {
    const { app } = createLockoutApp({ hasAccess: false });

    const response = await request(app).get('/api/leads');

    expect(response.status).toBe(402);
    expect(response.body.error.code).toBe('subscription_inactive');
    expect(response.body.resolutionId).toBe(RESOLUTION_IDS.PAYMENT_LOCKOUT);
  });

  test('allows subscription checkout recovery path while locked', async () => {
    const { app, prisma } = createLockoutApp({ hasAccess: false });

    const response = await request(app).post('/api/subscriptions/checkout').send({ method: 'upi' });

    expect(response.status).toBe(200);
    expect(response.body.data.ok).toBe(true);
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
  });

  test('allows product APIs when subscription access is active', async () => {
    const { app } = createLockoutApp({ hasAccess: true });

    const response = await request(app).get('/api/leads');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });
});

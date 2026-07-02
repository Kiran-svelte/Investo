import express, { Express } from 'express';
import request from 'supertest';
import { RESOLUTION_IDS } from '../../constants/resolutionIds';

jest.setTimeout(30000);

type TestRole = 'company_admin' | 'sales_agent';
type CheckoutFailure = 'cashfree_account_not_enabled';

function createSubscriptionApp(role: TestRole = 'company_admin', checkoutFailure?: CheckoutFailure): {
  app: Express;
  initiateCheckout: jest.Mock;
  confirmPayment: jest.Mock;
} {
  jest.resetModules();

  class CashfreeConfigurationError extends Error {}
  class CashfreeAccountNotEnabledError extends Error {}

  const initiateCheckout = jest.fn().mockImplementation(() => {
    if (checkoutFailure === 'cashfree_account_not_enabled') {
      return Promise.reject(new CashfreeAccountNotEnabledError('transactions are not enabled'));
    }

    return Promise.resolve({
      paymentId: 'payment-1',
      orderId: 'order-1',
      checkoutUrl: 'https://payments.example.test/order-1',
      amount: 1,
    });
  });
  const confirmPayment = jest.fn().mockResolvedValue(true);

  jest.doMock('../../config', () => ({
    __esModule: true,
    default: { features: { billing: true } },
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
    default: {
      subscriptionPlan: { findUnique: jest.fn() },
    },
  }));

  jest.doMock('../../middleware/auth', () => ({
    authenticate: (req: any, _res: any, next: any) => {
      req.user = {
        id: 'user-1',
        company_id: 'company-1',
        companyId: 'company-1',
        email: 'admin@example.com',
        role,
        name: 'Admin User',
      };
      next();
    },
  }));

  jest.doMock('../../services/billing/subscription.service', () => ({
    ensureInvestoProPlan: jest.fn(),
    getSubscriptionSummary: jest.fn().mockResolvedValue({
      billingStatus: 'past_due',
      hasAccess: false,
      needsPayment: true,
    }),
    startTrialForCompany: jest.fn(),
  }));

  jest.doMock('../../services/billing/checkout.service', () => ({
    initiateCheckout,
    confirmPayment,
  }));

  jest.doMock('../../services/billing/cashfree.service', () => ({
    CashfreeConfigurationError,
    CashfreeAccountNotEnabledError,
  }));

  jest.doMock('../../routes/invoice.routes', () => {
    const router = express.Router();
    router.get('/', (_req, res) => res.json({ data: [] }));
    return { __esModule: true, default: router };
  });

  const subscriptionRoutes = require('../../routes/subscription.routes').default;
  const app = express();
  app.use(express.json());
  app.use('/api/subscriptions', subscriptionRoutes);

  return { app, initiateCheckout, confirmPayment };
}

describe('subscription routes payment lockout recovery', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('company_admin can start checkout without subscriptions:update RBAC', async () => {
    const { app, initiateCheckout } = createSubscriptionApp('company_admin');

    const response = await request(app)
      .post('/api/subscriptions/checkout')
      .send({ method: 'upi' });

    expect(response.status).toBe(200);
    expect(response.body.data.checkoutUrl).toBe('https://payments.example.test/order-1');
    expect(initiateCheckout).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-1',
      method: 'upi',
      customerEmail: 'admin@example.com',
    }));
  });

  test('staff users receive structured billing-admin-required error on checkout', async () => {
    const { app, initiateCheckout } = createSubscriptionApp('sales_agent');

    const response = await request(app)
      .post('/api/subscriptions/checkout')
      .send({ method: 'upi' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('billing_admin_required');
    expect(response.body.resolutionId).toBe(RESOLUTION_IDS.PAYMENT_LOCKOUT);
    expect(initiateCheckout).not.toHaveBeenCalled();
  });

  test('confirm returns structured validation error when order id is missing', async () => {
    const { app, confirmPayment } = createSubscriptionApp('company_admin');

    const response = await request(app).post('/api/subscriptions/confirm').send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('order_id_required');
    expect(response.body.resolutionId).toBe(RESOLUTION_IDS.PAYMENT_LOCKOUT);
    expect(confirmPayment).not.toHaveBeenCalled();
  });

  test('returns exact Cashfree activation blocker when merchant transactions are disabled', async () => {
    const { app, initiateCheckout } = createSubscriptionApp('company_admin', 'cashfree_account_not_enabled');

    const response = await request(app)
      .post('/api/subscriptions/checkout')
      .send({ method: 'upi' });

    expect(response.status).toBe(424);
    expect(response.body.error.code).toBe('payment_gateway_account_not_enabled');
    expect(response.body.message).toContain('Cashfree merchant account is not enabled');
    expect(response.body.resolutionId).toBe(RESOLUTION_IDS.CASHFREE_ACTIVATION);
    expect(initiateCheckout).toHaveBeenCalledTimes(1);
  });
});

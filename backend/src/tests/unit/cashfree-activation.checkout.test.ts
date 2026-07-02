jest.setTimeout(30000);

describe('Cashfree activation checkout behavior', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('does not create invoice or payment rows when Cashfree rejects online order creation', async () => {
    jest.resetModules();

    const prisma = {
      companySubscription: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'subscription-1',
          basePriceMonthly: 1,
          negotiatedMonthlyPrice: null,
          includedSeats: 5,
          perSeatPriceInr: 0,
        }),
      },
      payment: {
        create: jest.fn(),
      },
    };
    const generateSubscriptionInvoice = jest.fn();

    class CashfreeAccountNotEnabledError extends Error {}
    const cashfreeError = new CashfreeAccountNotEnabledError('transactions are not enabled');
    const createCashfreeOrder = jest.fn().mockRejectedValue(cashfreeError);

    jest.doMock('../../config/prisma', () => ({
      __esModule: true,
      default: prisma,
    }));

    jest.doMock('../../config', () => ({
      __esModule: true,
      default: {
        frontend: { baseUrl: 'https://biginvesto.online' },
        apiPublicUrl: 'https://investo-backend-production.up.railway.app',
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

    jest.doMock('../../services/billing/subscription.service', () => ({
      activateSubscription: jest.fn(),
      countBillableSeats: jest.fn().mockResolvedValue(1),
      computeMonthlyTotal: jest.fn().mockReturnValue({ monthlyTotal: 1 }),
      getSubscriptionSummary: jest.fn(),
      logBillingEvent: jest.fn(),
    }));

    jest.doMock('../../services/billing/invoiceGenerator.service', () => ({
      generateSubscriptionInvoice,
      markInvoicePaid: jest.fn(),
    }));

    jest.doMock('../../services/billing/cashfree.service', () => ({
      createCashfreeOrder,
      fetchCashfreeOrder: jest.fn(),
      generateOrderId: jest.fn().mockReturnValue('order-1'),
      isCashfreeConfigured: jest.fn().mockReturnValue(true),
      CashfreeAccountNotEnabledError,
    }));

    const { initiateCheckout } = require('../../services/billing/checkout.service');

    await expect(
      initiateCheckout({
        companyId: 'company-1',
        method: 'upi',
        customerEmail: 'admin@example.com',
        customerName: 'Admin User',
      }),
    ).rejects.toBe(cashfreeError);

    expect(createCashfreeOrder).toHaveBeenCalledTimes(1);
    expect(generateSubscriptionInvoice).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });
});

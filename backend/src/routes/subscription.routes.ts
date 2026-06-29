import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole } from '../middleware/rbac';
import { getCompanyId } from '../middleware/tenant';
import { validate } from '../middleware/validate';
import prisma from '../config/prisma';
import config from '../config';
import logger from '../config/logger';
import invoiceRoutes from './invoice.routes';
import {
  ensureInvestoProPlan,
  getSubscriptionSummary,
  startTrialForCompany,
} from '../services/billing/subscription.service';
import { initiateCheckout, confirmPayment } from '../services/billing/checkout.service';
import { CashfreeConfigurationError } from '../services/billing/cashfree.service';
import { SUBSCRIPTION_PRICING } from '../constants/subscriptionPricing';
import { RESOLUTION_IDS } from '../constants/resolutionIds';

const router = Router();

function billingDisabled(_req: AuthRequest, res: Response): void {
  res.status(410).json({
    error: {
      code: 'billing_disabled',
      message: 'Billing and subscription management is not available.',
    },
    resolutionId: RESOLUTION_IDS.PAYMENT_LOCKOUT,
  });
}

function sendBillingRouteError(
  req: AuthRequest,
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  res.status(status).json({
    error: { code, message },
    code,
    message,
    resolutionId: RESOLUTION_IDS.PAYMENT_LOCKOUT,
    requestId: (req as any).requestId,
  });
}

function requireCompanyBillingSelfService(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role === 'company_admin') {
    next();
    return;
  }

  sendBillingRouteError(
    req,
    res,
    403,
    'billing_admin_required',
    'Only company admins can manage subscription payments.',
  );
}

router.use(authenticate);

router.use('/invoices', invoiceRoutes);

const checkoutSchema = z.object({
  method: z.enum(['card', 'invoice', 'upi', 'bank_transfer']),
});

/** GET /api/subscriptions/status */
router.get('/status', async (req: AuthRequest, res: Response) => {
  if (!config.features.billing) {
    billingDisabled(req, res);
    return;
  }
  try {
    const companyId = getCompanyId(req);
    const summary = await getSubscriptionSummary(companyId);
    if (!summary) {
      res.status(404).json({ error: 'No subscription found' });
      return;
    }
    res.json({ data: summary });
  } catch (err: unknown) {
    logger.error('Failed to fetch subscription status', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch subscription status' });
  }
});

/** GET /api/subscriptions/plans — single Investo Pro plan */
router.get('/plans', async (req: AuthRequest, res: Response) => {
  if (!config.features.billing) {
    billingDisabled(req, res);
    return;
  }
  try {
    const planId = await ensureInvestoProPlan();
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    res.json({
      data: plan
        ? [
            {
              id: plan.id,
              name: plan.name,
              maxAgents: plan.maxAgents,
              maxLeads: plan.maxLeads,
              maxProperties: plan.maxProperties,
              priceMonthly: Number(plan.priceMonthly),
              priceYearly: plan.priceYearly ? Number(plan.priceYearly) : null,
              features: plan.features,
              status: plan.status,
              trialDays: SUBSCRIPTION_PRICING.trialDays,
              includedSeats: SUBSCRIPTION_PRICING.includedSeats,
              perSeatPriceInr: SUBSCRIPTION_PRICING.perSeatPriceInr,
            },
          ]
        : [],
    });
  } catch (err: unknown) {
    logger.error('Failed to fetch plans', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

/** POST /api/subscriptions/checkout — start payment flow */
router.post(
  '/checkout',
  requireCompanyBillingSelfService,
  validate(checkoutSchema),
  async (req: AuthRequest, res: Response) => {
    if (!config.features.billing) {
      billingDisabled(req, res);
      return;
    }
    try {
      const companyId = getCompanyId(req);
      const result = await initiateCheckout({
        companyId,
        method: req.body.method,
        customerEmail: req.user!.email,
        customerName: req.user!.name || 'Agency Admin',
      });
      res.json({ data: result });
    } catch (err: unknown) {
      logger.error('Checkout failed', { error: err instanceof Error ? err.message : String(err) });
      if (err instanceof CashfreeConfigurationError) {
        sendBillingRouteError(
          req,
          res,
          503,
          'payment_gateway_not_configured',
          'Online payments are temporarily unavailable. Choose invoice or bank transfer, or contact support.',
        );
        return;
      }
      if (err instanceof Error && err.message === 'No subscription found') {
        sendBillingRouteError(
          req,
          res,
          404,
          'subscription_missing',
          'No subscription exists for this company. Contact platform support.',
        );
        return;
      }
      sendBillingRouteError(req, res, 500, 'checkout_failed', 'Payment could not be started. Please try again.');
    }
  },
);

/** POST /api/subscriptions/confirm — verify payment after redirect (or dev mode) */
router.post('/confirm', requireCompanyBillingSelfService, async (req: AuthRequest, res: Response) => {
  if (!config.features.billing) {
    billingDisabled(req, res);
    return;
  }
  try {
    const orderId = typeof req.body.order_id === 'string' ? req.body.order_id : '';
    if (!orderId) {
      sendBillingRouteError(req, res, 400, 'order_id_required', 'Payment order id is required.');
      return;
    }
    const companyId = getCompanyId(req);
    const success = await confirmPayment(orderId, companyId);
    if (!success) {
      sendBillingRouteError(req, res, 402, 'payment_not_completed', 'Payment is not completed yet.');
      return;
    }
    const summary = await getSubscriptionSummary(companyId);
    res.json({ data: { success: true, subscription: summary } });
  } catch (err: unknown) {
    logger.error('Payment confirm failed', { error: err instanceof Error ? err.message : String(err) });
    if (err instanceof CashfreeConfigurationError) {
      sendBillingRouteError(
        req,
        res,
        503,
        'payment_gateway_not_configured',
        'Online payment confirmation is temporarily unavailable. Contact support if payment was completed.',
      );
      return;
    }
    sendBillingRouteError(req, res, 500, 'payment_confirmation_failed', 'Payment confirmation failed.');
  }
});

/** POST /api/subscriptions/start-trial — backfill trial for existing company (super_admin) */
router.post('/start-trial', hasRole('super_admin'), async (req: AuthRequest, res: Response) => {
  if (!config.features.billing) {
    billingDisabled(req, res);
    return;
  }
  try {
    const companyId = typeof req.body.company_id === 'string' ? req.body.company_id : '';
    if (!companyId) {
      res.status(400).json({ error: 'company_id required' });
      return;
    }
    await startTrialForCompany(companyId, {
      negotiatedMonthlyPrice:
        typeof req.body.negotiated_monthly_price === 'number' ? req.body.negotiated_monthly_price : null,
    });
    const summary = await getSubscriptionSummary(companyId);
    res.json({ data: summary });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to start trial' });
  }
});

/** Legacy alias */
router.post('/select-plan', requireCompanyBillingSelfService, async (req: AuthRequest, res: Response) => {
  if (!config.features.billing) {
    billingDisabled(req, res);
    return;
  }
  res.json({
    data: { message: 'Investo Pro is the only plan. Use POST /subscriptions/checkout to subscribe.' },
  });
});

export default router;

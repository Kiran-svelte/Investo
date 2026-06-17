import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole, authorize } from '../middleware/rbac';
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
import { SUBSCRIPTION_PRICING } from '../constants/subscriptionPricing';

const router = Router();

function billingDisabled(_req: AuthRequest, res: Response): void {
  res.status(410).json({
    error: {
      code: 'billing_disabled',
      message: 'Billing and subscription management is not available.',
    },
  });
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
  authorize('subscriptions', 'update'),
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
      res.status(500).json({ error: err instanceof Error ? err.message : 'Checkout failed' });
    }
  },
);

/** POST /api/subscriptions/confirm — verify payment after redirect (or dev mode) */
router.post('/confirm', async (req: AuthRequest, res: Response) => {
  if (!config.features.billing) {
    billingDisabled(req, res);
    return;
  }
  try {
    const orderId = typeof req.body.order_id === 'string' ? req.body.order_id : '';
    if (!orderId) {
      res.status(400).json({ error: 'order_id required' });
      return;
    }
    const companyId = getCompanyId(req);
    const success = await confirmPayment(orderId, companyId);
    if (!success) {
      res.status(402).json({ error: 'Payment not completed' });
      return;
    }
    const summary = await getSubscriptionSummary(companyId);
    res.json({ data: { success: true, subscription: summary } });
  } catch (err: unknown) {
    logger.error('Payment confirm failed', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Payment confirmation failed' });
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
router.post('/select-plan', authorize('subscriptions', 'update'), async (req: AuthRequest, res: Response) => {
  if (!config.features.billing) {
    billingDisabled(req, res);
    return;
  }
  res.json({
    data: { message: 'Investo Pro is the only plan. Use POST /subscriptions/checkout to subscribe.' },
  });
});

export default router;

/**
 * Billing Admin Routes
 *
 * Super-admin-only endpoints for managing agency billing.
 * All routes require `super_admin` role.
 *
 * Mounted at: /api/billing-admin
 */
import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import prisma from '../config/prisma';
import logger from '../config/logger';
import config from '../config';
import {
  markPastDue,
  activateSubscription,
  suspendForNonPayment,
  logBillingEvent,
  buildSubscriptionSummary,
  countBillableSeats,
} from '../services/billing/subscription.service';

const router = Router();

router.use(authenticate);
router.use(hasRole('super_admin'));

const updatePriceSchema = z.object({
  negotiated_monthly_price: z.number().positive().max(999999),
});

/**
 * GET /api/billing-admin/overview
 * Returns all companies with their billing status summary.
 *
 * @returns Array of company billing snapshots.
 */
router.get('/overview', async (_req: AuthRequest, res: Response) => {
  if (!config.features.billing) {
    res.status(410).json({ error: { code: 'billing_disabled', message: 'Billing is disabled.' } });
    return;
  }

  try {
    const companies = await prisma.company.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        subscription: true,
        _count: { select: { users: { where: { status: 'active' } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = await Promise.all(
      companies.map(async (company) => {
        if (!company.subscription) {
          return {
            companyId: company.id,
            companyName: company.name,
            companySlug: company.slug,
            companyStatus: company.status,
            userCount: company._count.users,
            createdAt: company.createdAt.toISOString(),
            billingStatus: 'no_subscription' as const,
            trialEndsAt: null,
            trialDaysRemaining: null,
            monthlyTotal: null,
            nextBillingDate: null,
            paymentMethod: null,
          };
        }

        const seatCount = await countBillableSeats(company.id);
        const summary = buildSubscriptionSummary(
          company.subscription,
          seatCount,
          company.status,
        );

        return {
          companyId: company.id,
          companyName: company.name,
          companySlug: company.slug,
          companyStatus: company.status,
          userCount: company._count.users,
          createdAt: company.createdAt.toISOString(),
          billingStatus: summary.billingStatus,
          trialEndsAt: summary.trialEndsAt,
          trialDaysRemaining: summary.trialDaysRemaining,
          monthlyTotal: summary.monthlyTotal,
          nextBillingDate: summary.nextBillingDate,
          paymentMethod: summary.paymentMethod,
          negotiatedMonthlyPrice: summary.negotiatedMonthlyPrice,
          basePriceMonthly: summary.basePriceMonthly,
          includedSeats: summary.includedSeats,
          extraSeats: summary.extraSeats,
          seatCount: summary.seatCount,
        };
      }),
    );

    res.json({ data: result });
  } catch (err: unknown) {
    logger.error('Failed to fetch billing overview', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: { code: 'internal_error', message: 'Failed to fetch billing overview.' } });
  }
});

/**
 * POST /api/billing-admin/companies/:id/suspend
 * Manually suspends a company's access.
 *
 * @param id - Company ID to suspend.
 */
router.post('/companies/:id/suspend', async (req: AuthRequest, res: Response) => {
  if (!config.features.billing) {
    res.status(410).json({ error: { code: 'billing_disabled', message: 'Billing is disabled.' } });
    return;
  }

  const companyId = req.params.id;
  try {
    const sub = await prisma.companySubscription.findUnique({ where: { companyId } });
    if (!sub) {
      res.status(404).json({ error: { code: 'not_found', message: 'Subscription not found.' } });
      return;
    }

    await suspendForNonPayment(companyId);
    await logBillingEvent(companyId, 'manual_suspend', { adminId: req.user!.id });
    logger.info('Company manually suspended', { companyId, adminId: req.user!.id });

    res.json({ data: { success: true, message: 'Company suspended.' } });
  } catch (err: unknown) {
    logger.error('Failed to manually suspend company', {
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: { code: 'internal_error', message: 'Failed to suspend company.' } });
  }
});

/**
 * POST /api/billing-admin/companies/:id/reactivate
 * Manually reactivates a suspended company — sets billing status to active.
 *
 * @param id - Company ID to reactivate.
 */
router.post('/companies/:id/reactivate', async (req: AuthRequest, res: Response) => {
  if (!config.features.billing) {
    res.status(410).json({ error: { code: 'billing_disabled', message: 'Billing is disabled.' } });
    return;
  }

  const companyId = req.params.id;
  try {
    const sub = await prisma.companySubscription.findUnique({ where: { companyId } });
    if (!sub) {
      res.status(404).json({ error: { code: 'not_found', message: 'Subscription not found.' } });
      return;
    }

    // Use existing payment method or default to invoice for trust-based reactivation
    const method = sub.paymentMethod ?? 'invoice';
    await activateSubscription(companyId, method);
    await logBillingEvent(companyId, 'manual_reactivate', { adminId: req.user!.id });
    logger.info('Company manually reactivated', { companyId, adminId: req.user!.id });

    res.json({ data: { success: true, message: 'Company reactivated.' } });
  } catch (err: unknown) {
    logger.error('Failed to manually reactivate company', {
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: { code: 'internal_error', message: 'Failed to reactivate company.' } });
  }
});

/**
 * POST /api/billing-admin/companies/:id/mark-past-due
 * Manually marks a company as past_due (starts grace period).
 *
 * @param id - Company ID to mark as past_due.
 */
router.post('/companies/:id/mark-past-due', async (req: AuthRequest, res: Response) => {
  if (!config.features.billing) {
    res.status(410).json({ error: { code: 'billing_disabled', message: 'Billing is disabled.' } });
    return;
  }

  const companyId = req.params.id;
  try {
    const sub = await prisma.companySubscription.findUnique({ where: { companyId } });
    if (!sub) {
      res.status(404).json({ error: { code: 'not_found', message: 'Subscription not found.' } });
      return;
    }

    await markPastDue(companyId);
    await logBillingEvent(companyId, 'manual_mark_past_due', { adminId: req.user!.id });

    res.json({ data: { success: true, message: 'Company marked as past due.' } });
  } catch (err: unknown) {
    logger.error('Failed to mark company as past_due', {
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: { code: 'internal_error', message: 'Failed to mark past_due.' } });
  }
});

/**
 * PATCH /api/billing-admin/companies/:id/price
 * Updates the negotiated monthly price for a company's subscription.
 *
 * @param id - Company ID to update.
 * @param negotiated_monthly_price - New monthly price in INR.
 */
router.patch(
  '/companies/:id/price',
  validate(updatePriceSchema),
  async (req: AuthRequest, res: Response) => {
    if (!config.features.billing) {
      res.status(410).json({ error: { code: 'billing_disabled', message: 'Billing is disabled.' } });
      return;
    }

    const companyId = req.params.id;
    const newPrice = req.body.negotiated_monthly_price as number;

    try {
      const sub = await prisma.companySubscription.findUnique({ where: { companyId } });
      if (!sub) {
        res.status(404).json({ error: { code: 'not_found', message: 'Subscription not found.' } });
        return;
      }

      await prisma.companySubscription.update({
        where: { companyId },
        data: { negotiatedMonthlyPrice: newPrice },
      });

      await logBillingEvent(companyId, 'price_updated', {
        oldPrice: sub.negotiatedMonthlyPrice ? Number(sub.negotiatedMonthlyPrice) : null,
        newPrice,
        adminId: req.user!.id,
      });

      logger.info('Negotiated price updated', { companyId, newPrice, adminId: req.user!.id });
      res.json({ data: { success: true, negotiatedMonthlyPrice: newPrice } });
    } catch (err: unknown) {
      logger.error('Failed to update negotiated price', {
        companyId,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: { code: 'internal_error', message: 'Failed to update price.' } });
    }
  },
);

/**
 * GET /api/billing-admin/companies/:id/events
 * Returns billing event log for a specific company.
 *
 * @param id - Company ID.
 */
router.get('/companies/:id/events', async (req: AuthRequest, res: Response) => {
  if (!config.features.billing) {
    res.status(410).json({ error: { code: 'billing_disabled', message: 'Billing is disabled.' } });
    return;
  }

  const companyId = req.params.id;
  try {
    const events = await prisma.billingEvent.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({
      data: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        payload: e.payload,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (err: unknown) {
    logger.error('Failed to fetch billing events', {
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: { code: 'internal_error', message: 'Failed to fetch billing events.' } });
  }
});

export default router;

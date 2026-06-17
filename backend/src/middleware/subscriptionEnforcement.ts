/**
 * Subscription enforcement middleware.
 * Enforces trial/active/past_due grace access and seat limits when FEATURE_BILLING is enabled.
 */

import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import config from '../config';
import prisma from '../config/prisma';
import logger from '../config/logger';
import {
  resolveHasAccess,
  countBillableSeats,
  computeMonthlyTotal,
} from '../services/billing/subscription.service';
import { SUBSCRIPTION_PRICING } from '../constants/subscriptionPricing';

const BYPASS_ROLES = new Set(['super_admin']);

export async function requireActivePaidSubscription(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!config.features.billing) {
    next();
    return;
  }

  if (!req.user || BYPASS_ROLES.has(req.user.role)) {
    next();
    return;
  }

  const companyId = req.user.company_id;
  if (!companyId) {
    next();
    return;
  }

  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { status: true, subscription: true },
    });

    if (!company) {
      res.status(403).json({ error: 'Company not found' });
      return;
    }

    if (!company.subscription) {
      res.status(402).json({
        error: 'subscription_required',
        message: 'No active subscription. Contact support or subscribe from Billing.',
      });
      return;
    }

    const hasAccess = resolveHasAccess(
      company.subscription.billingStatus,
      company.subscription.graceUntil,
      company.status,
      company.subscription.trialEndsAt,
    );

    if (!hasAccess) {
      res.status(402).json({
        error: 'subscription_inactive',
        message: 'Your trial has ended or payment is overdue. Subscribe from Billing to continue.',
        billingStatus: company.subscription.billingStatus,
      });
      return;
    }

    next();
  } catch (err: unknown) {
    logger.error('Subscription enforcement error', {
      error: err instanceof Error ? err.message : String(err),
    });
    next();
  }
}

export function enforcePlanLimit(resource: 'agents' | 'leads' | 'properties') {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!config.features.billing) {
      next();
      return;
    }

    if (!req.user || BYPASS_ROLES.has(req.user.role)) {
      next();
      return;
    }

    const companyId = req.user.company_id;
    if (!companyId) {
      next();
      return;
    }

    try {
      if (resource === 'agents') {
        const sub = await prisma.companySubscription.findUnique({ where: { companyId } });
        if (!sub) {
          next();
          return;
        }

        const seatCount = await countBillableSeats(companyId);
        const maxSeats = sub.includedSeats + 999;
        if (seatCount >= maxSeats) {
          res.status(403).json({
            error: 'seat_limit_reached',
            message: `Maximum ${maxSeats} users allowed. Contact support to increase.`,
          });
          return;
        }
      }

      if (resource === 'leads' || resource === 'properties') {
        const company = await prisma.company.findUnique({
          where: { id: companyId },
          include: { plan: true },
        });
        const plan = company?.plan;
        if (!plan) {
          next();
          return;
        }

        if (resource === 'leads' && plan.maxLeads != null) {
          const count = await prisma.lead.count({ where: { companyId } });
          if (count >= plan.maxLeads) {
            res.status(403).json({ error: 'plan_limit_leads', message: `Lead limit reached (${plan.maxLeads})` });
            return;
          }
        }

        if (resource === 'properties' && plan.maxProperties != null) {
          const count = await prisma.property.count({ where: { companyId } });
          if (count >= plan.maxProperties) {
            res.status(403).json({
              error: 'plan_limit_properties',
              message: `Property limit reached (${plan.maxProperties})`,
            });
            return;
          }
        }
      }

      next();
    } catch (err: unknown) {
      logger.error('Plan limit enforcement error', {
        error: err instanceof Error ? err.message : String(err),
      });
      next();
    }
  };
}

if (config.features.billing) {
  logger.info('Subscription enforcement: ENABLED', {
    module: 'subscriptionEnforcement',
    trialDays: SUBSCRIPTION_PRICING.trialDays,
  });
} else {
  logger.info('Subscription enforcement: BILLING DISABLED — all limits bypassed', {
    module: 'subscriptionEnforcement',
  });
}

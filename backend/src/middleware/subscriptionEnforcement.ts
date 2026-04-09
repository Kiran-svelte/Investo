import { Response, NextFunction } from 'express';
import prisma from '../config/prisma';
import { AuthRequest } from './auth';
import logger from '../config/logger';

type PlanLimitedResource = 'agents' | 'leads' | 'properties';

function isSuperAdmin(req: AuthRequest): boolean {
  return req.user?.role === 'super_admin';
}

function getCompanyId(req: AuthRequest): string | null {
  return req.user?.company_id || req.user?.companyId || null;
}

export async function requireActivePaidSubscription(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (isSuperAdmin(req)) {
      next();
      return;
    }

    const companyId = getCompanyId(req);
    if (!companyId) {
      res.status(403).json({ error: 'Company context is required' });
      return;
    }

    const [company, blockingInvoice] = await Promise.all([
      prisma.company.findFirst({
        where: { id: companyId },
        select: { id: true, status: true, planId: true },
      }),
      prisma.invoice.findFirst({
        where: {
          companyId,
          OR: [
            { status: 'overdue' },
            { status: 'pending', dueDate: { lt: new Date() } },
          ],
        },
        orderBy: { dueDate: 'asc' },
        select: { id: true, status: true, dueDate: true },
      }),
    ]);

    if (!company || company.status !== 'active') {
      res.status(403).json({ error: 'Company is inactive or suspended' });
      return;
    }

    if (!company.planId) {
      res.status(402).json({
        error: 'Active subscription plan required',
        code: 'subscription_plan_required',
      });
      return;
    }

    if (blockingInvoice) {
      res.status(402).json({
        error: 'Payment required before write operations',
        code: 'subscription_payment_required',
        invoice: {
          id: blockingInvoice.id,
          status: blockingInvoice.status,
          due_date: blockingInvoice.dueDate.toISOString(),
        },
      });
      return;
    }

    next();
  } catch (err: any) {
    logger.error('Subscription payment enforcement failed', { error: err?.message });
    res.status(500).json({ error: 'Subscription enforcement failed' });
  }
}

export function enforcePlanLimit(resource: PlanLimitedResource) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (isSuperAdmin(req)) {
        next();
        return;
      }

      const companyId = getCompanyId(req);
      if (!companyId) {
        res.status(403).json({ error: 'Company context is required' });
        return;
      }

      const company = await prisma.company.findFirst({
        where: { id: companyId, status: 'active' },
        include: { plan: { select: { maxAgents: true, maxLeads: true, maxProperties: true } } },
      });

      if (!company) {
        res.status(403).json({ error: 'Company is inactive or suspended' });
        return;
      }

      if (!company.plan) {
        res.status(402).json({
          error: 'Active subscription plan required',
          code: 'subscription_plan_required',
        });
        return;
      }

      if (resource === 'agents') {
        const currentAgents = await prisma.user.count({
          where: { companyId, role: 'sales_agent', status: 'active' },
        });

        if (currentAgents >= company.plan.maxAgents) {
          res.status(403).json({
            error: `Plan agent limit reached (${company.plan.maxAgents})`,
            code: 'plan_limit_agents',
          });
          return;
        }
      }

      if (resource === 'leads' && company.plan.maxLeads !== null) {
        const currentLeads = await prisma.lead.count({ where: { companyId } });
        if (currentLeads >= company.plan.maxLeads) {
          res.status(403).json({
            error: `Plan lead limit reached (${company.plan.maxLeads})`,
            code: 'plan_limit_leads',
          });
          return;
        }
      }

      if (resource === 'properties' && company.plan.maxProperties !== null) {
        const currentProperties = await prisma.property.count({ where: { companyId } });
        if (currentProperties >= company.plan.maxProperties) {
          res.status(403).json({
            error: `Plan property limit reached (${company.plan.maxProperties})`,
            code: 'plan_limit_properties',
          });
          return;
        }
      }

      next();
    } catch (err: any) {
      logger.error('Subscription plan limit enforcement failed', {
        resource,
        error: err?.message,
      });
      res.status(500).json({ error: 'Plan limit enforcement failed' });
    }
  };
}

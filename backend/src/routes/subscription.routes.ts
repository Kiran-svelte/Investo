import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole } from '../middleware/rbac';
import { auditLog } from '../middleware/audit';
import prisma from '../config/prisma';
import logger from '../config/logger';
import invoiceRoutes from './invoice.routes';

const router = Router();

router.use(authenticate);

// Mount invoice routes under /invoices
router.use('/invoices', invoiceRoutes);

/**
 * GET /api/subscriptions/plans
 * List all subscription plans.
 * Super admin: all plans
 * Others: active plans only
 */
router.get('/plans', async (req: AuthRequest, res: Response) => {
  try {
    const where: any = {};
    if (req.user!.role !== 'super_admin') {
      where.status = 'active';
    }

    const plans = await prisma.subscriptionPlan.findMany({
      where,
      orderBy: { priceMonthly: 'asc' },
    });
    res.json({ data: plans });
  } catch (err: any) {
    logger.error('Failed to fetch plans', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

/**
 * GET /api/subscriptions/plans/:id
 */
router.get('/plans/:id', async (req: AuthRequest, res: Response) => {
  try {
    const plan = await prisma.subscriptionPlan.findFirst({ where: { id: req.params.id } });
    if (!plan) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }
    res.json({ data: plan });
  } catch (err: any) {
    logger.error('Failed to fetch plan', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch plan' });
  }
});

/**
 * POST /api/subscriptions/plans
 * Super admin only: create a new subscription plan.
 */
router.post(
  '/plans',
  hasRole('super_admin'),
  auditLog('create', 'subscriptions'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { name, max_agents, max_leads, max_properties, price_monthly, price_yearly, features } = req.body;

      const plan = await prisma.subscriptionPlan.create({
        data: {
          name,
          maxAgents: max_agents || 3,
          maxLeads: max_leads || null,
          maxProperties: max_properties || null,
          priceMonthly: price_monthly || 0,
          priceYearly: price_yearly || null,
          features: features || [],
          status: 'active',
        },
      });

      res.status(201).json({ data: plan, id: plan.id });
    } catch (err: any) {
      logger.error('Failed to create plan', { error: err.message });
      res.status(500).json({ error: 'Failed to create plan' });
    }
  }
);

/**
 * PUT /api/subscriptions/plans/:id
 * Super admin only: update a subscription plan.
 */
router.put(
  '/plans/:id',
  hasRole('super_admin'),
  auditLog('update', 'subscriptions'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      const updateData: any = {};
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.max_agents !== undefined) updateData.maxAgents = updates.max_agents;
      if (updates.max_leads !== undefined) updateData.maxLeads = updates.max_leads;
      if (updates.max_properties !== undefined) updateData.maxProperties = updates.max_properties;
      if (updates.price_monthly !== undefined) updateData.priceMonthly = updates.price_monthly;
      if (updates.price_yearly !== undefined) updateData.priceYearly = updates.price_yearly;
      if (updates.status !== undefined) updateData.status = updates.status;
      if (updates.features) updateData.features = updates.features;

      await prisma.subscriptionPlan.update({
        where: { id },
        data: updateData,
      });

      const plan = await prisma.subscriptionPlan.findFirst({ where: { id } });
      res.json({ data: plan });
    } catch (err: any) {
      logger.error('Failed to update plan', { error: err.message });
      res.status(500).json({ error: 'Failed to update plan' });
    }
  }
);

/**
 * DELETE /api/subscriptions/plans/:id
 * Super admin only: deactivate a plan (not delete).
 */
router.delete(
  '/plans/:id',
  hasRole('super_admin'),
  auditLog('deactivate', 'subscriptions'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;

      // Check if any companies are using this plan
      const companiesUsingPlan = await prisma.company.count({
        where: { planId: id, status: 'active' },
      });

      if (companiesUsingPlan > 0) {
        res.status(400).json({
          error: 'Cannot deactivate plan with active companies',
          companies_count: companiesUsingPlan,
        });
        return;
      }

      await prisma.subscriptionPlan.update({
        where: { id },
        data: { status: 'inactive' },
      });
      res.json({ message: 'Plan deactivated' });
    } catch (err: any) {
      logger.error('Failed to deactivate plan', { error: err.message });
      res.status(500).json({ error: 'Failed to deactivate plan' });
    }
  }
);

/**
 * POST /api/subscriptions/select-plan
 * Company admin: update own company plan.
 * Super admin: update target company plan by company_id.
 */
router.post(
  '/select-plan',
  hasRole('super_admin', 'company_admin'),
  auditLog('update', 'subscriptions'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { plan_id, company_id } = req.body;
      if (!plan_id) {
        res.status(400).json({ error: 'plan_id is required' });
        return;
      }

      const targetCompanyId = req.user!.role === 'super_admin'
        ? (company_id || req.user!.company_id)
        : req.user!.company_id;

      if (!targetCompanyId) {
        res.status(400).json({ error: 'company_id is required for super admin without company context' });
        return;
      }

      const [plan, company] = await Promise.all([
        prisma.subscriptionPlan.findFirst({ where: { id: plan_id, status: 'active' } }),
        prisma.company.findFirst({ where: { id: targetCompanyId } }),
      ]);

      if (!plan) {
        res.status(404).json({ error: 'Active plan not found' });
        return;
      }
      if (!company) {
        res.status(404).json({ error: 'Company not found' });
        return;
      }

      await prisma.company.update({
        where: { id: targetCompanyId },
        data: { planId: plan.id },
      });

      res.json({
        data: {
          company_id: targetCompanyId,
          plan_id: plan.id,
          plan_name: plan.name,
          price_monthly: plan.priceMonthly,
        },
        message: 'Subscription plan updated',
      });
    } catch (err: any) {
      logger.error('Failed to select subscription plan', { error: err.message });
      res.status(500).json({ error: 'Failed to select subscription plan' });
    }
  }
);

export default router;

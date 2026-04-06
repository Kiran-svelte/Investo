import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize, hasRole } from '../middleware/rbac';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import { auditLog } from '../middleware/audit';
import { validate } from '../middleware/validate';
import { requireFeature } from '../middleware/featureGate';
import { createUserSchema } from '../models/validation';
import { authService } from '../services/auth.service';
import prisma from '../config/prisma';
import logger from '../config/logger';

const router = Router();

router.use(authenticate);
router.use(tenantIsolation);
router.use((req: AuthRequest, res: Response, next) => {
  if (req.user?.role === 'super_admin') {
    next();
    return;
  }
  return requireFeature('agent_management')(req, res, next);
});

/**
 * GET /api/users
 * Company admin: list all users in own company
 * Sales agent: list own profile only
 * Super admin: list all users (optionally filtered by target_company_id)
 */
router.get(
  '/',
  authorize('users', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const where: any = {};

      if (req.user!.role === 'super_admin') {
        // Super admin can see all or filter by company
        if (companyId && companyId !== req.user!.company_id) {
          where.companyId = companyId;
        }
      } else if (req.user!.role === 'sales_agent') {
        // Sales agent sees only self
        where.id = req.user!.id;
      } else {
        // Company admin, operations, viewer see own company
        where.companyId = companyId;
      }

      // Role filter
      const { role } = req.query;
      if (role) {
        where.role = role as string;
      }

      const users = await prisma.user.findMany({
        where,
        select: {
          id: true, companyId: true, name: true, email: true, phone: true,
          role: true, status: true, lastLogin: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Enrich with lead counts for agents
      if (users.length > 0) {
        const userIds = users.map((u) => u.id);
        const leadCounts = await prisma.lead.groupBy({
          by: ['assignedAgentId'],
          where: {
            assignedAgentId: { in: userIds },
            status: { notIn: ['closed_won', 'closed_lost'] },
          },
          _count: { id: true },
        });

        const leadMap = new Map(leadCounts.map((l) => [l.assignedAgentId, l._count.id]));

        const salesCounts = await prisma.lead.groupBy({
          by: ['assignedAgentId'],
          where: {
            assignedAgentId: { in: userIds },
            status: 'closed_won',
          },
          _count: { id: true },
        });

        const salesMap = new Map(salesCounts.map((s) => [s.assignedAgentId, s._count.id]));

        const enriched = users.map((u) => ({
          ...u,
          active_leads: leadMap.get(u.id) || 0,
          sales_count: salesMap.get(u.id) || 0,
        }));

        res.json({ data: enriched, total: enriched.length });
        return;
      }

      res.json({ data: users, total: users.length });
    } catch (err: any) {
      logger.error('Failed to fetch users', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  }
);

/**
 * GET /api/users/:id
 */
router.get(
  '/:id',
  authorize('users', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const companyId = getCompanyId(req);

      // Sales agent can only see self
      if (req.user!.role === 'sales_agent' && id !== req.user!.id) {
        res.status(403).json({ error: 'Can only view own profile' });
        return;
      }

      const where: any = { id };
      // Non-super_admin can only see users in own company
      if (req.user!.role !== 'super_admin') {
        where.companyId = companyId;
      }

      const user = await prisma.user.findFirst({
        where,
        select: {
          id: true, companyId: true, name: true, email: true, phone: true,
          role: true, status: true, lastLogin: true, createdAt: true,
        },
      });

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({ data: user });
    } catch (err: any) {
      logger.error('Failed to fetch user', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch user' });
    }
  }
);

/**
 * POST /api/users
 * Company admin: create users in own company
 * Super admin: create users in any company (with target_company_id)
 */
router.post(
  '/',
  authorize('users', 'create'),
  validate(createUserSchema),
  auditLog('create', 'users'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { name, email, password, phone, role } = req.body;

      // Company admin cannot create super_admin role
      if (req.user!.role === 'company_admin' && role === 'super_admin') {
        res.status(403).json({ error: 'Cannot create super admin users' });
        return;
      }

      // Check plan limits for agent count
      if (role === 'sales_agent' && req.user!.role !== 'super_admin') {
        const company = await prisma.company.findFirst({
          where: { id: companyId },
          include: { plan: { select: { maxAgents: true } } },
        });

        if (company?.plan?.maxAgents) {
          const currentAgents = await prisma.user.count({
            where: { companyId, role: 'sales_agent', status: 'active' },
          });

          if (currentAgents >= company.plan.maxAgents) {
            res.status(403).json({ error: `Agent limit reached. Max agents: ${company.plan.maxAgents}` });
            return;
          }
        }
      }

      const result = await authService.register({
        name,
        email,
        password,
        phone,
        role,
        company_id: companyId,
      });

      res.status(201).json({ data: result, id: result.id });
    } catch (err: any) {
      if (err.message === 'Email already registered') {
        res.status(409).json({ error: err.message });
        return;
      }
      if (String(err.message || '').toLowerCase().includes('origin header')) {
        res.status(502).json({ error: `Identity provider configuration error: ${err.message}` });
        return;
      }
      logger.error('Failed to create user', { error: err.message });
      res.status(500).json({ error: 'Failed to create user' });
    }
  }
);

/**
 * PUT /api/users/:id
 * Company admin: update users in own company
 * Sales agent: update own profile (limited fields)
 */
router.put(
  '/:id',
  authorize('users', 'update'),
  auditLog('update', 'users'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const companyId = getCompanyId(req);

      // Check the target user belongs to the same company
      const targetUser = await prisma.user.findFirst({ where: { id } });
      if (!targetUser) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      if (req.user!.role !== 'super_admin' && targetUser.companyId !== companyId) {
        res.status(403).json({ error: 'Cannot modify users in other companies' });
        return;
      }

      // Sales agent can only update own profile (name, phone)
      if (req.user!.role === 'sales_agent') {
        if (id !== req.user!.id) {
          res.status(403).json({ error: 'Can only update own profile' });
          return;
        }
        const { name, phone } = req.body;
        await prisma.user.update({
          where: { id },
          data: {
            ...(name && { name }),
            ...(phone !== undefined && { phone }),
          },
        });
      } else {
        // Company admin or super admin
        const { name, phone, role, status } = req.body;

        // Cannot change to super_admin unless you are super_admin
        if (role === 'super_admin' && req.user!.role !== 'super_admin') {
          res.status(403).json({ error: 'Cannot assign super admin role' });
          return;
        }

        await prisma.user.update({
          where: { id },
          data: {
            ...(name && { name }),
            ...(phone !== undefined && { phone }),
            ...(role && { role }),
            ...(status && { status }),
          },
        });
      }

      const updated = await prisma.user.findFirst({
        where: { id },
        select: { id: true, companyId: true, name: true, email: true, phone: true, role: true, status: true },
      });

      res.json({ data: updated });
    } catch (err: any) {
      logger.error('Failed to update user', { error: err.message });
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
);

/**
 * PATCH /api/users/:id/deactivate
 * Company admin: deactivate user in own company
 */
router.patch(
  '/:id/deactivate',
  authorize('users', 'delete'),
  auditLog('deactivate', 'users'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const companyId = getCompanyId(req);

      // Cannot deactivate self
      if (id === req.user!.id) {
        res.status(400).json({ error: 'Cannot deactivate yourself' });
        return;
      }

      const targetUser = await prisma.user.findFirst({ where: { id } });
      if (!targetUser) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      if (req.user!.role !== 'super_admin' && targetUser.companyId !== companyId) {
        res.status(403).json({ error: 'Cannot modify users in other companies' });
        return;
      }

      await prisma.user.update({
        where: { id },
        data: { status: 'inactive' },
      });

      res.json({ message: 'User deactivated' });
    } catch (err: any) {
      logger.error('Failed to deactivate user', { error: err.message });
      res.status(500).json({ error: 'Failed to deactivate user' });
    }
  }
);

export default router;

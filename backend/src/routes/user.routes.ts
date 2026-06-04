import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize, hasRole } from '../middleware/rbac';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import { auditLog } from '../middleware/audit';
import { validate } from '../middleware/validate';
import { requireFeature } from '../middleware/featureGate';
import { requireActivePaidSubscription } from '../middleware/subscriptionEnforcement';
import { createUserSchema } from '../models/validation';
import { authService } from '../services/auth.service';
import { emailService } from '../services/email.service';
import config from '../config';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { buildPaginationMeta, parsePagination } from '../utils/pagination';

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

      const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: {
            id: true, companyId: true, name: true, email: true, phone: true,
            role: true, status: true, lastLogin: true, createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          skip: offset,
          take: limit,
        }),
        prisma.user.count({ where }),
      ]);

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

        res.json({
          data: enriched,
          pagination: buildPaginationMeta(page, limit, total),
        });
        return;
      }

      res.json({
        data: users,
        pagination: buildPaginationMeta(page, limit, total),
      });
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
  requireActivePaidSubscription,
  validate(createUserSchema),
  auditLog('create', 'users'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { name, email, password, phone, role, target_company_id, must_change_password } = req.body;
      const queryTargetCompanyId =
        typeof req.query.target_company_id === 'string' ? req.query.target_company_id : undefined;
      const resolvedTargetCompanyId = target_company_id || queryTargetCompanyId;

      // Determine which company to create user in
      // Super admin can specify target_company_id (body or query), others use their own company
      let companyId: string;
      if (req.user!.role === 'super_admin' && resolvedTargetCompanyId) {
        companyId = resolvedTargetCompanyId;
      } else {
        companyId = getCompanyId(req);
      }

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

        if (!company?.plan) {
          res.status(402).json({ error: 'Active subscription plan required' });
          return;
        }

        const currentAgents = await prisma.user.count({
          where: { companyId, role: 'sales_agent', status: 'active' },
        });

        if (currentAgents >= company.plan.maxAgents) {
          res.status(403).json({ error: `Agent limit reached. Max agents: ${company.plan.maxAgents}` });
          return;
        }
      }

      const result = await authService.register({
        name,
        email,
        password,
        phone,
        role,
        company_id: companyId,
        must_change_password,
      });

      if (role === 'company_admin') {
        const company = await prisma.company.findUnique({
          where: { id: companyId },
          select: { name: true },
        });
        const loginUrl = `${config.frontend.baseUrl.replace(/\/$/, '')}/login`;
        void emailService.sendWelcomeInviteEmail({
          toEmail: email,
          toName: name,
          loginUrl,
          temporaryPassword: password,
          companyName: company?.name,
        }).catch((mailErr: Error) => {
          logger.warn('Welcome invite email failed', { error: mailErr.message, email });
        });
      }

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

      const selfServiceRoles = new Set(['sales_agent', 'operations', 'viewer']);
      if (selfServiceRoles.has(req.user!.role)) {
        if (id !== req.user!.id) {
          res.status(403).json({ error: 'Can only update own profile' });
          return;
        }
        const { name, phone } = req.body;
        const { normalizeStaffProfilePhone } = await import('../utils/userProfilePhone');
        const normalizedPhone =
          phone !== undefined && phone !== null && String(phone).trim()
            ? normalizeStaffProfilePhone(String(phone))
            : undefined;
        if (phone !== undefined && phone !== null && String(phone).trim() && !normalizedPhone) {
          res.status(400).json({ error: 'Enter a valid Indian mobile number (10 digits).' });
          return;
        }
        await prisma.user.update({
          where: { id },
          data: {
            ...(name && { name }),
            ...(normalizedPhone !== undefined && { phone: normalizedPhone }),
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

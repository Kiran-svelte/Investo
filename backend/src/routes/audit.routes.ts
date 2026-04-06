import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole, authorize } from '../middleware/rbac';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import { requireFeature } from '../middleware/featureGate';
import prisma from '../config/prisma';
import logger from '../config/logger';

const router = Router();

router.use(authenticate);
router.use((req: AuthRequest, res: Response, next) => {
  if (req.user?.role === 'super_admin') {
    next();
    return;
  }
  return requireFeature('audit_logs')(req, res, next);
});

/**
 * GET /api/audit
 * Get audit logs.
 * Super admin: all logs (optionally filtered by company)
 * Company admin: only own company logs
 */
router.get(
  '/',
  authorize('audit_logs', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const skip = (page - 1) * limit;

      const where: any = {};

      // Filter by company for non-super_admin
      if (req.user!.role !== 'super_admin') {
        where.companyId = req.user!.company_id;
      } else if (req.query.company_id) {
        where.companyId = req.query.company_id;
      }

      // Filter by action
      if (req.query.action) {
        where.action = req.query.action;
      }

      // Filter by resource
      if (req.query.resource) {
        where.resourceType = req.query.resource;
      }

      // Search by user
      if (req.query.search) {
        const search = req.query.search as string;
        where.OR = [
          { user: { name: { contains: search, mode: 'insensitive' } } },
          { user: { email: { contains: search, mode: 'insensitive' } } },
          { resourceType: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          include: {
            user: {
              select: { name: true, email: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.auditLog.count({ where }),
      ]);

      const data = logs.map((log) => ({
        id: log.id,
        userId: log.userId,
        userName: log.user?.name || null,
        userEmail: log.user?.email || 'Unknown',
        action: log.action,
        resource: log.resourceType,
        resourceId: log.resourceId,
        details: log.details,
        ipAddress: log.ipAddress,
        userAgent: null,
        createdAt: log.createdAt.toISOString(),
      }));

      res.json({
        data,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err: any) {
      logger.error('Failed to fetch audit logs', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
  }
);

/**
 * GET /api/audit/:id
 * Get single audit log entry.
 */
router.get(
  '/:id',
  authorize('audit_logs', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const where: any = { id };

      if (req.user!.role !== 'super_admin') {
        where.companyId = req.user!.company_id;
      }

      const log = await prisma.auditLog.findFirst({
        where,
        include: {
          user: {
            select: { name: true, email: true },
          },
        },
      });

      if (!log) {
        res.status(404).json({ error: 'Audit log not found' });
        return;
      }

      res.json({
        data: {
          id: log.id,
          userId: log.userId,
          userName: log.user?.name || null,
          userEmail: log.user?.email || 'Unknown',
          action: log.action,
          resource: log.resourceType,
          resourceId: log.resourceId,
          details: log.details,
          ipAddress: log.ipAddress,
          createdAt: log.createdAt.toISOString(),
        },
      });
    } catch (err: any) {
      logger.error('Failed to fetch audit log', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch audit log' });
    }
  }
);

export default router;

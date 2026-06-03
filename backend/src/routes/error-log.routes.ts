import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import { requireFeature } from '../middleware/featureGate';
import prisma from '../config/prisma';
import logger from '../config/logger';

const router = Router();

const ERROR_ACTIONS = [
  'customer_wrong_report',
  'ai_error',
  'webhook_error',
  'system_error',
];

router.use(authenticate);
router.use(tenantIsolation);
router.use(requireFeature('lead_automation'));

/**
 * GET /api/error-logs
 * Agency error log — last 7 days by default.
 */
router.get(
  '/',
  authorize('audit_logs', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const days = Math.min(parseInt(req.query.days as string) || 7, 30);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const resolved = req.query.resolved as string | undefined;

      const logs = await prisma.auditLog.findMany({
        where: {
          companyId,
          createdAt: { gte: since },
          OR: [
            { action: { in: ERROR_ACTIONS } },
            { action: { contains: 'error', mode: 'insensitive' } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });

      const data = logs
        .map((log) => {
          const details = (log.details as Record<string, unknown>) || {};
          const isResolved = details.resolved === true;
          return {
            id: log.id,
            action: log.action,
            resource_type: log.resourceType,
            resource_id: log.resourceId,
            details,
            created_at: log.createdAt.toISOString(),
            resolved: isResolved,
          };
        })
        .filter((row) => {
          if (resolved === 'true') return row.resolved;
          if (resolved === 'false') return !row.resolved;
          return true;
        });

      res.json({ data, days });
    } catch (err: any) {
      logger.error('Failed to fetch error logs', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch error logs' });
    }
  }
);

/**
 * PATCH /api/error-logs/:id/resolve
 */
router.patch(
  '/:id/resolve',
  authorize('audit_logs', 'update'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const log = await prisma.auditLog.findFirst({
        where: { id: req.params.id, companyId },
      });
      if (!log) {
        res.status(404).json({ error: 'Log not found' });
        return;
      }
      const details = { ...(log.details as object), resolved: true, resolved_at: new Date().toISOString(), resolved_by: req.user!.id };
      await prisma.auditLog.update({
        where: { id: log.id },
        data: { details },
      });
      res.json({ data: { id: log.id, resolved: true } });
    } catch (err: any) {
      logger.error('Failed to resolve error log', { error: err.message });
      res.status(500).json({ error: 'Failed to resolve error log' });
    }
  }
);

/**
 * GET /api/error-logs/export
 */
router.get(
  '/export',
  authorize('audit_logs', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const days = Math.min(parseInt(req.query.days as string) || 7, 30);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const logs = await prisma.auditLog.findMany({
        where: {
          companyId,
          createdAt: { gte: since },
          OR: [
            { action: { in: ERROR_ACTIONS } },
            { action: { contains: 'error', mode: 'insensitive' } },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=error_logs_${days}d.json`);
      res.send(JSON.stringify(logs, null, 2));
    } catch (err: any) {
      res.status(500).json({ error: 'Export failed' });
    }
  }
);

export default router;

import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import { auditLog } from '../middleware/audit';
import { requireFeature } from '../middleware/featureGate';
import { propertyCompletenessGate } from '../middleware/propertyCompletenessGate';
import prisma from '../config/prisma';
import logger from '../config/logger';
import {
  deleteAllNotificationsForUser,
  deleteNotificationPermanently,
  ResourceDeleteError,
} from '../services/resourceDelete.service';

const router = Router();

router.use(authenticate);
router.use(tenantIsolation);
router.use(propertyCompletenessGate);
router.use(requireFeature('notifications'));

/**
 * GET /api/notifications
 * Get notifications for the current user.
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const userId = req.user!.id;

    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
    const skip = (page - 1) * limit;

    const unreadOnly = String(req.query.unread ?? '').toLowerCase() === 'true';
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;

    const where = {
      companyId,
      ...(unreadOnly ? { read: false } : {}),
      ...(type ? { type: type as any } : {}),
      OR: [{ userId }, { userId: null }],
    };

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: {
          companyId,
          read: false,
          OR: [{ userId }, { userId: null }],
        },
      }),
    ]);

    res.json({
      data: {
        notifications,
        total,
        page,
        limit,
        unreadCount,
      },
    });
  } catch (err: any) {
    logger.error('Failed to fetch notifications', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

/**
 * PATCH/PUT /api/notifications/:id/read
 * Mark a notification as read.
 */
const markReadHandler = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const { id } = req.params;

    await prisma.notification.updateMany({
      where: { id, companyId },
      data: { read: true },
    });

    res.json({ message: 'Notification marked as read' });
  } catch (err: any) {
    logger.error('Failed to mark notification as read', { error: err.message });
    res.status(500).json({ error: 'Failed to update notification' });
  }
};

router.patch('/:id/read', markReadHandler);
router.put('/:id/read', markReadHandler);

/**
 * PATCH/PUT /api/notifications/read-all
 * Mark all notifications as read for the current user.
 */
const markAllReadHandler = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const userId = req.user!.id;

    await prisma.notification.updateMany({
      where: {
        companyId,
        OR: [{ userId }, { userId: null }],
      },
      data: { read: true },
    });

    res.json({ message: 'All notifications marked as read' });
  } catch (err: any) {
    logger.error('Failed to mark all notifications as read', { error: err.message });
    res.status(500).json({ error: 'Failed to update notifications' });
  }
};

router.patch('/read-all', markAllReadHandler);
router.put('/read-all', markAllReadHandler);

function handleDeleteError(err: unknown, res: Response): void {
  if (err instanceof ResourceDeleteError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : 'Delete failed';
  logger.error('Delete failed', { error: message });
  res.status(500).json({ error: message });
}

/**
 * DELETE /api/notifications/all
 * Permanently delete all notifications visible to the current user.
 */
router.delete(
  '/all',
  authorize('notifications', 'delete'),
  auditLog('delete', 'notifications'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const count = await deleteAllNotificationsForUser(companyId, req.user!.id);
      res.json({ message: 'Notifications deleted', deleted: count });
    } catch (err: unknown) {
      handleDeleteError(err, res);
    }
  },
);

/**
 * DELETE /api/notifications/:id
 * Permanently delete one notification.
 */
router.delete(
  '/:id',
  authorize('notifications', 'delete'),
  auditLog('delete', 'notifications'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      await deleteNotificationPermanently(companyId, req.user!.id, req.params.id);
      res.json({ message: 'Notification deleted' });
    } catch (err: unknown) {
      handleDeleteError(err, res);
    }
  },
);

export default router;

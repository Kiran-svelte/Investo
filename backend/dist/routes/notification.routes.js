"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const tenant_1 = require("../middleware/tenant");
const audit_1 = require("../middleware/audit");
const featureGate_1 = require("../middleware/featureGate");
const propertyCompletenessGate_1 = require("../middleware/propertyCompletenessGate");
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const resourceDelete_service_1 = require("../services/resourceDelete.service");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.use(tenant_1.tenantIsolation);
router.use(propertyCompletenessGate_1.propertyCompletenessGate);
router.use((0, featureGate_1.requireFeature)('notifications'));
/**
 * GET /api/notifications
 * Get notifications for the current user.
 */
router.get('/', async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const userId = req.user.id;
        const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
        const skip = (page - 1) * limit;
        const unreadOnly = String(req.query.unread ?? '').toLowerCase() === 'true';
        const type = typeof req.query.type === 'string' ? req.query.type : undefined;
        const types = typeof req.query.types === 'string'
            ? req.query.types.split(',').map((entry) => entry.trim()).filter(Boolean)
            : [];
        const where = {
            companyId,
            ...(unreadOnly ? { read: false } : {}),
            ...(types.length > 0 ? { type: { in: types } } : type ? { type: type } : {}),
            OR: [{ userId }, { userId: null }],
        };
        const [notifications, total, unreadCount] = await Promise.all([
            prisma_1.default.notification.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            prisma_1.default.notification.count({ where }),
            prisma_1.default.notification.count({
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
    }
    catch (err) {
        logger_1.default.error('Failed to fetch notifications', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});
/**
 * PATCH/PUT /api/notifications/:id/read
 * Mark a notification as read.
 */
const markReadHandler = async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const { id } = req.params;
        await prisma_1.default.notification.updateMany({
            where: { id, companyId },
            data: { read: true },
        });
        res.json({ message: 'Notification marked as read' });
    }
    catch (err) {
        logger_1.default.error('Failed to mark notification as read', { error: err.message });
        res.status(500).json({ error: 'Failed to update notification' });
    }
};
router.patch('/:id/read', markReadHandler);
router.put('/:id/read', markReadHandler);
/**
 * PATCH/PUT /api/notifications/read-all
 * Mark all notifications as read for the current user.
 */
const markAllReadHandler = async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const userId = req.user.id;
        await prisma_1.default.notification.updateMany({
            where: {
                companyId,
                OR: [{ userId }, { userId: null }],
            },
            data: { read: true },
        });
        res.json({ message: 'All notifications marked as read' });
    }
    catch (err) {
        logger_1.default.error('Failed to mark all notifications as read', { error: err.message });
        res.status(500).json({ error: 'Failed to update notifications' });
    }
};
router.patch('/read-all', markAllReadHandler);
router.put('/read-all', markAllReadHandler);
function handleDeleteError(err, res) {
    if (err instanceof resourceDelete_service_1.ResourceDeleteError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
    }
    const message = err instanceof Error ? err.message : 'Delete failed';
    logger_1.default.error('Delete failed', { error: message });
    res.status(500).json({ error: message });
}
/**
 * DELETE /api/notifications/all
 * Permanently delete all notifications visible to the current user.
 */
router.delete('/all', (0, rbac_1.authorize)('notifications', 'delete'), (0, audit_1.auditLog)('delete', 'notifications'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const count = await (0, resourceDelete_service_1.deleteAllNotificationsForUser)(companyId, req.user.id);
        res.json({ message: 'Notifications deleted', deleted: count });
    }
    catch (err) {
        handleDeleteError(err, res);
    }
});
/**
 * DELETE /api/notifications/:id
 * Permanently delete one notification.
 */
router.delete('/:id', (0, rbac_1.authorize)('notifications', 'delete'), (0, audit_1.auditLog)('delete', 'notifications'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        await (0, resourceDelete_service_1.deleteNotificationPermanently)(companyId, req.user.id, req.params.id);
        res.json({ message: 'Notification deleted' });
    }
    catch (err) {
        handleDeleteError(err, res);
    }
});
exports.default = router;

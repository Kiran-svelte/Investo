"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const tenant_1 = require("../middleware/tenant");
const featureGate_1 = require("../middleware/featureGate");
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.use(tenant_1.tenantIsolation);
router.use((req, res, next) => {
    if (req.user?.role === 'super_admin') {
        next();
        return;
    }
    return (0, featureGate_1.requireFeature)('audit_logs')(req, res, next);
});
/**
 * GET /api/audit
 * Get audit logs.
 * Super admin: all logs (optionally filtered by company)
 * Company admin: only own company logs
 */
router.get('/', (0, rbac_1.authorize)('audit_logs', 'read'), async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const skip = (page - 1) * limit;
        const where = {};
        if (req.user.role === 'super_admin') {
            const companyFilter = (typeof req.query.company_id === 'string' ? req.query.company_id.trim()
                : typeof req.query.target_company_id === 'string' ? req.query.target_company_id.trim()
                    : '');
            if (!companyFilter) {
                res.status(400).json({ error: 'company_id query parameter is required for platform audit access' });
                return;
            }
            where.companyId = companyFilter;
        }
        else {
            where.companyId = (0, tenant_1.getCompanyId)(req);
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
            const search = req.query.search;
            where.OR = [
                { user: { name: { contains: search, mode: 'insensitive' } } },
                { user: { email: { contains: search, mode: 'insensitive' } } },
                { resourceType: { contains: search, mode: 'insensitive' } },
            ];
        }
        const [logs, total] = await Promise.all([
            prisma_1.default.auditLog.findMany({
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
            prisma_1.default.auditLog.count({ where }),
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
    }
    catch (err) {
        logger_1.default.error('Failed to fetch audit logs', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});
/**
 * GET /api/audit/:id
 * Get single audit log entry.
 */
router.get('/:id', (0, rbac_1.authorize)('audit_logs', 'read'), async (req, res) => {
    try {
        const { id } = req.params;
        const where = { id };
        if (req.user.role === 'super_admin') {
            const companyFilter = (typeof req.query.company_id === 'string' ? req.query.company_id.trim()
                : typeof req.query.target_company_id === 'string' ? req.query.target_company_id.trim()
                    : '');
            if (!companyFilter) {
                res.status(400).json({ error: 'company_id query parameter is required for platform audit access' });
                return;
            }
            where.companyId = companyFilter;
        }
        else {
            where.companyId = (0, tenant_1.getCompanyId)(req);
        }
        const log = await prisma_1.default.auditLog.findFirst({
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
    }
    catch (err) {
        logger_1.default.error('Failed to fetch audit log', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch audit log' });
    }
});
exports.default = router;

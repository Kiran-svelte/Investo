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
const validate_1 = require("../middleware/validate");
const featureGate_1 = require("../middleware/featureGate");
const subscriptionEnforcement_1 = require("../middleware/subscriptionEnforcement");
const validation_1 = require("../models/validation");
const auth_service_1 = require("../services/auth.service");
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
    return (0, featureGate_1.requireFeature)('agent_management')(req, res, next);
});
/**
 * GET /api/users
 * Company admin: list all users in own company
 * Sales agent: list own profile only
 * Super admin: list all users (optionally filtered by target_company_id)
 */
router.get('/', (0, rbac_1.authorize)('users', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const where = {};
        if (req.user.role === 'super_admin') {
            // Super admin can see all or filter by company
            if (companyId && companyId !== req.user.company_id) {
                where.companyId = companyId;
            }
        }
        else if (req.user.role === 'sales_agent') {
            // Sales agent sees only self
            where.id = req.user.id;
        }
        else {
            // Company admin, operations, viewer see own company
            where.companyId = companyId;
        }
        // Role filter
        const { role } = req.query;
        if (role) {
            where.role = role;
        }
        const users = await prisma_1.default.user.findMany({
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
            const leadCounts = await prisma_1.default.lead.groupBy({
                by: ['assignedAgentId'],
                where: {
                    assignedAgentId: { in: userIds },
                    status: { notIn: ['closed_won', 'closed_lost'] },
                },
                _count: { id: true },
            });
            const leadMap = new Map(leadCounts.map((l) => [l.assignedAgentId, l._count.id]));
            const salesCounts = await prisma_1.default.lead.groupBy({
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
    }
    catch (err) {
        logger_1.default.error('Failed to fetch users', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});
/**
 * GET /api/users/:id
 */
router.get('/:id', (0, rbac_1.authorize)('users', 'read'), async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = (0, tenant_1.getCompanyId)(req);
        // Sales agent can only see self
        if (req.user.role === 'sales_agent' && id !== req.user.id) {
            res.status(403).json({ error: 'Can only view own profile' });
            return;
        }
        const where = { id };
        // Non-super_admin can only see users in own company
        if (req.user.role !== 'super_admin') {
            where.companyId = companyId;
        }
        const user = await prisma_1.default.user.findFirst({
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
    }
    catch (err) {
        logger_1.default.error('Failed to fetch user', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});
/**
 * POST /api/users
 * Company admin: create users in own company
 * Super admin: create users in any company (with target_company_id)
 */
router.post('/', (0, rbac_1.authorize)('users', 'create'), subscriptionEnforcement_1.requireActivePaidSubscription, (0, validate_1.validate)(validation_1.createUserSchema), (0, audit_1.auditLog)('create', 'users'), async (req, res) => {
    try {
        const { name, email, password, phone, role, target_company_id, must_change_password } = req.body;
        // Determine which company to create user in
        // Super admin can specify target_company_id, others use their own company
        let companyId;
        if (req.user.role === 'super_admin' && target_company_id) {
            companyId = target_company_id;
        }
        else {
            companyId = (0, tenant_1.getCompanyId)(req);
        }
        // Company admin cannot create super_admin role
        if (req.user.role === 'company_admin' && role === 'super_admin') {
            res.status(403).json({ error: 'Cannot create super admin users' });
            return;
        }
        // Check plan limits for agent count
        if (role === 'sales_agent' && req.user.role !== 'super_admin') {
            const company = await prisma_1.default.company.findFirst({
                where: { id: companyId },
                include: { plan: { select: { maxAgents: true } } },
            });
            if (!company?.plan) {
                res.status(402).json({ error: 'Active subscription plan required' });
                return;
            }
            const currentAgents = await prisma_1.default.user.count({
                where: { companyId, role: 'sales_agent', status: 'active' },
            });
            if (currentAgents >= company.plan.maxAgents) {
                res.status(403).json({ error: `Agent limit reached. Max agents: ${company.plan.maxAgents}` });
                return;
            }
        }
        const result = await auth_service_1.authService.register({
            name,
            email,
            password,
            phone,
            role,
            company_id: companyId,
            must_change_password,
        });
        res.status(201).json({ data: result, id: result.id });
    }
    catch (err) {
        if (err.message === 'Email already registered') {
            res.status(409).json({ error: err.message });
            return;
        }
        if (String(err.message || '').toLowerCase().includes('origin header')) {
            res.status(502).json({ error: `Identity provider configuration error: ${err.message}` });
            return;
        }
        logger_1.default.error('Failed to create user', { error: err.message });
        res.status(500).json({ error: 'Failed to create user' });
    }
});
/**
 * PUT /api/users/:id
 * Company admin: update users in own company
 * Sales agent: update own profile (limited fields)
 */
router.put('/:id', (0, rbac_1.authorize)('users', 'update'), (0, audit_1.auditLog)('update', 'users'), async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = (0, tenant_1.getCompanyId)(req);
        // Check the target user belongs to the same company
        const targetUser = await prisma_1.default.user.findFirst({ where: { id } });
        if (!targetUser) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        if (req.user.role !== 'super_admin' && targetUser.companyId !== companyId) {
            res.status(403).json({ error: 'Cannot modify users in other companies' });
            return;
        }
        // Sales agent can only update own profile (name, phone)
        if (req.user.role === 'sales_agent') {
            if (id !== req.user.id) {
                res.status(403).json({ error: 'Can only update own profile' });
                return;
            }
            const { name, phone } = req.body;
            await prisma_1.default.user.update({
                where: { id },
                data: {
                    ...(name && { name }),
                    ...(phone !== undefined && { phone }),
                },
            });
        }
        else {
            // Company admin or super admin
            const { name, phone, role, status } = req.body;
            // Cannot change to super_admin unless you are super_admin
            if (role === 'super_admin' && req.user.role !== 'super_admin') {
                res.status(403).json({ error: 'Cannot assign super admin role' });
                return;
            }
            await prisma_1.default.user.update({
                where: { id },
                data: {
                    ...(name && { name }),
                    ...(phone !== undefined && { phone }),
                    ...(role && { role }),
                    ...(status && { status }),
                },
            });
        }
        const updated = await prisma_1.default.user.findFirst({
            where: { id },
            select: { id: true, companyId: true, name: true, email: true, phone: true, role: true, status: true },
        });
        res.json({ data: updated });
    }
    catch (err) {
        logger_1.default.error('Failed to update user', { error: err.message });
        res.status(500).json({ error: 'Failed to update user' });
    }
});
/**
 * PATCH /api/users/:id/deactivate
 * Company admin: deactivate user in own company
 */
router.patch('/:id/deactivate', (0, rbac_1.authorize)('users', 'delete'), (0, audit_1.auditLog)('deactivate', 'users'), async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = (0, tenant_1.getCompanyId)(req);
        // Cannot deactivate self
        if (id === req.user.id) {
            res.status(400).json({ error: 'Cannot deactivate yourself' });
            return;
        }
        const targetUser = await prisma_1.default.user.findFirst({ where: { id } });
        if (!targetUser) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        if (req.user.role !== 'super_admin' && targetUser.companyId !== companyId) {
            res.status(403).json({ error: 'Cannot modify users in other companies' });
            return;
        }
        await prisma_1.default.user.update({
            where: { id },
            data: { status: 'inactive' },
        });
        res.json({ message: 'User deactivated' });
    }
    catch (err) {
        logger_1.default.error('Failed to deactivate user', { error: err.message });
        res.status(500).json({ error: 'Failed to deactivate user' });
    }
});
exports.default = router;
//# sourceMappingURL=user.routes.js.map
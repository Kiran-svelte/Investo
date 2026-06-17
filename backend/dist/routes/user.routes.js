"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const email_service_1 = require("../services/email.service");
const config_1 = __importDefault(require("../config"));
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const pagination_1 = require("../utils/pagination");
const resourceDelete_service_1 = require("../services/resourceDelete.service");
const staffPhoneUniqueness_1 = require("../utils/staffPhoneUniqueness");
const branchScope_service_1 = require("../identity/org/branchScope.service");
const router = (0, express_1.Router)();
function mapUserResponse(user) {
    return {
        id: user.id,
        company_id: user.companyId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        last_login: user.lastLogin ?? null,
        created_at: user.createdAt ?? null,
        branch_id: user.branchId || null,
        branch_name: user.branch?.name || null,
        active_leads: user.active_leads,
        sales_count: user.sales_count,
    };
}
router.use(auth_1.authenticate);
router.use(tenant_1.strictTenantIsolation);
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
            where.companyId = companyId;
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
        const { role, branch_id: branchFilter } = req.query;
        if (role) {
            where.role = role;
        }
        if (branchFilter && (0, branchScope_service_1.isOrgBranchesEnabled)()) {
            where.branchId = branchFilter;
        }
        const { page, limit, offset } = (0, pagination_1.parsePagination)(req.query);
        const [users, total] = await Promise.all([
            prisma_1.default.user.findMany({
                where,
                select: {
                    id: true, companyId: true, name: true, email: true, phone: true,
                    role: true, status: true, lastLogin: true, createdAt: true,
                    branchId: true,
                    branch: { select: { name: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip: offset,
                take: limit,
            }),
            prisma_1.default.user.count({ where }),
        ]);
        // Enrich with lead counts for agents
        if (users.length > 0) {
            const userIds = users.map((u) => u.id);
            const leadCountScope = {
                assignedAgentId: { in: userIds },
                status: { notIn: ['closed_won', 'closed_lost'] },
            };
            if (where.companyId)
                leadCountScope.companyId = where.companyId;
            const leadCounts = await prisma_1.default.lead.groupBy({
                by: ['assignedAgentId'],
                where: leadCountScope,
                _count: { id: true },
            });
            const leadMap = new Map(leadCounts.map((l) => [l.assignedAgentId, l._count.id]));
            const salesCountScope = {
                assignedAgentId: { in: userIds },
                status: 'closed_won',
            };
            if (where.companyId)
                salesCountScope.companyId = where.companyId;
            const salesCounts = await prisma_1.default.lead.groupBy({
                by: ['assignedAgentId'],
                where: salesCountScope,
                _count: { id: true },
            });
            const salesMap = new Map(salesCounts.map((s) => [s.assignedAgentId, s._count.id]));
            const enriched = users.map((u) => mapUserResponse({
                ...u,
                active_leads: leadMap.get(u.id) || 0,
                sales_count: salesMap.get(u.id) || 0,
            }));
            res.json({
                data: enriched,
                pagination: (0, pagination_1.buildPaginationMeta)(page, limit, total),
            });
            return;
        }
        res.json({
            data: users.map((u) => mapUserResponse(u)),
            pagination: (0, pagination_1.buildPaginationMeta)(page, limit, total),
        });
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
                branchId: true,
                branch: { select: { name: true } },
            },
        });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        res.json({ data: mapUserResponse(user) });
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
        const { name, email, password, phone, role, target_company_id, must_change_password, branch_id } = req.body;
        const queryTargetCompanyId = typeof req.query.target_company_id === 'string' ? req.query.target_company_id : undefined;
        const resolvedTargetCompanyId = target_company_id || queryTargetCompanyId;
        // Determine which company to create user in
        // Super admin can specify target_company_id (body or query), others use their own company
        let companyId;
        if (req.user.role === 'super_admin' && resolvedTargetCompanyId) {
            companyId = resolvedTargetCompanyId;
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
        if (branch_id && (0, branchScope_service_1.isOrgBranchesEnabled)()) {
            await (0, branchScope_service_1.assertBranchBelongsToCompany)(companyId, branch_id);
        }
        const result = await auth_service_1.authService.register({
            name,
            email,
            password,
            phone,
            role,
            company_id: companyId,
            must_change_password,
            branch_id: branch_id && (0, branchScope_service_1.isOrgBranchesEnabled)() ? branch_id : null,
        });
        if (role === 'company_admin') {
            const company = await prisma_1.default.company.findUnique({
                where: { id: companyId },
                select: { name: true },
            });
            const loginUrl = `${config_1.default.frontend.baseUrl.replace(/\/$/, '')}/login`;
            void email_service_1.emailService.sendWelcomeInviteEmail({
                toEmail: email,
                toName: name,
                loginUrl,
                temporaryPassword: password,
                companyName: company?.name,
            }).catch((mailErr) => {
                logger_1.default.warn('Welcome invite email failed', { error: mailErr.message, email });
            });
        }
        res.status(201).json({ data: result, id: result.id });
    }
    catch (err) {
        if ((0, staffPhoneUniqueness_1.isStaffPhoneInUseError)(err)) {
            res.status(409).json({ error: err.message });
            return;
        }
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
        const selfServiceRoles = new Set(['sales_agent', 'operations', 'viewer']);
        if (selfServiceRoles.has(req.user.role)) {
            if (id !== req.user.id) {
                res.status(403).json({ error: 'Can only update own profile' });
                return;
            }
            const { name, phone } = req.body;
            const { normalizeStaffProfilePhone } = await Promise.resolve().then(() => __importStar(require('../utils/userProfilePhone')));
            const normalizedPhone = phone !== undefined && phone !== null && String(phone).trim()
                ? normalizeStaffProfilePhone(String(phone))
                : undefined;
            if (phone !== undefined && phone !== null && String(phone).trim() && !normalizedPhone) {
                res.status(400).json({ error: 'Enter a valid Indian mobile number (10 digits).' });
                return;
            }
            if (normalizedPhone) {
                await (0, staffPhoneUniqueness_1.assertStaffPhoneAvailable)(normalizedPhone, id);
            }
            await prisma_1.default.user.update({
                where: { id },
                data: {
                    ...(name && { name }),
                    ...(normalizedPhone !== undefined && { phone: normalizedPhone }),
                },
            });
        }
        else {
            // Company admin or super admin
            const { name, phone, role, status, branch_id } = req.body;
            const { normalizeStaffProfilePhone } = await Promise.resolve().then(() => __importStar(require('../utils/userProfilePhone')));
            // Cannot change to super_admin unless you are super_admin
            if (role === 'super_admin' && req.user.role !== 'super_admin') {
                res.status(403).json({ error: 'Cannot assign super admin role' });
                return;
            }
            let phoneToSave;
            if (phone !== undefined) {
                if (phone === null || String(phone).trim() === '') {
                    phoneToSave = null;
                }
                else {
                    const normalized = normalizeStaffProfilePhone(String(phone));
                    if (!normalized) {
                        res.status(400).json({ error: 'Enter a valid Indian mobile number (10 digits).' });
                        return;
                    }
                    await (0, staffPhoneUniqueness_1.assertStaffPhoneAvailable)(normalized, id);
                    phoneToSave = normalized;
                }
            }
            if (branch_id !== undefined && (0, branchScope_service_1.isOrgBranchesEnabled)()) {
                if (branch_id) {
                    await (0, branchScope_service_1.assertBranchBelongsToCompany)(targetUser.companyId, branch_id);
                }
            }
            await prisma_1.default.user.update({
                where: { id },
                data: {
                    ...(name && { name }),
                    ...(phoneToSave !== undefined && { phone: phoneToSave }),
                    ...(role && { role }),
                    ...(status && { status }),
                    ...(branch_id !== undefined && (0, branchScope_service_1.isOrgBranchesEnabled)()
                        ? { branchId: branch_id || null }
                        : {}),
                },
            });
        }
        const updated = await prisma_1.default.user.findFirst({
            where: { id },
            select: {
                id: true,
                companyId: true,
                name: true,
                email: true,
                phone: true,
                role: true,
                status: true,
                branchId: true,
                branch: { select: { name: true } },
            },
        });
        res.json({ data: mapUserResponse(updated) });
    }
    catch (err) {
        if ((0, staffPhoneUniqueness_1.isStaffPhoneInUseError)(err)) {
            res.status(409).json({ error: err.message });
            return;
        }
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
/**
 * DELETE /api/users/:id
 * Permanently delete a user (company admin / super admin). Prefer deactivate when unsure.
 */
router.delete('/:id', (0, rbac_1.authorize)('users', 'delete'), (0, audit_1.auditLog)('delete', 'users'), async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = (0, tenant_1.getCompanyId)(req);
        const targetUser = await prisma_1.default.user.findFirst({ where: { id } });
        if (!targetUser) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        if (req.user.role !== 'super_admin' && targetUser.companyId !== companyId) {
            res.status(403).json({ error: 'Cannot delete users in other companies' });
            return;
        }
        await (0, resourceDelete_service_1.deleteUserPermanently)(targetUser.companyId, id, req.user.id);
        res.json({ message: 'User deleted permanently' });
    }
    catch (err) {
        if (err instanceof resourceDelete_service_1.ResourceDeleteError) {
            res.status(err.statusCode).json({ error: err.message });
            return;
        }
        const message = err instanceof Error ? err.message : 'Delete failed';
        logger_1.default.error('Failed to delete user', { error: message });
        res.status(500).json({ error: 'Failed to delete user' });
    }
});
exports.default = router;

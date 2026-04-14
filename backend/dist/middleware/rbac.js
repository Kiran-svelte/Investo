"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorize = authorize;
exports.hasRole = hasRole;
const prisma_1 = __importDefault(require("../config/prisma"));
const redis_1 = require("../config/redis");
// System roles (hardcoded for super_admin and company_admin)
const SYSTEM_PERMISSIONS = {
    super_admin: {
        platform_settings: ['create', 'read', 'update', 'delete'],
        companies: ['create', 'read', 'update', 'delete'],
        subscriptions: ['create', 'read', 'update', 'delete'],
        users: ['create', 'read', 'update', 'delete'],
        leads: ['create', 'read', 'update', 'delete'],
        properties: ['create', 'read', 'update', 'delete'],
        conversations: ['read'],
        visits: ['create', 'read', 'update', 'delete'],
        analytics: ['read'],
        ai_settings: ['create', 'read', 'update', 'delete'],
        audit_logs: ['read'],
        notifications: ['read'],
    },
    company_admin: {
        companies: ['read'],
        subscriptions: ['read'],
        users: ['create', 'read', 'update', 'delete'],
        leads: ['create', 'read', 'update', 'delete'],
        properties: ['create', 'read', 'update', 'delete'],
        conversations: ['read'],
        visits: ['create', 'read', 'update', 'delete'],
        analytics: ['read'],
        ai_settings: ['create', 'read', 'update', 'delete'],
        audit_logs: ['read'],
        notifications: ['read', 'update'],
    },
};
// Fallback for system roles that don't have custom company_roles
const FALLBACK_PERMISSIONS = {
    sales_agent: {
        users: ['read'],
        leads: ['read', 'update'],
        properties: ['read'],
        conversations: ['read'],
        visits: ['create', 'read', 'update', 'delete'],
        analytics: ['read'],
        notifications: ['read', 'update'],
    },
    operations: {
        users: ['read'],
        leads: ['read'],
        properties: ['read'],
        conversations: ['read'],
        visits: ['read', 'update'],
        analytics: ['read'],
        notifications: ['read', 'update'],
    },
    viewer: {
        users: ['read'],
        leads: ['read'],
        properties: ['read'],
        visits: ['read'],
        analytics: ['read'],
        audit_logs: ['read'],
        notifications: ['read'],
    },
};
/**
 * Resolve permissions for a user:
 * 1. super_admin / company_admin → hardcoded system permissions
 * 2. Other roles → check company_roles table for dynamic permissions
 * 3. Fallback → use FALLBACK_PERMISSIONS for system role names
 */
async function resolvePermissions(role, companyId, customRoleId) {
    // System roles always use hardcoded permissions
    if (role === 'super_admin' || role === 'company_admin') {
        return SYSTEM_PERMISSIONS[role] || null;
    }
    // Try dynamic: check if company has a custom role configured
    const cacheKey = `rbac:${companyId}:${customRoleId || role}`;
    const cached = await (0, redis_1.cacheGet)(cacheKey);
    if (cached)
        return cached;
    // Check custom role by ID first (if user has one assigned)
    if (customRoleId) {
        const customRole = await prisma_1.default.companyRole.findFirst({
            where: { id: customRoleId, companyId },
        });
        if (customRole && customRole.permissions) {
            const perms = customRole.permissions;
            await (0, redis_1.cacheSet)(cacheKey, perms, 300);
            return perms;
        }
    }
    // Check company_roles table for this role name
    const companyRole = await prisma_1.default.companyRole.findFirst({
        where: { companyId, roleName: role },
    });
    if (companyRole && companyRole.permissions) {
        const perms = companyRole.permissions;
        await (0, redis_1.cacheSet)(cacheKey, perms, 300);
        return perms;
    }
    // Fallback to hardcoded
    return FALLBACK_PERMISSIONS[role] || null;
}
function authorize(resource, permission) {
    return async (req, res, next) => {
        const user = req.user;
        if (!user) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const companyId = user.companyId || '';
        const customRoleId = user.customRoleId || null;
        const perms = await resolvePermissions(user.role, companyId, customRoleId);
        if (!perms) {
            res.status(403).json({ error: 'Unknown role' });
            return;
        }
        const resourcePerms = perms[resource];
        if (!resourcePerms || !resourcePerms.includes(permission)) {
            res.status(403).json({ error: 'Insufficient permissions' });
            return;
        }
        next();
    };
}
function hasRole(...roles) {
    return (req, res, next) => {
        const user = req.user;
        if (!user) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        if (!roles.includes(user.role)) {
            res.status(403).json({ error: 'Insufficient role' });
            return;
        }
        next();
    };
}
//# sourceMappingURL=rbac.js.map
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const tenant_1 = require("../middleware/tenant");
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.use(tenant_1.tenantIsolation);
// Available permission resources and actions
const VALID_RESOURCES = [
    'users', 'leads', 'properties', 'conversations', 'visits',
    'analytics', 'ai_settings', 'audit_logs', 'notifications',
];
const VALID_ACTIONS = ['create', 'read', 'update', 'delete'];
function validatePermissions(permissions) {
    if (typeof permissions !== 'object' || permissions === null)
        return false;
    for (const [resource, actions] of Object.entries(permissions)) {
        if (!VALID_RESOURCES.includes(resource))
            return false;
        if (!Array.isArray(actions))
            return false;
        for (const action of actions) {
            if (!VALID_ACTIONS.includes(action))
                return false;
        }
    }
    return true;
}
/**
 * GET /api/roles
 * List all roles for this company (system defaults + custom)
 */
router.get('/', (0, rbac_1.authorize)('users', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const roles = await prisma_1.default.companyRole.findMany({
            where: { companyId },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        });
        // Also include system roles info
        const systemRoles = [
            { roleName: 'super_admin', displayName: 'Super Admin', isSystem: true },
            { roleName: 'company_admin', displayName: 'Company Admin', isSystem: true },
        ];
        res.json({ data: { customRoles: roles, systemRoles } });
    }
    catch (err) {
        logger_1.default.error('Failed to list roles', { error: err.message });
        res.status(500).json({ error: 'Failed to list roles' });
    }
});
/**
 * POST /api/roles
 * Create a custom role for this company
 */
router.post('/', (0, rbac_1.authorize)('users', 'create'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const { role_name, display_name, permissions } = req.body;
        if (!role_name || !display_name) {
            res.status(400).json({ error: 'role_name and display_name are required' });
            return;
        }
        if (permissions && !validatePermissions(permissions)) {
            res.status(400).json({
                error: 'Invalid permissions format',
                expected: '{ "leads": ["read", "update"], "properties": ["read"] }',
                validResources: VALID_RESOURCES,
                validActions: VALID_ACTIONS,
            });
            return;
        }
        // Check unique
        const existing = await prisma_1.default.companyRole.findUnique({
            where: { companyId_roleName: { companyId, roleName: role_name } },
        });
        if (existing) {
            res.status(409).json({ error: `Role '${role_name}' already exists` });
            return;
        }
        const role = await prisma_1.default.companyRole.create({
            data: {
                companyId,
                roleName: role_name,
                displayName: display_name,
                permissions: permissions || {},
                isDefault: false,
            },
        });
        res.status(201).json({ data: role });
    }
    catch (err) {
        logger_1.default.error('Failed to create role', { error: err.message });
        res.status(500).json({ error: 'Failed to create role' });
    }
});
/**
 * PUT /api/roles/:id
 * Update a custom role's permissions
 */
router.put('/:id', (0, rbac_1.authorize)('users', 'update'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const { id } = req.params;
        const { display_name, permissions } = req.body;
        const role = await prisma_1.default.companyRole.findFirst({
            where: { id, companyId },
        });
        if (!role) {
            res.status(404).json({ error: 'Role not found' });
            return;
        }
        if (role.isDefault) {
            res.status(403).json({ error: 'Cannot modify default system roles' });
            return;
        }
        if (permissions && !validatePermissions(permissions)) {
            res.status(400).json({ error: 'Invalid permissions format' });
            return;
        }
        const updated = await prisma_1.default.companyRole.update({
            where: { id },
            data: {
                ...(display_name && { displayName: display_name }),
                ...(permissions && { permissions }),
            },
        });
        res.json({ data: updated });
    }
    catch (err) {
        logger_1.default.error('Failed to update role', { error: err.message });
        res.status(500).json({ error: 'Failed to update role' });
    }
});
/**
 * DELETE /api/roles/:id
 * Delete a custom role (not default roles)
 */
router.delete('/:id', (0, rbac_1.authorize)('users', 'delete'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const { id } = req.params;
        const role = await prisma_1.default.companyRole.findFirst({
            where: { id, companyId },
            include: { users: { select: { id: true } } },
        });
        if (!role) {
            res.status(404).json({ error: 'Role not found' });
            return;
        }
        if (role.isDefault) {
            res.status(403).json({ error: 'Cannot delete default system roles' });
            return;
        }
        if (role.users.length > 0) {
            res.status(409).json({
                error: `Cannot delete role with ${role.users.length} assigned users. Reassign them first.`,
            });
            return;
        }
        await prisma_1.default.companyRole.delete({ where: { id } });
        res.json({ message: 'Role deleted' });
    }
    catch (err) {
        logger_1.default.error('Failed to delete role', { error: err.message });
        res.status(500).json({ error: 'Failed to delete role' });
    }
});
exports.default = router;

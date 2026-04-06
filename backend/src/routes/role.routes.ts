import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import prisma from '../config/prisma';
import logger from '../config/logger';

const router = Router();

router.use(authenticate);
router.use(tenantIsolation);

// Available permission resources and actions
const VALID_RESOURCES = [
  'users', 'leads', 'properties', 'conversations', 'visits',
  'analytics', 'ai_settings', 'audit_logs', 'notifications',
] as const;
const VALID_ACTIONS = ['create', 'read', 'update', 'delete'] as const;

function validatePermissions(permissions: any): boolean {
  if (typeof permissions !== 'object' || permissions === null) return false;
  for (const [resource, actions] of Object.entries(permissions)) {
    if (!VALID_RESOURCES.includes(resource as any)) return false;
    if (!Array.isArray(actions)) return false;
    for (const action of actions) {
      if (!VALID_ACTIONS.includes(action as any)) return false;
    }
  }
  return true;
}

/**
 * GET /api/roles
 * List all roles for this company (system defaults + custom)
 */
router.get(
  '/',
  authorize('users', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const roles = await prisma.companyRole.findMany({
        where: { companyId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });

      // Also include system roles info
      const systemRoles = [
        { roleName: 'super_admin', displayName: 'Super Admin', isSystem: true },
        { roleName: 'company_admin', displayName: 'Company Admin', isSystem: true },
      ];

      res.json({ data: { customRoles: roles, systemRoles } });
    } catch (err: any) {
      logger.error('Failed to list roles', { error: err.message });
      res.status(500).json({ error: 'Failed to list roles' });
    }
  }
);

/**
 * POST /api/roles
 * Create a custom role for this company
 */
router.post(
  '/',
  authorize('users', 'create'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
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
      const existing = await prisma.companyRole.findUnique({
        where: { companyId_roleName: { companyId, roleName: role_name } },
      });
      if (existing) {
        res.status(409).json({ error: `Role '${role_name}' already exists` });
        return;
      }

      const role = await prisma.companyRole.create({
        data: {
          companyId,
          roleName: role_name,
          displayName: display_name,
          permissions: permissions || {},
          isDefault: false,
        },
      });

      res.status(201).json({ data: role });
    } catch (err: any) {
      logger.error('Failed to create role', { error: err.message });
      res.status(500).json({ error: 'Failed to create role' });
    }
  }
);

/**
 * PUT /api/roles/:id
 * Update a custom role's permissions
 */
router.put(
  '/:id',
  authorize('users', 'update'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;
      const { display_name, permissions } = req.body;

      const role = await prisma.companyRole.findFirst({
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

      const updated = await prisma.companyRole.update({
        where: { id },
        data: {
          ...(display_name && { displayName: display_name }),
          ...(permissions && { permissions }),
        },
      });

      res.json({ data: updated });
    } catch (err: any) {
      logger.error('Failed to update role', { error: err.message });
      res.status(500).json({ error: 'Failed to update role' });
    }
  }
);

/**
 * DELETE /api/roles/:id
 * Delete a custom role (not default roles)
 */
router.delete(
  '/:id',
  authorize('users', 'delete'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;

      const role = await prisma.companyRole.findFirst({
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

      await prisma.companyRole.delete({ where: { id } });
      res.json({ message: 'Role deleted' });
    } catch (err: any) {
      logger.error('Failed to delete role', { error: err.message });
      res.status(500).json({ error: 'Failed to delete role' });
    }
  }
);

export default router;

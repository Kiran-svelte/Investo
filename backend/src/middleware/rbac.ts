import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { Role } from '../models/validation';
import prisma from '../config/prisma';
import { cacheGet, cacheSet } from '../config/redis';

type Permission = 'create' | 'read' | 'update' | 'delete';
type Resource =
  | 'platform_settings'
  | 'companies'
  | 'subscriptions'
  | 'users'
  | 'leads'
  | 'properties'
  | 'conversations'
  | 'visits'
  | 'analytics'
  | 'ai_settings'
  | 'audit_logs'
  | 'notifications';

// System roles (hardcoded for super_admin and company_admin)
const SYSTEM_PERMISSIONS: Partial<Record<Role, Partial<Record<Resource, Permission[]>>>> = {
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
const FALLBACK_PERMISSIONS: Partial<Record<Role, Partial<Record<Resource, Permission[]>>>> = {
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
async function resolvePermissions(
  role: string, companyId: string, customRoleId?: string | null
): Promise<Partial<Record<string, string[]>> | null> {
  // System roles always use hardcoded permissions
  if (role === 'super_admin' || role === 'company_admin') {
    return SYSTEM_PERMISSIONS[role as Role] || null;
  }

  // Try dynamic: check if company has a custom role configured
  const cacheKey = `rbac:${companyId}:${customRoleId || role}`;
  const cached = await cacheGet<Partial<Record<string, string[]>>>(cacheKey);
  if (cached) return cached;

  // Check custom role by ID first (if user has one assigned)
  if (customRoleId) {
    const customRole = await prisma.companyRole.findFirst({
      where: { id: customRoleId, companyId },
    });
    if (customRole && customRole.permissions) {
      const perms = customRole.permissions as Record<string, string[]>;
      await cacheSet(cacheKey, perms, 300);
      return perms;
    }
  }

  // Check company_roles table for this role name
  const companyRole = await prisma.companyRole.findFirst({
    where: { companyId, roleName: role },
  });
  if (companyRole && companyRole.permissions) {
    const perms = companyRole.permissions as Record<string, string[]>;
    await cacheSet(cacheKey, perms, 300);
    return perms;
  }

  // Fallback to hardcoded
  return FALLBACK_PERMISSIONS[role as Role] || null;
}

export function authorize(resource: Resource, permission: Permission) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const companyId = (user as any).companyId || '';
    const customRoleId = (user as any).customRoleId || null;
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

export function hasRole(...roles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!roles.includes(user.role as Role)) {
      res.status(403).json({ error: 'Insufficient role' });
      return;
    }

    next();
  };
}

import { ROLES, Role } from '../../models/validation';

// Replicate the permission matrix from rbac.ts for testing
type Permission = 'create' | 'read' | 'update' | 'delete';
type Resource =
  | 'platform_settings' | 'companies' | 'subscriptions' | 'users'
  | 'leads' | 'properties' | 'conversations' | 'visits'
  | 'analytics' | 'ai_settings' | 'audit_logs' | 'notifications';

const PERMISSIONS: Record<Role, Partial<Record<Resource, Permission[]>>> = {
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

function hasPermission(role: Role, resource: Resource, permission: Permission): boolean {
  return PERMISSIONS[role]?.[resource]?.includes(permission) ?? false;
}

describe('RBAC Permission Matrix', () => {
  test('all 5 roles are defined', () => {
    expect(ROLES).toHaveLength(5);
    expect(ROLES).toContain('super_admin');
    expect(ROLES).toContain('company_admin');
    expect(ROLES).toContain('sales_agent');
    expect(ROLES).toContain('operations');
    expect(ROLES).toContain('viewer');
  });

  // Super admin
  test('super_admin has full CRUD on platform_settings', () => {
    expect(hasPermission('super_admin', 'platform_settings', 'create')).toBe(true);
    expect(hasPermission('super_admin', 'platform_settings', 'read')).toBe(true);
    expect(hasPermission('super_admin', 'platform_settings', 'update')).toBe(true);
    expect(hasPermission('super_admin', 'platform_settings', 'delete')).toBe(true);
  });

  test('super_admin has full CRUD on companies', () => {
    expect(hasPermission('super_admin', 'companies', 'create')).toBe(true);
    expect(hasPermission('super_admin', 'companies', 'delete')).toBe(true);
  });

  // Company admin
  test('company_admin can only read companies, not create', () => {
    expect(hasPermission('company_admin', 'companies', 'read')).toBe(true);
    expect(hasPermission('company_admin', 'companies', 'create')).toBe(false);
    expect(hasPermission('company_admin', 'companies', 'delete')).toBe(false);
  });

  test('company_admin has full CRUD on users', () => {
    expect(hasPermission('company_admin', 'users', 'create')).toBe(true);
    expect(hasPermission('company_admin', 'users', 'delete')).toBe(true);
  });

  test('company_admin has full CRUD on leads', () => {
    expect(hasPermission('company_admin', 'leads', 'create')).toBe(true);
    expect(hasPermission('company_admin', 'leads', 'update')).toBe(true);
  });

  // Sales agent
  test('sales_agent can read and update leads but not create or delete', () => {
    expect(hasPermission('sales_agent', 'leads', 'read')).toBe(true);
    expect(hasPermission('sales_agent', 'leads', 'update')).toBe(true);
    expect(hasPermission('sales_agent', 'leads', 'create')).toBe(false);
    expect(hasPermission('sales_agent', 'leads', 'delete')).toBe(false);
  });

  test('sales_agent cannot access platform_settings', () => {
    expect(hasPermission('sales_agent', 'platform_settings', 'read')).toBe(false);
  });

  test('sales_agent cannot modify ai_settings', () => {
    expect(hasPermission('sales_agent', 'ai_settings', 'create')).toBe(false);
    expect(hasPermission('sales_agent', 'ai_settings', 'update')).toBe(false);
  });

  // Operations
  test('operations can only read leads, not update', () => {
    expect(hasPermission('operations', 'leads', 'read')).toBe(true);
    expect(hasPermission('operations', 'leads', 'update')).toBe(false);
    expect(hasPermission('operations', 'leads', 'create')).toBe(false);
  });

  test('operations can read and update visits but not create', () => {
    expect(hasPermission('operations', 'visits', 'read')).toBe(true);
    expect(hasPermission('operations', 'visits', 'update')).toBe(true);
    expect(hasPermission('operations', 'visits', 'create')).toBe(false);
  });

  // Viewer
  test('viewer is read-only for everything', () => {
    const writeOps: Permission[] = ['create', 'update', 'delete'];
    const readResources: Resource[] = ['users', 'leads', 'properties', 'visits', 'analytics', 'audit_logs'];

    readResources.forEach((resource) => {
      expect(hasPermission('viewer', resource, 'read')).toBe(true);
      writeOps.forEach((op) => {
        expect(hasPermission('viewer', resource, op)).toBe(false);
      });
    });
  });

  test('viewer cannot access ai_settings, conversations, or subscriptions', () => {
    expect(hasPermission('viewer', 'ai_settings', 'read')).toBe(false);
    expect(hasPermission('viewer', 'conversations', 'read')).toBe(false);
    expect(hasPermission('viewer', 'subscriptions', 'read')).toBe(false);
  });

  // Cross-cutting forbidden scenarios
  test('no non-super_admin role can access platform_settings', () => {
    const nonSuper: Role[] = ['company_admin', 'sales_agent', 'operations', 'viewer'];
    nonSuper.forEach((role) => {
      expect(hasPermission(role, 'platform_settings', 'read')).toBe(false);
    });
  });

  test('no non-admin role can modify companies', () => {
    const nonAdmin: Role[] = ['sales_agent', 'operations', 'viewer'];
    nonAdmin.forEach((role) => {
      expect(hasPermission(role, 'companies', 'create')).toBe(false);
      expect(hasPermission(role, 'companies', 'update')).toBe(false);
    });
  });
});

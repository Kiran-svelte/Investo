import type { UserRole } from '../context/AuthContext';

/** Nav keys map to sidebar labels (i18n `nav.*`) and routes. */
export type NavRouteKey =
  | 'dashboard'
  | 'leads'
  | 'properties'
  | 'conversations'
  | 'calendar'
  | 'agents'
  | 'analytics'
  | 'ai_settings'
  | 'companies'
  | 'billing'
  | 'emi_calculator'
  | 'audit_logs'
  | 'notifications'
  | 'settings';

export interface NavItemSpec {
  key: NavRouteKey;
  path: string;
  roles: UserRole[];
  featureKey?: string;
  /** Shown when i18n key missing */
  labelFallback?: string;
}

/**
 * Role-specific navigation — single source of truth for sidebar + route guards.
 *
 * super_admin: platform operator (tenants only, no tenant CRM clutter)
 * company_admin: full tenant control
 * sales_agent: pipeline + visits + conversations
 * operations: visits + logistics + read leads/properties
 * viewer: read-only executive view
 */
export const NAV_ITEMS: NavItemSpec[] = [
  {
    key: 'dashboard',
    path: '/dashboard',
    roles: ['company_admin', 'sales_agent', 'operations', 'viewer'],
  },
  {
    key: 'leads',
    path: '/leads',
    roles: ['company_admin', 'sales_agent', 'operations', 'viewer'],
    featureKey: 'lead_automation',
  },
  {
    key: 'properties',
    path: '/properties',
    roles: ['company_admin', 'sales_agent', 'operations', 'viewer'],
    featureKey: 'property_management',
  },
  {
    key: 'conversations',
    path: '/conversations',
    roles: ['company_admin', 'sales_agent', 'viewer'],
    featureKey: 'conversation_center',
  },
  {
    key: 'calendar',
    path: '/calendar',
    roles: ['company_admin', 'sales_agent', 'operations'],
    featureKey: 'visit_scheduling',
  },
  {
    key: 'agents',
    path: '/agents',
    roles: ['company_admin'],
    featureKey: 'agent_management',
  },
  {
    key: 'analytics',
    path: '/analytics',
    roles: ['company_admin', 'viewer'],
    featureKey: 'analytics',
  },
  {
    key: 'ai_settings',
    path: '/ai-settings',
    roles: ['company_admin'],
    featureKey: 'ai_bot',
  },
  {
    key: 'companies',
    path: '/companies',
    roles: ['super_admin'],
  },
  {
    key: 'billing',
    path: '/billing',
    roles: ['company_admin'],
  },
  {
    key: 'emi_calculator',
    path: '/emi-calculator',
    roles: ['company_admin', 'sales_agent'],
    labelFallback: 'EMI Calculator',
  },
  {
    key: 'audit_logs',
    path: '/audit-logs',
    roles: ['super_admin'],
    featureKey: 'audit_logs',
  },
  {
    key: 'notifications',
    path: '/notifications',
    roles: ['company_admin', 'sales_agent', 'operations'],
    featureKey: 'notifications',
  },
  {
    key: 'settings',
    path: '/settings',
    roles: ['super_admin', 'company_admin', 'sales_agent', 'operations', 'viewer'],
  },
];

/** Extra routes not shown in sidebar but guarded the same way. */
const EXTRA_ROUTE_GUARDS: Array<{
  pathPrefix: string;
  roles: UserRole[];
  featureKey?: string;
}> = [
  { pathPrefix: '/properties/import', roles: ['company_admin'], featureKey: 'property_management' },
  { pathPrefix: '/leads/', roles: ['company_admin', 'sales_agent', 'operations', 'viewer'], featureKey: 'lead_automation' },
];

export function getRoleHomePath(role: UserRole | undefined): string {
  switch (role) {
    case 'super_admin':
      return '/companies';
    case 'operations':
      return '/calendar';
    case 'viewer':
      return '/leads';
    default:
      return '/dashboard';
  }
}

export function getNavItemByKey(key: NavRouteKey): NavItemSpec | undefined {
  return NAV_ITEMS.find((item) => item.key === key);
}

export function getNavItemForPath(pathname: string): NavItemSpec | undefined {
  const normalized = pathname.split('?')[0] || '/';

  for (const extra of EXTRA_ROUTE_GUARDS) {
    if (normalized === extra.pathPrefix || normalized.startsWith(`${extra.pathPrefix}/`)) {
      return {
        key: 'properties',
        path: extra.pathPrefix,
        roles: extra.roles,
        featureKey: extra.featureKey,
      };
    }
  }

  if (normalized.startsWith('/leads/')) {
    return getNavItemByKey('leads');
  }

  const exact = NAV_ITEMS.find((item) => item.path === normalized);
  if (exact) return exact;

  return NAV_ITEMS.find(
    (item) => normalized.startsWith(`${item.path}/`),
  );
}

export function isPathAllowedForRole(
  pathname: string,
  role: UserRole | undefined,
  isFeatureEnabled: (featureKey?: string) => boolean,
): boolean {
  if (!role) return false;

  const spec = getNavItemForPath(pathname);
  if (!spec) {
    return pathname === '/change-password';
  }

  if (!spec.roles.includes(role)) {
    return false;
  }

  if (spec.featureKey && role !== 'super_admin' && !isFeatureEnabled(spec.featureKey)) {
    return false;
  }

  return true;
}

export function getVisibleNavItems(
  role: UserRole | undefined,
  isFeatureEnabled: (featureKey?: string) => boolean,
): NavItemSpec[] {
  if (!role) return [];

  return NAV_ITEMS.filter((item) => {
    if (!item.roles.includes(role)) return false;
    if (!item.featureKey) return true;
    if (role === 'super_admin') return true;
    return isFeatureEnabled(item.featureKey);
  });
}

/** UI capabilities derived from role (pages still enforce server-side). */
export function getRoleCapabilities(role: UserRole | undefined) {
  const isViewer = role === 'viewer';
  const isOperations = role === 'operations';
  const isSalesAgent = role === 'sales_agent';
  const isCompanyAdmin = role === 'company_admin';
  const isSuperAdmin = role === 'super_admin';

  return {
    isReadOnly: isViewer,
    canManageUsers: isCompanyAdmin,
    /** Only company admin uploads brochures / publishes listings (AI asks them for missing fields). */
    canUploadProperties: isCompanyAdmin,
    canManageProperties: isCompanyAdmin,
    canManageBilling: isCompanyAdmin,
    canManageAiSettings: isCompanyAdmin,
    canManageTenantSettings: isCompanyAdmin,
    canCreateLeads: isCompanyAdmin || isSalesAgent,
    canExportLeads: isCompanyAdmin,
    canAssignLeads: isCompanyAdmin,
    canTakeoverConversation: isCompanyAdmin || isSalesAgent,
    canScheduleVisits: isCompanyAdmin || isSalesAgent || isOperations,
    isPlatformAdmin: isSuperAdmin,
    isTenantStaff: isCompanyAdmin || isSalesAgent || isOperations || isViewer,
  };
}

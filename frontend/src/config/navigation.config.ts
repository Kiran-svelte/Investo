import type { UserRole } from '../context/AuthContext';

/** Authenticated app shell — all tenant CRM routes live under this prefix. */
export const DASHBOARD_BASE = '/dashboard';

/** Build a path under the dashboard layout (e.g. `/dashboard/leads`). */
export function dashboardPath(subpath = ''): string {
  if (!subpath || subpath === '/') return DASHBOARD_BASE;
  const normalized = subpath.startsWith('/') ? subpath : `/${subpath}`;
  return `${DASHBOARD_BASE}${normalized}`;
}

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
  | 'ai_action_logs'
  | 'copilot'
  | 'companies'
  | 'platform_health'
  | 'observability'
  | 'message_failures'
  | 'emi_calculator'
  | 'audit_logs'
  | 'error_logs'
  | 'notifications'
  | 'usage'
  | 'security'
  | 'security_dashboard'
  | 'branches'
  | 'compliance'
  | 'integrations'
  | 'ai_governance'
  | 'tenant_health'
  | 'support_tools'
  | 'dr_status'
  | 'settings';

export interface NavItemSpec {
  key: NavRouteKey;
  path: string;
  roles: UserRole[];
  featureKey?: string;
  /** Shown when i18n key missing */
  labelFallback?: string;
}

export type NavGroupKey = 'workspace' | 'pipeline' | 'intelligence' | 'admin' | 'platform';

export const NAV_GROUP_ORDER: NavGroupKey[] = [
  'workspace',
  'pipeline',
  'intelligence',
  'admin',
  'platform',
];

export const NAV_ITEM_GROUP: Record<NavRouteKey, NavGroupKey> = {
  dashboard: 'workspace',
  leads: 'pipeline',
  properties: 'pipeline',
  conversations: 'pipeline',
  calendar: 'pipeline',
  agents: 'admin',
  analytics: 'intelligence',
  ai_settings: 'intelligence',
  ai_action_logs: 'intelligence',
  copilot: 'intelligence',
  emi_calculator: 'admin',
  notifications: 'admin',
  settings: 'admin',
  companies: 'platform',
  platform_health: 'platform',
  observability: 'platform',
  message_failures: 'platform',
  audit_logs: 'platform',
  error_logs: 'admin',
  usage: 'admin',
  security: 'admin',
  security_dashboard: 'platform',
  branches: 'admin',
  compliance: 'admin',
  integrations: 'admin',
  ai_governance: 'admin',
  tenant_health: 'platform',
  support_tools: 'platform',
  dr_status: 'platform',
};

export interface NavGroupSpec {
  key: NavGroupKey;
  items: NavItemSpec[];
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
    path: dashboardPath('/leads'),
    roles: ['company_admin', 'sales_agent', 'operations', 'viewer'],
    featureKey: 'lead_automation',
  },
  {
    key: 'properties',
    path: dashboardPath('/properties'),
    roles: ['company_admin', 'sales_agent', 'operations', 'viewer'],
    featureKey: 'property_management',
  },
  {
    key: 'conversations',
    path: dashboardPath('/conversations'),
    roles: ['company_admin', 'sales_agent'],
    featureKey: 'conversation_center',
  },
  {
    key: 'calendar',
    path: dashboardPath('/calendar'),
    roles: ['company_admin', 'sales_agent', 'operations'],
    featureKey: 'visit_scheduling',
  },
  {
    key: 'agents',
    path: dashboardPath('/agents'),
    roles: ['company_admin'],
    featureKey: 'agent_management',
  },
  {
    key: 'analytics',
    path: dashboardPath('/analytics'),
    roles: ['company_admin', 'viewer'],
    featureKey: 'analytics',
  },
  {
    key: 'ai_settings',
    path: dashboardPath('/ai-settings'),
    roles: ['company_admin'],
    featureKey: 'ai_bot',
  },
  {
    key: 'ai_action_logs',
    path: dashboardPath('/ai-action-logs'),
    roles: ['company_admin'],
    featureKey: 'ai_bot',
    labelFallback: 'AI Action Logs',
  },
  {
    key: 'copilot',
    path: dashboardPath('/copilot'),
    roles: ['company_admin', 'sales_agent', 'operations', 'super_admin', 'viewer'],
    featureKey: 'ai_bot',
    labelFallback: 'Copilot',
  },
  {
    key: 'security_dashboard',
    path: dashboardPath('/security-dashboard'),
    roles: ['super_admin'],
    labelFallback: 'Security Dashboard',
  },
  {
    key: 'companies',
    path: dashboardPath('/companies'),
    roles: ['super_admin'],
  },
  {
    key: 'platform_health',
    path: dashboardPath('/platform-health'),
    roles: ['super_admin'],
    labelFallback: 'Platform Health',
  },
  {
    key: 'observability',
    path: dashboardPath('/observability'),
    roles: ['super_admin'],
    labelFallback: 'Observability',
  },
  {
    key: 'message_failures',
    path: dashboardPath('/message-failures'),
    roles: ['super_admin'],
    labelFallback: 'Message Failures',
  },
  {
    key: 'emi_calculator',
    path: dashboardPath('/emi-calculator'),
    roles: ['company_admin', 'sales_agent'],
    labelFallback: 'EMI Calculator',
  },
  {
    key: 'audit_logs',
    path: dashboardPath('/audit-logs'),
    roles: ['super_admin'],
    featureKey: 'audit_logs',
  },
  {
    key: 'error_logs',
    path: dashboardPath('/error-logs'),
    roles: ['company_admin'],
    labelFallback: 'Error Log',
  },
  {
    key: 'notifications',
    path: dashboardPath('/notifications'),
    roles: ['company_admin', 'sales_agent', 'operations'],
    featureKey: 'notifications',
  },
  {
    key: 'usage',
    path: dashboardPath('/usage'),
    roles: ['company_admin'],
    labelFallback: 'Usage & Limits',
  },
  {
    key: 'security',
    path: dashboardPath('/security'),
    roles: ['company_admin'],
    labelFallback: 'Security & Identity',
  },
  {
    key: 'branches',
    path: dashboardPath('/branches'),
    roles: ['company_admin'],
    labelFallback: 'Branches',
  },
  {
    key: 'compliance',
    path: dashboardPath('/compliance'),
    roles: ['company_admin'],
    labelFallback: 'Compliance',
  },
  {
    key: 'integrations',
    path: dashboardPath('/integrations'),
    roles: ['company_admin'],
    labelFallback: 'Integrations',
  },
  {
    key: 'ai_governance',
    path: dashboardPath('/ai-governance'),
    roles: ['company_admin', 'super_admin'],
    labelFallback: 'AI Governance',
  },
  {
    key: 'tenant_health',
    path: dashboardPath('/tenant-health'),
    roles: ['super_admin'],
    labelFallback: 'Tenant Health',
  },
  {
    key: 'support_tools',
    path: dashboardPath('/support-tools'),
    roles: ['super_admin'],
    labelFallback: 'Support Tools',
  },
  {
    key: 'dr_status',
    path: dashboardPath('/dr-status'),
    roles: ['super_admin'],
    labelFallback: 'DR Status',
  },
  {
    key: 'settings',
    path: dashboardPath('/settings'),
    roles: ['super_admin', 'company_admin', 'sales_agent', 'operations', 'viewer'],
  },
];

/** Extra routes not shown in sidebar but guarded the same way. */
const EXTRA_ROUTE_GUARDS: Array<{
  pathPrefix: string;
  roles: UserRole[];
  featureKey?: string;
}> = [
  { pathPrefix: dashboardPath('/properties/import'), roles: ['company_admin'], featureKey: 'property_management' },
  { pathPrefix: dashboardPath('/leads/'), roles: ['company_admin', 'sales_agent', 'operations', 'viewer'], featureKey: 'lead_automation' },
];

export function getRoleHomePath(role: UserRole | undefined): string {
  switch (role) {
    case 'super_admin':
      return dashboardPath('/companies');
    case 'operations':
      return dashboardPath('/calendar');
    case 'viewer':
      return dashboardPath('/leads');
    default:
      return DASHBOARD_BASE;
  }
}

export function getNavItemByKey(key: NavRouteKey): NavItemSpec | undefined {
  return NAV_ITEMS.find((item) => item.key === key);
}

/** Map legacy top-level paths (pre-/dashboard nesting) to dashboard paths. */
export function resolveDashboardPath(pathname: string): string {
  const normalized = pathname.split('?')[0] || '/';
  if (normalized === DASHBOARD_BASE || normalized.startsWith(`${DASHBOARD_BASE}/`)) {
    return normalized;
  }
  const legacyRoots = [
    'leads',
    'properties',
    'conversations',
    'calendar',
    'agents',
    'analytics',
    'ai-settings',
    'ai-action-logs',
    'copilot',
    'settings',
    'notifications',
    'companies',
    'platform-health',
    'observability',
    'message-failures',
    'usage',
    'security',
    'security-dashboard',
    'branches',
    'compliance',
    'integrations',
    'ai-governance',
    'tenant-health',
    'support-tools',
    'dr-status',
    'emi-calculator',
    'audit-logs',
    'error-logs',
  ];
  for (const root of legacyRoots) {
    if (normalized === `/${root}` || normalized.startsWith(`/${root}/`)) {
      return `${DASHBOARD_BASE}${normalized}`;
    }
  }
  return normalized;
}

export function getNavItemForPath(pathname: string): NavItemSpec | undefined {
  const normalized = resolveDashboardPath(pathname);

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

  if (normalized.startsWith(`${dashboardPath('/leads')}/`)) {
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
    return pathname === '/change-password' || pathname === dashboardPath('/profile');
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

/** Sidebar sections — same items for every role, grouped for clarity. */
export function getVisibleNavGroups(
  role: UserRole | undefined,
  isFeatureEnabled: (featureKey?: string) => boolean,
): NavGroupSpec[] {
  const items = getVisibleNavItems(role, isFeatureEnabled);
  const byGroup = new Map<NavGroupKey, NavItemSpec[]>();

  for (const item of items) {
    const group = NAV_ITEM_GROUP[item.key];
    const list = byGroup.get(group) ?? [];
    list.push(item);
    byGroup.set(group, list);
  }

  return NAV_GROUP_ORDER.filter((key) => byGroup.has(key)).map((key) => ({
    key,
    items: byGroup.get(key) ?? [],
  }));
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
    canManageAiSettings: isCompanyAdmin,
    canManageTenantSettings: isCompanyAdmin,
    canCreateLeads: isCompanyAdmin || isSalesAgent,
    canExportLeads: isCompanyAdmin,
    canAssignLeads: isCompanyAdmin,
    canTakeoverConversation: isCompanyAdmin || isSalesAgent,
    canAccessConversations: isCompanyAdmin || isSalesAgent,
    canScheduleVisits: isCompanyAdmin || isSalesAgent || isOperations,
    isPlatformAdmin: isSuperAdmin,
    isTenantStaff: isCompanyAdmin || isSalesAgent || isOperations || isViewer,
  };
}

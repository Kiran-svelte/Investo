/** Tenant feature keys — must match backend ALL_FEATURES / company_feature rows. */
export interface TenantFeatureDefinition {
  key: string;
  label: string;
  description: string;
  /** Default when creating a new tenant or onboarding. */
  defaultEnabled: boolean;
}

export const TENANT_FEATURE_DEFINITIONS: TenantFeatureDefinition[] = [
  { key: 'ai_bot', label: 'AI Bot', description: 'Automated customer engagement', defaultEnabled: true },
  { key: 'lead_automation', label: 'Lead Automation', description: 'Track and manage lead lifecycle', defaultEnabled: true },
  { key: 'visit_scheduling', label: 'Visit Scheduling', description: 'Schedule & manage property visits', defaultEnabled: true },
  { key: 'notifications', label: 'Notifications', description: 'Notify teams about critical events', defaultEnabled: true },
  { key: 'agent_management', label: 'Agent Management', description: 'Manage team members and assignments', defaultEnabled: true },
  { key: 'conversation_center', label: 'Conversation Center', description: 'Handle customer chats and handoffs', defaultEnabled: true },
  { key: 'property_management', label: 'Property Management', description: 'Manage inventory and listing details', defaultEnabled: true },
  { key: 'analytics', label: 'Analytics Dashboard', description: 'Business insights & reports', defaultEnabled: true },
  { key: 'audit_logs', label: 'Audit Logging', description: 'Track all user actions', defaultEnabled: false },
  { key: 'csv_export', label: 'CSV Export', description: 'Export operational data as CSV', defaultEnabled: false },
];

export function buildDefaultFeatureState(): Array<{ key: string; label: string; description: string; enabled: boolean }> {
  return TENANT_FEATURE_DEFINITIONS.map((f) => ({
    key: f.key,
    label: f.label,
    description: f.description,
    enabled: f.defaultEnabled,
  }));
}

/** Staff copilot intents — Step 1 classifier output values */
export const AGENT_INTENTS = [
  'update_lead_status',
  'create_lead',
  'update_lead',
  'assign_lead',
  'delete_lead',
  'list_leads_today',
  're_engage_lead',
  'flag_lead_priority',
  'transfer_lead_portfolio',
  'list_visits_today',
  'list_visits_tomorrow',
  'list_visits_by_date_range',
  'get_visit_details',
  'confirm_visit',
  'complete_visit',
  'cancel_visit',
  'reschedule_visit',
  'bulk_reassign_visits',
  'snooze_all_visits',
  'get_lead_details',
  'add_lead_note',
  'list_leads',
  'schedule_visit',
  'send_brochure',
  'list_properties',
  'get_property_details',
  'create_property',
  'update_property',
  'check_property_completeness',
  'search_catalog',
  'search_properties_for_lead',
  'list_conversations',
  'get_conversation_messages',
  'takeover_conversation',
  'release_conversation',
  'send_message_to_client',
  'list_notifications',
  'mark_notifications_read',
  'calculate_emi',
  'get_calendar_events',
  'get_available_slots',
  'get_dashboard_stats',
  'get_agent_performance',
  'get_lead_analytics',
  'get_pipeline_funnel',
  'get_my_performance',
  'list_agents',
  'create_agent',
  'update_agent',
  'deactivate_agent',
  'get_company_settings',
  'update_company_settings',
  'get_readiness_score',
  'get_audit_logs',
  'get_ai_action_log',
  'unknown',
] as const;

export type AgentIntent = (typeof AGENT_INTENTS)[number];

export const LEAD_PIPELINE_STATUSES = [
  'new',
  'contacted',
  'visit_scheduled',
  'visited',
  'negotiation',
  'closed_won',
  'closed_lost',
] as const;

export type LeadPipelineStatus = (typeof LEAD_PIPELINE_STATUSES)[number];

/** Intents executed by deterministic CRM fast paths (orchestrator defers) */
export const DETERMINISTIC_DELEGATE_INTENTS: ReadonlySet<AgentIntent> = new Set([
  'list_leads_today',
  'list_visits_today',
  'list_visits_tomorrow',
  'confirm_visit',
]);

/** Minimum classifier confidence to run parameter extraction + execution */
export const INTENT_CONFIDENCE_THRESHOLD = 0.55;

export const INTENT_LLM_TEMPERATURE = 0.05;

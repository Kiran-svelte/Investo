/** Canonical WhatsApp CRM workflow identifiers (15 production workflows). */
export const WORKFLOW_IDS = [
  'new_lead',
  'update_status',
  'add_note',
  'assign_agent',
  'schedule_visit',
  'reschedule_visit',
  'cancel_visit',
  'complete_visit',
  'mark_visit_outcome',
  'price_inquiry',
  'availability_check',
  'brochure_request',
  'amenities_question',
  'agent_availability',
  'escalate_to_human',
] as const;

export type WorkflowId = (typeof WORKFLOW_IDS)[number];

export const WORKFLOW_CONFIDENCE_THRESHOLD = 0.62;
export const WORKFLOW_LLM_TEMPERATURE = 0.05;

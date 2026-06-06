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

/** Workflows safe to run on the buyer WhatsApp channel (prospects / clients). */
export const BUYER_WORKFLOW_IDS = [
  'brochure_request',
  'price_inquiry',
  'availability_check',
  'amenities_question',
  'escalate_to_human',
] as const;

export type BuyerWorkflowId = (typeof BUYER_WORKFLOW_IDS)[number];

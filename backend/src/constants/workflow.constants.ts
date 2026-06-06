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

/**
 * Global LLM confidence floor for query workflows (price, brochure, availability).
 * Classification below this is discarded and falls through to the language brain.
 * Must never be raised above MUTATION_CONFIDENCE_THRESHOLD.
 * Target: §2.3 A+ spec — queries ≥ 0.65.
 */
export const WORKFLOW_CONFIDENCE_THRESHOLD = 0.65;

/**
 * Minimum confidence to execute a mutation workflow (write to DB + send WhatsApp).
 * Higher than WORKFLOW_CONFIDENCE_THRESHOLD to guard against booking the wrong visit.
 * Target: §2.3 A+ spec — mutations ≥ 0.80.
 */
export const MUTATION_CONFIDENCE_THRESHOLD = 0.80;

/**
 * Confidence band [low, high) in which we ask a clarification question instead
 * of executing a mutation workflow. Below low → fall through. Above high → execute.
 * Target: §2.3 A+ spec — clarification band 0.70–0.80.
 */
export const CLARIFICATION_BAND: Readonly<{ low: number; high: number }> = {
  low: 0.70,
  high: 0.80,
};

/**
 * LLM temperature for workflow classification.
 * Must be 0.0 for maximum determinism — prevents non-deterministic routing.
 * Target: §2.3 A+ spec — temp = 0.0.
 */
export const WORKFLOW_LLM_TEMPERATURE = 0.0;

/**
 * Workflows that mutate DB state (visit/lead writes).
 * These require MUTATION_CONFIDENCE_THRESHOLD and support clarification loops.
 */
export const MUTATION_WORKFLOW_IDS = [
  'schedule_visit',
  'reschedule_visit',
  'cancel_visit',
] as const;

export type MutationWorkflowId = (typeof MUTATION_WORKFLOW_IDS)[number];

/**
 * Redis / DB TTL for workflow idempotency keys.
 * 24 h covers WhatsApp retry windows; long enough to prevent re-booking same slot.
 */
export const WORKFLOW_IDEMPOTENCY_TTL_SECONDS = 86_400;

/**
 * Workflows safe to run on the buyer WhatsApp channel (prospects / clients).
 * Visit mutations are included — the workflow engine applies buyer-scoped guards.
 */
export const BUYER_WORKFLOW_IDS = [
  'brochure_request',
  'price_inquiry',
  'availability_check',
  'amenities_question',
  'escalate_to_human',
  'schedule_visit',
  'reschedule_visit',
  'cancel_visit',
] as const;

export type BuyerWorkflowId = (typeof BUYER_WORKFLOW_IDS)[number];

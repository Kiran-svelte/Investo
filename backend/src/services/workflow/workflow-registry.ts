import type { AgentIntent } from '../../constants/agent-intent.constants';
import type { WorkflowId } from '../../constants/workflow.constants';
import type { WorkflowDefinition } from './workflow.types';

/** Maps staff copilot classifier intents to canonical CRM workflows. */
export const INTENT_TO_WORKFLOW: Partial<Record<AgentIntent, WorkflowId>> = {
  update_lead_status: 'update_status',
  create_lead: 'new_lead',
  add_lead_note: 'add_note',
  assign_lead: 'assign_agent',
  schedule_visit: 'schedule_visit',
  reschedule_visit: 'reschedule_visit',
  cancel_visit: 'cancel_visit',
  complete_visit: 'complete_visit',
  mark_visit_outcome: 'mark_visit_outcome',
  send_brochure: 'brochure_request',
  search_catalog: 'availability_check',
  search_properties_for_lead: 'availability_check',
  get_property_details: 'price_inquiry',
  // list_properties covers amenity questions when staff asks about features
  list_properties: 'amenities_question',
  get_available_slots: 'agent_availability',
  get_calendar_events: 'agent_availability',
  takeover_conversation: 'escalate_to_human',
  flag_lead_priority: 'escalate_to_human',
  // 'send_message_to_client' is also an escalation signal when staff is
  // asked to handle a client personally ('call me', 'talk to agent')
  send_message_to_client: 'escalate_to_human',
};

export const WORKFLOW_DEFINITIONS: WorkflowDefinition[] = [
  {
    id: 'new_lead',
    label: 'New Lead',
    steps: [
      { action: 'createLead' },
      { action: 'assignAgent', optional: true },
      { action: 'sendWelcome', optional: true },
      { action: 'notifyAgent', optional: true },
    ],
  },
  {
    id: 'update_status',
    label: 'Update Status',
    steps: [
      { action: 'resolveLead' },
      { action: 'updateLeadStatus' },
      { action: 'logLeadHistory' },
      { action: 'notifyIfCritical', optional: true },
      { action: 'syncLeadMemory', optional: true },
    ],
  },
  {
    id: 'add_note',
    label: 'Add Note',
    steps: [
      { action: 'resolveLead' },
      { action: 'addLeadNote' },
      { action: 'syncLeadMemory' },
    ],
  },
  {
    id: 'assign_agent',
    label: 'Assign Agent',
    steps: [
      { action: 'resolveLead' },
      { action: 'resolveAgent' },
      { action: 'reassignLead' },
      { action: 'notifyAgentChange' },
    ],
  },
  {
    id: 'schedule_visit',
    label: 'Schedule Visit',
    steps: [
      { action: 'resolveLead' },
      { action: 'bookVisit' },
      { action: 'updateLeadStatusVisitScheduled', optional: true },
      { action: 'sendVisitConfirmation', optional: true },
      { action: 'scheduleVisitReminders', optional: true },
      { action: 'syncLeadMemory', optional: true },
    ],
  },
  {
    id: 'reschedule_visit',
    label: 'Reschedule Visit',
    steps: [
      { action: 'resolveVisit' },
      // CRITICAL: cancel the existing visit slot BEFORE booking new one.
      // Without this step, the old visit record stays as 'scheduled' — creating
      // a ghost duplicate booking visible in the agent calendar.
      { action: 'cancelVisitSlot' },
      { action: 'bookVisit' },
      { action: 'updateVisitStatus', optional: true },
      { action: 'sendVisitConfirmation', optional: true },
      { action: 'rescheduleReminders', optional: true },
    ],
  },
  {
    id: 'cancel_visit',
    label: 'Cancel Visit',
    steps: [
      { action: 'resolveVisit' },
      { action: 'cancelVisit' },
      { action: 'notifyAgent', optional: true },
      { action: 'scheduleFollowUp', optional: true },
    ],
  },
  {
    id: 'complete_visit',
    label: 'Complete Visit',
    steps: [
      { action: 'resolveVisit' },
      { action: 'completeVisit' },
      { action: 'updateLeadStatusVisited', optional: true },
      { action: 'logFeedback', optional: true },
      { action: 'updateLeadScore', optional: true },
      { action: 'scheduleFollowUp', optional: true },
      { action: 'syncLeadMemory', optional: true },
    ],
  },
  {
    id: 'mark_visit_outcome',
    label: 'Mark Visit Outcome',
    steps: [
      { action: 'resolveVisit' },
      { action: 'recordVisitOutcome' },
      { action: 'addLeadNote', optional: true },
      { action: 'notifyAgent', optional: true },
      { action: 'touchAnalytics', optional: true },
      { action: 'updateLeadScore', optional: true },
      { action: 'syncLeadMemory', optional: true },
    ],
  },
  {
    id: 'price_inquiry',
    label: 'Price Inquiry',
    steps: [
      { action: 'resolveLead', optional: true },
      { action: 'fetchPropertyPrice' },
      { action: 'respondPrice' },
      { action: 'updateLeadScore', optional: true },
      { action: 'notifyIfHot', optional: true },
    ],
  },
  {
    id: 'availability_check',
    label: 'Availability Check',
    steps: [
      { action: 'resolveLead', optional: true },
      { action: 'checkInventory' },
      { action: 'respondAvailability' },
      { action: 'updateLeadInterest', optional: true },
    ],
  },
  {
    id: 'brochure_request',
    label: 'Brochure Request',
    steps: [
      { action: 'resolveLead' },
      { action: 'sendBrochure' },
      { action: 'logBrochureRequest' },
      { action: 'updateLeadScore', optional: true },
    ],
  },
  {
    id: 'amenities_question',
    label: 'Amenities Question',
    steps: [
      { action: 'resolveLead', optional: true },
      { action: 'answerAmenities' },
      { action: 'updateLeadPreferences', optional: true },
      { action: 'tagLead', optional: true },
    ],
  },
  {
    id: 'agent_availability',
    label: 'Agent Availability',
    steps: [
      { action: 'resolveAgent', optional: true },
      { action: 'checkCalendar' },
      { action: 'suggestAlternatives', optional: true },
      { action: 'optionalBookSlot', optional: true },
    ],
  },
  {
    id: 'escalate_to_human',
    label: 'Escalate to Human',
    steps: [
      { action: 'resolveLead', optional: true },
      { action: 'takeoverConversation', optional: true },
      { action: 'createUrgentAlert' },
      { action: 'notifyAllAgents' },
      { action: 'markLeadUrgent', optional: true },
    ],
  },
];

const WORKFLOW_BY_ID = new Map(WORKFLOW_DEFINITIONS.map((w) => [w.id, w]));

export function getWorkflowDefinition(id: WorkflowId): WorkflowDefinition | undefined {
  return WORKFLOW_BY_ID.get(id);
}

export function workflowIdForIntent(intent: AgentIntent): WorkflowId | undefined {
  return INTENT_TO_WORKFLOW[intent];
}

export function allWorkflowIds(): WorkflowId[] {
  return WORKFLOW_DEFINITIONS.map((w) => w.id);
}

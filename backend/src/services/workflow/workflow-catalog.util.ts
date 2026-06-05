import type { WorkflowId } from '../../constants/workflow.constants';
import { WORKFLOW_DEFINITIONS } from './workflow-registry';

export type WorkflowRoutingKind = 'runWorkflow' | 'direct_tool';

export interface WorkflowGuideEntry {
  id: WorkflowId;
  label: string;
  /** Example staff phrases that should trigger this workflow. */
  triggers: string[];
  /** Primary entry point for the agent. */
  routing: WorkflowRoutingKind;
  /** Direct tool when routing is direct_tool (read-only fast paths). */
  directTool?: string;
  /** Ordered action chain executed inside runWorkflow. */
  steps: string[];
  /** Required params the agent should extract before calling runWorkflow. */
  requiredParams: string[];
}

/**
 * All 15 production CRM workflows — single source for prompts and listWorkflows tool.
 */
export const WORKFLOW_GUIDE: WorkflowGuideEntry[] = [
  {
    id: 'new_lead',
    label: 'New Lead',
    triggers: ['new lead', 'add lead', 'create lead', 'register customer'],
    routing: 'runWorkflow',
    steps: ['createLead', 'assignAgent', 'sendWelcome', 'notifyAgent'],
    requiredParams: ['customerName', 'phone'],
  },
  {
    id: 'update_status',
    label: 'Update Status',
    triggers: ['update status', 'mark contacted', 'move to negotiation', 'status to visited'],
    routing: 'runWorkflow',
    steps: ['resolveLead', 'updateLeadStatus', 'logLeadHistory', 'notifyIfCritical', 'syncLeadMemory'],
    requiredParams: ['leadId or leadName', 'status'],
  },
  {
    id: 'add_note',
    label: 'Add Note',
    triggers: ['add note', 'note for lead', 'log note', 'customer said'],
    routing: 'runWorkflow',
    steps: ['resolveLead', 'addLeadNote', 'syncLeadMemory'],
    requiredParams: ['leadId or leadName', 'note'],
  },
  {
    id: 'assign_agent',
    label: 'Assign Agent',
    triggers: ['assign lead', 'reassign', 'give lead to', 'transfer to agent'],
    routing: 'runWorkflow',
    steps: ['resolveLead', 'resolveAgent', 'reassignLead', 'notifyAgentChange'],
    requiredParams: ['leadId or leadName', 'agentId or agentName'],
  },
  {
    id: 'schedule_visit',
    label: 'Schedule Visit',
    triggers: ['book visit', 'schedule visit', 'site visit on', 'visit tomorrow at'],
    routing: 'runWorkflow',
    steps: ['resolveLead', 'bookVisit', 'updateLeadStatusVisitScheduled', 'sendVisitConfirmation', 'scheduleVisitReminders', 'syncLeadMemory'],
    requiredParams: ['leadId or leadName', 'scheduledAt', 'propertyId or propertyName'],
  },
  {
    id: 'reschedule_visit',
    label: 'Reschedule Visit',
    triggers: ['reschedule', 'change visit time', 'move visit to', 'postpone visit'],
    routing: 'runWorkflow',
    steps: ['resolveVisit', 'cancelVisitSlot', 'bookVisit', 'updateVisitStatus', 'sendVisitConfirmation', 'rescheduleReminders'],
    requiredParams: ['visitId or lead context', 'newScheduledAt'],
  },
  {
    id: 'cancel_visit',
    label: 'Cancel Visit',
    triggers: ['cancel visit', 'call off visit', 'customer cannot come'],
    routing: 'runWorkflow',
    steps: ['resolveVisit', 'cancelVisit', 'notifyAgent', 'scheduleFollowUp'],
    requiredParams: ['visitId or visit context'],
  },
  {
    id: 'complete_visit',
    label: 'Complete Visit',
    triggers: ['complete visit', 'mark visit done', 'visit completed', 'customer visited'],
    routing: 'runWorkflow',
    steps: ['resolveVisit', 'completeVisit', 'updateLeadStatusVisited', 'logFeedback', 'updateLeadScore', 'scheduleFollowUp', 'syncLeadMemory'],
    requiredParams: ['visitId or visit context'],
  },
  {
    id: 'mark_visit_outcome',
    label: 'Mark Visit Outcome',
    triggers: ['liked it', 'not interested', 'will decide later', 'visit outcome', 'hot lead after visit'],
    routing: 'runWorkflow',
    steps: ['resolveVisit', 'recordVisitOutcome', 'addLeadNote', 'notifyAgent', 'touchAnalytics', 'updateLeadScore', 'syncLeadMemory'],
    requiredParams: ['visitId or visit context', 'outcome or note'],
  },
  {
    id: 'price_inquiry',
    label: 'Price Inquiry',
    triggers: ['price', 'how much', 'cost', 'rate for property'],
    routing: 'runWorkflow',
    steps: ['resolveLead', 'fetchPropertyPrice', 'respondPrice', 'updateLeadScore', 'notifyIfHot'],
    requiredParams: ['propertyId or propertyName'],
  },
  {
    id: 'availability_check',
    label: 'Availability Check',
    triggers: ['available units', 'inventory', 'units left', 'any flats available'],
    routing: 'runWorkflow',
    steps: ['resolveLead', 'checkInventory', 'respondAvailability', 'updateLeadInterest'],
    requiredParams: ['propertyId or propertyName or search criteria'],
  },
  {
    id: 'brochure_request',
    label: 'Brochure Request',
    triggers: ['send brochure', 'share pdf', 'brochure for'],
    routing: 'runWorkflow',
    steps: ['resolveLead', 'sendBrochure', 'logBrochureRequest', 'updateLeadScore'],
    requiredParams: ['leadId or leadName', 'propertyId or propertyName'],
  },
  {
    id: 'amenities_question',
    label: 'Amenities Question',
    triggers: ['amenities', 'pool', 'gym', 'clubhouse', 'features of project'],
    routing: 'runWorkflow',
    steps: ['resolveLead', 'answerAmenities', 'updateLeadPreferences', 'tagLead'],
    requiredParams: ['propertyId or propertyName'],
  },
  {
    id: 'agent_availability',
    label: 'Agent Availability',
    triggers: ['calendar', 'free slots', 'when is agent free', 'available times'],
    routing: 'runWorkflow',
    steps: ['resolveAgent', 'checkCalendar', 'suggestAlternatives', 'optionalBookSlot'],
    requiredParams: ['agentId or agentName', 'startDate', 'endDate'],
  },
  {
    id: 'escalate_to_human',
    label: 'Escalate to Human',
    triggers: ['escalate', 'urgent', 'talk to manager', 'human takeover', 'flag priority'],
    routing: 'runWorkflow',
    steps: ['resolveLead', 'takeoverConversation', 'createUrgentAlert', 'notifyAllAgents', 'markLeadUrgent'],
    requiredParams: ['leadId or leadName', 'note or reason'],
  },
];

/** Read-only commands — call direct tools, NOT runWorkflow. */
export const DIRECT_TOOL_ROUTES: Array<{ tool: string; triggers: string[] }> = [
  { tool: 'listVisitsToday', triggers: ['visits today', 'today visits', 'my visits today'] },
  { tool: 'listVisitsTomorrow', triggers: ['visits tomorrow', 'tomorrow visits'] },
  { tool: 'listVisitsByDateRange', triggers: ['visits on', 'visits between', 'visits this week'] },
  { tool: 'listLeadsAddedToday', triggers: ['new leads today', 'leads added today'] },
  { tool: 'listLeads', triggers: ['list leads', 'show leads', 'all leads'] },
  { tool: 'getLeadDetails', triggers: ['get lead', 'lead details for'] },
  { tool: 'getVisitDetails', triggers: ['visit details', 'which visit'] },
  { tool: 'getPropertyDetails', triggers: ['property details', 'tell me about project'] },
  { tool: 'listProperties', triggers: ['list properties', 'all projects'] },
  { tool: 'getCalendarEvents', triggers: ['my calendar', 'calendar events'] },
  { tool: 'getAvailableSlots', triggers: ['free slots', 'open slots'] },
  { tool: 'getDashboardStats', triggers: ['dashboard stats', 'pipeline stats'] },
  { tool: 'getMyPerformance', triggers: ['my performance', 'my stats'] },
];

function formatWorkflowLine(entry: WorkflowGuideEntry): string {
  const stepChain = entry.steps.join(' → ');
  const triggers = entry.triggers.map((t) => `"${t}"`).join(', ');
  const params = entry.requiredParams.join(', ');
  return [
    `• *${entry.id}* (${entry.label})`,
    `  Triggers: ${triggers}`,
    `  Call: runWorkflow(workflowId="${entry.id}")`,
    `  Params: ${params}`,
    `  Steps (order): ${stepChain}`,
  ].join('\n');
}

/**
 * Full workflow + tool routing guide injected into the copilot system prompt.
 */
export function buildWorkflowExecutionGuideForPrompt(): string {
  const workflowBlock = WORKFLOW_GUIDE.map(formatWorkflowLine).join('\n');
  const directBlock = DIRECT_TOOL_ROUTES.map(
    (row) => `• ${row.tool} — when user says: ${row.triggers.map((t) => `"${t}"`).join(', ')}`,
  ).join('\n');

  return [
    '=== EXECUTION CONTRACT (MANDATORY) ===',
    '1. RIGHT TOOL: Match user intent using the catalogs below.',
    '   - Read-only queries → call the DIRECT TOOL (never runWorkflow).',
    '   - Multi-step mutations → call runWorkflow with the EXACT workflow id.',
    '   - Never invent data; never skip tools for facts you do not already have in context.',
    '2. CORRECT WORKFLOW: workflowId must match what the user wants.',
    '   - If unsure, call listWorkflows first, then runWorkflow with the best match.',
    '   - Do NOT use schedule_visit for cancel; do NOT use update_status for schedule_visit.',
    '3. ORDER: runWorkflow runs ALL steps in the listed order automatically.',
    '   - Do NOT call atomic tools (scheduleVisit, updateLeadStatus) instead of runWorkflow when the user needs the full workflow.',
    '4. SUCCESS: Each required step must succeed.',
    '   - If runWorkflow fails, read the step error, supply missing params (leadId, visitId, scheduledAt), and retry ONCE.',
    '   - Optional steps may skip; required steps must pass or the workflow stops.',
    '',
    '=== ALL 15 WORKFLOWS (runWorkflow) ===',
    workflowBlock,
    '',
    '=== DIRECT TOOLS (lookups — do NOT use runWorkflow) ===',
    directBlock,
    '=== END WORKFLOW CATALOG ===',
  ].join('\n');
}

/** Compact catalog for the listWorkflows tool response. */
export function formatWorkflowCatalogForTool(): string {
  const lines = WORKFLOW_GUIDE.map((entry) => {
    const def = WORKFLOW_DEFINITIONS.find((w) => w.id === entry.id);
    const required = def?.steps.filter((s) => !s.optional).map((s) => s.action) ?? entry.steps;
    return [
      `• *${entry.id}* — ${entry.label}`,
      `  Triggers: ${entry.triggers.join(' | ')}`,
      `  Required steps: ${required.join(' → ')}`,
    ].join('\n');
  });
  return ['*All 15 CRM workflows*', ...lines].join('\n');
}

export function getWorkflowGuideEntry(id: WorkflowId): WorkflowGuideEntry | undefined {
  return WORKFLOW_GUIDE.find((entry) => entry.id === id);
}

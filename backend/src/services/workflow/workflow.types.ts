import type { AgentIntent } from '../../constants/agent-intent.constants';
import type { LeadPipelineStatus } from '../../constants/agent-intent.constants';
import type { WorkflowId } from '../../constants/workflow.constants';
import type { ToolContext } from '../agent/agent-state';
import type { AgentSessionMessage } from '../agent/agent-session-messages.service';

export type WorkflowActionName = string;

export interface WorkflowStepDef {
  action: WorkflowActionName;
  optional?: boolean;
  /** When set, step runs only on matching channel. */
  channel?: 'buyer' | 'staff';
}

export interface WorkflowDefinition {
  id: WorkflowId;
  label: string;
  steps: WorkflowStepDef[];
}

export interface WorkflowParams {
  [key: string]: unknown;
  leadId?: string;
  leadName?: string;
  visitId?: string;
  conversationId?: string;
  propertyId?: string;
  propertyName?: string;
  agentId?: string;
  agentName?: string;
  fromAgentId?: string;
  toAgentId?: string;
  customerName?: string;
  phone?: string;
  status?: LeadPipelineStatus | string;
  note?: string;
  message?: string;
  messageText?: string;
  scheduledAt?: string;
  newScheduledAt?: string;
  startDate?: string;
  endDate?: string;
  priority?: string;
  outcome?: string;
}

export interface WorkflowRunContext {
  toolContext: ToolContext;
  messageText: string;
  recentMessages: AgentSessionMessage[];
  companyName: string;
  sessionLeadId?: string | null;
  sessionVisitId?: string | null;
  staffPhone?: string;
  /** Buyer/customer channel — skips staff-only tools where applicable */
  channel?: 'staff' | 'buyer';
  /** Set by runWorkflow after idempotency claim. */
  workflowRunId?: string;
}

export interface WorkflowState {
  leadId?: string;
  leadName?: string;
  visitId?: string;
  agentId?: string;
  propertyId?: string;
  conversationId?: string;
  lastMessage?: string;
  oldStatus?: string;
  newStatus?: string;
  /** Pre-mutation visit id captured for compensators. */
  priorVisitId?: string;
}

export interface ActionResult {
  ok: boolean;
  message?: string;
  data?: Partial<WorkflowState>;
  stop?: boolean;
}

export interface WorkflowRunResult {
  ok: boolean;
  reply: string | null;
  workflowId: WorkflowId;
  /** Last step that failed (required step only). */
  failedStep?: string;
  /** Steps that completed before failure or full run. */
  completedSteps?: string[];
  /** True when saga marked needs_reconciliation after partial mutation. */
  needsReconciliation?: boolean;
  /** Idempotency cache hit — no handlers re-run. */
  idempotencyHit?: boolean;
}

export interface IntentWorkflowMapping {
  intent: AgentIntent;
  workflowId: WorkflowId;
}

import type { AgentIntent } from '../../constants/agent-intent.constants';
import type { LeadPipelineStatus } from '../../constants/agent-intent.constants';
import type { WorkflowId } from '../../constants/workflow.constants';
import type { ToolContext } from '../agent/agent-state';
import type { AgentSessionMessage } from '../agent/agent-session-messages.service';

export type WorkflowActionName = string;

export interface WorkflowStepDef {
  action: WorkflowActionName;
  optional?: boolean;
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
}

export interface IntentWorkflowMapping {
  intent: AgentIntent;
  workflowId: WorkflowId;
}

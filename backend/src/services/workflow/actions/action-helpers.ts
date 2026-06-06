import prisma from '../../../config/prisma';
import type { ToolContext } from '../../agent/agent-state';
import type { AgentSessionMessage } from '../../agent/agent-session-messages.service';
import { resolveLeadForIntent } from '../../agent/agent-lead-resolution.service';
import { getToolsForRole } from '../../agent/tools';
import type { ActionResult, WorkflowParams, WorkflowRunContext, WorkflowState } from '../workflow.types';

export interface ActionContext {
  run: WorkflowRunContext;
  params: WorkflowParams;
  state: WorkflowState;
}

type ActionTool = {
  name: string;
  schema?: { safeParse: (input: unknown) => { success: boolean; data?: Record<string, unknown>; error?: unknown } };
  func: (input: Record<string, unknown>) => Promise<string>;
};

export function ok(message?: string, data?: Partial<WorkflowState>, stop?: boolean): ActionResult {
  return { ok: true, message, data, stop };
}

export function fail(message: string, stop = true): ActionResult {
  return { ok: false, message, stop };
}

export function failToolResult(result: { ok: false; message: string }): ActionResult {
  return fail(result.message);
}

export function skip(): ActionResult {
  return { ok: true };
}

function schemaIssues(error: unknown): string {
  const issues = Array.isArray((error as { issues?: unknown[] })?.issues)
    ? (error as { issues: Array<{ path?: unknown[]; message?: string }> }).issues
    : [];
  if (!issues.length) return 'valid details are missing';
  return issues
    .slice(0, 4)
    .map((issue) => {
      const path = Array.isArray(issue.path) && issue.path.length ? issue.path.join('.') : 'value';
      return `${path}: ${issue.message ?? 'invalid'}`;
    })
    .join('; ');
}

export function getTools(context: ToolContext): ActionTool[] {
  return getToolsForRole(context).map((tool: ActionTool & { func: ActionTool['func'] }) => ({
    name: String(tool.name),
    schema: tool.schema,
    func: tool.func.bind(tool),
  }));
}

export async function runNamedTool(
  context: ToolContext,
  toolName: string,
  input: Record<string, unknown>,
): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  const tool = getTools(context).find((t) => t.name === toolName);
  if (!tool) {
    return { ok: false, message: `Action ${toolName} is not available for your role.` };
  }
  let data = input;
  if (tool.schema?.safeParse) {
    const parsed = tool.schema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, message: schemaIssues(parsed.error) };
    }
    data = parsed.data ?? input;
  }
  const text = String(await tool.func(data)).trim();
  return { ok: true, text };
}

export function extractUuid(text: string): string | undefined {
  return text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Classifiers sometimes emit property names in id fields — coerce to name lookup instead. */
function sanitizeInvalidUuidFields(parameters: WorkflowParams): void {
  if (parameters.propertyId && !isValidUuid(parameters.propertyId)) {
    if (!parameters.propertyName) parameters.propertyName = String(parameters.propertyId);
    delete parameters.propertyId;
  }
  if (parameters.visitId && !isValidUuid(parameters.visitId)) {
    delete parameters.visitId;
  }
  if (parameters.agentId && !isValidUuid(parameters.agentId)) {
    if (!parameters.agentName) parameters.agentName = String(parameters.agentId);
    delete parameters.agentId;
  }
  if (parameters.leadId && !isValidUuid(parameters.leadId)) {
    if (!parameters.leadName) parameters.leadName = String(parameters.leadId);
    delete parameters.leadId;
  }
}

export async function enrichWorkflowParams(input: {
  context: ToolContext;
  params: WorkflowParams;
  messageText: string;
  recentMessages: AgentSessionMessage[];
  sessionLeadId?: string | null;
  sessionVisitId?: string | null;
}): Promise<WorkflowParams> {
  const parameters: WorkflowParams = {
    message: input.params.message ?? input.messageText,
    messageText: input.params.messageText ?? input.messageText,
    ...input.params,
  };

  sanitizeInvalidUuidFields(parameters);

  if (!parameters.leadId && (parameters.leadName || input.sessionLeadId)) {
    const lead = await resolveLeadForIntent(
      input.context,
      { leadId: parameters.leadId, leadName: parameters.leadName },
      input.sessionLeadId,
      input.recentMessages,
    );
    if (lead) parameters.leadId = lead.leadId;
  }

  if (parameters.leadId && !parameters.propertyId) {
    const leadRow = await prisma.lead.findUnique({
      where: { id: parameters.leadId },
      select: { leadMemory: true },
    });
    const raw = leadRow?.leadMemory;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const discussed = (raw as { projectsDiscussed?: Array<{ propertyId?: string; name?: string }> })
        .projectsDiscussed;
      if (Array.isArray(discussed) && discussed.length) {
        const withId = [...discussed].reverse().find((p) => p.propertyId && isValidUuid(p.propertyId));
        if (withId?.propertyId) {
          parameters.propertyId = withId.propertyId;
        } else if (!parameters.propertyName) {
          const named = [...discussed].reverse().find((p) => p.name);
          if (named?.name) parameters.propertyName = named.name;
        }
      }
      if (!parameters.visitId) {
        const visits = (raw as { upcomingVisits?: Array<{ visitId?: string }> }).upcomingVisits;
        const active = Array.isArray(visits)
          ? [...visits].reverse().find((v) => v.visitId && isValidUuid(v.visitId))
          : undefined;
        if (active?.visitId) parameters.visitId = active.visitId;
      }
    }
  }

  if (!parameters.visitId && input.sessionVisitId) {
    parameters.visitId = input.sessionVisitId;
  }

  if (!parameters.agentId && parameters.agentName) {
    const agent = await prisma.user.findFirst({
      where: {
        companyId: input.context.companyId,
        status: 'active',
        name: { contains: String(parameters.agentName), mode: 'insensitive' },
      },
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (agent) parameters.agentId = agent.id;
  }

  if (!parameters.propertyId && parameters.propertyName) {
    const property = await prisma.property.findFirst({
      where: {
        companyId: input.context.companyId,
        name: { contains: String(parameters.propertyName), mode: 'insensitive' },
      },
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (property) parameters.propertyId = property.id;
  }

  if (!parameters.newScheduledAt && parameters.scheduledAt) {
    parameters.newScheduledAt = parameters.scheduledAt;
  }

  if (!parameters.scheduledAt && !parameters.newScheduledAt) {
    const message = parameters.message ?? parameters.messageText ?? input.messageText;
    const {
      parseRescheduleTargetFromMessage,
      parseVisitDateTimeFromMessage,
      isVisitCancelOrRescheduleMessage,
      isVisitSchedulingMessage,
    } = await import('../../visitIntentFromMessage.service');
    const parsed = isVisitCancelOrRescheduleMessage(message)
      ? parseRescheduleTargetFromMessage(message)
      : isVisitSchedulingMessage(message)
        ? parseVisitDateTimeFromMessage(message)
        : null;
    if (parsed) {
      const iso = parsed.toISOString();
      parameters.scheduledAt = iso;
      parameters.newScheduledAt = iso;
    }
  }

  return parameters;
}

export function mergeStateFromToolOutput(toolName: string, output: string, state: WorkflowState): Partial<WorkflowState> {
  const id = extractUuid(output);
  if (!id) return {};
  const patch: Partial<WorkflowState> = {};
  const lower = toolName.toLowerCase();
  if (lower.includes('lead') && !state.leadId) patch.leadId = id;
  if (lower.includes('visit') && !state.visitId) patch.visitId = id;
  if (lower.includes('property') && !state.propertyId) patch.propertyId = id;
  if (lower.includes('conversation') && !state.conversationId) patch.conversationId = id;
  return patch;
}

export function requireLeadId(ctx: ActionContext): string | null {
  return ctx.state.leadId ?? ctx.params.leadId ?? null;
}

export function requireVisitId(ctx: ActionContext): string | null {
  return ctx.state.visitId ?? ctx.params.visitId ?? null;
}

import config from '../../config';
import logger from '../../config/logger';
import prisma from '../../config/prisma';
import {
  AGENT_INTENTS,
  DETERMINISTIC_DELEGATE_INTENTS,
  INTENT_CONFIDENCE_THRESHOLD,
  INTENT_LLM_TEMPERATURE,
  type AgentIntent,
  type LeadPipelineStatus,
  LEAD_PIPELINE_STATUSES,
} from '../../constants/agent-intent.constants';
import { fetchOpenAi, OPENAI_CHAT_URL, openAiKeyProblem } from '../openaiStatus.service';
import { getAgentSessionContext, setAgentSessionClientContext, syncLeadClientMemory } from '../clientMemory.service';
import { logAgentAction } from '../agent-action-log.service';
import type { ToolContext } from './agent-state';
import { updateLeadStatusById } from './lead-status-actions';
import { getToolsForRole } from './tools';
import {
  appendAgentSessionMessage,
  getRecentAgentSessionMessages,
  type AgentSessionMessage,
} from './agent-session-messages.service';
import { buildAgentScopeFilter } from './tools/format-helpers';
import { resolveLeadForIntent } from './agent-lead-resolution.service';
import { runWorkflowForIntent } from '../workflow/workflow-engine.service';
import { workflowIdForIntent } from '../workflow/workflow-registry';

export { extractLeadIdsFromText, extractLeadNamesFromAssistantMessages, resolveLeadForIntent } from './agent-lead-resolution.service';

export interface IntentParameters {
  [key: string]: unknown;
  toolName?: string;
  leadId?: string;
  leadName?: string;
  status?: LeadPipelineStatus;
  visitId?: string;
  conversationId?: string;
  propertyId?: string;
  agentId?: string;
  fromAgentId?: string;
  toAgentId?: string;
  agentName?: string;
  fromAgentName?: string;
  toAgentName?: string;
  propertyName?: string;
  note?: string;
  search?: string;
  scheduledAt?: string;
  message?: string;
  messageText?: string;
}

export interface ClassifyIntentResult {
  intent: AgentIntent;
  toolName?: string;
  confidence: number;
  parameters: Partial<IntentParameters>;
}

export interface ExtractIntentResult {
  intent: AgentIntent;
  toolName?: string;
  parameters: IntentParameters;
  missingFields?: string[];
}

export interface ClassifyAndExecuteParams {
  toolContext: ToolContext;
  messageText: string;
  recentMessages: AgentSessionMessage[];
  companyName: string;
  sessionLeadId?: string | null;
  sessionVisitId?: string | null;
  staffPhone?: string;
}

type LlmCaller = (system: string, user: string) => Promise<string>;

interface AgentActionTool {
  name: string;
  description?: string;
  schema?: any;
  func: (input: Record<string, unknown>) => Promise<string>;
}

const INTENT_TOOL_MAP: Partial<Record<AgentIntent, string>> = {
  update_lead_status: 'updateLeadStatus',
  create_lead: 'createLead',
  update_lead: 'updateLead',
  assign_lead: 'assignLead',
  delete_lead: 'deleteLead',
  list_leads_today: 'listLeadsAddedToday',
  re_engage_lead: 'reEngageLead',
  flag_lead_priority: 'flagLeadPriority',
  transfer_lead_portfolio: 'transferLeadPortfolio',
  list_visits_today: 'listVisitsToday',
  list_visits_tomorrow: 'listVisitsTomorrow',
  list_visits_by_date_range: 'listVisitsByDateRange',
  get_visit_details: 'getVisitDetails',
  complete_visit: 'completeVisit',
  cancel_visit: 'cancelVisit',
  reschedule_visit: 'rescheduleVisit',
  bulk_reassign_visits: 'bulkReassignVisits',
  snooze_all_visits: 'snoozeAllVisits',
  get_lead_details: 'getLeadDetails',
  add_lead_note: 'addLeadNote',
  list_leads: 'listLeads',
  schedule_visit: 'scheduleVisit',
  send_brochure: 'sendBrochureToClient',
  list_properties: 'listProperties',
  get_property_details: 'getPropertyDetails',
  create_property: 'createProperty',
  update_property: 'updateProperty',
  check_property_completeness: 'checkPropertyCompleteness',
  search_catalog: 'searchCatalogByCustomerMessage',
  search_properties_for_lead: 'searchPropertiesForLead',
  list_conversations: 'listConversations',
  get_conversation_messages: 'getConversationMessages',
  takeover_conversation: 'takeoverConversation',
  release_conversation: 'releaseConversation',
  send_message_to_client: 'sendMessageToClient',
  list_notifications: 'listNotifications',
  mark_notifications_read: 'markNotificationsRead',
  calculate_emi: 'calculateEmi',
  get_calendar_events: 'getCalendarEvents',
  get_available_slots: 'getAvailableSlots',
  get_dashboard_stats: 'getDashboardStats',
  get_agent_performance: 'getAgentPerformance',
  get_lead_analytics: 'getLeadAnalytics',
  get_pipeline_funnel: 'getPipelineFunnel',
  get_my_performance: 'getMyPerformance',
  list_agents: 'listAgents',
  create_agent: 'createAgent',
  update_agent: 'updateAgent',
  deactivate_agent: 'deactivateAgent',
  get_company_settings: 'getCompanySettings',
  update_company_settings: 'updateCompanySettings',
  get_readiness_score: 'getReadinessScore',
  get_audit_logs: 'getAuditLogs',
  get_ai_action_log: 'getAiActionLog',
};

function parseJsonObject<T>(raw: string): T | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeIntent(value: unknown): AgentIntent {
  const raw = String(value ?? 'unknown').toLowerCase().replace(/\s+/g, '_');
  return (AGENT_INTENTS as readonly string[]).includes(raw) ? (raw as AgentIntent) : 'unknown';
}

function normalizeToolName(value: unknown, tools: AgentActionTool[]): string | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const exact = tools.find((tool) => tool.name === raw);
  if (exact) return exact.name;
  const lowered = raw.toLowerCase();
  return tools.find((tool) => tool.name.toLowerCase() === lowered)?.name;
}

function getIntentDefaultTool(intent: AgentIntent, tools: AgentActionTool[]): string | undefined {
  const mapped = INTENT_TOOL_MAP[intent];
  return normalizeToolName(mapped, tools);
}

function getActionToolsForContext(context: ToolContext): AgentActionTool[] {
  return getToolsForRole(context).map((tool: any) => ({
    name: String(tool.name),
    description: typeof tool.description === 'string' ? tool.description : '',
    schema: tool.schema,
    func: tool.func.bind(tool),
  }));
}

function getSchemaKeys(schema: any): string[] {
  if (!schema) return [];
  const shape =
    typeof schema.shape === 'function'
      ? schema.shape()
      : schema.shape
        ?? (typeof schema._def?.shape === 'function' ? schema._def.shape() : schema._def?.shape);
  if (!shape || typeof shape !== 'object') return [];
  return Object.keys(shape);
}

function formatToolCatalogForPrompt(tools: AgentActionTool[]): string {
  if (!tools.length) return '(no deterministic action handlers available for this role)';
  return tools
    .map((tool) => {
      const keys = getSchemaKeys(tool.schema);
      const params = keys.length ? ` params: ${keys.join(', ')}` : ' params: none';
      return `- ${tool.name} (${params}) - ${tool.description ?? ''}`.trim();
    })
    .join('\n');
}

function normalizeStatus(value: unknown): LeadPipelineStatus | undefined {
  const raw = String(value ?? '').toLowerCase().replace(/\s+/g, '_');
  return (LEAD_PIPELINE_STATUSES as readonly string[]).includes(raw)
    ? (raw as LeadPipelineStatus)
    : undefined;
}

async function resolveAgentIdForIntent(
  context: ToolContext,
  name: unknown,
): Promise<string | undefined> {
  const hint = typeof name === 'string' ? name.trim() : '';
  if (!hint) return undefined;
  const user = await prisma.user.findFirst({
    where: {
      companyId: context.companyId,
      status: 'active',
      name: { contains: hint, mode: 'insensitive' },
    },
    select: { id: true },
    orderBy: { updatedAt: 'desc' },
  });
  return user?.id;
}

async function resolvePropertyIdForIntent(
  context: ToolContext,
  name: unknown,
): Promise<string | undefined> {
  const hint = typeof name === 'string' ? name.trim() : '';
  if (!hint) return undefined;
  const property = await prisma.property.findFirst({
    where: {
      companyId: context.companyId,
      name: { contains: hint, mode: 'insensitive' },
    },
    select: { id: true },
    orderBy: { updatedAt: 'desc' },
  });
  return property?.id;
}

function findTool(tools: AgentActionTool[], toolName?: string): AgentActionTool | undefined {
  const normalized = normalizeToolName(toolName, tools);
  return normalized ? tools.find((tool) => tool.name === normalized) : undefined;
}

function toolSchemaIssues(error: any): string {
  const issues = Array.isArray(error?.issues) ? error.issues : [];
  if (!issues.length) return 'the request needs more valid details';
  return issues
    .slice(0, 4)
    .map((issue: any) => {
      const path = Array.isArray(issue.path) && issue.path.length ? issue.path.join('.') : 'value';
      return `${path}: ${issue.message ?? 'invalid'}`;
    })
    .join('; ');
}

function parseToolInput(
  tool: AgentActionTool,
  params: Record<string, unknown>,
): { ok: true; data: Record<string, unknown> } | { ok: false; message: string } {
  if (!tool.schema || typeof tool.schema.safeParse !== 'function') {
    return { ok: true, data: params };
  }
  const parsed = tool.schema.safeParse(params);
  if (!parsed.success) {
    return {
      ok: false,
      message: `I need more details to run ${tool.name}: ${toolSchemaIssues(parsed.error)}.`,
    };
  }
  return { ok: true, data: parsed.data };
}

async function enrichToolParameters(
  context: ToolContext,
  params: IntentParameters,
  recentMessages: AgentSessionMessage[],
  sessionLeadId?: string | null,
  sessionVisitId?: string | null,
): Promise<Record<string, unknown>> {
  const enriched: Record<string, unknown> = { ...params };

  if (!enriched.leadId && (params.leadName || sessionLeadId)) {
    const lead = await resolveLeadForIntent(context, params, sessionLeadId, recentMessages);
    if (lead) enriched.leadId = lead.leadId;
  }

  if (!enriched.visitId && sessionVisitId) {
    enriched.visitId = sessionVisitId;
  }

  if (!enriched.agentId && params.agentName) {
    const agentId = await resolveAgentIdForIntent(context, params.agentName);
    if (agentId) enriched.agentId = agentId;
  }
  if (!enriched.fromAgentId && params.fromAgentName) {
    const fromAgentId = await resolveAgentIdForIntent(context, params.fromAgentName);
    if (fromAgentId) enriched.fromAgentId = fromAgentId;
  }
  if (!enriched.toAgentId && params.toAgentName) {
    const toAgentId = await resolveAgentIdForIntent(context, params.toAgentName);
    if (toAgentId) enriched.toAgentId = toAgentId;
  }

  if (!enriched.propertyId && params.propertyName) {
    const propertyId = await resolvePropertyIdForIntent(context, params.propertyName);
    if (propertyId) enriched.propertyId = propertyId;
  }

  if (!enriched.messageText && typeof params.message === 'string') {
    enriched.messageText = params.message;
  }

  delete enriched.toolName;
  delete enriched.leadName;
  delete enriched.agentName;
  delete enriched.fromAgentName;
  delete enriched.toAgentName;
  delete enriched.propertyName;

  return enriched;
}

function formatRecentMessagesForLlm(messages: AgentSessionMessage[]): string {
  if (!messages.length) return '(no prior messages in this session)';
  return messages
    .map((m) => `${m.role === 'staff' ? 'Staff' : 'Assistant'}: ${m.content.slice(0, 500)}`)
    .join('\n');
}

async function defaultLlmCaller(system: string, user: string): Promise<string> {
  const keyProblem = openAiKeyProblem();
  if (keyProblem) throw new Error(keyProblem);

  const response = await fetchOpenAi(
    OPENAI_CHAT_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: config.agentAi.model || config.ai.openaiModel || 'gpt-4o',
        temperature: INTENT_LLM_TEMPERATURE,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    },
    { label: 'agent_intent' },
  );

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

export async function classifyAgentIntent(
  messageText: string,
  llm: LlmCaller = defaultLlmCaller,
  availableTools: AgentActionTool[] = [],
): Promise<ClassifyIntentResult> {
  const system = `You classify WhatsApp messages from real-estate CRM staff into one intent.
Return JSON only: {"intent":"<intent>","toolName":"<exact action handler or null>","confidence":0.0-1.0,"parameters":{}}.
Intents: ${AGENT_INTENTS.join(', ')}.
Available deterministic action handlers for this staff role:
${formatToolCatalogForPrompt(availableTools)}.
Rules:
- "update lead X status to visited" => update_lead_status (NOT list_leads_today).
- For CRM actions, set toolName to the exact matching handler name from the available list.
- Never invent a toolName that is not in the available list.
- "new leads today" / "leads we got today" => list_leads_today.
- "visits tomorrow" => list_visits_tomorrow.
- Partial parameters OK (leadName, status, visitId, propertyName, agentName).
- unknown if unclear.`;

  const raw = await llm(system, `Message: ${messageText}`);
  const parsed = parseJsonObject<{
    intent?: string;
    toolName?: string | null;
    confidence?: number;
    parameters?: Partial<IntentParameters>;
  }>(raw);

  if (!parsed) {
    return { intent: 'unknown', confidence: 0, parameters: {} };
  }

  const intent = normalizeIntent(parsed.intent);
  return {
    intent,
    toolName: normalizeToolName(parsed.toolName, availableTools) ?? getIntentDefaultTool(intent, availableTools),
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
    parameters: parsed.parameters ?? {},
  };
}

export async function extractAgentIntentParameters(
  messageText: string,
  classified: ClassifyIntentResult,
  recentMessages: AgentSessionMessage[],
  sessionLeadId?: string | null,
  llm: LlmCaller = defaultLlmCaller,
  availableTools: AgentActionTool[] = [],
): Promise<ExtractIntentResult> {
  const system = `Extract structured CRM action parameters from staff WhatsApp messages.
Return JSON only: {"intent":"...","toolName":"<exact action handler or null>","parameters":{...},"missingFields":[]}.
Allowed status values: ${LEAD_PIPELINE_STATUSES.join(', ')}.
Available deterministic action handlers:
${formatToolCatalogForPrompt(availableTools)}.
Use recent chat to resolve leadName -> prefer leadId when ID appears in history.
Session last_lead_id hint: ${sessionLeadId ?? 'none'}.`;

  const raw = await llm(
    system,
    [
      `Classified intent: ${classified.intent}`,
      `Classified toolName: ${classified.toolName ?? 'none'}`,
      `Partial parameters: ${JSON.stringify(classified.parameters)}`,
      `Recent messages:\n${formatRecentMessagesForLlm(recentMessages)}`,
      `Current message: ${messageText}`,
    ].join('\n\n'),
  );

  const parsed = parseJsonObject<{
    intent?: string;
    toolName?: string | null;
    parameters?: Partial<IntentParameters>;
    missingFields?: string[];
  }>(raw);

  const parameters: IntentParameters = {
    ...classified.parameters,
    ...(parsed?.parameters ?? {}),
  };
  if (parameters.status) {
    parameters.status = normalizeStatus(parameters.status);
  }

  const intent = normalizeIntent(parsed?.intent ?? classified.intent);
  return {
    intent,
    toolName:
      normalizeToolName(parsed?.toolName, availableTools)
      ?? normalizeToolName(classified.toolName, availableTools)
      ?? getIntentDefaultTool(intent, availableTools),
    parameters,
    missingFields: parsed?.missingFields,
  };
}

export async function executeAgentIntent(
  context: ToolContext,
  extracted: ExtractIntentResult,
  recentMessages: AgentSessionMessage[],
  sessionLeadId?: string | null,
  options?: { messageText?: string; staffPhone?: string; sessionVisitId?: string | null; actionTools?: AgentActionTool[] },
): Promise<string | null> {
  const { intent, parameters } = extracted;

  if (intent === 'unknown' || DETERMINISTIC_DELEGATE_INTENTS.has(intent)) {
    return null;
  }

  const started = Date.now();

  try {
    if (intent === 'update_lead_status') {
      const status = parameters.status ?? normalizeStatus(parameters.status);
      if (!status) {
        return 'Which status should I set? (e.g. visited, contacted, negotiation)';
      }
      const lead = await resolveLeadForIntent(context, parameters, sessionLeadId, recentMessages);
      if (!lead) {
        return 'Which lead should I update? Share the customer name or lead ID from your list.';
      }
      const result = await updateLeadStatusById(context, lead.leadId, status);
      if (result.leadId && options?.staffPhone) {
        await setAgentSessionClientContext({
          userId: context.userId,
          phone: options.staffPhone,
          leadId: result.leadId,
        }).catch(() => undefined);
        void syncLeadClientMemory(result.leadId);
      }
      void logAgentAction({
        companyId: context.companyId,
        triggeredBy: 'agent_tool',
        action: 'intent_update_lead_status',
        actorId: context.userId,
        resourceType: 'lead',
        resourceId: result.leadId,
        inputs: { status, leadName: lead.customerName },
        result: result.reply,
        status: 'success',
        durationMs: Date.now() - started,
      });
      return result.reply;
    }

    if (intent === 'add_lead_note') {
      if (!parameters.note?.trim()) {
        return 'What note should I add to this lead?';
      }
      const lead = await resolveLeadForIntent(context, parameters, sessionLeadId, recentMessages);
      if (!lead) return 'Which lead is this note for? Share the name or ID.';
      const existing = await prisma.lead.findFirst({
        where: { id: lead.leadId, ...buildAgentScopeFilter(context.companyId, context.userRole, context.userId) },
        select: { notes: true },
      });
      if (!existing) return 'Lead not found or access denied.';
      const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      const newNote = `[${now}] ${parameters.note.trim()}`;
      const combined = existing.notes ? `${existing.notes}\n${newNote}` : newNote;
      await prisma.lead.update({ where: { id: lead.leadId }, data: { notes: combined } });
      return `✅ Note added to *${lead.customerName}*.`;
    }

    if (intent === 'get_lead_details') {
      const lead = await resolveLeadForIntent(context, parameters, sessionLeadId, recentMessages);
      if (!lead) return 'Which lead should I look up? Share the name or ID.';
      const full = await prisma.lead.findFirst({
        where: { id: lead.leadId, ...buildAgentScopeFilter(context.companyId, context.userRole, context.userId) },
        include: { assignedAgent: { select: { name: true } } },
      });
      if (!full) return 'Lead not found or access denied.';
      return [
        `*${full.customerName ?? 'Unknown'}*`,
        `Status: ${full.status}`,
        `Phone: ${full.phone}`,
        full.notes ? `Notes: ${full.notes.slice(0, 200)}` : '',
        `ID: ${full.id}`,
      ]
        .filter(Boolean)
        .join('\n');
    }

    if (intent === 'cancel_visit' || intent === 'reschedule_visit') {
      const { applyVisitMutationFromChat } = await import('../visitMutationFromChat.service');
      const { buildVisitScopeFilter } = await import('./tools/format-helpers');
      const mutation = await applyVisitMutationFromChat({
        companyId: context.companyId,
        message: options?.messageText ?? '',
        visitScope: buildVisitScopeFilter(context.companyId, context.userRole, context.userId),
      });
      if (mutation.handled && mutation.reply) return mutation.reply;
    }

    const actionTools = options?.actionTools ?? getActionToolsForContext(context);
    const toolName = extracted.toolName ?? getIntentDefaultTool(intent, actionTools);
    const tool = findTool(actionTools, toolName);
    if (!tool) {
      return null;
    }

    const enriched = await enrichToolParameters(
      context,
      parameters,
      recentMessages,
      sessionLeadId,
      options?.sessionVisitId,
    );
    const parsed = parseToolInput(tool, enriched);
    if (parsed.ok === false) {
      return parsed.message;
    }

    const reply = await tool.func(parsed.data);
    const resultText = String(reply ?? '').trim();
    const failed =
      resultText.toLowerCase().includes('not found')
      || resultText.toLowerCase().includes('access denied')
      || resultText.toLowerCase().includes('only ');

    if (typeof parsed.data.leadId === 'string' && options?.staffPhone) {
      await setAgentSessionClientContext({
        userId: context.userId,
        phone: options.staffPhone,
        leadId: parsed.data.leadId,
      }).catch(() => undefined);
      void syncLeadClientMemory(parsed.data.leadId);
    }

    void logAgentAction({
      companyId: context.companyId,
      triggeredBy: 'agent_tool',
      action: `intent_${tool.name}`,
      actorId: context.userId,
      actorRole: context.userRole,
      inputs: parsed.data,
      result: resultText.slice(0, 500) || null,
      status: failed ? 'failed' : 'success',
      durationMs: Date.now() - started,
    });

    return resultText || null;
  } catch (err: unknown) {
    logger.error('Agent intent execution failed', {
      intent,
      error: err instanceof Error ? err.message : String(err),
      userId: context.userId,
    });
    return null;
  }
}

function shouldRunIntentOrchestrator(messageText: string): boolean {
  const text = messageText.trim();
  if (!text) return false;
  if (
    /\b(update|set|mark|change|move|status|note|assign|brochure|schedule|reschedule|cancel|confirm|list|show|get|find|search|create|add|send|takeover|release|read|calculate|transfer|deactivate|complete|snooze|postpone)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  if (/\b(lead|visit|customer|client|property|catalog|conversation|notification|emi|calendar|agent|team|user|settings|readiness|audit|analytics|pipeline|performance|company)\b/i.test(text) && text.length < 240) {
    return true;
  }
  return false;
}

/**
 * Step 1–3: classify → extract parameters → deterministic execution.
 * Returns null to fall through to deterministic CRM / invokeAgent.
 */
export async function classifyAndExecuteAgentIntent(
  params: ClassifyAndExecuteParams,
  deps?: { llm?: LlmCaller },
): Promise<string | null> {
  if (!config.agentAi?.enabled || !shouldRunIntentOrchestrator(params.messageText)) {
    return null;
  }

  if (openAiKeyProblem()) {
    return null;
  }

  try {
    const actionTools = getActionToolsForContext(params.toolContext);
    const classified = await classifyAgentIntent(params.messageText, deps?.llm, actionTools);
    if (classified.confidence < INTENT_CONFIDENCE_THRESHOLD) {
      return null;
    }
    if (classified.intent === 'unknown') {
      return null;
    }
    if (DETERMINISTIC_DELEGATE_INTENTS.has(classified.intent)) {
      return null;
    }

    const extracted = await extractAgentIntentParameters(
      params.messageText,
      classified,
      params.recentMessages,
      params.sessionLeadId,
      deps?.llm,
      actionTools,
    );

    if (workflowIdForIntent(extracted.intent)) {
      const workflowReply = await runWorkflowForIntent(extracted.intent, extracted.parameters, {
        toolContext: params.toolContext,
        messageText: params.messageText,
        recentMessages: params.recentMessages,
        companyName: params.companyName,
        sessionLeadId: params.sessionLeadId,
        sessionVisitId: params.sessionVisitId,
        staffPhone: params.staffPhone,
        channel: 'staff',
      });
      if (workflowReply) return workflowReply;
    }

    return executeAgentIntent(
      params.toolContext,
      extracted,
      params.recentMessages,
      params.sessionLeadId,
      {
        messageText: params.messageText,
        staffPhone: params.staffPhone,
        sessionVisitId: params.sessionVisitId,
        actionTools,
      },
    );
  } catch (err: unknown) {
    logger.warn('Agent intent orchestrator skipped', {
      error: err instanceof Error ? err.message : String(err),
      userId: params.toolContext.userId,
    });
    return null;
  }
}

export async function recordAgentCopilotExchange(input: {
  sessionId?: string;
  inboundText: string;
  outboundText: string;
}): Promise<void> {
  if (!input.sessionId) return;
  await appendAgentSessionMessage({ sessionId: input.sessionId, role: 'staff', content: input.inboundText });
  await appendAgentSessionMessage({ sessionId: input.sessionId, role: 'assistant', content: input.outboundText });
}

export { getRecentAgentSessionMessages };

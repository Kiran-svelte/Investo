import config from '../../config';
import logger from '../../config/logger';
import { incrementOpsMetric } from '../opsMetrics.service';
import {
  WORKFLOW_CONFIDENCE_THRESHOLD,
  WORKFLOW_LLM_TEMPERATURE,
  type WorkflowId,
} from '../../constants/workflow.constants';
import type { AgentIntent } from '../../constants/agent-intent.constants';
import { fetchOpenAi, OPENAI_CHAT_URL, openAiKeyProblem } from '../openaiStatus.service';
import { setAgentSessionClientContext } from '../clientMemory.service';
import type { ToolContext } from '../agent/agent-state';
import type { AgentSessionMessage } from '../agent/agent-session-messages.service';
import { WORKFLOW_ACTION_HANDLERS } from './actions';
import { enrichWorkflowParams } from './actions/action-helpers';
import {
  allWorkflowIds,
  getWorkflowDefinition,
  workflowIdForIntent,
  WORKFLOW_DEFINITIONS,
} from './workflow-registry';
import type {
  WorkflowParams,
  WorkflowRunContext,
  WorkflowRunResult,
  WorkflowState,
} from './workflow.types';

type WorkflowLlmCaller = (system: string, user: string) => Promise<string>;

export interface ClassifyWorkflowMessageResult {
  workflowId: WorkflowId | 'unknown';
  confidence: number;
  parameters: WorkflowParams;
}

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

function formatWorkflowCatalog(): string {
  return WORKFLOW_DEFINITIONS.map((w) => {
    const chain = w.steps.map((s) => s.action).join(' → ');
    return `- ${w.id}: ${w.label}; steps: ${chain}`;
  }).join('\n');
}

function formatRecentMessages(messages: AgentSessionMessage[]): string {
  if (!messages.length) return '(no prior messages)';
  return messages
    .map((m) => `${m.role === 'staff' ? 'Staff' : 'Assistant'}: ${m.content.slice(0, 500)}`)
    .join('\n');
}

/**
 * Calls an LLM for workflow classification.
 * Provider priority: OpenAI → Claude (Anthropic) → Kimi (Moonshot).
 *
 * @throws Error when no provider is reachable.
 */
async function defaultWorkflowLlm(system: string, user: string): Promise<string> {
  const openAiProblem = openAiKeyProblem();

  if (!openAiProblem && config.ai.openaiApiKey) {
    try {
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
            temperature: WORKFLOW_LLM_TEMPERATURE,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
        },
        { label: 'workflow_engine' },
      );
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content ?? '';
      if (text) return text;
    } catch (err: unknown) {
      logger.warn('OpenAI workflow call failed, trying fallback', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (config.ai.claudeApiKey) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.ai.claudeApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.ai.claudeModel || 'claude-sonnet-4-6',
        max_tokens: 512,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!response.ok) throw new Error(`Claude API error ${response.status}`);
    const data = (await response.json()) as { content?: Array<{ text?: string }> };
    return data.content?.[0]?.text ?? '';
  }

  if (config.ai.kimiApiKey) {
    const response = await fetch(`${config.ai.kimiApiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.ai.kimiApiKey}` },
      body: JSON.stringify({
        model: config.ai.kimi25Model || 'kimi-k2-2504',
        temperature: WORKFLOW_LLM_TEMPERATURE,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    if (!response.ok) throw new Error(`Kimi API error ${response.status}`);
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  }

  throw new Error(openAiProblem || 'No valid AI provider configured for workflow engine');
}

function normalizeWorkflowId(value: unknown): WorkflowId | 'unknown' {
  const raw = String(value ?? 'unknown').toLowerCase().replace(/\s+/g, '_');
  return (allWorkflowIds() as readonly string[]).includes(raw) ? (raw as WorkflowId) : 'unknown';
}

/**
 * Execute ordered workflow steps. Stops on first failure or `stop: true`.
 */
export async function runWorkflow(
  workflowId: WorkflowId,
  run: WorkflowRunContext,
  params: WorkflowParams,
): Promise<WorkflowRunResult> {
  const definition = getWorkflowDefinition(workflowId);
  if (!definition) {
    return { ok: false, reply: null, workflowId };
  }

  const enriched = await enrichWorkflowParams({
    context: run.toolContext,
    params,
    messageText: run.messageText,
    recentMessages: run.recentMessages,
    sessionLeadId: run.sessionLeadId,
    sessionVisitId: run.sessionVisitId,
  });

  const state: WorkflowState = {
    leadId: enriched.leadId,
    visitId: enriched.visitId,
    agentId: enriched.agentId,
    propertyId: enriched.propertyId,
    conversationId: enriched.conversationId,
  };

  const messages: string[] = [];

  for (const step of definition.steps) {
    const handler = WORKFLOW_ACTION_HANDLERS[step.action];
    if (!handler) {
      if (step.optional) continue;
      return {
        ok: false,
        reply: `Workflow step "${step.action}" is not configured.`,
        workflowId,
      };
    }

    const result = await handler({ run, params: enriched, state });
    if (result.data) Object.assign(state, result.data);
    if (typeof result.data?.leadId === 'string') enriched.leadId = result.data.leadId;
    if (typeof result.data?.visitId === 'string') enriched.visitId = result.data.visitId;

    if (!result.ok) {
      if (step.optional) continue;
      return { ok: false, reply: result.message ?? 'Could not complete that request.', workflowId };
    }

    if (result.message) messages.push(result.message);
    if (result.stop) break;
  }

  if (typeof state.leadId === 'string' && run.staffPhone) {
    await setAgentSessionClientContext({
      userId: run.toolContext.userId,
      phone: run.staffPhone,
      leadId: state.leadId,
      visitId: state.visitId,
    }).catch(() => undefined);
  }

  if (!messages.length) {
    return { ok: true, reply: null, workflowId };
  }

  const reply = messages.length === 1 ? messages[0] : messages.join('\n\n');
  incrementOpsMetric('workflow_runs');
  return { ok: true, reply, workflowId };
}

/**
 * Run a workflow mapped from a staff copilot intent (after classify + extract).
 */
export async function runWorkflowForIntent(
  intent: AgentIntent,
  params: WorkflowParams,
  run: WorkflowRunContext,
): Promise<string | null> {
  const workflowId = workflowIdForIntent(intent);
  if (!workflowId) return null;

  const result = await runWorkflow(workflowId, run, { ...params, messageText: params.messageText ?? run.messageText });
  return result.reply;
}

export async function classifyWorkflowMessage(
  input: {
    messageText: string;
    recentMessages: AgentSessionMessage[];
    sessionLeadId?: string | null;
    sessionVisitId?: string | null;
    companyName: string;
  },
  llm: WorkflowLlmCaller = defaultWorkflowLlm,
): Promise<ClassifyWorkflowMessageResult> {
  const system = `Classify Investo WhatsApp CRM messages into one workflow.
Return JSON only: {"workflow":"<id>","confidence":0.0-1.0,"parameters":{}}.
Workflows:
${formatWorkflowCatalog()}

Rules:
- Use exact workflow ids. Use unknown if none fit.
- "update lead X status to visited" => update_status (NOT new_lead or list workflows).
- Messages with "today" about lead STATUS are update_status, not schedule_visit.
- "when is my visit booked" => schedule_visit or get_visit_details context; prefer listing next visit.
- Put customer feedback in note; preserve questions in message.
- Extract leadId, leadName, visitId, status, note, scheduledAt, newScheduledAt, propertyId, agentName, customerName, phone.`;

  const raw = await llm(
    system,
    [
      `Company: ${input.companyName}`,
      `Session lead: ${input.sessionLeadId ?? 'none'}`,
      `Session visit: ${input.sessionVisitId ?? 'none'}`,
      `Recent:\n${formatRecentMessages(input.recentMessages)}`,
      `Message: ${input.messageText}`,
    ].join('\n\n'),
  );

  const parsed = parseJsonObject<{
    workflow?: string;
    confidence?: number;
    parameters?: WorkflowParams;
  }>(raw);

  if (!parsed) {
    return { workflowId: 'unknown', confidence: 0, parameters: {} };
  }

  const workflowId = normalizeWorkflowId(parsed.workflow);
  return {
    workflowId,
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
    parameters: parsed.parameters ?? {},
  };
}

function shouldClassifyWorkflow(messageText: string): boolean {
  const text = messageText.trim();
  if (!text || text.length > 1200) return false;
  return true;
}

export async function classifyAndRunWorkflow(
  run: WorkflowRunContext,
  deps?: { llm?: WorkflowLlmCaller },
): Promise<string | null> {
  if (!config.agentAi?.enabled || !shouldClassifyWorkflow(run.messageText) || openAiKeyProblem()) {
    return null;
  }

  try {
    const classified = await classifyWorkflowMessage(
      {
        messageText: run.messageText,
        recentMessages: run.recentMessages,
        sessionLeadId: run.sessionLeadId,
        sessionVisitId: run.sessionVisitId,
        companyName: run.companyName,
      },
      deps?.llm,
    );

    if (classified.workflowId === 'unknown' || classified.confidence < WORKFLOW_CONFIDENCE_THRESHOLD) {
      return null;
    }

    const result = await runWorkflow(classified.workflowId, run, classified.parameters);
    return result.reply;
  } catch (err: unknown) {
    logger.warn('Workflow engine classify path skipped', {
      error: err instanceof Error ? err.message : String(err),
      userId: run.toolContext.userId,
    });
    return null;
  }
}

/** Buyer-channel workflow hints (price, brochure, availability). */
export async function tryRunBuyerWorkflow(input: {
  companyId: string;
  leadId?: string;
  messageText: string;
  propertyId?: string;
}): Promise<string | null> {
  const text = input.messageText.toLowerCase();
  let workflowId: WorkflowId | null = null;
  if (/\b(brochure|pdf|details|share)\b/.test(text)) workflowId = 'brochure_request';
  else if (/\b(price|cost|how much|rate)\b/.test(text)) workflowId = 'price_inquiry';
  else if (/\b(available|availability|units left|in stock)\b/.test(text)) workflowId = 'availability_check';
  else if (/\b(amenit|pool|gym|clubhouse)\b/.test(text)) workflowId = 'amenities_question';
  if (!workflowId) return null;

  const run: WorkflowRunContext = {
    toolContext: {
      userId: 'system',
      companyId: input.companyId,
      userRole: 'company_admin',
      userName: 'System',
    },
    messageText: input.messageText,
    recentMessages: [],
    companyName: '',
    sessionLeadId: input.leadId,
    channel: 'buyer',
  };

  const result = await runWorkflow(workflowId, run, {
    leadId: input.leadId,
    propertyId: input.propertyId,
    message: input.messageText,
  });
  return result.reply;
}

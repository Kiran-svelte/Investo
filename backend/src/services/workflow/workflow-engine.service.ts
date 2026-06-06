import config from '../../config';
import logger from '../../config/logger';
import { incrementOpsMetric } from '../opsMetrics.service';
import {
  BUYER_WORKFLOW_IDS,
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
 * Post-processes LLM-extracted workflow parameters.
 * Coerces scheduledAt/newScheduledAt to ISO strings even if the LLM
 * returned a natural-language date like "saturday 4pm".
 * Falls back to parseVisitDateTimeFromMessage from the original message.
 */
function normalizeWorkflowParameters(params: WorkflowParams, messageText: string): WorkflowParams {
  const normalized = { ...params };

  const coerceToIso = (value: unknown, fallbackMessage?: string): string | undefined => {
    if (!value && !fallbackMessage) return undefined;
    if (typeof value === 'string' && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now() - 60_000) {
        // Preserve the original ISO string (may carry +05:30 offset from LLM).
        // Both representations resolve to the same UTC moment; preserving the
        // IST offset avoids an ambiguous round-trip through UTC toISOString().
        return value.trim();
      }
      // LLM output a non-ISO string (e.g. "saturday 4pm") — parse deterministically
      const { parseVisitDateTimeFromMessage } = require('../visitIntentFromMessage.service');
      const fallback: Date | null = parseVisitDateTimeFromMessage(value);
      if (fallback) return fallback.toISOString();
    }
    if (fallbackMessage) {
      const { parseVisitDateTimeFromMessage } = require('../visitIntentFromMessage.service');
      const fromMsg: Date | null = parseVisitDateTimeFromMessage(fallbackMessage);
      if (fromMsg) return fromMsg.toISOString();
    }
    return undefined;
  };

  if (params.scheduledAt !== undefined || params.newScheduledAt !== undefined) {
    const iso = coerceToIso(params.scheduledAt ?? params.newScheduledAt, messageText);
    if (iso) {
      normalized.scheduledAt = iso;
      normalized.newScheduledAt = iso;
    }
  }

  return normalized;
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
  const completedSteps: string[] = [];
  const executedActions = new Set<string>();

  for (const step of definition.steps) {
    if (executedActions.has(step.action)) {
      logger.warn('Workflow action dedup: skipping duplicate step in same run', {
        workflowId,
        action: step.action,
      });
      continue;
    }
    executedActions.add(step.action);

    const handler = WORKFLOW_ACTION_HANDLERS[step.action];
    if (!handler) {
      if (step.optional) continue;
      return {
        ok: false,
        reply: `Workflow "${workflowId}" failed at step "${step.action}": handler not configured.`,
        workflowId,
        failedStep: step.action,
        completedSteps,
      };
    }

    const result = await handler({ run, params: enriched, state });
    if (result.data) Object.assign(state, result.data);
    if (typeof result.data?.leadId === 'string') enriched.leadId = result.data.leadId;
    if (typeof result.data?.visitId === 'string') enriched.visitId = result.data.visitId;

    if (!result.ok) {
      if (step.optional) continue;
      const detail = result.message ?? 'Could not complete that request.';
      logger.warn('Workflow step failed', {
        workflowId,
        step: step.action,
        completedSteps,
        detail,
      });
      return {
        ok: false,
        reply: `Workflow "${workflowId}" failed at step "${step.action}": ${detail}`,
        workflowId,
        failedStep: step.action,
        completedSteps,
      };
    }

    completedSteps.push(step.action);
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
  return { ok: true, reply, workflowId, completedSteps };
}

/**
 * Run a workflow mapped from a staff copilot intent (after classify + extract).
 *
 * Returns:
 *   - `null`   → no workflow mapped for this intent (caller may fall through)
 *   - `string` → workflow ran; may be empty if all steps skipped (do NOT fall through)
 */
export async function runWorkflowForIntent(
  intent: AgentIntent,
  params: WorkflowParams,
  run: WorkflowRunContext,
): Promise<string | null> {
  const workflowId = workflowIdForIntent(intent);
  if (!workflowId) return null;

  const result = await runWorkflow(workflowId, run, { ...params, messageText: params.messageText ?? run.messageText });
  const label = getWorkflowDefinition(workflowId)?.label ?? workflowId;
  if (!result.ok) {
    return (
      result.reply?.trim()
      || `Could not complete ${label}${result.failedStep ? ` (step: ${result.failedStep})` : ''}.`
    );
  }
  // Non-null string prevents double-execution via executeAgentIntent / invokeAgent.
  return result.reply?.trim() || `✅ ${label} completed.`;
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
  // Inject today's IST date so the LLM can resolve relative dates
  // like "saturday 4pm" or "tomorrow morning" to absolute ISO timestamps.
  const todayIST = new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const system = `Classify Investo WhatsApp CRM messages into one workflow.
Return JSON only: {"workflow":"<id>","confidence":0.0-1.0,"parameters":{}}.
Workflows:
${formatWorkflowCatalog()}

Rules:
- Use exact workflow ids. Use unknown if none fit.
- "update lead X status to visited" => update_status (NOT new_lead or list workflows).
- Messages with "today" about lead STATUS are update_status, not schedule_visit.
- "liked it", "not interested", "will decide later" after a visit => mark_visit_outcome.
- "when is my visit booked" => agent_availability context; prefer listing next visit.
- Put customer feedback in note; preserve questions in message.
- Extract: leadId, leadName, visitId, status, note, scheduledAt, newScheduledAt, propertyId, agentName, customerName, phone, outcome.

CRITICAL - scheduledAt extraction:
Today in IST is: ${todayIST}
- ALWAYS output scheduledAt and newScheduledAt as ISO 8601 strings: "YYYY-MM-DDTHH:mm:ss+05:30".
- Resolve relative days: "saturday 4pm" => next Saturday at 16:00 IST.
- Resolve "tomorrow" relative to today's date above.
- If time is ambiguous (e.g. "morning"), default to 10:00.
- If time is "afternoon", default to 15:00. If "evening", default to 18:00.
- Never output partial strings like "saturday 4pm" — always compute and output the full ISO date.`;

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
  const parameters = normalizeWorkflowParameters(parsed.parameters ?? {}, input.messageText);
  return {
    workflowId,
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
    parameters,
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
  // Do NOT gate on openAiKeyProblem() here — defaultWorkflowLlm has its own
  // OpenAI → Claude → Kimi fallback chain. Blocking here kills classification
  // even when Claude/Kimi are healthy.
  if (!config.agentAi?.enabled || !shouldClassifyWorkflow(run.messageText)) {
    return null;
  }


  try {
    const { tryResolveVisitListReply, wantsVisitOnSpecificDate } = await import('../agent/agent-crm-query.service');
    const { isVisitListQueryMessage, isVisitCancelOrRescheduleMessage } = await import('../visitIntentFromMessage.service');
    const isVisitDateListQuery =
      isVisitListQueryMessage(run.messageText)
      || (
        wantsVisitOnSpecificDate(run.messageText)
        && !isVisitCancelOrRescheduleMessage(run.messageText)
      );

    if (isVisitDateListQuery) {
      const listReply = await tryResolveVisitListReply(run.toolContext, run.messageText);
      if (listReply) {
        return listReply;
      }
    }

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

    const mutationWorkflows = new Set(['reschedule_visit', 'schedule_visit', 'cancel_visit']);
    if (mutationWorkflows.has(classified.workflowId) && isVisitDateListQuery) {
      const listReply = await tryResolveVisitListReply(run.toolContext, run.messageText);
      if (listReply) return listReply;
      return null;
    }

    const result = await runWorkflow(classified.workflowId, run, classified.parameters);
    const label = getWorkflowDefinition(classified.workflowId)?.label ?? classified.workflowId;
    if (!result.ok) {
      return (
        result.reply?.trim()
        || `Could not complete ${label}${result.failedStep ? ` (step: ${result.failedStep})` : ''}.`
      );
    }
    return result.reply?.trim() || `✅ ${label} completed.`;
  } catch (err: unknown) {
    logger.warn('Workflow engine classify path skipped', {
      error: err instanceof Error ? err.message : String(err),
      userId: run.toolContext.userId,
    });
    return null;
  }
}

const BUYER_WORKFLOW_SET = new Set<string>(BUYER_WORKFLOW_IDS);

function isBuyerWorkflowId(id: WorkflowId | 'unknown'): id is WorkflowId {
  return id !== 'unknown' && BUYER_WORKFLOW_SET.has(id);
}

function formatBuyerWorkflowReply(workflowId: WorkflowId, reply: string): string {
  if (workflowId === 'escalate_to_human') {
    return (
      "I've alerted our team and moved this chat to a human specialist.\n\n" +
      'Someone from the team will call or message you shortly.'
    );
  }

  const cleanedLines = reply
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^ID:\s*/i.test(trimmed)) return false;
      if (/^Match score:\s*/i.test(trimmed)) return false;
      if (/^Visits:\s*/i.test(trimmed)) return false;
      if (/^Brochure PDF:\s*/i.test(trimmed)) return false;
      if (/^Brochure:\s*/i.test(trimmed)) return false;
      return true;
    })
    .map((line) => {
      const trimmed = line.trim();
      if (/^\*Catalog matches \(grounded\)\*$/i.test(trimmed)) {
        return 'Here are the matching options I found:';
      }
      if (/^\*Matches for .+\*$/i.test(trimmed)) {
        return 'Here are the matching options I found:';
      }
      if (/^No matching published properties in catalog/i.test(trimmed)) {
        return "I couldn't find an exact matching property in our catalog.";
      }
      return line;
    });

  const text = cleanedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text || reply.trim();
}

/** Regex fallback when LLM classifier is unavailable or low-confidence. */
export async function tryRunBuyerWorkflow(input: {
  companyId: string;
  leadId?: string;
  messageText: string;
  propertyId?: string;
  companyName?: string;
}): Promise<string | null> {
  const text = input.messageText.toLowerCase();
  let workflowId: WorkflowId | null = null;
  if (/\b(brochure|pdf|details|share)\b/.test(text)) workflowId = 'brochure_request';
  else if (/\b(price|cost|how much|rate)\b/.test(text)) workflowId = 'price_inquiry';
  else if (/\b(available|availability|units left|in stock)\b/.test(text)) workflowId = 'availability_check';
  else if (/\b(amenit|pool|gym|clubhouse)\b/.test(text)) workflowId = 'amenities_question';
  else if (/\b(talk\s+to|speak\s+to|human|agent|call\s+me|callback|call\s+back)\b/.test(text)) workflowId = 'escalate_to_human';
  if (!workflowId) return null;
  if (workflowId === 'escalate_to_human' && !input.leadId) return null;

  const result = await runWorkflow(workflowId, buildBuyerWorkflowRun(input), {
    leadId: input.leadId,
    propertyId: input.propertyId,
    message: input.messageText,
  });

  if (!result.ok || !result.reply?.trim()) return null;
  return formatBuyerWorkflowReply(workflowId, result.reply);
}

function buildBuyerWorkflowRun(input: {
  companyId: string;
  leadId?: string;
  messageText: string;
  companyName?: string;
  sessionVisitId?: string | null;
}): WorkflowRunContext {
  return {
    toolContext: {
      userId: 'system',
      companyId: input.companyId,
      userRole: 'company_admin',
      userName: 'System',
    },
    messageText: input.messageText,
    recentMessages: [],
    companyName: input.companyName ?? '',
    sessionLeadId: input.leadId,
    sessionVisitId: input.sessionVisitId,
    channel: 'buyer',
  };
}

/**
 * Buyer orchestrator step 1–3: LLM intent classifier → workflow action handlers → reply.
 * Returns null to fall through to aiService.generateResponse (language brain).
 */
export async function classifyAndRunBuyerWorkflow(
  input: {
    companyId: string;
    leadId: string;
    messageText: string;
    propertyId?: string;
    companyName: string;
    sessionVisitId?: string | null;
  },
  deps?: { llm?: WorkflowLlmCaller },
): Promise<string | null> {
  if (!shouldClassifyWorkflow(input.messageText)) {
    return null;
  }

  const run = buildBuyerWorkflowRun(input);

  if (!config.agentAi?.enabled) {
    return tryRunBuyerWorkflow(input);
  }

  try {
    const classified = await classifyWorkflowMessage(
      {
        messageText: input.messageText,
        recentMessages: [],
        sessionLeadId: input.leadId,
        sessionVisitId: input.sessionVisitId,
        companyName: input.companyName,
      },
      deps?.llm,
    );

    if (
      classified.workflowId === 'unknown'
      || classified.confidence < WORKFLOW_CONFIDENCE_THRESHOLD
      || !isBuyerWorkflowId(classified.workflowId)
    ) {
      return tryRunBuyerWorkflow(input);
    }

    const params: WorkflowParams = {
      ...classified.parameters,
      leadId: classified.parameters.leadId ?? input.leadId,
      propertyId: classified.parameters.propertyId ?? input.propertyId,
      message: input.messageText,
    };

    const result = await runWorkflow(classified.workflowId, run, params);
    const label = getWorkflowDefinition(classified.workflowId)?.label ?? classified.workflowId;

    if (!result.ok) {
      if (!result.reply?.trim()) return null;
      return formatBuyerWorkflowReply(classified.workflowId, result.reply);
    }

    if (result.reply?.trim()) return formatBuyerWorkflowReply(classified.workflowId, result.reply);
    return null;
  } catch (err: unknown) {
    logger.warn('Buyer workflow orchestrator skipped', {
      error: err instanceof Error ? err.message : String(err),
      companyId: input.companyId,
      leadId: input.leadId,
    });
    return tryRunBuyerWorkflow(input);
  }
}

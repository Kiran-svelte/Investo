import { v4 as uuidv4 } from 'uuid';
import config from '../../config';
import logger from '../../config/logger';
import prisma from '../../config/prisma';
import { cacheGet, cacheSet } from '../../config/redis';
import { incrementOpsMetric } from '../opsMetrics.service';
import {
  BUYER_WORKFLOW_IDS,
  CLARIFICATION_BAND,
  MUTATION_CONFIDENCE_THRESHOLD,
  MUTATION_WORKFLOW_IDS,
  WORKFLOW_CONFIDENCE_THRESHOLD,
  WORKFLOW_IDEMPOTENCY_TTL_SECONDS,
  WORKFLOW_LLM_TEMPERATURE,
  type MutationWorkflowId,
  type WorkflowId,
} from '../../constants/workflow.constants';
import {
  buildPartialFailureReply,
  isMutationAction,
  runCompensators,
} from './workflow-compensator.service';
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

const MUTATION_WORKFLOW_SET = new Set<string>(MUTATION_WORKFLOW_IDS);
const WORKFLOW_IDEM_REDIS_PREFIX = 'workflow-idem:';

export function buildWorkflowIdempotencyKey(
  workflowId: WorkflowId,
  params: WorkflowParams,
  companyId: string,
): string | null {
  const scheduledAt = params.scheduledAt ?? params.newScheduledAt;
  let scheduledIso: string | null = null;
  if (scheduledAt) {
    const parsed = new Date(scheduledAt);
    if (!Number.isNaN(parsed.getTime())) {
      scheduledIso = parsed.toISOString();
    }
  }

  switch (workflowId) {
    case 'schedule_visit':
      if (!params.leadId || !scheduledIso) return null;
      return `schedule_visit:${companyId}:${params.leadId}:${scheduledIso}`;
    case 'reschedule_visit':
      if (!params.visitId || !scheduledIso) return null;
      return `reschedule_visit:${companyId}:${params.visitId}:${scheduledIso}`;
    case 'cancel_visit':
      if (!params.visitId) return null;
      return `cancel_visit:${companyId}:${params.visitId}`;
    default:
      return null;
  }
}

export interface WorkflowIdempotencyClaim {
  claimed: boolean;
  cachedReply?: string;
  key?: string;
}

/** Redis + DB claim before runWorkflow loop. */
export async function claimWorkflowExecution(
  key: string,
  companyId: string,
  workflowId: WorkflowId,
): Promise<WorkflowIdempotencyClaim> {
  const redisKey = `${WORKFLOW_IDEM_REDIS_PREFIX}${companyId}:${key}`;
  const cached = await cacheGet<string>(redisKey);
  if (cached) {
    incrementOpsMetric('workflow_idempotency_hits');
    return { claimed: false, cachedReply: cached, key };
  }

  const model = (prisma as any).workflowIdempotencyKey;
  if (!model?.findUnique || !model?.create) {
    return { claimed: true, key };
  }

  const existing = await model.findUnique({
    where: { companyId_key: { companyId, key } },
    select: { resultReply: true, expiresAt: true, status: true },
  });
  if (existing && existing.expiresAt > new Date() && existing.status === 'completed' && existing.resultReply) {
    await cacheSet(redisKey, existing.resultReply, WORKFLOW_IDEMPOTENCY_TTL_SECONDS);
    incrementOpsMetric('workflow_idempotency_hits');
    return { claimed: false, cachedReply: existing.resultReply, key };
  }
  if (existing && existing.expiresAt > new Date() && existing.status === 'running') {
    incrementOpsMetric('workflow_idempotency_hits');
    return {
      claimed: false,
      cachedReply: 'That workflow is already being processed. I will send the confirmed result shortly.',
      key,
    };
  }

  const expiresAt = new Date(Date.now() + WORKFLOW_IDEMPOTENCY_TTL_SECONDS * 1000);
  try {
    await model.create({
      data: { companyId, key, workflowId, status: 'running', expiresAt },
    });
    return { claimed: true, key };
  } catch (err: unknown) {
    const retry = await model.findUnique({
      where: { companyId_key: { companyId, key } },
      select: { resultReply: true, expiresAt: true, status: true },
    });
    if (retry?.resultReply && retry.expiresAt > new Date()) {
      return { claimed: false, cachedReply: retry.resultReply, key };
    }
    if (retry?.status === 'running' && retry.expiresAt > new Date()) {
      return {
        claimed: false,
        cachedReply: 'That workflow is already being processed. I will send the confirmed result shortly.',
        key,
      };
    }
    logger.warn('Workflow idempotency claim failed — proceeding without dedup', {
      companyId,
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return { claimed: true, key };
  }
}

async function persistWorkflowIdempotencyResult(
  companyId: string,
  key: string | undefined,
  reply: string,
): Promise<void> {
  if (!key) return;
  const redisKey = `${WORKFLOW_IDEM_REDIS_PREFIX}${companyId}:${key}`;
  await cacheSet(redisKey, reply, WORKFLOW_IDEMPOTENCY_TTL_SECONDS);
  const model = (prisma as any).workflowIdempotencyKey;
  if (!model?.updateMany) return;
  await model.updateMany({
    where: { companyId, key },
    data: { resultReply: reply, status: 'completed' },
  }).catch(() => undefined);
}

async function clearWorkflowIdempotencyClaim(companyId: string, key: string | undefined): Promise<void> {
  if (!key) return;
  const model = (prisma as any).workflowIdempotencyKey;
  if (!model?.deleteMany) return;
  await model.deleteMany({ where: { companyId, key } }).catch(() => undefined);
}

function stepMatchesChannel(step: { channel?: 'buyer' | 'staff' }, runChannel: 'buyer' | 'staff'): boolean {
  if (!step.channel) return true;
  return step.channel === runChannel;
}

function buildClarificationReply(workflowId: MutationWorkflowId): string {
  if (workflowId === 'schedule_visit' || workflowId === 'reschedule_visit') {
    return (
      'I want to make sure I get this right — would you like to:\n' +
      '1️⃣ *Book a new visit*\n' +
      '2️⃣ *Change an existing visit*\n\n' +
      'Reply with 1 or 2, or describe what you need.'
    );
  }
  if (workflowId === 'cancel_visit') {
    return 'Should I cancel your *upcoming visit*? Reply *yes* to confirm or describe which visit.';
  }
  return 'Could you clarify what you would like me to do with your visit?';
}

async function storePendingClarification(
  leadId: string | undefined,
  workflowId: WorkflowId,
  parameters: WorkflowParams,
): Promise<void> {
  if (!leadId) return;
  const conversation = await prisma.conversation.findFirst({
    where: { leadId, status: { not: 'closed' } },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, commitments: true },
  });
  if (!conversation) return;
  const commitments = (conversation.commitments as Record<string, unknown>) ?? {};
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      commitments: {
        ...commitments,
        pendingClarification: {
          workflowId,
          parameters: parameters as object,
          createdAt: new Date().toISOString(),
        },
      } as object,
    },
  }).catch(() => undefined);
}

export async function resolvePendingClarification(
  leadId: string,
  messageText: string,
): Promise<{ workflowId: WorkflowId; parameters: WorkflowParams } | null> {
  const conversation = await prisma.conversation.findFirst({
    where: { leadId, status: { not: 'closed' } },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, commitments: true },
  });
  if (!conversation) return null;
  const commitments = conversation.commitments as Record<string, unknown> | null;
  const pending = commitments?.pendingClarification as {
    workflowId?: WorkflowId;
    parameters?: WorkflowParams;
  } | undefined;
  if (!pending?.workflowId) return null;

  const text = messageText.trim().toLowerCase();
  let workflowId = pending.workflowId;
  const parameters = { ...(pending.parameters ?? {}) };

  if (/^1\b|new\s+visit|book\s+new/i.test(text)) {
    workflowId = 'schedule_visit';
  } else if (/^2\b|change|reschedule|move|push/i.test(text)) {
    workflowId = 'reschedule_visit';
  } else if (/^yes\b|confirm|cancel/i.test(text) && pending.workflowId === 'cancel_visit') {
    workflowId = 'cancel_visit';
  } else if (text.length < 4) {
    return null;
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      commitments: { ...commitments, pendingClarification: null },
    },
  }).catch(() => undefined);

  return { workflowId, parameters };
}

function evaluateMutationConfidence(
  workflowId: WorkflowId,
  confidence: number,
): 'execute' | 'clarify' | 'fallthrough' {
  if (!MUTATION_WORKFLOW_SET.has(workflowId)) {
    return confidence >= WORKFLOW_CONFIDENCE_THRESHOLD ? 'execute' : 'fallthrough';
  }
  if (confidence >= MUTATION_CONFIDENCE_THRESHOLD) return 'execute';
  if (confidence >= CLARIFICATION_BAND.low && confidence < CLARIFICATION_BAND.high) return 'clarify';
  return 'fallthrough';
}

/**
 * Execute ordered workflow steps. Stops on first failure or `stop: true`.
 * Wraps idempotency claim, saga step tracking, and compensators.
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

  const companyId = run.toolContext.companyId;
  const idemKey = buildWorkflowIdempotencyKey(workflowId, enriched, companyId);
  if (idemKey) {
    const claim = await claimWorkflowExecution(idemKey, companyId, workflowId);
    if (!claim.claimed && claim.cachedReply) {
      return { ok: true, reply: claim.cachedReply, workflowId, idempotencyHit: true };
    }
  }

  const workflowRunId = uuidv4();
  run.workflowRunId = workflowRunId;
  const runChannel: 'buyer' | 'staff' = run.channel ?? 'staff';
  const stateSnapshot: Record<string, unknown> = {};

  const runRecordModel = (prisma as any).workflowRunRecord;
  if (runRecordModel?.create) {
    await runRecordModel.create({
      data: {
        id: workflowRunId,
        companyId,
        workflowId,
        channel: runChannel,
        idempotencyKey: idemKey,
        status: 'running',
        stateSnapshot: {},
        stepsJson: [],
      },
    }).catch(() => undefined);
  }

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
  const stepsLog: Array<{ action: string; status: string; errorMessage?: string }> = [];

  for (const step of definition.steps) {
    if (!stepMatchesChannel(step, runChannel)) continue;

    if (executedActions.has(step.action)) {
      logger.warn('Workflow action dedup: skipping duplicate step in same run', {
        workflowId,
        action: step.action,
      });
      continue;
    }
    executedActions.add(step.action);

    if (isMutationAction(step.action)) {
      if (state.leadId && !stateSnapshot.oldLeadStatus) {
        const lead = await prisma.lead.findUnique({
          where: { id: state.leadId },
          select: { status: true },
        });
        if (lead) stateSnapshot.oldLeadStatus = lead.status;
      }
      if (step.action === 'bookVisit') {
        stateSnapshot.priorVisitId = state.visitId;
      }
    }

    const handler = WORKFLOW_ACTION_HANDLERS[step.action];
    if (!handler) {
      if (step.optional) continue;
      stepsLog.push({ action: step.action, status: 'failed', errorMessage: 'handler not configured' });
      await finalizeWorkflowRun(workflowRunId, 'failed', stepsLog, step.action);
      await clearWorkflowIdempotencyClaim(companyId, idemKey ?? undefined);
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
    if (typeof result.data?.visitId === 'string') {
      if (step.action === 'bookVisit' && !stateSnapshot.createdVisitId) {
        stateSnapshot.createdVisitId = result.data.visitId;
      }
      enriched.visitId = result.data.visitId;
    }

    if (!result.ok) {
      if (step.optional) {
        stepsLog.push({ action: step.action, status: 'skipped', errorMessage: result.message });
        continue;
      }
      const detail = result.message ?? 'Could not complete that request.';
      stepsLog.push({ action: step.action, status: 'failed', errorMessage: detail });
      logger.warn('Workflow step failed', { workflowId, step: step.action, completedSteps, detail });

      const hadMutations = completedSteps.some(isMutationAction);
      if (hadMutations) {
        await runCompensators({
          workflowRunId,
          failedStep: step.action,
          completedSteps,
          state,
          stateSnapshot,
          companyId,
        });
        const label = definition.label;
        await finalizeWorkflowRun(workflowRunId, 'needs_reconciliation', stepsLog, step.action, stateSnapshot);
        await clearWorkflowIdempotencyClaim(companyId, idemKey ?? undefined);
        return {
          ok: false,
          reply: buildPartialFailureReply(label, step.action),
          workflowId,
          failedStep: step.action,
          completedSteps,
          needsReconciliation: true,
        };
      }

      await finalizeWorkflowRun(workflowRunId, 'failed', stepsLog, step.action);
      await clearWorkflowIdempotencyClaim(companyId, idemKey ?? undefined);
      return {
        ok: false,
        reply: `Workflow "${workflowId}" failed at step "${step.action}": ${detail}`,
        workflowId,
        failedStep: step.action,
        completedSteps,
      };
    }

    completedSteps.push(step.action);
    stepsLog.push({ action: step.action, status: 'completed' });
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

  await finalizeWorkflowRun(workflowRunId, 'completed', stepsLog, undefined, stateSnapshot);

  if (!messages.length) {
    return { ok: true, reply: null, workflowId, completedSteps };
  }

  const reply = messages.length === 1 ? messages[0] : messages.join('\n\n');
  if (idemKey) {
    await persistWorkflowIdempotencyResult(companyId, idemKey, reply);
  }
  incrementOpsMetric('workflow_runs');
  return { ok: true, reply, workflowId, completedSteps };
}

async function finalizeWorkflowRun(
  workflowRunId: string,
  status: 'running' | 'completed' | 'failed' | 'completed_with_errors' | 'needs_reconciliation',
  stepsJson: Array<{ action: string; status: string; errorMessage?: string }>,
  failedStep?: string,
  stateSnapshot?: Record<string, unknown>,
): Promise<void> {
  const model = (prisma as any).workflowRunRecord;
  if (!model?.update) return;
  await model.update({
    where: { id: workflowRunId },
    data: {
      status,
      stepsJson,
      failedStep: failedStep ?? null,
      stateSnapshot: (stateSnapshot ?? {}) as object,
      completedAt: status === 'completed' ? new Date() : undefined,
    },
  }).catch(() => undefined);
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

function isCopilotActive(): boolean {
  return Boolean(config.agentAi?.enabled && config.agentAi?.copilotEnabled !== false);
}

function isLlmActive(): boolean {
  return Boolean(config.agentAi?.enabled && config.agentAi?.llmEnabled !== false);
}

export async function classifyAndRunWorkflow(
  run: WorkflowRunContext,
  deps?: { llm?: WorkflowLlmCaller },
): Promise<string | null> {
  if (!isCopilotActive() || !shouldClassifyWorkflow(run.messageText)) {
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

    if (!isLlmActive()) {
      return null;
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

    if (classified.workflowId === 'unknown') {
      return null;
    }

    const confidenceAction = evaluateMutationConfidence(classified.workflowId, classified.confidence);
    if (confidenceAction === 'fallthrough') {
      return null;
    }
    if (confidenceAction === 'clarify') {
      await storePendingClarification(
        classified.parameters.leadId ?? run.sessionLeadId ?? undefined,
        classified.workflowId,
        classified.parameters,
      );
      return buildClarificationReply(classified.workflowId as MutationWorkflowId);
    }

    if (MUTATION_WORKFLOW_SET.has(classified.workflowId) && isVisitDateListQuery) {
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
  sessionVisitId?: string | null;
}): Promise<string | null> {
  const text = input.messageText.toLowerCase();
  let workflowId: WorkflowId | null = null;
  if (/\b(cancel|call\s+off)\b.*\b(visit|appointment)\b/.test(text)) workflowId = 'cancel_visit';
  else if (/\b(reschedule|move|push|change)\b.*\b(visit|appointment|slot)\b/.test(text)) workflowId = 'reschedule_visit';
  else if (/\b(book|schedule)\b.*\b(visit|appointment|site\s+visit)\b/.test(text)) workflowId = 'schedule_visit';
  else if (/\b(site\s+visit|property\s+visit)\b/.test(text)) workflowId = 'schedule_visit';
  else if (/\b(brochure|pdf|details|share)\b/.test(text)) workflowId = 'brochure_request';
  else if (/\b(price|cost|how much|rate)\b/.test(text)) workflowId = 'price_inquiry';
  else if (/\b(available|availability|units left|in stock)\b/.test(text)) workflowId = 'availability_check';
  else if (/\b(amenit|pool|gym|clubhouse)\b/.test(text)) workflowId = 'amenities_question';
  else if (/\b(talk\s+to|speak\s+to|human|agent|call\s+me|callback|call\s+back)\b/.test(text)) workflowId = 'escalate_to_human';
  if (!workflowId) return null;
  if (workflowId === 'escalate_to_human' && !input.leadId) return null;

  const params: WorkflowParams = {
    leadId: input.leadId,
    propertyId: input.propertyId,
    visitId: input.sessionVisitId ?? undefined,
    message: input.messageText,
  };

  const result = await runWorkflow(workflowId, buildBuyerWorkflowRun(input), params);

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

  const pending = await resolvePendingClarification(input.leadId, input.messageText);
  if (pending && isBuyerWorkflowId(pending.workflowId)) {
    const params: WorkflowParams = {
      ...pending.parameters,
      leadId: pending.parameters.leadId ?? input.leadId,
      propertyId: pending.parameters.propertyId ?? input.propertyId,
      visitId: pending.parameters.visitId ?? input.sessionVisitId ?? undefined,
      message: input.messageText,
    };
    const result = await runWorkflow(pending.workflowId, run, params);
    if (result.reply?.trim()) return formatBuyerWorkflowReply(pending.workflowId, result.reply);
  }

  if (!isCopilotActive() || !isLlmActive()) {
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

    if (classified.workflowId === 'unknown' || !isBuyerWorkflowId(classified.workflowId)) {
      return tryRunBuyerWorkflow(input);
    }

    const confidenceAction = evaluateMutationConfidence(classified.workflowId, classified.confidence);
    if (confidenceAction === 'fallthrough') {
      return tryRunBuyerWorkflow(input);
    }
    if (confidenceAction === 'clarify') {
      await storePendingClarification(input.leadId, classified.workflowId, classified.parameters);
      return buildClarificationReply(classified.workflowId as MutationWorkflowId);
    }

    const params: WorkflowParams = {
      ...classified.parameters,
      leadId: classified.parameters.leadId ?? input.leadId,
      propertyId: classified.parameters.propertyId ?? input.propertyId,
      visitId: classified.parameters.visitId ?? input.sessionVisitId ?? undefined,
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

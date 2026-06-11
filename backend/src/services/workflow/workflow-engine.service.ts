import { v4 as uuidv4 } from 'uuid';
import config from '../../config';
import logger from '../../config/logger';
import prisma from '../../config/prisma';
import { cacheGet, cacheSet } from '../../config/redis';
import { incrementOpsMetric } from '../opsMetrics.service';
import {
  BUYER_WORKFLOW_IDS,
  CLARIFICATION_BAND,
  ESCALATION_CLARIFICATION_BAND,
  ESCALATION_CONFIDENCE_THRESHOLD,
  MUTATION_CONFIDENCE_THRESHOLD,
  MUTATION_WORKFLOW_IDS,
  WORKFLOW_CONFIDENCE_THRESHOLD,
  WORKFLOW_IDEMPOTENCY_TTL_SECONDS,
  WORKFLOW_LLM_TEMPERATURE,
  type MutationWorkflowId,
  type WorkflowId,
} from '../../constants/workflow.constants';
import {
  buildBuyerSafePartialFailureReply,
  buildPartialFailureReply,
  isMutationAction,
  runCompensators,
} from './workflow-compensator.service';
import { logAgentAction } from '../agent-action-log.service';
import type { AgentIntent } from '../../constants/agent-intent.constants';
import { fetchOpenAi, OPENAI_CHAT_URL, openAiKeyProblem } from '../openaiStatus.service';
import { setAgentSessionClientContext } from '../clientMemory.service';
import type { ToolContext } from '../agent/agent-state';
import { sanitizeStaffInstructionsForBuyer } from '../../utils/buyerStaffCopyGuard.util';
import type { AgentSessionMessage } from '../agent/agent-session-messages.service';
import { WORKFLOW_ACTION_HANDLERS } from './actions';
import { enrichWorkflowParams } from './actions/action-helpers';
import { formatBuyerWorkflowCatalogForClassifier } from './workflow-catalog.util';
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

function isExplicitBrochureRequest(messageText: string): boolean {
  return (
    /\b(brochure|brochures|pdf|broucher|document)\b/i.test(messageText)
    || /\b(send|share)\b[\s\S]{0,40}\b(brochure|pdf|document)\b/i.test(messageText)
  );
}

function isPropertyDetailsRequest(messageText: string): boolean {
  return /\b(details?|info|about)\b/i.test(messageText);
}

function isPlainSiteVisitBookingRequest(messageText: string): boolean {
  const siteVisit =
    /\b(book|schedule|arrange)\b[\s\S]{0,80}\b(site\s*)?visit\b/i.test(messageText)
    || /\b(site\s*)?visit\b[\s\S]{0,80}\b(book|schedule|arrange)\b/i.test(messageText)
    || /\b(book|schedule|arrange)\b[\s\S]{0,80}\bappointment\b/i.test(messageText);
  if (!siteVisit) return false;

  return !(
    /\b(finalize|lock|confirm)\b.*\b(price|deal|flat|unit|villa|apartment|property|plot)\b/i.test(messageText)
    || /\b(at|for)\s*(?:₹|rs\.?|inr|â‚¹)?\s*[\d,.]+\s*(lakh|lac|cr|crore)?\b/i.test(messageText)
    || /\b(token|booking amount|payment|pay now)\b/i.test(messageText)
  );
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
  } else {
    const {
      parseRescheduleTargetFromMessage,
      parseVisitDateTimeFromMessage,
      isVisitCancelOrRescheduleMessage,
      isVisitSchedulingMessage,
    } = require('../visitIntentFromMessage.service');
    const parsed = isVisitCancelOrRescheduleMessage(messageText)
      ? parseRescheduleTargetFromMessage(messageText)
      : isVisitSchedulingMessage(messageText)
        ? parseVisitDateTimeFromMessage(messageText)
        : null;
    if (parsed) {
      const iso = parsed.toISOString();
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
      cachedReply: "I'm already working on that request. One moment.",
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
        cachedReply: "I'm already working on that request. One moment.",
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
      'I want to make sure I get this right. Would you like to:\n' +
      '1. *Book a new visit*\n' +
      '2. *Change an existing visit*\n\n' +
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
  const parameters = { ...(pending.parameters ?? {}) };
  let resolved: { workflowId: WorkflowId; parameters: WorkflowParams } | null = null;

  if (/^1\b|new\s+visit|book\s+new/i.test(text)) {
    resolved = { workflowId: 'schedule_visit', parameters };
  } else if (/^2\b|change|reschedule|move|push/i.test(text)) {
    resolved = { workflowId: 'reschedule_visit', parameters };
  } else if (
    pending.workflowId === 'cancel_visit'
    && /^(yes|confirm|cancel\s+it|go\s+ahead)\b/i.test(text)
  ) {
    resolved = { workflowId: 'cancel_visit', parameters };
  } else if (/^yes\b|^confirm\b/i.test(text)) {
    resolved = { workflowId: pending.workflowId, parameters };
  } else {
    return null;
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      commitments: { ...commitments, pendingClarification: null },
    },
  }).catch(() => undefined);

  return resolved;
}

export type MutationGateSource =
  | 'classifier'
  | 'exact_regex'
  | 'bias_detector'
  | 'pending_clarification';

/** Single mutation confidence gate for classifier, bias, regex, and clarification resume paths. */
export function evaluateMutationGate(
  workflowId: WorkflowId,
  confidence: number,
  source: MutationGateSource,
): 'execute' | 'clarify' | 'fallthrough' {
  if (source === 'exact_regex') {
    if (MUTATION_WORKFLOW_SET.has(workflowId)) return 'execute';
    return evaluateMutationConfidence(workflowId, 1);
  }
  return evaluateMutationConfidence(workflowId, confidence);
}

function evaluateMutationConfidence(
  workflowId: WorkflowId,
  confidence: number,
): 'execute' | 'clarify' | 'fallthrough' {
  if (workflowId === 'escalate_to_human') {
    if (confidence >= ESCALATION_CONFIDENCE_THRESHOLD) return 'execute';
    if (
      confidence >= ESCALATION_CLARIFICATION_BAND.low
      && confidence < ESCALATION_CLARIFICATION_BAND.high
    ) {
      return 'clarify';
    }
    return 'fallthrough';
  }
  if (!MUTATION_WORKFLOW_SET.has(workflowId)) {
    return confidence >= WORKFLOW_CONFIDENCE_THRESHOLD ? 'execute' : 'fallthrough';
  }
  if (confidence >= MUTATION_CONFIDENCE_THRESHOLD) return 'execute';
  if (confidence >= CLARIFICATION_BAND.low && confidence < CLARIFICATION_BAND.high) return 'clarify';
  return 'fallthrough';
}

/**
 * Records a classifier "fallthrough" (confidence below threshold, or unknown
 * workflow) to `agent_action_logs` + an ops metric, so AI routing quality is
 * measurable instead of silently dropping to the language brain.
 */
function recordWorkflowFallthrough(params: {
  companyId: string;
  workflowId: string;
  confidence: number;
  channel: 'buyer' | 'staff';
  reason: 'unknown' | 'low_confidence';
  leadId?: string | null;
  actorId?: string;
  actorRole?: string;
}): void {
  incrementOpsMetric('workflow_fallthrough');
  void logAgentAction({
    companyId: params.companyId,
    triggeredBy: 'inbound_message',
    action: 'workflow_fallthrough',
    actorId: params.actorId,
    actorRole: params.actorRole,
    resourceType: 'lead',
    resourceId: params.leadId ?? null,
    inputs: {
      workflowId: params.workflowId,
      confidence: params.confidence,
      channel: params.channel,
      reason: params.reason,
    },
    status: 'skipped',
    result: 'Classifier below threshold; routed to language brain',
  });
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
        const partialReply = runChannel === 'buyer'
          ? buildBuyerSafePartialFailureReply(label, step.action)
          : buildPartialFailureReply(label, step.action);
        if (runChannel === 'buyer') {
          void notifyBuyerWorkflowFailure(run, state, workflowId, step.action, detail);
        }
        return {
          ok: false,
          reply: partialReply,
          workflowId,
          failedStep: step.action,
          completedSteps,
          needsReconciliation: true,
        };
      }

      await finalizeWorkflowRun(workflowRunId, 'failed', stepsLog, step.action);
      await clearWorkflowIdempotencyClaim(companyId, idemKey ?? undefined);
      const buyerReply = runChannel === 'buyer'
        ? buildBuyerWorkflowFailureReply(workflowId, step.action, detail)
        : `Workflow "${workflowId}" failed at step "${step.action}": ${detail}`;
      if (typeof state.leadId === 'string' || runChannel === 'staff') {
        void logAgentAction({
          companyId,
          triggeredBy: 'inbound_message',
          action: `workflow_${workflowId}`,
          resourceType: 'lead',
          resourceId: state.leadId ?? run.sessionLeadId ?? null,
          actorId: run.toolContext.userId,
          actorRole: run.toolContext.userRole,
        inputs: {
          workflowId,
          channel: runChannel,
          failedStep: step.action,
          completedSteps,
          confidence: run.classifierConfidence,
          gateSource: run.classifierSource,
        },
        status: 'failed',
        errorMessage: detail,
        result: buyerReply.slice(0, 500),
      });
      }
      if (runChannel === 'buyer') {
        void notifyBuyerWorkflowFailure(run, state, workflowId, step.action, detail);
      }
      return {
        ok: false,
        reply: buyerReply,
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
    if (runChannel === 'buyer' && workflowId === 'escalate_to_human') {
      return {
        ok: true,
        reply: formatBuyerWorkflowReply(workflowId, ''),
        workflowId,
        completedSteps,
      };
    }
    return { ok: true, reply: null, workflowId, completedSteps };
  }

  let reply = messages.length === 1 ? messages[0] : messages.join('\n\n');
  if (runChannel === 'buyer') {
    reply = stripBuyerInternalWorkflowLines(reply);
  }
  if (idemKey) {
    await persistWorkflowIdempotencyResult(companyId, idemKey, reply);
  }
  if (typeof state.leadId === 'string' || runChannel === 'staff') {
    await logAgentAction({
      companyId,
      triggeredBy: 'inbound_message',
      action: `workflow_${workflowId}`,
      resourceType: 'lead',
      resourceId: state.leadId ?? run.sessionLeadId ?? null,
      actorId: run.toolContext.userId,
      actorRole: run.toolContext.userRole,
      inputs: {
        workflowId,
        channel: runChannel,
        completedSteps,
        confidence: run.classifierConfidence,
        gateSource: run.classifierSource,
      },
      status: 'success',
      result: reply.slice(0, 500),
    });
  }
  incrementOpsMetric('workflow_runs');
  return { ok: true, reply, workflowId, completedSteps };
}

/** Remove staff-only status lines from buyer-visible workflow replies. */
function stripBuyerInternalWorkflowLines(reply: string): string {
  return reply
    .split(/\r?\n/)
    .filter((line) => !/^\s*lead marked\s/i.test(line.trim()))
    .filter((line) => !/^\s*visit reminders scheduled\.?\s*$/i.test(line.trim()))
    .filter((line) => !/^\s*lead score updated/i.test(line.trim()))
    .filter((line) => !/^\s*lead tagged:/i.test(line.trim()))
    .filter((line) => !/^\s*urgent alert created/i.test(line.trim()))
    .filter((line) => !/^\s*🚨\s*all\s+\d+\s+agents notified/i.test(line.trim()))
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
    /** When buyer, classifier catalog is limited to BUYER_WORKFLOW_IDS (H7). */
    channel?: 'buyer' | 'staff';
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

  const isBuyerChannel = input.channel === 'buyer';
  const catalogBlock = isBuyerChannel
    ? formatBuyerWorkflowCatalogForClassifier()
    : formatWorkflowCatalog();

  const system = `Classify Investo WhatsApp CRM messages into one workflow.
Return JSON only: {"workflow":"<id>","confidence":0.0-1.0,"parameters":{}}.
Workflows:
${catalogBlock}

Rules:
- Use exact workflow ids. Use unknown if none fit.
${isBuyerChannel ? '- Buyer channel only: use the listed buyer workflow ids; never staff-only ids like update_status or complete_visit.' : '- "update lead X status to visited" => update_status (NOT new_lead or list workflows).'}
- Messages with "today" about lead STATUS are update_status, not schedule_visit.
- "book/schedule a site visit" => schedule_visit. If date/time is missing, leave scheduledAt empty and let the workflow ask for it.
- "liked it", "not interested", "will decide later" after a visit => mark_visit_outcome.
- "when is my visit booked" => agent_availability context; prefer listing next visit.
- "more details", "property details", "tell me about option 2" => price_inquiry unless the user explicitly asks for a brochure/PDF/document.
- Use brochure_request only for explicit brochure, PDF, document, send/share brochure language.
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

  let workflowId = normalizeWorkflowId(parsed.workflow);
  if (workflowId === 'escalate_to_human' && isPlainSiteVisitBookingRequest(input.messageText)) {
    workflowId = 'schedule_visit';
  }
  if (
    workflowId === 'brochure_request'
    && isPropertyDetailsRequest(input.messageText)
    && !isExplicitBrochureRequest(input.messageText)
  ) {
    workflowId = 'price_inquiry';
  }
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

/** Budget/location/BHK sharing without an explicit inquiry — let the language brain acknowledge. */
export function isBuyerQualificationOnlyMessage(messageText: string): boolean {
  const t = messageText.toLowerCase();
  const hasQualify =
    /\b(budget|crore|lakh|bhk|whitefield|looking for|need a|preference|interested in)\b/i.test(t);
  const hasExplicitIntent =
    /\b(price|cost|how much|brochure|pdf|book|schedule|visit|available|amenities|discount|negotiat|human|call me|send me)\b/i.test(t);
  return hasQualify && !hasExplicitIntent;
}

const INTERNAL_WORKFLOW_LEAK = /Workflow\s+"[^"]+"\s+failed|handler not configured|Invalid uuid|propertyId:/i;

function mapBuyerWorkflowFailureReason(workflowId: WorkflowId, failedStep: string): import('../buyerAgentAssist.service').BuyerAssistReason {
  if (workflowId === 'schedule_visit' || failedStep === 'bookVisit') return 'visit_booking_failure';
  if (workflowId === 'reschedule_visit') return 'reschedule_failure';
  if (workflowId === 'cancel_visit') return 'cancel_failure';
  if (failedStep === 'checkCalendar' || failedStep === 'optionalBookSlot') return 'calendar_update_failure';
  if (failedStep === 'updateLeadStatus' || failedStep === 'transitionLeadStatus') return 'lead_status_failure';
  return 'workflow_failure';
}

async function notifyBuyerWorkflowFailure(
  run: WorkflowRunContext,
  state: WorkflowState,
  workflowId: WorkflowId,
  failedStep: string,
  detail: string,
): Promise<void> {
  const leadId = state.leadId ?? run.sessionLeadId;
  if (!leadId || (run.channel ?? 'staff') !== 'buyer') return;
  const { notifyBuyerAgentAssistNeeded } = await import('../buyerAgentAssist.service');
  void notifyBuyerAgentAssistNeeded({
    companyId: run.toolContext.companyId,
    leadId,
    conversationId: state.conversationId ?? null,
    reason: mapBuyerWorkflowFailureReason(workflowId, failedStep),
    summary: `Workflow ${workflowId} failed at ${failedStep}`,
    detail,
    customerMessage: run.messageText,
    workflowId,
    failedStep,
  });
}

/** Never expose internal workflow/step names to buyers. */
export function buildBuyerWorkflowFailureReply(
  workflowId: WorkflowId,
  failedStep: string | undefined,
  detail: string | undefined,
): string {
  const raw = sanitizeStaffInstructionsForBuyer((detail ?? '').trim());
  if (raw && !INTERNAL_WORKFLOW_LEAK.test(raw)) {
    return raw;
  }
  const d = raw.toLowerCase();
  if (failedStep === 'bookVisit' || workflowId === 'schedule_visit' || workflowId === 'reschedule_visit') {
    if (d.includes('overlap') || d.includes('conflict')) {
      return 'That time slot is already booked. Please share another date and time (e.g. "Sunday 11 am").';
    }
    if (d.includes('past')) {
      return 'That time is in the past. Please share a future date and time.';
    }
    if (d.includes('which property')) {
      return 'Which property would you like to visit? Share the project name and your preferred time.';
    }
    return 'What date and time works for your site visit? (e.g. "next Saturday 4 pm")';
  }
  if (workflowId === 'brochure_request') {
    return "I'd love to send you the brochure — which project are you interested in?";
  }
  if (workflowId === 'price_inquiry' || workflowId === 'availability_check') {
    return "I'm pulling up the latest details — could you name the project you're asking about?";
  }
  return "I couldn't complete that just now. Please try again or reply *talk to agent* for help.";
}

function sanitizeBuyerWorkflowReply(workflowId: WorkflowId, reply: string, failedStep?: string): string {
  if (!INTERNAL_WORKFLOW_LEAK.test(reply)) return reply;
  return buildBuyerWorkflowFailureReply(workflowId, failedStep, reply);
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
      recordWorkflowFallthrough({
        companyId: run.toolContext.companyId,
        workflowId: 'unknown',
        confidence: classified.confidence,
        channel: 'staff',
        reason: 'unknown',
        leadId: run.sessionLeadId ?? null,
        actorId: run.toolContext.userId,
        actorRole: run.toolContext.userRole,
      });
      return null;
    }

    const confidenceAction = evaluateMutationConfidence(classified.workflowId, classified.confidence);
    if (confidenceAction === 'fallthrough') {
      recordWorkflowFallthrough({
        companyId: run.toolContext.companyId,
        workflowId: classified.workflowId,
        confidence: classified.confidence,
        channel: 'staff',
        reason: 'low_confidence',
        leadId: classified.parameters.leadId ?? run.sessionLeadId ?? null,
        actorId: run.toolContext.userId,
        actorRole: run.toolContext.userRole,
      });
      return null;
    }
    if (confidenceAction === 'clarify') {
      incrementOpsMetric('workflow_clarification');
      await storePendingClarification(
        classified.parameters.leadId ?? run.sessionLeadId ?? undefined,
        classified.workflowId,
        classified.parameters,
      );
      // G5: Log clarification event for transparency in /dashboard/ai-action-logs.
      void logAgentAction({
        companyId: run.toolContext.companyId,
        triggeredBy: 'inbound_message',
        action: 'workflow_clarification',
        actorId: run.toolContext.userId,
        actorRole: run.toolContext.userRole,
        resourceType: 'lead',
        resourceId: classified.parameters.leadId ?? run.sessionLeadId ?? null,
        inputs: {
          workflowId: classified.workflowId,
          confidence: classified.confidence,
          parameters: classified.parameters,
          channel: 'staff',
        },
        status: 'success',
        result: 'Clarification requested',
      });
      return buildClarificationReply(classified.workflowId as MutationWorkflowId);
    }

    if (MUTATION_WORKFLOW_SET.has(classified.workflowId) && isVisitDateListQuery) {
      const listReply = await tryResolveVisitListReply(run.toolContext, run.messageText);
      if (listReply) return listReply;
      // No visits on that date — continue to book/reschedule via workflow (do not return null).
    }

    run.classifierConfidence = classified.confidence;
    run.classifierSource = 'classifier';
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
      "I've notified our team about your request.\n\n" +
      "I'm still here to help — feel free to ask about properties, visits, or brochures."
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

  const safe = sanitizeStaffInstructionsForBuyer(text || reply.trim());
  return safe || reply.trim();
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
  else if (isExplicitBrochureRequest(input.messageText)) workflowId = 'brochure_request';
  else if (isPropertyDetailsRequest(input.messageText)) workflowId = 'price_inquiry';
  else if (
    /\b(discount|negotiat|%\s*off|best price|final price|counter offer|lower the price)\b/.test(text)
    || /\bcan you (do|give)\s+\d+\s*%/.test(text)
    || /\bgive me\s+\d+\s*%/.test(text)
  ) {
    workflowId = 'escalate_to_human';
  } else if (/\b(price|cost|how much|rate)\b/.test(text)) workflowId = 'price_inquiry';
  else if (/\b(available|availability|units left|in stock)\b/.test(text)) workflowId = 'availability_check';
  else if (/\b(how many|number of|total)\b[\s\S]{0,40}\b(project|projects|properties|inventory|ongoing)\b/.test(text)) {
    workflowId = 'availability_check';
  } else if (/\b(do you|have you|got|any)\b[\s\S]{0,40}\b(villas?|apartments?|plots?|properties|projects?)\b/.test(text)) {
    workflowId = 'availability_check';
  } else if (/\b(\d)\s*bhk\b/.test(text)) workflowId = 'availability_check';
  else if (/\b(amenit|pool|gym|clubhouse)\b/.test(text)) workflowId = 'amenities_question';
  else if (/\b(talk\s+to|speak\s+to|human|agent|call\s+me|callback|call\s+back)\b/.test(text)) workflowId = 'escalate_to_human';
  if (!workflowId) return null;
  if (workflowId === 'escalate_to_human' && !input.leadId) return null;

  const gate = evaluateMutationGate(workflowId, 1, 'exact_regex');
  if (gate !== 'execute') return null;

  const params: WorkflowParams = {
    leadId: input.leadId,
    propertyId: input.propertyId,
    visitId: input.sessionVisitId ?? undefined,
    message: input.messageText,
  };

  const result = await runWorkflow(workflowId, buildBuyerWorkflowRun(input), params);

  if (!result.reply?.trim()) return null;
  const safe = sanitizeBuyerWorkflowReply(workflowId, result.reply, result.failedStep);
  return formatBuyerWorkflowReply(workflowId, safe);
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
      channel: 'buyer',
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
export interface BuyerActiveVisitContext {
  visitId: string;
  propertyName?: string | null;
}

/** Discount / negotiation requests must escalate — never answer via price_inquiry catalog. */
export function detectBuyerNegotiationEscalationBias(
  messageText: string,
): { workflowId: WorkflowId; parameters: WorkflowParams } | null {
  const text = messageText.toLowerCase();
  const isNegotiation =
    /\b(discount|negotiat|%\s*off|best price|final price|counter offer|lower the price|rate reduce)\b/.test(text)
    || /\bcan you (do|give)\s+\d+\s*%/.test(text)
    || /\bgive me\s+\d+\s*%/.test(text);
  if (!isNegotiation) return null;
  return {
    workflowId: 'escalate_to_human',
    parameters: {
      message: messageText,
      note: 'Price negotiation — specialist handoff',
    },
  };
}

/**
 * When buyer has an active visit, bias mutation workflows before LLM classification.
 * Handles "push my appointment" → reschedule_visit instead of schedule_visit.
 */
export function detectActiveVisitMutationBias(
  messageText: string,
  activeVisit?: BuyerActiveVisitContext | null,
): { workflowId: WorkflowId; parameters: WorkflowParams } | null {
  if (!activeVisit?.visitId) return null;
  const text = messageText.toLowerCase();
  if (/\b(cancel|call\s+off)\b/.test(text)) {
    return {
      workflowId: 'cancel_visit',
      parameters: { visitId: activeVisit.visitId, leadId: undefined, message: messageText },
    };
  }
  const rescheduleSignal =
    /\b(reschedule|move|push|change|postpone|shift|later)\b/.test(text)
    && /\b(visit|appointment|slot|time|it)\b/.test(text);
  if (rescheduleSignal || /\bpush\s+my\s+appointment\b/.test(text)) {
    const { parseRescheduleTargetFromMessage } = require('../visitIntentFromMessage.service');
    const parsed = parseRescheduleTargetFromMessage(messageText);
    const scheduledAt = parsed?.toISOString();
    return {
      workflowId: 'reschedule_visit',
      parameters: {
        visitId: activeVisit.visitId,
        message: messageText,
        ...(scheduledAt ? { scheduledAt, newScheduledAt: scheduledAt } : {}),
      },
    };
  }
  return null;
}

export async function classifyAndRunBuyerWorkflow(
  input: {
    companyId: string;
    leadId: string;
    messageText: string;
    propertyId?: string;
    companyName: string;
    sessionVisitId?: string | null;
    activeVisit?: BuyerActiveVisitContext | null;
  },
  deps?: { llm?: WorkflowLlmCaller },
): Promise<string | null> {
  if (!shouldClassifyWorkflow(input.messageText)) {
    return null;
  }
  if (isBuyerQualificationOnlyMessage(input.messageText)) {
    return null;
  }

  const run = buildBuyerWorkflowRun(input);

  const negotiationBias = detectBuyerNegotiationEscalationBias(input.messageText);
  if (negotiationBias) {
    const gate = evaluateMutationGate(negotiationBias.workflowId, 1, 'exact_regex');
    if (gate === 'execute') {
      const params: WorkflowParams = {
        ...negotiationBias.parameters,
        leadId: input.leadId,
        propertyId: input.propertyId,
      };
      const result = await runWorkflow(negotiationBias.workflowId, run, params);
      if (result.reply?.trim()) {
        const safe = sanitizeBuyerWorkflowReply(negotiationBias.workflowId, result.reply, result.failedStep);
        return formatBuyerWorkflowReply(negotiationBias.workflowId, safe);
      }
    }
  }

  const activeVisitCtx = input.activeVisit
    ?? (input.sessionVisitId ? { visitId: input.sessionVisitId } : null);
  const visitBias = detectActiveVisitMutationBias(input.messageText, activeVisitCtx);
  if (visitBias) {
    const hasRescheduleTime = Boolean(
      visitBias.parameters.scheduledAt || visitBias.parameters.newScheduledAt,
    );
    const confidence = visitBias.workflowId === 'reschedule_visit' && !hasRescheduleTime ? 0.75 : 1;
    const gate = evaluateMutationGate(visitBias.workflowId, confidence, 'bias_detector');
    if (gate === 'clarify') {
      await storePendingClarification(input.leadId, visitBias.workflowId, visitBias.parameters);
      void logAgentAction({
        companyId: input.companyId,
        triggeredBy: 'inbound_message',
        action: 'workflow_clarification',
        resourceType: 'lead',
        resourceId: input.leadId,
        inputs: { workflowId: visitBias.workflowId, confidence, channel: 'buyer', source: 'bias_detector' },
        status: 'success',
        result: 'Clarification requested',
      });
      return buildClarificationReply(visitBias.workflowId as MutationWorkflowId);
    }
    if (gate === 'execute') {
      const params: WorkflowParams = {
        ...visitBias.parameters,
        leadId: visitBias.parameters.leadId ?? input.leadId,
        propertyId: input.propertyId,
        visitId: visitBias.parameters.visitId ?? input.sessionVisitId ?? undefined,
      };
      const result = await runWorkflow(visitBias.workflowId, run, params);
      if (result.reply?.trim()) {
        const safe = sanitizeBuyerWorkflowReply(visitBias.workflowId, result.reply, result.failedStep);
        return formatBuyerWorkflowReply(visitBias.workflowId, safe);
      }
    }
  }

  const pending = await resolvePendingClarification(input.leadId, input.messageText);
  if (pending && isBuyerWorkflowId(pending.workflowId)) {
    const gate = evaluateMutationGate(pending.workflowId, 1, 'pending_clarification');
    if (gate === 'clarify') {
      incrementOpsMetric('workflow_clarification');
      void logAgentAction({
        companyId: input.companyId,
        triggeredBy: 'inbound_message',
        action: 'workflow_clarification',
        resourceType: 'lead',
        resourceId: input.leadId,
        inputs: { workflowId: pending.workflowId, channel: 'buyer', source: 'pending_clarification_reask' },
        status: 'success',
        result: 'Clarification re-asked',
      });
      return buildClarificationReply(pending.workflowId as MutationWorkflowId);
    }
    if (gate === 'execute') {
      void logAgentAction({
        companyId: input.companyId,
        triggeredBy: 'inbound_message',
        action: 'workflow_clarification_resolved',
        resourceType: 'lead',
        resourceId: input.leadId,
        inputs: { workflowId: pending.workflowId, channel: 'buyer' },
        status: 'success',
        result: 'Pending clarification resolved; executing workflow',
      });
      const params: WorkflowParams = {
        ...pending.parameters,
        leadId: pending.parameters.leadId ?? input.leadId,
        propertyId: pending.parameters.propertyId ?? input.propertyId,
        visitId: pending.parameters.visitId ?? input.sessionVisitId ?? undefined,
        message: input.messageText,
      };
      run.classifierSource = 'pending_clarification';
      const result = await runWorkflow(pending.workflowId, run, params);
      if (result.reply?.trim()) return formatBuyerWorkflowReply(pending.workflowId, result.reply);
    }
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
        channel: 'buyer',
      },
      deps?.llm,
    );

    if (classified.workflowId === 'unknown' || !isBuyerWorkflowId(classified.workflowId)) {
      recordWorkflowFallthrough({
        companyId: input.companyId,
        workflowId: String(classified.workflowId),
        confidence: classified.confidence,
        channel: 'buyer',
        reason: 'unknown',
        leadId: input.leadId,
      });
      return tryRunBuyerWorkflow(input);
    }

    if (
      classified.workflowId === 'price_inquiry'
      && detectBuyerNegotiationEscalationBias(input.messageText)
    ) {
      classified.workflowId = 'escalate_to_human';
      classified.parameters = {
        ...classified.parameters,
        note: 'Price negotiation — specialist handoff',
      };
    }

    const confidenceAction = evaluateMutationGate(classified.workflowId, classified.confidence, 'classifier');
    if (confidenceAction === 'fallthrough') {
      recordWorkflowFallthrough({
        companyId: input.companyId,
        workflowId: classified.workflowId,
        confidence: classified.confidence,
        channel: 'buyer',
        reason: 'low_confidence',
        leadId: input.leadId,
      });
      return tryRunBuyerWorkflow(input);
    }
    if (confidenceAction === 'clarify') {
      incrementOpsMetric('workflow_clarification');
      await storePendingClarification(input.leadId, classified.workflowId, classified.parameters);
      // G5: Log clarification event for transparency in /dashboard/ai-action-logs.
      void logAgentAction({
        companyId: input.companyId,
        triggeredBy: 'inbound_message',
        action: 'workflow_clarification',
        resourceType: 'lead',
        resourceId: input.leadId,
        inputs: {
          workflowId: classified.workflowId,
          confidence: classified.confidence,
          parameters: classified.parameters,
          channel: 'buyer',
        },
        status: 'success',
        result: 'Clarification requested',
      });
      if (classified.workflowId === 'escalate_to_human') {
        return (
          'Would you like me to connect you with a team member? Reply *yes* to confirm, ' +
          'or tell me what you need and I will try to help.'
        );
      }
      return buildClarificationReply(classified.workflowId as MutationWorkflowId);
    }

    const params: WorkflowParams = {
      ...classified.parameters,
      leadId: classified.parameters.leadId ?? input.leadId,
      propertyId: classified.parameters.propertyId ?? input.propertyId,
      visitId: classified.parameters.visitId ?? input.sessionVisitId ?? undefined,
      message: input.messageText,
    };

    run.classifierConfidence = classified.confidence;
    run.classifierSource = 'classifier';
    const result = await runWorkflow(classified.workflowId, run, params);
    const label = getWorkflowDefinition(classified.workflowId)?.label ?? classified.workflowId;

    if (!result.ok) {
      if (!result.reply?.trim()) return null;
      const safe = sanitizeBuyerWorkflowReply(classified.workflowId, result.reply, result.failedStep);
      return formatBuyerWorkflowReply(classified.workflowId, safe);
    }

    if (result.reply?.trim()) {
      const safe = sanitizeBuyerWorkflowReply(classified.workflowId, result.reply);
      return formatBuyerWorkflowReply(classified.workflowId, safe);
    }
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

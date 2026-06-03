/**
 * Agent Action Log Service
 *
 * Write-through service for recording every autonomous AI action (cron jobs,
 * agent tool calls, automated status changes) to the `agent_action_logs` table.
 *
 * Design contract:
 * - NEVER throws. All errors are swallowed and logged to stderr only.
 * - Fire-and-forget safe: callers do not need to await in critical paths.
 * - All fields are optional except companyId, triggeredBy, and action.
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import logger from '../config/logger';

/** Who initiated the action. */
export type ActionTrigger = 'cron' | 'agent_tool' | 'automation' | 'inbound_message';

/** Outcome of the action. */
export type ActionStatus = 'success' | 'failed' | 'skipped';

export interface LogAgentActionParams {
  companyId: string;
  triggeredBy: ActionTrigger;
  action: string;
  actorId?: string | null;
  actorRole?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  inputs?: Record<string, unknown> | null;
  result?: string | null;
  status?: ActionStatus;
  errorMessage?: string | null;
  durationMs?: number | null;
}

/**
 * Persists one agent action log entry.
 *
 * Non-throwing: if the DB write fails, the error is logged to stderr and the
 * caller continues normally. Never use await in critical-path code — fire and
 * forget from cron handlers and tool callbacks.
 *
 * @param params - Action metadata to persist.
 */
export async function logAgentAction(params: LogAgentActionParams): Promise<void> {
  try {
    await prisma.agentActionLog.create({
      data: {
        companyId: params.companyId,
        triggeredBy: params.triggeredBy,
        action: params.action,
        actorId: params.actorId ?? null,
        actorRole: params.actorRole ?? null,
        resourceType: params.resourceType ?? null,
        resourceId: params.resourceId ?? null,
        inputs: params.inputs != null ? (params.inputs as unknown as Prisma.InputJsonValue) : undefined,
        result: params.result ?? null,
        status: params.status ?? 'success',
        errorMessage: params.errorMessage ?? null,
        durationMs: params.durationMs ?? null,
      },
    });
  } catch (err: unknown) {
    logger.error('AgentActionLog write failed', {
      action: params.action,
      companyId: params.companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Purges action log entries older than the given number of days.
 * Called by the nightly cleanup cron to enforce the 90-day TTL.
 *
 * @param retentionDays - Entries older than this will be deleted. Default 90.
 * @returns Number of rows deleted.
 */
export async function purgeOldActionLogs(retentionDays = 90): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.agentActionLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}

/**
 * Returns the N most recent action log entries for a company, with optional
 * filter by action name or status.
 *
 * @param companyId - Tenant scope.
 * @param limit - Maximum records to return.
 * @param action - Optional filter by action name substring.
 * @param status - Optional filter by outcome status.
 * @returns Array of log entries ordered newest-first.
 */
export async function getRecentActionLogs(
  companyId: string,
  limit = 20,
  action?: string,
  status?: ActionStatus,
) {
  return prisma.agentActionLog.findMany({
    where: {
      companyId,
      ...(action ? { action: { contains: action, mode: 'insensitive' } } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
  });
}

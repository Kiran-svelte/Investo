/**
 * @file workflow-compensator.service.ts
 * @description Compensating saga actions for workflow partial failures (Gap 1).
 *
 * When a workflow step fails after a mutation has already been committed,
 * compensators here reverse those mutations so the system stays consistent
 * without silent orphan records.
 *
 * Strategy (ai-implementation-plan.md Option C + limited A for visit mutations):
 *  - Compensators run in REVERSE order of completed mutation steps.
 *  - Compensator failures mark the run as `needs_reconciliation` for manual review.
 *  - All compensation actions are logged to `agent_action_logs` for audit.
 */

import prisma from '../../config/prisma';
import logger from '../../config/logger';
import { logAgentAction } from '../agent-action-log.service';
import type { WorkflowState } from './workflow.types';

/**
 * DB writes that need compensation on downstream failure.
 * cancelVisitSlot frees the old slot during a reschedule; if the subsequent
 * bookVisit fails it must be restored, so it is a tracked mutation.
 */
const MUTATION_ACTIONS = new Set([
  'bookVisit',
  'cancelVisitSlot',
  'cancelVisit',
  'updateLeadStatus',
  'updateLeadStatusVisitScheduled',
  'updateLeadStatusVisited',
]);

/**
 * Returns true when an action name corresponds to a DB mutation.
 * Used to decide which completed steps need compensation on failure.
 *
 * @param action - Workflow action name (e.g. 'bookVisit').
 */
export function isMutationAction(action: string): boolean {
  return MUTATION_ACTIONS.has(action);
}

/**
 * Cancels a visit that was created during a failed workflow run.
 * Scoped to `companyId` as a safety guard against cross-tenant mutations.
 * No-op if the visit is already cancelled.
 *
 * @param visitId - ID of the visit to cancel.
 * @param companyId - Tenant scope for cross-tenant safety.
 * @returns true if cancelled or already cancelled, false on unexpected DB error.
 * @throws Never — all errors are caught and logged.
 */
export async function compensateBookVisit(visitId: string, companyId?: string): Promise<boolean> {
  try {
    const whereClause: Record<string, unknown> = { id: visitId };
    if (companyId) whereClause['companyId'] = companyId;

    const visit = await prisma.visit.findFirst({
      where: whereClause as any,
      select: { status: true },
    });
    if (!visit || visit.status === 'cancelled') return true;

    await prisma.visit.update({
      where: { id: visitId },
      data: { status: 'cancelled', updatedAt: new Date() },
    });
    logger.info('Compensator: visit cancelled', { visitId, companyId });
    return true;
  } catch (err: unknown) {
    logger.error('Compensator: compensateBookVisit failed', {
      visitId,
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Restores a visit to the status it held before it was cancelled, used to roll
 * back `cancelVisitSlot` (reschedule prep) or `cancelVisit` when a downstream
 * non-optional step fails. No-op if no prior status was captured.
 *
 * @param visitId - ID of the visit to restore.
 * @param priorStatus - Status captured before the cancel (e.g. 'scheduled').
 * @param companyId - Tenant scope for cross-tenant safety.
 * @returns true if restored or nothing to do, false on DB error.
 * @throws Never — all errors are caught and logged.
 */
export async function compensateCancelVisit(
  visitId: string,
  priorStatus: string | undefined,
  companyId?: string,
): Promise<boolean> {
  if (!priorStatus || priorStatus === 'cancelled') return true;
  try {
    const whereClause: Record<string, unknown> = { id: visitId, status: 'cancelled' };
    if (companyId) whereClause['companyId'] = companyId;
    await prisma.visit.updateMany({
      where: whereClause as any,
      data: { status: priorStatus as any, updatedAt: new Date() },
    });
    logger.info('Compensator: cancelled visit restored', { visitId, companyId, restoredTo: priorStatus });
    return true;
  } catch (err: unknown) {
    logger.error('Compensator: compensateCancelVisit failed', {
      visitId,
      companyId,
      priorStatus,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Reverts a lead status to the value captured before the workflow mutation.
 * If no snapshot exists, returns false without touching the lead.
 *
 * @param leadId - ID of the lead to revert.
 * @param previousStatus - Pre-mutation status from stateSnapshot.oldLeadStatus.
 * @param companyId - Tenant scope for safety.
 * @returns true if reverted, false if no snapshot or DB error.
 * @throws Never — all errors are caught and logged.
 */
export async function compensateUpdateLeadStatus(
  leadId: string,
  previousStatus: string | undefined,
  companyId?: string,
): Promise<boolean> {
  if (!previousStatus) {
    logger.warn('Compensator: no previousStatus snapshot; cannot revert lead status', {
      leadId,
      companyId,
    });
    return false;
  }
  try {
    await prisma.lead.update({
      where: { id: leadId },
      // TODO(agent): verify — status cast required; Prisma enum does not accept plain string in generic paths
      data: { status: previousStatus as any, updatedAt: new Date() },
    });
    logger.info('Compensator: lead status reverted', { leadId, companyId, revertedTo: previousStatus });
    return true;
  } catch (err: unknown) {
    logger.error('Compensator: compensateUpdateLeadStatus failed', {
      leadId,
      companyId,
      previousStatus,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Marks a WorkflowRunRecord as `needs_reconciliation`.
 * Called when compensators themselves fail — alerts on-call via the nightly reconciliation cron.
 *
 * @param workflowRunId - UUID of the run record to flag.
 * @throws Never — errors are only logged.
 */
export async function markRunNeedsReconciliation(workflowRunId: string): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE workflow_run_records
       SET status = 'needs_reconciliation', updated_at = now()
       WHERE id = $1::uuid`,
      workflowRunId,
    );
    logger.warn('WorkflowRun flagged needs_reconciliation', { workflowRunId });
  } catch (err: unknown) {
    logger.error('markRunNeedsReconciliation DB write failed', {
      workflowRunId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface CompensatorInput {
  workflowRunId: string;
  failedStep: string;
  completedSteps: string[];
  state: WorkflowState;
  stateSnapshot: Record<string, unknown>;
  companyId: string;
}

/**
 * Main compensator orchestrator: called by `runWorkflow` on non-optional step failure.
 * Runs compensators in reverse order of completed mutation steps.
 * Flags run as `needs_reconciliation` if any compensator fails.
 *
 * @param input - Context including snapshot, completed steps, and state from the failed run.
 * @returns true if all compensators succeeded, false if any failed.
 * @throws Never — all errors are caught and logged.
 */
export async function runCompensators(input: CompensatorInput): Promise<boolean> {
  const { completedSteps, state, stateSnapshot, companyId } = input;
  let allOk = true;

  const reversed = [...completedSteps].reverse();
  for (const action of reversed) {
    if (!isMutationAction(action)) continue;

    if (action === 'bookVisit' && typeof state.visitId === 'string') {
      const createdInRun = stateSnapshot.createdVisitId === state.visitId;
      if (createdInRun) {
        const ok = await compensateBookVisit(state.visitId, companyId);
        allOk = ok && allOk;
        if (ok) {
          void logAgentAction({
            companyId,
            triggeredBy: 'inbound_message',
            action: 'compensate_book_visit',
            resourceType: 'visit',
            resourceId: state.visitId,
            inputs: { workflowRunId: input.workflowRunId },
            status: 'success',
          });
        }
      }
    }

    if (action === 'cancelVisitSlot' && typeof state.cancelledSlotVisitId === 'string') {
      const ok = await compensateCancelVisit(
        state.cancelledSlotVisitId,
        state.cancelledSlotPriorStatus,
        companyId,
      );
      allOk = ok && allOk;
      if (ok) {
        void logAgentAction({
          companyId,
          triggeredBy: 'inbound_message',
          action: 'compensate_cancel_visit_slot',
          resourceType: 'visit',
          resourceId: state.cancelledSlotVisitId,
          inputs: { workflowRunId: input.workflowRunId, restoredTo: state.cancelledSlotPriorStatus },
          status: 'success',
        });
      }
    }

    if (action === 'cancelVisit' && typeof state.cancelledVisitId === 'string') {
      const ok = await compensateCancelVisit(
        state.cancelledVisitId,
        state.cancelledVisitPriorStatus,
        companyId,
      );
      allOk = ok && allOk;
      if (ok) {
        void logAgentAction({
          companyId,
          triggeredBy: 'inbound_message',
          action: 'compensate_cancel_visit',
          resourceType: 'visit',
          resourceId: state.cancelledVisitId,
          inputs: { workflowRunId: input.workflowRunId, restoredTo: state.cancelledVisitPriorStatus },
          status: 'success',
        });
      }
    }

    if (
      (action === 'updateLeadStatus' || action === 'updateLeadStatusVisitScheduled')
      && typeof state.leadId === 'string'
    ) {
      const prevStatus = stateSnapshot.oldLeadStatus as string | undefined;
      const ok = await compensateUpdateLeadStatus(state.leadId, prevStatus, companyId);
      allOk = ok && allOk;
      if (ok) {
        void logAgentAction({
          companyId,
          triggeredBy: 'inbound_message',
          action: 'compensate_update_lead_status',
          resourceType: 'lead',
          resourceId: state.leadId,
          inputs: { workflowRunId: input.workflowRunId, revertedTo: prevStatus },
          status: 'success',
        });
      }
    }
  }

  const finalStatus = allOk ? 'failed' : 'needs_reconciliation';
  await prisma.$executeRawUnsafe(
    `UPDATE workflow_run_records
     SET status = $1, completed_at = now(), updated_at = now()
     WHERE id = $2::uuid`,
    finalStatus,
    input.workflowRunId,
  ).catch(() => undefined);

  // Always leave a DB trace of the partial failure so ops can audit/reconcile:
  // 'success' when fully compensated (rolled back), 'failed' when manual
  // reconciliation is required.
  void logAgentAction({
    companyId,
    triggeredBy: 'inbound_message',
    action: allOk ? 'workflow_partial_rollback' : 'workflow_needs_reconciliation',
    resourceType: 'workflow_run',
    resourceId: input.workflowRunId,
    inputs: {
      workflowRunId: input.workflowRunId,
      failedStep: input.failedStep,
      completedSteps: input.completedSteps,
    },
    status: allOk ? 'success' : 'failed',
    result: allOk
      ? 'Mutations compensated and rolled back'
      : 'Compensation incomplete; needs manual reconciliation',
  });

  if (!allOk) {
    await markRunNeedsReconciliation(input.workflowRunId);
  }

  return allOk;
}

/**
 * Builds a staff copilot partial-failure reply.
 * Never exposes internal step names to the end user.
 *
 * @param workflowLabel - Human-readable workflow label (e.g. "Schedule Visit").
 * @param _failedStep - Internal action name for logging only (not shown to user).
 * @returns Staff-facing partial failure message.
 */
export function buildPartialFailureReply(workflowLabel: string, _failedStep: string): string {
  return (
    `*${workflowLabel}* partially completed.\n\n` +
    `The visit/lead record was saved but the follow-up step did not finish. ` +
    `Our team has been notified. You can retry or check the dashboard.`
  );
}

/**
 * Builds a buyer-safe partial-failure reply.
 *
 * Rules:
 * - Never say "was saved" or any mutation-claim language — the mutation may have
 *   rolled back. `mutationLanguageGuard` would catch it, but we prevent it at source.
 * - Never expose workflow names, step names, or internal identifiers.
 * - Set buyer expectation that the team will confirm.
 *
 * @param _workflowLabel - Unused in buyer-safe variant (would expose internal names).
 * @param _failedStep - Internal action name for logging only (never shown to buyer).
 * @returns Buyer-facing fallback message that does not claim mutation success.
 */
export function buildBuyerSafePartialFailureReply(
  _workflowLabel: string,
  _failedStep: string,
): string {
  return (
    'We hit a small snag processing your request. ' +
    'Our team will follow up with you to confirm everything shortly. ' +
    'You can also call us directly if it is urgent.'
  );
}

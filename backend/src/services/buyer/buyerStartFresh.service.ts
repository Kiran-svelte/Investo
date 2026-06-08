import prisma from '../../config/prisma';
import logger from '../../config/logger';
import { conversationStateManager } from '../conversationStateMachine';
import { logAgentAction } from '../agent-action-log.service';
import { cancelVisitReminderJobs } from '../visitLifecycle.service';
import { ensureCallRequestsSchema, cancelCallRequest } from '../callRequest.service';
import { resolveBookingApprovalStatus } from '../bookingApproval.service';

const ACTIVE_VISIT_STATUSES = ['scheduled', 'confirmed'] as const;
const START_COMMAND = '/start';

export interface BuyerStartFreshInput {
  companyId: string;
  leadId: string;
  conversationId: string;
  customerPhone?: string;
}

export interface BuyerStartFreshResult {
  visitsCancelled: number;
  callRequestsCancelled: number;
  approvalsCancelled: number;
  conversationReset: boolean;
}

/** True when the inbound text is an exact /start command (trimmed, case-insensitive). */
export function isBuyerStartCommand(messageText: string): boolean {
  return messageText.trim().toLowerCase() === START_COMMAND;
}

export function buildBuyerStartFreshReply(companyName: string): string {
  return (
    `You're starting fresh with *${companyName}*! 🏡\n\n` +
    `I've cleared your previous visit requests, callbacks, and conversation context. ` +
    `Our AI assistant is ready to help — share your *budget*, preferred *area*, and *property type* whenever you're ready.`
  );
}

async function findActiveCallRequestIds(companyId: string, leadId: string): Promise<string[]> {
  await ensureCallRequestsSchema();
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM call_requests
     WHERE company_id = $1::uuid AND lead_id = $2::uuid
       AND status IN ('pending_approval', 'scheduled', 'confirmed')
     ORDER BY scheduled_at ASC`,
    companyId,
    leadId,
  );
  return rows.map((r) => r.id);
}

async function cancelPendingApprovalsForLead(companyId: string, leadId: string): Promise<number> {
  const model = (prisma as { bookingApprovalRequest?: { findMany: Function } }).bookingApprovalRequest;
  if (!model?.findMany) return 0;

  const pending = await model.findMany({
    where: { companyId, leadId, status: 'pending' },
    select: { id: true },
  });

  let count = 0;
  for (const row of pending) {
    const resolved = await resolveBookingApprovalStatus({ approvalId: row.id, status: 'cancelled' });
    if (resolved?.status === 'cancelled') count += 1;
  }
  return count;
}

/**
 * Atomically clears buyer booking state and resets the conversation for a fresh AI turn.
 * Does NOT modify lead.status or delete the lead row.
 */
export async function resetBuyerBookingAndConversationState(
  input: BuyerStartFreshInput,
): Promise<BuyerStartFreshResult> {
  const initialState = conversationStateManager.createInitialState();
  const visitIdsToCancelReminders: string[] = [];

  const result = await prisma.$transaction(async (tx) => {
    const activeVisits = await tx.visit.findMany({
      where: {
        companyId: input.companyId,
        leadId: input.leadId,
        status: { in: [...ACTIVE_VISIT_STATUSES] },
      },
      select: { id: true },
    });

    if (activeVisits.length > 0) {
      await tx.visit.updateMany({
        where: {
          companyId: input.companyId,
          leadId: input.leadId,
          status: { in: [...ACTIVE_VISIT_STATUSES] },
        },
        data: {
          status: 'cancelled',
          notes: 'Cancelled via buyer /start reset',
        },
      });
      visitIdsToCancelReminders.push(...activeVisits.map((v) => v.id));
    }

    const conversation = await tx.conversation.update({
      where: { id: input.conversationId },
      data: {
        status: 'ai_active',
        aiEnabled: true,
        stage: 'rapport',
        stageEnteredAt: new Date(),
        stageMessageCount: 0,
        commitments: initialState.commitments as object,
        objectionCount: 0,
        lastObjectionType: null,
        consecutiveObjections: 0,
        urgencyScore: 5,
        valueScore: 5,
        escalationReason: null,
        escalatedAt: null,
        recommendedPropertyIds: [],
        selectedPropertyId: null,
        proposedVisitTime: null,
      },
    });

    return {
      visitsCancelled: activeVisits.length,
      conversationReset: Boolean(conversation),
    };
  });

  for (const visitId of visitIdsToCancelReminders) {
    await cancelVisitReminderJobs(visitId);
  }

  const callIds = await findActiveCallRequestIds(input.companyId, input.leadId);
  let callRequestsCancelled = 0;
  for (const callId of callIds) {
    const cancelled = await cancelCallRequest({
      companyId: input.companyId,
      callId,
      notifyAgent: false,
    });
    if (cancelled.success) callRequestsCancelled += 1;
  }

  const approvalsCancelled = await cancelPendingApprovalsForLead(input.companyId, input.leadId);

  void logAgentAction({
    companyId: input.companyId,
    triggeredBy: 'inbound_message',
    action: 'buyer_start_fresh_reset',
    resourceType: 'lead',
    resourceId: input.leadId,
    status: 'success',
    inputs: {
      conversationId: input.conversationId,
      customerPhone: input.customerPhone ?? null,
      visitsCancelled: result.visitsCancelled,
      callRequestsCancelled,
      approvalsCancelled,
    },
  });

  logger.info('Buyer /start fresh reset completed', {
    companyId: input.companyId,
    leadId: input.leadId,
    conversationId: input.conversationId,
    visitsCancelled: result.visitsCancelled,
    callRequestsCancelled,
    approvalsCancelled,
  });

  return {
    visitsCancelled: result.visitsCancelled,
    callRequestsCancelled,
    approvalsCancelled,
    conversationReset: result.conversationReset,
  };
}

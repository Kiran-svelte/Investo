import {
  isCallBookingIntent,
  isCallCancelIntent,
  isCallRescheduleIntent,
  isCallStatusQuery,
  isBareSchedulingTimeReply,
  isHumanEscalationIntent,
  resolveCallScheduledAt,
} from '../utils/callIntentFromMessage.util';
import {
  clearConversationAwaitingCallTime,
  isConversationAwaitingCallTime,
  isConversationInVisitSchedulingFlow,
  setConversationAwaitingCallTime,
} from '../utils/conversationCallContext.util';
import {
  buildBuyerCallStatusReply,
  cancelCallRequest,
  findActiveCallRequest,
  formatBuyerCallReply,
  notifyAgentCallChangeRequested,
  rescheduleCallRequest,
  scheduleCallRequest,
} from './callRequest.service';
import { parseVisitDateTimeFromMessage } from './visitIntentFromMessage.service';
import { parseDateTimeFromNaturalLanguage } from '../utils/parseDateTimeFromMessage.util';
import prisma from '../config/prisma';

export { isCallStatusQuery };

export interface CommitCustomerCallInput {
  companyId: string;
  customerMessage: string;
  conversationId?: string;
  lead: { id: string; assignedAgentId?: string | null };
  /** When set, call booking is owned by the interactive handler — skip text-path commit. */
  interactiveId?: string;
}

export interface CommitCustomerCallResult {
  committed: boolean;
  customerReply?: string;
  workflowSuggestion?: { workflowId: string; parameters: Record<string, unknown> };
  /** When true, H-call attaches call-reschedule / call-cancel buttons. */
  hasActiveCall?: boolean;
}

export async function tryCommitCustomerCallBooking(
  input: CommitCustomerCallInput,
): Promise<CommitCustomerCallResult> {
  if (input.interactiveId?.trim()) {
    return { committed: false };
  }

  const msg = input.customerMessage.trim();
  if (!msg) return { committed: false };

  if (isHumanEscalationIntent(msg)) {
    return { committed: false };
  }

  const active = await findActiveCallRequest({
    companyId: input.companyId,
    leadId: input.lead.id,
  });

  if (isCallStatusQuery(msg)) {
    const customerReply = await buildBuyerCallStatusReply({
      companyId: input.companyId,
      leadId: input.lead.id,
    });
    return { committed: true, customerReply, hasActiveCall: Boolean(active) };
  }

  if (isCallCancelIntent(msg)) {
    if (!active) {
      return {
        committed: true,
        customerReply: "I couldn't find a scheduled callback to cancel. Would you like to book a new one?",
        hasActiveCall: false,
      };
    }
    if (active.status === 'confirmed') {
      await notifyAgentCallChangeRequested({
        companyId: input.companyId,
        callId: active.id,
        messageText: msg,
      }).catch(() => undefined);
      return {
        committed: true,
        customerReply: `Your callback is already confirmed, so I can't cancel it automatically. I have notified the team to help you.`,
        hasActiveCall: true,
      };
    }
    const cancelled = await cancelCallRequest({ companyId: input.companyId, callId: active.id });
    if (!cancelled.success) {
      return {
        committed: true,
        customerReply: "I couldn't cancel that callback. Please ask your agent for help.",
        hasActiveCall: true,
      };
    }
    return {
      committed: true,
      customerReply: `*Callback cancelled*\n\nReply anytime if you'd like to schedule a new call with our team.`,
      hasActiveCall: false,
    };
  }

  if (isCallRescheduleIntent(msg)) {
    if (!active) {
      return {
        committed: true,
        customerReply: "I couldn't find a scheduled callback. Share a date and time (e.g. *tomorrow 3pm*) to book one.",
        hasActiveCall: false,
      };
    }
    if (active.status === 'confirmed') {
      await notifyAgentCallChangeRequested({
        companyId: input.companyId,
        callId: active.id,
        messageText: msg,
      }).catch(() => undefined);
      return {
        committed: true,
        customerReply: `Your callback is already confirmed, so I can't reschedule it automatically. I have notified the team to help you.`,
        hasActiveCall: true,
      };
    }
    const newTime =
      parseDateTimeFromNaturalLanguage(msg)
      ?? parseVisitDateTimeFromMessage(msg)
      ?? resolveCallScheduledAt(msg);
    const rescheduled = await rescheduleCallRequest({
      companyId: input.companyId,
      callId: active.id,
      scheduledAt: newTime,
    });
    if (!rescheduled.success) {
      return {
        committed: true,
        customerReply: "I couldn't reschedule that callback. Please share another date and time.",
      };
    }
    const agent = rescheduled.call
      ? await prisma.user.findUnique({ where: { id: rescheduled.call.agent_id }, select: { name: true } })
      : null;
    return {
      committed: true,
      customerReply: formatBuyerCallReply('Callback request updated', newTime, agent?.name),
    };
  }

  if (!isCallBookingIntent(msg)) {
    let awaitingCallTime = false;
    let inVisitSchedulingFlow = false;
    if (input.conversationId) {
      const conversation = await prisma.conversation.findUnique({
        where: { id: input.conversationId },
        select: { commitments: true, stage: true },
      });
      awaitingCallTime = isConversationAwaitingCallTime(conversation?.commitments);
      inVisitSchedulingFlow = isConversationInVisitSchedulingFlow({
        stage: conversation?.stage,
        commitments: conversation?.commitments,
      });
    }

    const bareTimeReply = isBareSchedulingTimeReply(msg);
    if (!awaitingCallTime && !active) {
      return { committed: false };
    }
    // Active callback must not steal bare time while buyer is booking a site visit.
    if (inVisitSchedulingFlow && bareTimeReply && !awaitingCallTime) {
      return { committed: false };
    }
    if (!bareTimeReply) {
      return { committed: false };
    }
  }

  const scheduledAt = resolveCallScheduledAt(msg);
  if (active) {
    if (active.status === 'confirmed') {
      await notifyAgentCallChangeRequested({
        companyId: input.companyId,
        callId: active.id,
        messageText: msg,
      }).catch(() => undefined);
      return {
        committed: true,
        customerReply: `Your callback is already confirmed, so I can't change it automatically. I have notified the team to help you.`,
        hasActiveCall: true,
      };
    }
    const rescheduled = await rescheduleCallRequest({
      companyId: input.companyId,
      callId: active.id,
      scheduledAt,
    });
    if (rescheduled.success && rescheduled.call) {
      if (input.conversationId) {
        await clearConversationAwaitingCallTime(input.conversationId).catch(() => undefined);
      }
      const agent = rescheduled.call
        ? await prisma.user.findUnique({ where: { id: rescheduled.call.agent_id }, select: { name: true } })
        : null;
      return {
        committed: true,
        customerReply: formatBuyerCallReply('Callback request updated', scheduledAt, agent?.name),
        hasActiveCall: true,
      };
    }
  }

  const booked = await scheduleCallRequest({
    companyId: input.companyId,
    leadId: input.lead.id,
    scheduledAt,
    notes: msg.slice(0, 500),
    agentId: input.lead.assignedAgentId ?? undefined,
  });
  if (!booked.success || !booked.call) {
    if (input.conversationId) {
      await setConversationAwaitingCallTime(input.conversationId).catch(() => undefined);
    }
    return {
      committed: true,
      customerReply:
        `📞 I'll ask our team to call you — please share a good time if you have one (e.g. *tomorrow 3pm*).`,
      hasActiveCall: false,
    };
  }
  if (input.conversationId) {
    await clearConversationAwaitingCallTime(input.conversationId).catch(() => undefined);
  }
  const agent = await prisma.user.findUnique({
    where: { id: booked.call.agent_id },
    select: { name: true },
  });
  return {
    committed: true,
    customerReply: formatBuyerCallReply('Callback request sent', scheduledAt, agent?.name),
    hasActiveCall: true,
  };
}

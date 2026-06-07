import {
  isCallBookingIntent,
  isCallCancelIntent,
  isCallRescheduleIntent,
  isCallStatusQuery,
  resolveCallScheduledAt,
} from '../utils/callIntentFromMessage.util';
import {
  buildBuyerCallStatusReply,
  cancelCallRequest,
  findActiveCallRequest,
  formatBuyerCallReply,
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
  lead: { id: string; assignedAgentId?: string | null };
}

export interface CommitCustomerCallResult {
  committed: boolean;
  customerReply?: string;
  workflowSuggestion?: { workflowId: string; parameters: Record<string, unknown> };
}

export async function tryCommitCustomerCallBooking(
  input: CommitCustomerCallInput,
): Promise<CommitCustomerCallResult> {
  const msg = input.customerMessage.trim();
  if (!msg) return { committed: false };

  if (isCallStatusQuery(msg)) {
    const customerReply = await buildBuyerCallStatusReply({
      companyId: input.companyId,
      leadId: input.lead.id,
    });
    return { committed: true, customerReply };
  }

  const active = await findActiveCallRequest({
    companyId: input.companyId,
    leadId: input.lead.id,
  });

  if (isCallCancelIntent(msg)) {
    if (!active) {
      return {
        committed: true,
        customerReply: "I couldn't find a scheduled callback to cancel. Would you like to book a new one?",
      };
    }
    const cancelled = await cancelCallRequest({ companyId: input.companyId, callId: active.id });
    if (!cancelled.success) {
      return { committed: true, customerReply: "I couldn't cancel that callback. Please ask your agent for help." };
    }
    return {
      committed: true,
      customerReply: `*Callback cancelled*\n\nReply anytime if you'd like to schedule a new call with our team.`,
    };
  }

  if (isCallRescheduleIntent(msg)) {
    if (!active) {
      return {
        committed: true,
        customerReply: "I couldn't find a scheduled callback. Share a date and time (e.g. *tomorrow 3pm*) to book one.",
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
      customerReply: formatBuyerCallReply('Callback rescheduled', newTime, agent?.name),
    };
  }

  if (!isCallBookingIntent(msg)) return { committed: false };

  const scheduledAt = resolveCallScheduledAt(msg);
  if (active) {
    const rescheduled = await rescheduleCallRequest({
      companyId: input.companyId,
      callId: active.id,
      scheduledAt,
    });
    if (rescheduled.success && rescheduled.call) {
      const agent = rescheduled.call
        ? await prisma.user.findUnique({ where: { id: rescheduled.call.agent_id }, select: { name: true } })
        : null;
      return {
        committed: true,
        customerReply: formatBuyerCallReply('Callback updated', scheduledAt, agent?.name),
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
    return {
      committed: true,
      customerReply: "I couldn't schedule that callback right now. Please share another time or ask for an agent.",
    };
  }
  const agent = await prisma.user.findUnique({
    where: { id: booked.call.agent_id },
    select: { name: true },
  });
  return {
    committed: true,
    customerReply: formatBuyerCallReply('Callback scheduled', scheduledAt, agent?.name),
  };
}

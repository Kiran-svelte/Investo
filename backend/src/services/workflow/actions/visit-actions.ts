import prisma from '../../../config/prisma';
import logger from '../../../config/logger';
import { logAgentAction } from '../../agent-action-log.service';
import { applyVisitMutationFromChat } from '../../visitMutationFromChat.service';
import { scheduleVisit } from '../../visitBooking.service';
import { buildVisitScopeFilter } from '../../agent/tools/format-helpers';
import type { ActionContext } from './action-helpers';
import { fail, failToolResult, ok, requireLeadId, requireVisitId, runNamedTool, skip, mergeStateFromToolOutput } from './action-helpers';

export async function resolveVisit(ctx: ActionContext) {
  const visitId = ctx.state.visitId ?? ctx.params.visitId ?? ctx.run.sessionVisitId;
  if (!visitId) {
    if (ctx.run.channel === 'buyer' && ctx.run.sessionVisitId) {
      const visit = await prisma.visit.findFirst({
        where: {
          id: ctx.run.sessionVisitId,
          companyId: ctx.run.toolContext.companyId,
          leadId: ctx.run.sessionLeadId ?? undefined,
        },
        select: { id: true, leadId: true, status: true },
      });
      if (visit) {
        ctx.state.visitId = visit.id;
        if (visit.leadId) ctx.state.leadId = visit.leadId;
        return ok(undefined, { visitId: visit.id, leadId: visit.leadId });
      }
    }
    if (ctx.run.channel === 'buyer') {
      const leadId = requireLeadId(ctx) ?? ctx.run.sessionLeadId;
      if (leadId) {
        const activeVisit = await prisma.visit.findFirst({
          where: {
            companyId: ctx.run.toolContext.companyId,
            leadId,
            status: { in: ['scheduled', 'confirmed'] },
            scheduledAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
          },
          orderBy: { scheduledAt: 'asc' },
          select: { id: true, leadId: true, status: true },
        });
        if (activeVisit) {
          ctx.state.visitId = activeVisit.id;
          ctx.state.leadId = activeVisit.leadId;
          return ok(undefined, { visitId: activeVisit.id, leadId: activeVisit.leadId });
        }
      }
      return fail("I couldn't find an upcoming site visit to update.");
    }
    if (ctx.run.channel === 'staff' && ctx.run.messageText) {
      const { isVisitListQueryMessage } = await import('../../visitIntentFromMessage.service');
      if (isVisitListQueryMessage(ctx.run.messageText)) {
        return fail('Which visit? Share visit ID or describe the booking.');
      }
      const mutation = await applyVisitMutationFromChat({
        companyId: ctx.run.toolContext.companyId,
        message: ctx.run.messageText,
        visitScope: buildVisitScopeFilter(
          ctx.run.toolContext.companyId,
          ctx.run.toolContext.userRole,
          ctx.run.toolContext.userId,
        ),
      });
      if (mutation.handled && mutation.visitId) {
        ctx.state.visitId = mutation.visitId;
        return ok(undefined, { visitId: mutation.visitId });
      }
    }
    return fail('Which visit? Share visit ID or describe the booking.');
  }
  const visit = await prisma.visit.findFirst({
    where: {
      id: visitId,
      ...buildVisitScopeFilter(
        ctx.run.toolContext.companyId,
        ctx.run.toolContext.userRole,
        ctx.run.toolContext.userId,
      ),
    },
    select: { id: true, leadId: true, status: true },
  });
  if (!visit) return fail('Visit not found or access denied.');
  ctx.state.visitId = visit.id;
  if (visit.leadId) ctx.state.leadId = visit.leadId;
  return ok(undefined, { visitId: visit.id, leadId: visit.leadId });
}

function formatBuyerVisitReply(
  title: string,
  scheduledAt: Date,
  propertyName?: string | null,
  agentName?: string | null,
): string {
  const when = scheduledAt.toLocaleString('en-IN', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
  return (
    `*${title}*\n\n` +
    `Property: *${propertyName || 'Property'}*\n` +
    `Date: ${when}\n\n` +
    `Our specialist${agentName ? ` *${agentName}*` : ''} will confirm details before the visit.`
  );
}

async function bookBuyerVisit(ctx: ActionContext, scheduledAtRaw: unknown) {
  const leadId = requireLeadId(ctx) ?? ctx.run.sessionLeadId;
  const scheduledAt = scheduledAtRaw ? new Date(String(scheduledAtRaw)) : null;
  if (!leadId) return fail('Lead is required to book a visit.');
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    return fail('When should the visit be scheduled? Share date and time.');
  }

  const existingVisitId = requireVisitId(ctx);
  if (existingVisitId) {
    const visit = await prisma.visit.findFirst({
      where: {
        id: existingVisitId,
        companyId: ctx.run.toolContext.companyId,
        leadId,
        status: { in: ['scheduled', 'confirmed'] },
      },
      include: {
        property: { select: { name: true } },
        agent: { select: { name: true } },
      },
    });
    if (!visit) return fail("I couldn't find an upcoming site visit to reschedule.");
    const oldTime = visit.scheduledAt;
    const updated = await prisma.visit.update({
      where: { id: existingVisitId },
      data: { scheduledAt, reminderSent: false, status: 'scheduled' },
      include: {
        property: { select: { name: true } },
        agent: { select: { name: true } },
      },
    });
    void import('../../visitNotificationBridge.service').then(({ notifyVisitRescheduledFromTool }) =>
      notifyVisitRescheduledFromTool(existingVisitId, oldTime),
    );
    return ok(
      formatBuyerVisitReply('Visit rescheduled', updated.scheduledAt, updated.property?.name, updated.agent?.name),
      { visitId: updated.id, leadId: updated.leadId, propertyId: updated.propertyId ?? undefined },
    );
  }

  const propertyId = typeof ctx.params.propertyId === 'string' ? ctx.params.propertyId : undefined;
  if (!propertyId) {
    return fail('Which property should I book for your visit?');
  }

  const booking = await scheduleVisit({
    companyId: ctx.run.toolContext.companyId,
    leadId,
    propertyId,
    scheduledAt,
    notes: 'Booked via WhatsApp buyer workflow',
  });

  if (!booking.success || !booking.visit) {
    const reason =
      booking.error === 'agent_conflict'
        ? 'That slot overlaps with another visit. Please share another time.'
        : booking.error === 'past_date'
          ? 'That time is in the past. Please share a future date and time.'
          : booking.error === 'property_not_found'
            ? 'I could not find that property in our active catalog.'
            : 'I could not schedule that visit right now. Please share another time or ask for an agent.';
    return fail(reason);
  }

  const visit = await prisma.visit.findUnique({
    where: { id: booking.visit.id },
    include: {
      property: { select: { name: true } },
      agent: { select: { name: true } },
    },
  });
  return ok(
    formatBuyerVisitReply('Visit scheduled', booking.visit.scheduledAt, visit?.property?.name, visit?.agent?.name),
    { visitId: booking.visit.id, leadId: booking.visit.leadId, propertyId: booking.visit.propertyId ?? undefined },
  );
}

export async function bookVisit(ctx: ActionContext) {
  if (!ctx.state.priorVisitId && ctx.state.visitId) {
    ctx.state.priorVisitId = ctx.state.visitId;
  }
  const visitId = requireVisitId(ctx);
  const scheduledAt = ctx.params.newScheduledAt ?? ctx.params.scheduledAt;
  if (ctx.run.channel === 'buyer') {
    return bookBuyerVisit(ctx, scheduledAt);
  }
  if (visitId && !scheduledAt) {
    return fail('When should the visit be rescheduled? Share date and time.');
  }
  if (visitId && scheduledAt) {
    const rescheduled = await runNamedTool(ctx.run.toolContext, 'rescheduleVisit', {
      visitId,
      newScheduledAt: scheduledAt,
    });
    if (rescheduled.ok === false) return failToolResult(rescheduled);
    const patch = mergeStateFromToolOutput('rescheduleVisit', rescheduled.text, ctx.state);
    Object.assign(ctx.state, patch);
    return ok(rescheduled.text, patch);
  }

  const leadId = requireLeadId(ctx);
  if (!leadId) return fail('Lead is required to book a visit.');
  if (!scheduledAt) return fail('When should the visit be scheduled?');
  const result = await runNamedTool(ctx.run.toolContext, 'scheduleVisit', {
    leadId,
    propertyId: ctx.params.propertyId,
    scheduledAt,
    notes: ctx.params.note,
  });
  if (result.ok === false) return failToolResult(result);
  const patch = mergeStateFromToolOutput('scheduleVisit', result.text, ctx.state);
  Object.assign(ctx.state, patch);
  return ok(result.text, patch);
}

/**
 * Marks the old visit slot as 'rescheduled' so the slot is freed before a
 * new booking is created. Without this, the old visit remains 'scheduled'
 * and appears in visit lists as a duplicate (double-booking).
 */
export async function cancelVisitSlot(ctx: ActionContext) {
  const visitId = requireVisitId(ctx);
  if (!visitId) return skip();
  try {
    await prisma.visit.updateMany({
      where: { id: visitId, status: { in: ['scheduled', 'confirmed'] } },
      // 'rescheduled' is not in the VisitStatus enum; use 'cancelled' to free
      // the old slot so it no longer appears as an active booking.
      data: { status: 'cancelled', updatedAt: new Date() },
    });
    return ok('Old visit slot freed.');
  } catch (err: unknown) {
    logger.warn('cancelVisitSlot failed', { visitId, error: err instanceof Error ? err.message : String(err) });
    return skip();
  }
}

/**
 * Updates the visit status after a reschedule to 'scheduled'.
 * The `bookVisit` action creates a new visit but does not reset
 * the status on the existing visit record.
 */
export async function updateVisitStatus(ctx: ActionContext) {
  const visitId = ctx.state.visitId ?? ctx.params.visitId;
  if (!visitId) return skip();
  const targetStatus = ctx.params.status === 'confirmed' ? 'confirmed' : 'scheduled';
  try {
    await prisma.visit.updateMany({
      where: { id: visitId },
      data: { status: targetStatus, updatedAt: new Date() },
    });
    return ok(`Visit status set to ${targetStatus}.`);
  } catch (err: unknown) {
    logger.warn('updateVisitStatus failed', { visitId, error: err instanceof Error ? err.message : String(err) });
    return skip();
  }
}

export async function sendVisitConfirmation(ctx: ActionContext) {
  if (ctx.run.channel === 'buyer') return skip();
  const visitId = requireVisitId(ctx);
  if (!visitId) return skip();
  const visit = await prisma.visit.findFirst({
    where: { id: visitId },
    include: { lead: { select: { phone: true, customerName: true, companyId: true } } },
  });
  if (!visit?.lead?.phone) return skip();
  try {
    const { whatsappService } = await import('../../whatsapp.service');
    const when = visit.scheduledAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const msg = `Your site visit is confirmed for ${when}. Reply if you need to reschedule.`;
    await whatsappService.sendCompanyTextMessage(visit.lead.phone, msg, visit.lead.companyId);
    return ok('Visit confirmation sent to customer.');
  } catch {
    return skip();
  }
}

/**
 * Schedules real WhatsApp visit reminders via the automation queue.
 * Enqueues two jobs: 24 h before and 1 h before the visit.
 * Jobs are idempotent — re-running for the same visitId is a no-op.
 */
export async function scheduleVisitReminders(ctx: ActionContext) {
  const visitId = requireVisitId(ctx);
  if (!visitId) return skip();

  const visit = await prisma.visit.findUnique({
    where: { id: visitId },
    select: { scheduledAt: true, leadId: true, companyId: true },
  });
  if (!visit) return skip();

  try {
    const { automationQueueService } = await import('../../automationQueue.service');
    const at24h = new Date(visit.scheduledAt.getTime() - 24 * 60 * 60 * 1000);
    const at1h  = new Date(visit.scheduledAt.getTime() -      60 * 60 * 1000);
    const payload = { visitId, leadId: visit.leadId, companyId: visit.companyId };

    if (at24h > new Date()) {
      await automationQueueService.schedule('visit_reminder_24h', visitId, at24h, payload);
    }
    if (at1h > new Date()) {
      await automationQueueService.schedule('visit_reminder_1h', visitId, at1h, payload);
    }
    logger.info('Visit reminders scheduled', { visitId, at24h, at1h });
    return skip();
  } catch (err: unknown) {
    logger.warn('scheduleVisitReminders failed', {
      visitId,
      error: err instanceof Error ? err.message : String(err),
    });
    return skip();
  }
}

/**
 * Reschedules reminders when a visit is moved to a new time.
 * The new visitId key in the automation queue naturally replaces
 * old keys since the visitId is used as uniqueKey with NX semantics.
 * Scheduling fresh reminders for the updated scheduledAt is sufficient.
 */
export async function rescheduleReminders(ctx: ActionContext) {
  return scheduleVisitReminders(ctx);
}

export async function cancelVisit(ctx: ActionContext) {
  const visitId = requireVisitId(ctx);
  if (!visitId) return fail('Which visit should I cancel?');

  const existing = await prisma.visit.findFirst({
    where: { id: visitId, companyId: ctx.run.toolContext.companyId },
    include: { property: { select: { name: true } } },
  });
  if (existing?.status === 'cancelled') {
    return ok('That visit is already cancelled.');
  }
  if (ctx.run.channel === 'buyer') {
    if (!existing || (ctx.state.leadId && existing.leadId !== ctx.state.leadId)) {
      return fail("I couldn't find an upcoming site visit to cancel.");
    }
    await prisma.visit.update({
      where: { id: existing.id },
      data: { status: 'cancelled', notes: 'Cancelled via WhatsApp buyer workflow' },
    });
    return ok(
      `Your site visit for *${existing.property?.name ?? 'Property'}* has been *cancelled*.\n\n` +
      `Reply with a new date and time if you'd like to book again.`,
      { visitId: existing.id, leadId: existing.leadId },
    );
  }

  const result = await runNamedTool(ctx.run.toolContext, 'cancelVisit', {
    visitId,
    reason: ctx.params.note,
  });
  if (result.ok === false) return failToolResult(result);
  return ok(result.text, undefined, result.text.toLowerCase().includes('confirm'));
}

export async function completeVisit(ctx: ActionContext) {
  const visitId = requireVisitId(ctx);
  if (!visitId) return fail('Which visit was completed?');
  const result = await runNamedTool(ctx.run.toolContext, 'completeVisit', {
    visitId,
    notes: ctx.params.note,
  });
  if (result.ok === false) return failToolResult(result);
  return ok(result.text);
}

export async function recordVisitOutcome(ctx: ActionContext) {
  const note = ctx.params.note ?? ctx.params.outcome ?? ctx.params.message;
  if (!note) return fail('What was the visit outcome?');
  ctx.params.note = String(note);
  const { addLeadNote } = await import('./lead-actions');
  return addLeadNote(ctx);
}

export async function logFeedback(ctx: ActionContext) {
  return recordVisitOutcome(ctx);
}

/**
 * Queues a real follow-up task by writing a dated agent action log entry.
 * The cron scheduler picks up 'follow_up_due' actions and sends reminders.
 */
export async function scheduleFollowUp(ctx: ActionContext) {
  const leadId = requireLeadId(ctx);
  if (!leadId) return skip();
  const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // default: 24 hours
  void logAgentAction({
    companyId: ctx.run.toolContext.companyId,
    triggeredBy: 'agent_tool',
    action: 'follow_up_due',
    actorId: ctx.run.toolContext.userId,
    resourceType: 'lead',
    resourceId: leadId,
    inputs: { dueAt: dueAt.toISOString(), note: ctx.params.note },
    // 'pending' is not a valid ActionStatus; 'success' means the follow-up
    // was successfully scheduled (the actual follow-up fires via cron).
    status: 'success',
  });
  logger.info('Follow-up scheduled', { leadId, dueAt, companyId: ctx.run.toolContext.companyId });
  return ok('Follow-up reminder scheduled for tomorrow.');
}

/**
 * Records visit outcome as a note on the visit record itself (not just the lead).
 * The outcome field is stored in visit.notes and also tags the lead for analytics.
 * Previously this was a stub that only wrote to agent_action_log.
 */
export async function touchAnalytics(ctx: ActionContext) {
  const visitId = requireVisitId(ctx);
  const outcome = ctx.params.note ?? ctx.params.outcome ?? ctx.params.message;

  if (visitId && outcome) {
    await prisma.visit.update({
      where: { id: visitId },
      data: {
        notes: String(outcome).slice(0, 1000),
        updatedAt: new Date(),
      },
    }).catch((err: unknown) => {
      logger.warn('touchAnalytics: visit notes update failed', {
        visitId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  void logAgentAction({
    companyId: ctx.run.toolContext.companyId,
    triggeredBy: 'agent_tool',
    action: 'workflow_visit_outcome_analytics',
    resourceType: 'visit',
    resourceId: visitId ?? undefined,
    inputs: { outcome: String(outcome ?? '').slice(0, 200) },
    status: 'success',
  });
  return ok('Outcome recorded.');
}

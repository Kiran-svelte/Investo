import prisma from '../../../config/prisma';
import logger from '../../../config/logger';
import { logAgentAction } from '../../agent-action-log.service';
import { applyVisitMutationFromChat } from '../../visitMutationFromChat.service';
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

export async function bookVisit(ctx: ActionContext) {
  if (!ctx.state.priorVisitId && ctx.state.visitId) {
    ctx.state.priorVisitId = ctx.state.visitId;
  }
  const visitId = requireVisitId(ctx);
  const scheduledAt = ctx.params.newScheduledAt ?? ctx.params.scheduledAt;
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
    return ok('Visit reminders scheduled.');
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
    select: { status: true },
  });
  if (existing?.status === 'cancelled') {
    return ok('That visit is already cancelled.');
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



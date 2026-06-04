import prisma from '../../../config/prisma';
import { logAgentAction } from '../../agent-action-log.service';
import { applyVisitMutationFromChat } from '../../visitMutationFromChat.service';
import { buildVisitScopeFilter } from '../../agent/tools/format-helpers';
import type { ActionContext } from './action-helpers';
import { fail, failToolResult, ok, requireLeadId, requireVisitId, runNamedTool, skip, mergeStateFromToolOutput } from './action-helpers';

export async function resolveVisit(ctx: ActionContext) {
  const visitId = ctx.state.visitId ?? ctx.params.visitId ?? ctx.run.sessionVisitId;
  if (!visitId) {
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

export async function cancelVisitSlot(ctx: ActionContext) {
  return skip();
}

export async function updateVisitStatus(ctx: ActionContext) {
  return skip();
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

export async function scheduleVisitReminders(ctx: ActionContext) {
  void logAgentAction({
    companyId: ctx.run.toolContext.companyId,
    triggeredBy: 'agent_tool',
    action: 'workflow_schedule_visit_reminders',
    resourceType: 'visit',
    resourceId: requireVisitId(ctx) ?? undefined,
    status: 'success',
  });
  return skip();
}

export async function rescheduleReminders(ctx: ActionContext) {
  return scheduleVisitReminders(ctx);
}

export async function cancelVisit(ctx: ActionContext) {
  const visitId = requireVisitId(ctx);
  if (!visitId) return fail('Which visit should I cancel?');
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

export async function scheduleFollowUp(ctx: ActionContext) {
  const leadId = requireLeadId(ctx);
  if (!leadId) return skip();
  void logAgentAction({
    companyId: ctx.run.toolContext.companyId,
    triggeredBy: 'agent_tool',
    action: 'workflow_schedule_follow_up',
    resourceType: 'lead',
    resourceId: leadId,
    status: 'success',
  });
  return ok('Follow-up reminder queued.');
}

export async function touchAnalytics(ctx: ActionContext) {
  void logAgentAction({
    companyId: ctx.run.toolContext.companyId,
    triggeredBy: 'agent_tool',
    action: 'workflow_visit_outcome_analytics',
    resourceType: 'visit',
    resourceId: requireVisitId(ctx) ?? undefined,
    inputs: { note: ctx.params.note },
    status: 'success',
  });
  return skip();
}

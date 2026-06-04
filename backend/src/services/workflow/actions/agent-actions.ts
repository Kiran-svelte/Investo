import type { ActionContext } from './action-helpers';
import { fail, ok, runNamedTool, skip } from './action-helpers';

export async function checkCalendar(ctx: ActionContext) {
  const startDate = ctx.params.startDate;
  const endDate = ctx.params.endDate;
  const result = await runNamedTool(ctx.run.toolContext, 'getCalendarEvents', {
    startDate: startDate ?? new Date().toISOString().slice(0, 10),
    endDate: endDate ?? new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
  });
  if (!result.ok) return skip();
  ctx.state.lastMessage = result.text;
  return ok(result.text);
}

export async function suggestAlternatives(ctx: ActionContext) {
  const slots = await runNamedTool(ctx.run.toolContext, 'getAvailableSlots', {
    date: ctx.params.scheduledAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  });
  if (!slots.ok) {
    const agents = await runNamedTool(ctx.run.toolContext, 'listAgents', {});
    if (agents.ok) return ok(agents.text);
    return skip();
  }
  return ok(slots.text);
}

export async function optionalBookSlot(ctx: ActionContext) {
  if (!ctx.params.scheduledAt || !ctx.state.leadId) return skip();
  const { bookVisit } = await import('./visit-actions');
  return bookVisit(ctx);
}

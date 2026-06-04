import prisma from '../../../config/prisma';
import { notificationEngine } from '../../notification.engine';
import type { ActionContext } from './action-helpers';
import { fail, ok, requireLeadId, runNamedTool, skip } from './action-helpers';

export async function createUrgentAlert(ctx: ActionContext) {
  const leadId = requireLeadId(ctx);
  if (!leadId) return fail('Which lead needs escalation?');
  await notificationEngine.notify({
    companyId: ctx.run.toolContext.companyId,
    userId: null,
    type: 'system_alert',
    title: 'Urgent: human takeover requested',
    message: ctx.params.note ?? ctx.params.message ?? ctx.run.messageText,
    data: { leadId, escalatedBy: ctx.run.toolContext.userId },
  });
  return ok('Urgent alert created.');
}

export async function notifyAllAgents(ctx: ActionContext) {
  const agents = await prisma.user.findMany({
    where: { companyId: ctx.run.toolContext.companyId, status: 'active', role: { in: ['sales_agent', 'company_admin'] } },
    select: { id: true },
  });
  const leadId = requireLeadId(ctx);
  for (const agent of agents) {
    await notificationEngine.notify({
      companyId: ctx.run.toolContext.companyId,
      userId: agent.id,
      type: 'system_alert',
      title: 'Escalation: customer needs human help',
      message: leadId ? `Lead ${leadId} requested human assistance.` : 'Customer requested human assistance.',
      data: { leadId },
    });
  }
  return ok('Agents notified.');
}

export async function escalateTakeover(ctx: ActionContext) {
  if (!ctx.params.conversationId) return skip();
  const result = await runNamedTool(ctx.run.toolContext, 'takeoverConversation', {
    conversationId: ctx.params.conversationId,
  });
  return result.ok ? ok(result.text) : skip();
}

import prisma from '../../../config/prisma';
import logger from '../../../config/logger';
import { notificationEngine } from '../../notification.engine';
import type { ActionContext } from './action-helpers';
import { fail, ok, requireLeadId, runNamedTool, skip } from './action-helpers';

/** Send a WhatsApp alert to a staff member's phone. Fire-and-forget. */
async function pushEscalationToAgent(
  phone: string,
  companyId: string,
  leadId: string | null,
  customerName: string | null,
  requestMessage: string,
): Promise<void> {
  try {
    const { whatsappService } = await import('../../whatsapp.service');
    const text = [
      `🚨 *Customer needs help*`,
      ``,
      customerName ? `Customer: *${customerName}*` : null,
      leadId ? `Lead ID: ${leadId}` : null,
      ``,
      `Message: "${requestMessage.slice(0, 200)}"`,
      ``,
      `Our AI is still helping them on WhatsApp. Please check your Investo dashboard when you can.`,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
    await whatsappService.sendCompanyTextMessage(phone, text, companyId);
  } catch (err: unknown) {
    logger.warn('escalateToHuman: WhatsApp push failed', {
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Creates an urgent system_alert DB notification for the escalation.
 */
export async function createUrgentAlert(ctx: ActionContext) {
  const leadId = requireLeadId(ctx);
  if (!leadId) return fail('Which lead needs escalation?');
  await notificationEngine.notify({
    companyId: ctx.run.toolContext.companyId,
    userId: null,
    type: 'system_alert',
    title: '🚨 Urgent: human takeover requested',
    message: ctx.params.note ?? ctx.params.message ?? ctx.run.messageText,
    data: { leadId, escalatedBy: ctx.run.toolContext.userId },
  });
  return ok('Urgent alert created.');
}

/**
 * Notifies all active agents via DB notification AND WhatsApp.
 * Previously only sent DB notifications — agents wouldn't know until they
 * opened the dashboard. Now sends real WhatsApp to every agent phone.
 */
export async function notifyAllAgents(ctx: ActionContext) {
  const companyId = ctx.run.toolContext.companyId;
  const leadId = requireLeadId(ctx);

  const agents = await prisma.user.findMany({
    where: {
      companyId,
      status: 'active',
      role: { in: ['sales_agent', 'company_admin'] },
    },
    select: { id: true, phone: true },
  });

  // Fetch lead name for better alert message
  const lead = leadId
    ? await prisma.lead.findUnique({
        where: { id: leadId },
        select: { customerName: true },
      })
    : null;

  const requestMessage = ctx.params.note ?? ctx.params.message ?? ctx.run.messageText ?? '';

  for (const agent of agents) {
    await notificationEngine.notify({
      companyId,
      userId: agent.id,
      type: 'system_alert',
      title: '🚨 Escalation: customer needs human help',
      message: leadId
        ? `Lead ${lead?.customerName ?? leadId} requested human assistance.`
        : 'Customer requested human assistance.',
      data: { leadId },
    });

    // WhatsApp push — the key fix. Previously missing.
    if (agent.phone) {
      void pushEscalationToAgent(
        agent.phone,
        companyId,
        leadId,
        lead?.customerName ?? null,
        requestMessage,
      );
    }
  }

  return ok(`🚨 All ${agents.length} agents notified via WhatsApp and app.`);
}

/**
 * Takes over the conversation so the AI stops responding and a human can reply.
 * Auto-resolves conversationId from the lead's most recent open conversation
 * if not explicitly provided in the workflow parameters.
 */
export async function escalateTakeover(ctx: ActionContext) {
  let conversationId = ctx.params.conversationId;

  if (!conversationId) {
    const leadId = ctx.state.leadId ?? ctx.params.leadId;
    if (leadId) {
      const conv = await prisma.conversation.findFirst({
        where: { leadId, status: { not: 'closed' } },
        select: { id: true },
        orderBy: { updatedAt: 'desc' },
      });
      conversationId = conv?.id;
    }
  }

  if (!conversationId) return skip();

  const result = await runNamedTool(ctx.run.toolContext, 'takeoverConversation', { conversationId });
  return result.ok ? ok(result.text) : skip();
}

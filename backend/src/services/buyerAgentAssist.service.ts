import prisma from '../config/prisma';
import logger from '../config/logger';
import { notificationEngine } from './notification.engine';
import { logAgentAction } from './agent-action-log.service';

export type BuyerAssistReason =
  | 'escalation_request'
  | 'price_negotiation'
  | 'authority_limit'
  | 'workflow_failure'
  | 'visit_booking_failure'
  | 'call_booking_failure'
  | 'calendar_update_failure'
  | 'lead_status_failure'
  | 'reschedule_failure'
  | 'cancel_failure'
  | 'ai_action_blocked'
  | 'unknown';

export interface NotifyBuyerAgentAssistInput {
  companyId: string;
  leadId: string;
  conversationId?: string | null;
  reason: BuyerAssistReason;
  summary: string;
  detail?: string | null;
  customerMessage?: string | null;
  workflowId?: string | null;
  failedStep?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
}

const REASON_LABELS: Record<BuyerAssistReason, string> = {
  escalation_request: 'Customer requested human help',
  price_negotiation: 'Price negotiation / discount request',
  authority_limit: 'Booking or final-price authority limit',
  workflow_failure: 'Buyer workflow could not complete',
  visit_booking_failure: 'Site visit booking could not complete',
  call_booking_failure: 'Callback booking could not complete',
  calendar_update_failure: 'Calendar update failed',
  lead_status_failure: 'Lead status update failed',
  reschedule_failure: 'Visit reschedule could not complete',
  cancel_failure: 'Visit cancel could not complete',
  ai_action_blocked: 'AI action blocked — needs agent',
  unknown: 'AI needs agent assistance',
};

function buildWhatsAppAlert(input: NotifyBuyerAgentAssistInput, label: string): string {
  const lines = [
    `🔔 *AI needs your help*`,
    ``,
    `Reason: *${label}*`,
    input.customerName ? `Customer: *${input.customerName}*` : null,
    input.customerPhone ? `Phone: ${input.customerPhone}` : null,
    input.leadId ? `Lead: ${input.leadId}` : null,
    input.workflowId ? `Workflow: ${input.workflowId}` : null,
    input.failedStep ? `Failed step: ${input.failedStep}` : null,
    ``,
    `Summary: ${input.summary}`,
  ];

  if (input.detail?.trim()) {
    lines.push(``, `Details: ${input.detail.trim().slice(0, 400)}`);
  }
  if (input.customerMessage?.trim()) {
    lines.push(``, `Customer said: "${input.customerMessage.trim().slice(0, 250)}"`);
  }

  lines.push(
    ``,
    `The AI is still helping the customer on WhatsApp. Reply in your Investo dashboard when you can.`,
  );

  return lines.filter((line): line is string => line !== null).join('\n');
}

/**
 * Notifies assigned agent (or all active sales agents/admins) when the buyer AI
 * cannot complete an action. Does NOT change conversation status — AI stays active.
 */
export async function notifyBuyerAgentAssistNeeded(input: NotifyBuyerAgentAssistInput): Promise<void> {
  const label = REASON_LABELS[input.reason] ?? REASON_LABELS.unknown;
  const inAppTitle = `AI assist: ${label}`;
  const inAppMessage = input.summary.slice(0, 500);
  const whatsAppBody = buildWhatsAppAlert(input, label);

  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: {
      id: true,
      customerName: true,
      phone: true,
      assignedAgentId: true,
      companyId: true,
    },
  });

  if (!lead || lead.companyId !== input.companyId) {
    logger.warn('notifyBuyerAgentAssistNeeded: lead not found or company mismatch', {
      leadId: input.leadId,
      companyId: input.companyId,
    });
    return;
  }

  const customerName = input.customerName ?? lead.customerName;
  const customerPhone = input.customerPhone ?? lead.phone;
  const notifyPayload = {
    ...input,
    customerName,
    customerPhone,
  };

  const data = {
    leadId: input.leadId,
    conversationId: input.conversationId ?? null,
    reason: input.reason,
    summary: input.summary,
    detail: input.detail ?? null,
    workflowId: input.workflowId ?? null,
    failedStep: input.failedStep ?? null,
    customerMessage: input.customerMessage?.slice(0, 500) ?? null,
  };

  const recipients: Array<{ id: string; phone: string | null }> = [];

  if (lead.assignedAgentId) {
    const agent = await prisma.user.findUnique({
      where: { id: lead.assignedAgentId },
      select: { id: true, phone: true, status: true },
    });
    if (agent?.status === 'active') {
      recipients.push({ id: agent.id, phone: agent.phone });
    }
  }

  if (recipients.length === 0) {
    const agents = await prisma.user.findMany({
      where: {
        companyId: input.companyId,
        status: 'active',
        role: { in: ['sales_agent', 'company_admin'] },
      },
      select: { id: true, phone: true },
    });
    recipients.push(...agents);
  }

  await Promise.all(
    recipients.map(async (agent) => {
      await notificationEngine.notify({
        companyId: input.companyId,
        userId: agent.id,
        type: 'system_alert',
        title: inAppTitle,
        message: inAppMessage,
        data,
      });
      if (agent.phone) {
        await notificationEngine.notifyAgentByWhatsApp({
          agentPhone: agent.phone,
          companyId: input.companyId,
          message: buildWhatsAppAlert(notifyPayload, label),
        });
      }
    }),
  );

  await logAgentAction({
    companyId: input.companyId,
    triggeredBy: 'inbound_message',
    action: 'buyer_ai_agent_assist',
    resourceType: 'lead',
    resourceId: input.leadId,
    status: 'success',
    inputs: data,
    result: inAppMessage.slice(0, 500),
  });

  logger.info('Buyer AI agent assist notification sent', {
    leadId: input.leadId,
    reason: input.reason,
    recipientCount: recipients.length,
  });
}

export type NotifyBuyerAiFailureInput = {
  companyId: string;
  leadId: string;
  conversationId?: string | null;
  customerMessage?: string | null;
  detail?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
};

/**
 * Notifies staff when the buyer AI could not respond or complete an action.
 * Fire-and-forget — does not change conversation status.
 */
export function notifyBuyerAiFailure(input: NotifyBuyerAiFailureInput): void {
  void notifyBuyerAgentAssistNeeded({
    companyId: input.companyId,
    leadId: input.leadId,
    conversationId: input.conversationId,
    reason: 'ai_action_blocked',
    summary: 'Buyer AI could not respond — customer needs agent follow-up',
    detail: input.detail ?? null,
    customerMessage: input.customerMessage,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
  }).catch((err: unknown) => {
    logger.warn('notifyBuyerAiFailure failed', {
      leadId: input.leadId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * Clears auto-escalation state on a buyer conversation so AI resumes immediately.
 * Manual dashboard takeover (recent agent reply) is preserved by the caller.
 */
export async function clearBuyerAutoEscalation(conversationId: string): Promise<void> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, status: true, stage: true, aiEnabled: true },
  });
  if (!conversation) return;

  const needsClear =
    conversation.status === 'agent_active'
    || !conversation.aiEnabled
    || conversation.stage === 'human_escalated';

  if (!needsClear) return;

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: 'ai_active',
      aiEnabled: true,
      ...(conversation.stage === 'human_escalated' && {
        stage: 'rapport',
        stageEnteredAt: new Date(),
        stageMessageCount: 0,
        escalationReason: null,
      }),
    },
  });

  logger.info('Cleared buyer auto-escalation state', {
    conversationId,
    previousStatus: conversation.status,
    previousStage: conversation.stage,
  });
}

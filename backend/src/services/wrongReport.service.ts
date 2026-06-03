import prisma from '../config/prisma';
import logger from '../config/logger';
import { socketService, SOCKET_EVENTS } from './socket.service';

const WRONG_PATTERNS = [
  /^wrong$/i,
  /^incorrect$/i,
  /^not correct$/i,
  /^galat$/i,
  /^गलत$/,
  /^report\s*error$/i,
];

export function isWrongReportMessage(text: string): boolean {
  const trimmed = text.trim();
  if (WRONG_PATTERNS.some((p) => p.test(trimmed))) return true;
  return trimmed.toUpperCase() === 'WRONG';
}

export async function handleWrongReport(params: {
  companyId: string;
  leadId: string;
  conversationId: string;
  customerPhone: string;
  messageText: string;
}): Promise<{ acknowledged: boolean }> {
  const { companyId, leadId, conversationId, customerPhone, messageText } = params;

  await prisma.auditLog.create({
    data: {
      companyId,
      action: 'customer_wrong_report',
      resourceType: 'conversation',
      resourceId: conversationId,
      details: {
        leadId,
        customerPhone,
        message: messageText.slice(0, 500),
        reportedAt: new Date().toISOString(),
        resolved: false,
      },
    },
  });

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { assignedAgentId: true, customerName: true, phone: true },
  });

  await prisma.notification.create({
    data: {
      companyId,
      userId: lead?.assignedAgentId ?? undefined,
      type: 'system_alert',
      title: 'Customer reported incorrect info',
      message: `${lead?.customerName || customerPhone} replied WRONG — please review the conversation.`,
      data: { leadId, conversationId, kind: 'wrong_report' },
    },
  });

  const admins = await prisma.user.findMany({
    where: { companyId, role: 'company_admin', status: 'active' },
    select: { id: true },
  });
  for (const admin of admins) {
    if (admin.id === lead?.assignedAgentId) continue;
    await prisma.notification.create({
      data: {
        companyId,
        userId: admin.id,
        type: 'system_alert',
        title: 'Data accuracy report (WRONG)',
        message: `Lead ${lead?.customerName || customerPhone} flagged AI response as incorrect.`,
        data: { leadId, conversationId },
      },
    });
  }

  socketService.emitToCompany(companyId, SOCKET_EVENTS.NOTIFICATION_NEW, {
    type: 'wrong_report',
    leadId,
    conversationId,
  });

  logger.info('WRONG report recorded', { companyId, leadId, conversationId });

  return { acknowledged: true };
}

export const WRONG_ACK_MESSAGE =
  'Thank you for letting us know. We have logged this and a team member will review the details shortly.';

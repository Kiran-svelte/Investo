import { UserRole } from '@prisma/client';
import config from '../../config';
import logger from '../../config/logger';
import { maskPhoneNumberForLogs } from '../../utils/maskPhoneNumberForLogs';
import { ToolContext } from './agent-state';

const ELIGIBLE_ROLES: ReadonlySet<UserRole> = new Set(['super_admin', 'company_admin', 'sales_agent', 'operations']);

interface InternalUserMatch {
  userId: string;
  companyId: string;
  companyName: string;
  userRole: UserRole;
  userName: string;
  phone: string;
}

async function getPrisma() {
  const module = await import('../../config/prisma');
  return module.default;
}

function digits(phone: string): string {
  return phone.replace(/\D/g, '');
}

async function findInternalUserByPhone(senderPhone: string): Promise<InternalUserMatch | null> {
  const prisma = await getPrisma();
  const rawDigits = digits(senderPhone);
  const last10 = rawDigits.length >= 10 ? rawDigits.slice(-10) : rawDigits;
  const candidates = Array.from(new Set([senderPhone, rawDigits, `+${rawDigits}`, last10, `+91${last10}`, `91${last10}`].filter(Boolean)));

  const user = await prisma.user.findFirst({
    where: {
      status: 'active',
      role: { in: Array.from(ELIGIBLE_ROLES) },
      OR: candidates.map((candidate) => ({ phone: { contains: candidate } })),
    },
    select: {
      id: true,
      companyId: true,
      role: true,
      name: true,
      phone: true,
      company: { select: { name: true, status: true } },
    },
  });

  if (!user || user.company.status !== 'active') return null;
  return {
    userId: user.id,
    companyId: user.companyId,
    companyName: user.company.name,
    userRole: user.role,
    userName: user.name,
    phone: user.phone ?? senderPhone,
  };
}

async function sendWhatsAppResponse(phone: string, companyId: string, message: string): Promise<void> {
  const prisma = await getPrisma();
  const { whatsappService } = await import('../whatsapp.service');
  const dynamicSender = (whatsappService as any).sendCompanyTextMessage;
  if (typeof dynamicSender === 'function') {
    await dynamicSender.call(whatsappService, phone, message, companyId);
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { settings: true },
  });
  const settings = (company?.settings as any) || {};
  const whatsapp = settings?.whatsapp || {};
  const outboundConfig = {
    phoneNumberId: String(whatsapp.phoneNumberId || config.whatsapp.phoneNumberId || ''),
    accessToken: String(whatsapp.accessToken || config.whatsapp.accessToken || ''),
    verifyToken: String(whatsapp.verifyToken || config.whatsapp.verifyToken || ''),
  };
  await (whatsappService as any).sendMessage(phone, message, outboundConfig);
}

async function handleAgentMessage(user: InternalUserMatch, messageText: string): Promise<string> {
  const prisma = await getPrisma();
  const { getOrCreateThreadId } = await import('./agent-memory.service');
  const { checkAndResolvePendingConfirmation, executePendingAction } = await import('./confirmation.service');
  const { invokeAgent } = await import('./agent-graph.service');
  const threadId = await getOrCreateThreadId(user.userId, user.phone, user.companyId);
  const session = await prisma.agentSession.findUnique({ where: { threadId } });

  if (session) {
    const confirmation = await checkAndResolvePendingConfirmation(session.id, messageText);
    if (confirmation.hasPending && confirmation.isConfirmed) {
      return executePendingAction(confirmation.pendingActionId!);
    }
    if (confirmation.hasPending && confirmation.isRejected) {
      return 'Action cancelled.';
    }
    if (confirmation.hasPending) {
      return `${confirmation.displayMessage}\n\nReply "yes" to confirm or "no" to cancel.`;
    }
  }

  const toolContext: ToolContext = {
    userId: user.userId,
    companyId: user.companyId,
    userRole: user.userRole,
    userName: user.userName,
    sessionId: session?.id,
  };

  return invokeAgent({
    messageText,
    threadId,
    toolContext,
    companyName: user.companyName,
  });
}

export async function routeIfInternalUser(senderPhone: string, messageText: string, _webhookCompanyId?: string): Promise<boolean> {
  if (!config.agentAi?.enabled || !messageText.trim()) return false;

  const user = await findInternalUserByPhone(senderPhone);
  if (!user) return false;

  try {
    const response = await handleAgentMessage(user, messageText);
    await sendWhatsAppResponse(senderPhone, user.companyId, response);
    return true;
  } catch (error: any) {
    logger.error('Agent AI routing failed', {
      phone: maskPhoneNumberForLogs(senderPhone),
      userId: user.userId,
      error: error?.message,
    });
    await sendWhatsAppResponse(senderPhone, user.companyId, 'I hit an issue processing that request. Please try again.');
    return true;
  }
}

export const agentRouterService = { routeIfInternalUser };

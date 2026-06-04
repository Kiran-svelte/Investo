import config from '../../config';
import logger from '../../config/logger';
import { maskPhoneNumberForLogs } from '../../utils/maskPhoneNumberForLogs';
import { normalizeInboundWhatsAppPhone } from '../../utils/phoneMatch';
import type { CompanyUserMatch } from '../inboundWhatsAppRouting.service';
import { ToolContext } from './agent-state';

async function getPrisma() {
  const module = await import('../../config/prisma');
  return module.default;
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

async function handleAgentMessage(user: CompanyUserMatch, messageText: string): Promise<string> {
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

  const { tryDeterministicAgentCrmReply } = await import('./agent-crm-query.service');
  const deterministic = await tryDeterministicAgentCrmReply(toolContext, messageText);
  // visit cancel/reschedule handled inside tryDeterministicAgentCrmReply (mutation path first)
  // #region agent log
  fetch('http://127.0.0.1:7737/ingest/e570e274-2b9f-4460-95d9-ffd83c68631e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a72821'},body:JSON.stringify({sessionId:'a72821',location:'agent-router.service.ts',message:'agent route branch',data:{userId:user.userId,role:user.userRole,usedDeterministic:Boolean(deterministic),preview:messageText.slice(0,80)},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
  // #endregion
  if (deterministic) {
    return deterministic;
  }

  return invokeAgent({
    messageText,
    threadId,
    toolContext,
    companyName: user.companyName,
  });
}

/**
 * Agent copilot for a known company user (caller must verify company membership).
 */
export async function routeIfInternalUserForCompany(
  senderPhone: string,
  messageText: string,
  user: CompanyUserMatch,
): Promise<boolean> {
  if (!config.agentAi?.enabled || !messageText.trim()) return false;

  try {
    const normalizedPhone = normalizeInboundWhatsAppPhone(senderPhone);
    const response = await handleAgentMessage(user, messageText);
    await sendWhatsAppResponse(normalizedPhone, user.companyId, response);
    return true;
  } catch (error: any) {
    logger.error('Agent AI routing failed', {
      phone: maskPhoneNumberForLogs(senderPhone),
      userId: user.userId,
      error: error?.message,
    });
    await sendWhatsAppResponse(
      normalizeInboundWhatsAppPhone(senderPhone),
      user.companyId,
      'I hit an issue processing that request. Please try again.',
    );
    return true;
  }
}

/**
 * @deprecated Use inboundWhatsAppRouting.routeCompanyScopedInbound with companyId.
 * Kept for backward compatibility in tests; requires companyId when possible.
 */
export async function routeIfInternalUser(
  senderPhone: string,
  messageText: string,
  companyId?: string,
): Promise<boolean> {
  if (!companyId) {
    logger.warn('routeIfInternalUser called without companyId; skipping global agent match');
    return false;
  }

  const { findCompanyUserByPhone, routeCompanyScopedInbound } = await import(
    '../inboundWhatsAppRouting.service'
  );
  const user = await findCompanyUserByPhone(senderPhone, companyId);
  if (!user) return false;

  const result = await routeCompanyScopedInbound({
    senderPhone,
    messageText,
    companyId,
  });
  return result.handled;
}

export const agentRouterService = { routeIfInternalUser, routeIfInternalUserForCompany };

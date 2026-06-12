import { UserRole } from '@prisma/client';
import config from '../config';
import logger from '../config/logger';
import { maskPhoneNumberForLogs } from '../utils/maskPhoneNumberForLogs';
import { normalizeInboundWhatsAppPhone, phoneLast10 } from '../utils/phoneMatch';

/**
 * Roles that are routed to the agent copilot pipeline.
 * Includes `viewer` — the copilot pipeline itself enforces read-only mode
 * for viewer (no mutations, no memory writes; only CRM queries and greetings).
 */
const AGENT_COPILOT_ROLES: ReadonlySet<UserRole> = new Set([
  'super_admin',
  'company_admin',
  'sales_agent',
  'operations',
  'viewer',
]);

export type InboundWhatsAppRoute =
  | { kind: 'customer' }
  | { kind: 'agent_copilot'; userId: string; companyId: string }
  | { kind: 'staff_non_copilot'; userId: string; role: UserRole };

export interface CompanyUserMatch {
  userId: string;
  companyId: string;
  companyName: string;
  userRole: UserRole;
  userName: string;
  phone: string;
}

async function getPrisma() {
  const module = await import('../config/prisma');
  return module.default;
}

/**
 * Match sender to an active user in the given company (last-10 digit match).
 * Avoids global `contains` lookups that could mis-route strangers.
 */
export async function findCompanyUserByPhone(
  senderPhone: string,
  companyId: string,
): Promise<CompanyUserMatch | null> {
  const senderLast10 = phoneLast10(normalizeInboundWhatsAppPhone(senderPhone));
  if (!senderLast10) return null;

  const prisma = await getPrisma();
  const users = await prisma.user.findMany({
    where: { companyId, status: 'active' },
    select: {
      id: true,
      companyId: true,
      role: true,
      name: true,
      phone: true,
      company: { select: { name: true, status: true } },
    },
  });

  for (const user of users) {
    if (!user.phone) continue;
    const userLast10 = phoneLast10(user.phone);
    if (userLast10 && userLast10 === senderLast10 && user.company.status === 'active') {
      return {
        userId: user.id,
        companyId: user.companyId,
        companyName: user.company.name,
        userRole: user.role,
        userName: user.name,
        phone: user.phone,
      };
    }
  }

  return null;
}

function staffNonCopilotMessage(companyName: string): string {
  return (
    `Hi! This WhatsApp line is for *property buyers* contacting *${companyName}*.\n\n` +
    `Your number is registered as a *staff account*. Please use the Investo dashboard for your work — not this customer assistant.\n\n` +
    `To test the buyer experience, message from a phone number that is *not* on any user profile.`
  );
}

async function sendWhatsAppResponse(phone: string, companyId: string, message: string): Promise<void> {
  const { whatsappService } = await import('./whatsapp.service');
  const dynamicSender = (whatsappService as any).sendCompanyTextMessage;
  if (typeof dynamicSender === 'function') {
    await dynamicSender.call(whatsappService, phone, message, companyId);
    return;
  }

  const prisma = await getPrisma();
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { settings: true },
  });
  const outboundConfig = await whatsappService.resolveCompanyWhatsAppConfig(companyId);
  if (!outboundConfig) {
    logger.warn('Staff inbound reply skipped: company WhatsApp not configured', { companyId });
    return;
  }
  await whatsappService.sendMessage(phone, message, outboundConfig);
}

/**
 * Route inbound WhatsApp for a resolved company.
 * - Strangers → customer AI (caller runs handleIncomingMessage)
 * - Staff (agent roles) → Agent AI copilot
 * - Staff (viewer) → read-only copilot (queries only, no writes)
 * - Other staff roles without copilot access → short staff notice
 */
export async function routeCompanyScopedInbound(params: {
  senderPhone: string;
  messageText: string;
  companyId: string;
  interactiveId?: string;
  inboundMessageId?: string;
}): Promise<{ handled: boolean; route: InboundWhatsAppRoute }> {
  const normalizedPhone = normalizeInboundWhatsAppPhone(params.senderPhone);
  const companyUser = await findCompanyUserByPhone(normalizedPhone, params.companyId);

  if (!companyUser) {
    return { handled: false, route: { kind: 'customer' } };
  }

  const senderLast10 = phoneLast10(normalizedPhone);
  if (senderLast10) {
    const prisma = await getPrisma();
    const buyerLeads = await prisma.lead.findMany({
      where: { companyId: params.companyId },
      select: { id: true, customerName: true, status: true, phone: true },
      take: 500,
    });
    const matchingBuyerLead = buyerLeads.find((lead) => {
      if (!lead.phone) return false;
      return phoneLast10(lead.phone) === senderLast10;
    });
    if (matchingBuyerLead) {
      logger.warn('Staff phone match supersedes potential buyer lead — customer AI suppressed', {
        companyId: params.companyId,
        userId: companyUser.userId,
        userRole: companyUser.userRole,
        staffPhone: maskPhoneNumberForLogs(normalizedPhone),
        buyerLeadId: matchingBuyerLead.id,
        buyerLeadName: matchingBuyerLead.customerName,
        buyerLeadStatus: matchingBuyerLead.status,
        messagePreview: params.messageText.slice(0, 80),
      });
    }
  }

  if (AGENT_COPILOT_ROLES.has(companyUser.userRole)) {
    const { tryHandleAgentVisitApprovalReply } = await import('./visitPendingApproval.service');
    const visitApprovalHandled = await tryHandleAgentVisitApprovalReply(companyUser, params.messageText);
    if (visitApprovalHandled) {
      return {
        handled: true,
        route: { kind: 'agent_copilot', userId: companyUser.userId, companyId: companyUser.companyId },
      };
    }

    const { tryHandleAgentCallApprovalReply } = await import('./callRequest.service');
    const callApprovalHandled = await tryHandleAgentCallApprovalReply(companyUser, params.messageText);
    if (callApprovalHandled) {
      return {
        handled: true,
        route: { kind: 'agent_copilot', userId: companyUser.userId, companyId: companyUser.companyId },
      };
    }

    const copilotActive =
      config.agentAi?.enabled !== false && config.agentAi?.copilotEnabled !== false;

    if (!copilotActive || !params.messageText.trim()) {
      if (!copilotActive) {
        await sendWhatsAppResponse(
          normalizedPhone,
          companyUser.companyId,
          'Agent copilot is temporarily unavailable. Please use the Investo dashboard.',
        );
      }
      return { handled: true, route: { kind: 'agent_copilot', userId: companyUser.userId, companyId: companyUser.companyId } };
    }

    try {
      const { routeIfInternalUserForCompany } = await import('./agent/agent-router.service');
      const handled = await routeIfInternalUserForCompany(
        normalizedPhone,
        params.messageText,
        companyUser,
        params.interactiveId,
        params.inboundMessageId,
      );
      return {
        handled,
        route: { kind: 'agent_copilot', userId: companyUser.userId, companyId: companyUser.companyId },
      };
    } catch (error: any) {
      logger.error('Agent copilot routing failed', {
        phone: maskPhoneNumberForLogs(normalizedPhone),
        error: error?.message,
      });
      await sendWhatsAppResponse(
        normalizedPhone,
        companyUser.companyId,
        'I hit an issue processing that request. Please try again or use the dashboard.',
      );
      return { handled: true, route: { kind: 'agent_copilot', userId: companyUser.userId, companyId: companyUser.companyId } };
    }
  }

  await sendWhatsAppResponse(
    normalizedPhone,
    companyUser.companyId,
    staffNonCopilotMessage(companyUser.companyName),
  );
  logger.info('Staff non-copilot WhatsApp message; customer AI skipped', {
    phone: maskPhoneNumberForLogs(normalizedPhone),
    userId: companyUser.userId,
    role: companyUser.userRole,
  });
  return {
    handled: true,
    route: { kind: 'staff_non_copilot', userId: companyUser.userId, role: companyUser.userRole },
  };
}

export const inboundWhatsAppRoutingService = {
  findCompanyUserByPhone,
  routeCompanyScopedInbound,
};

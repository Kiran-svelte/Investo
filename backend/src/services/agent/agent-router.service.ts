import config from '../../config';
import logger from '../../config/logger';
import { maskPhoneNumberForLogs } from '../../utils/maskPhoneNumberForLogs';
import { normalizeInboundWhatsAppPhone } from '../../utils/phoneMatch';
import type { CompanyUserMatch } from '../inboundWhatsAppRouting.service';
import { ToolContext } from './agent-state';

/**
 * Pattern matching simple greetings from staff on WhatsApp copilot.
 * Used to bypass the LLM graph entirely and return an instant welcome.
 */
const COPILOT_GREETING_PATTERN =
  /^(hi|hello|hey|hii|hola|namaste|good\s*(morning|afternoon|evening)|start|help|what\s+can\s+you\s+do|commands?)[!.,?\s]*$/i;

/**
 * Returns true when the staff message is a simple copilot greeting or help request.
 * These messages should never be sent to the LLM graph — they are handled deterministically.
 *
 * @param message - Trimmed message text from the staff user.
 * @returns True when message is a greeting or help request.
 */
function normalizeCopilotInboundText(message: string): string {
  return message.replace(/\u200b/g, '').trim();
}

function isCopilotGreeting(message: string): boolean {
  const trimmed = normalizeCopilotInboundText(message);
  if (!trimmed || trimmed.length > 50) return false;
  return COPILOT_GREETING_PATTERN.test(trimmed);
}

/**
 * Builds a deterministic welcome/help message for the agent copilot.
 * Shown whenever a staff user sends a greeting or "help" command.
 *
 * @param userName - Display name of the staff user.
 * @param companyName - Name of the company.
 * @returns Formatted WhatsApp-ready welcome string.
 */
function buildCopilotWelcomeMessage(userName: string, companyName: string): string {
  const name = userName.trim() || 'there';
  return (
    `👋 *Hi ${name}!* Welcome to *Investo Copilot* for *${companyName}*.\n\n` +
    `I can help you with:\n` +
    `• 📅 *Visits* — "visits today", "visits tomorrow", "visits on 6th June"\n` +
    `• 👥 *Leads* — "new leads today", "get lead Rahul", "update lead status"\n` +
    `• 🏠 *Properties* — "list properties", "property details"\n` +
    `• 📊 *Analytics* — "dashboard stats", "my performance"\n` +
    `• ✅ *Actions* — "confirm visit", "mark lead visited", "send brochure"\n\n` +
    `Just type your command or tap a shortcut below.`
  );
}

async function getPrisma() {
  const module = await import('../../config/prisma');
  return module.default;
}

async function sendStaffCopilotQuickActions(phone: string, companyId: string): Promise<void> {
  try {
    const { whatsappService } = await import('../whatsapp.service');
    await whatsappService.sendCompanyInteractiveButtons(
      phone,
      companyId,
      'Tap a shortcut (or type your own command):',
      [
        { id: 'copilot-visits-today', title: 'Visits today' },
        { id: 'copilot-new-leads', title: 'New leads today' },
        { id: 'copilot-visits-tomorrow', title: 'Visits tomorrow' },
      ],
      'Investo Copilot',
      'CRM shortcuts',
    );
  } catch (err: unknown) {
    logger.debug('Staff copilot quick actions skipped', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
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
  const normalizedText = normalizeCopilotInboundText(messageText);

  // FAST PATH: Greetings and help commands — deterministic, never hits LLM.
  if (isCopilotGreeting(normalizedText)) {
    return buildCopilotWelcomeMessage(user.userName, user.companyName);
  }

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

  const { getAgentSessionContext } = await import('../clientMemory.service');
  const sessionCtx = await getAgentSessionContext(session?.id);
  const { getRecentAgentSessionMessages } = await import('./agent-session-messages.service');
  const { classifyAndRunWorkflow } = await import('../workflow/workflow-engine.service');
  const { classifyAndExecuteAgentIntent, recordAgentCopilotExchange } =
    await import('./agent-intent-orchestrator.service');
  const recentMessages = await getRecentAgentSessionMessages(session?.id, 5);

  // Deterministic CRM before workflow LLM (avoids misclassifying "update status … today" as list leads)
  const { tryDeterministicAgentCrmReply } = await import('./agent-crm-query.service');
  const crmReply = await tryDeterministicAgentCrmReply(toolContext, normalizedText, {
    sessionLeadId: sessionCtx.lastLeadId,
  });
  if (crmReply) {
    if (session?.id) {
      await recordAgentCopilotExchange({
        sessionId: session.id,
        inboundText: messageText,
        outboundText: crmReply,
      });
    }
    return crmReply;
  }

  const workflowReply = await classifyAndRunWorkflow({
    toolContext,
    messageText: normalizedText,
    recentMessages,
    companyName: user.companyName,
    sessionLeadId: sessionCtx.lastLeadId,
    sessionVisitId: sessionCtx.lastVisitId,
    staffPhone: user.phone,
  });
  if (workflowReply) {
    if (session?.id) {
      await recordAgentCopilotExchange({
        sessionId: session.id,
        inboundText: messageText,
        outboundText: workflowReply,
      });
    }
    return workflowReply;
  }

  const intentReply = await classifyAndExecuteAgentIntent({
    toolContext,
    messageText: normalizedText,
    recentMessages,
    companyName: user.companyName,
    sessionLeadId: sessionCtx.lastLeadId,
    sessionVisitId: sessionCtx.lastVisitId,
    staffPhone: user.phone,
  });
  if (intentReply) {
    if (session?.id) {
      await recordAgentCopilotExchange({
        sessionId: session.id,
        inboundText: messageText,
        outboundText: intentReply,
      });
    }
    return intentReply;
  }

  const { buildClientMemoryContextForAgent, setAgentSessionClientContext } =
    await import('../clientMemory.service');
  const memory = await buildClientMemoryContextForAgent({
    companyId: user.companyId,
    userId: user.userId,
    userRole: user.userRole,
    messageText,
    sessionLeadId: sessionCtx.lastLeadId,
    sessionVisitId: sessionCtx.lastVisitId,
  });
  if (session?.id && (memory.leadId || memory.visitId)) {
    await setAgentSessionClientContext({
      userId: user.userId,
      phone: user.phone,
      leadId: memory.leadId,
      visitId: memory.visitId,
    });
  }

  let agentReply: string;
  try {
    agentReply = await invokeAgent({
      messageText: normalizedText,
      threadId,
      toolContext,
      companyName: user.companyName,
      clientMemoryBlock: memory.block,
    });
  } catch (agentErr: unknown) {
    logger.error('invokeAgent failed', {
      userId: user.userId,
      error: agentErr instanceof Error ? agentErr.message : String(agentErr),
    });
    const fallback = await tryDeterministicAgentCrmReply(toolContext, normalizedText, {
      sessionLeadId: sessionCtx.lastLeadId,
    });
    if (fallback) {
      agentReply = fallback;
    } else if (isCopilotGreeting(normalizedText)) {
      agentReply = buildCopilotWelcomeMessage(user.userName, user.companyName);
    } else {
      agentReply =
        `⚠️ I had trouble processing that request. Here are commands that always work:\n\n` +
        `📅 *Visit queries*\n` +
        `• "visits today" • "visits tomorrow" • "visits on 6th June"\n\n` +
        `👥 *Lead queries*\n` +
        `• "new leads today" • "get lead [name]"\n\n` +
        `✅ *Quick actions*\n` +
        `• "confirm visit" • "mark lead [name] visited"\n\n` +
        `Or use the *Investo dashboard* for advanced operations.`;
    }
  }
  if (session?.id) {
    await recordAgentCopilotExchange({
      sessionId: session.id,
      inboundText: messageText,
      outboundText: agentReply,
    });
  }
  return agentReply;
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
    await sendStaffCopilotQuickActions(normalizedPhone, user.companyId);
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

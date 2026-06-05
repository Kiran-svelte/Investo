import config from '../../config';
import logger from '../../config/logger';
import { maskPhoneNumberForLogs } from '../../utils/maskPhoneNumberForLogs';
import { normalizeInboundWhatsAppPhone } from '../../utils/phoneMatch';
import type { CompanyUserMatch } from '../inboundWhatsAppRouting.service';
import { ToolContext } from './agent-state';

import { isCopilotGreeting, normalizeCopilotInboundText } from '../../utils/copilotGreeting.util';
import {
  COPILOT_SHORTCUT_BUTTONS,
  resolveCopilotInboundCommand,
  shouldSendCopilotShortcutMenu,
  type CopilotReplyKind,
} from '../../utils/copilotShortcut.util';
import {
  claimStaffCopilotTurn,
  releaseStaffCopilotTurn,
} from '../inboundMessageGuard.service';

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
      COPILOT_SHORTCUT_BUTTONS.map(({ id, title }) => ({ id, title })),
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

type AgentMessageResult = {
  text: string;
  replyKind: CopilotReplyKind;
};

async function handleAgentMessage(
  user: CompanyUserMatch,
  messageText: string,
  interactiveId?: string,
): Promise<AgentMessageResult> {
  const resolvedCommand = resolveCopilotInboundCommand({ interactiveId, messageText });
  const normalizedText = normalizeCopilotInboundText(resolvedCommand);

  // FAST PATH: Greetings and help commands — deterministic, never hits LLM.
  if (isCopilotGreeting(normalizedText)) {
    return {
      text: buildCopilotWelcomeMessage(user.userName, user.companyName),
      replyKind: 'welcome',
    };
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
      return {
        text: await executePendingAction(confirmation.pendingActionId!),
        replyKind: 'confirmation',
      };
    }
    if (confirmation.hasPending && confirmation.isRejected) {
      return { text: 'Action cancelled.', replyKind: 'confirmation' };
    }
    if (confirmation.hasPending) {
      return {
        text: `${confirmation.displayMessage}\n\nReply "yes" to confirm or "no" to cancel.`,
        replyKind: 'confirmation',
      };
    }
  }

  const { getAgentSessionContext } = await import('../clientMemory.service');
  const sessionCtx = await getAgentSessionContext(session?.id);

  const toolContext: ToolContext = {
    userId: user.userId,
    companyId: user.companyId,
    userRole: user.userRole,
    userName: user.userName,
    sessionId: session?.id,
    staffPhone: user.phone,
    companyName: user.companyName,
    sessionLeadId: sessionCtx.lastLeadId,
    sessionVisitId: sessionCtx.lastVisitId,
  };
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
        inboundText: resolvedCommand || messageText,
        outboundText: crmReply,
      });
    }
    return { text: crmReply, replyKind: 'crm' };
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
        inboundText: resolvedCommand || messageText,
        outboundText: workflowReply,
      });
    }
    return { text: workflowReply, replyKind: 'workflow' };
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
        inboundText: resolvedCommand || messageText,
        outboundText: intentReply,
      });
    }
    return { text: intentReply, replyKind: 'intent' };
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

  // Pre-LLM guard: if the message is still a greeting after all deterministic checks,
  // never invoke the LLM. Some WhatsApp clients embed invisible Unicode characters
  // that bypass normalizeCopilotInboundText — so we re-check here with aggressive
  // stripping before spending an LLM call.
  const aggressivelyNormalized = normalizedText
    .replace(/[\u200b-\u200f\u2028\u2029\ufeff]/g, '') // strip invisible Unicode
    .replace(/[\r\n]+/g, ' ')                           // collapse newlines
    .trim();
  if (isCopilotGreeting(aggressivelyNormalized) || aggressivelyNormalized.length === 0) {
    return {
      text: buildCopilotWelcomeMessage(user.userName, user.companyName),
      replyKind: 'welcome',
    };
  }

  let agentReply: string;
  let replyKind: CopilotReplyKind = 'agent';
  try {
    agentReply = await invokeAgent({
      messageText: normalizedText,
      threadId,
      toolContext,
      companyName: user.companyName,
      clientMemoryBlock: memory.block,
      sessionLeadId: sessionCtx.lastLeadId,
      sessionVisitId: sessionCtx.lastVisitId,
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
      replyKind = 'crm';
    } else if (isCopilotGreeting(normalizedText)) {
      agentReply = buildCopilotWelcomeMessage(user.userName, user.companyName);
      replyKind = 'welcome';
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
      replyKind = 'help_fallback';
    }
  }

  // Post-LLM safety filter: if the LLM generated a vague refusal or "I couldn't
  // complete" style message for a short generic input, replace with the deterministic
  // help menu so the user always gets a useful response.
  const isLlmRefusal = /could\s+not\s+complete|unable\s+to\s+(retrieve|process)|try\s+a\s+shorter/i.test(agentReply);
  if (isLlmRefusal && aggressivelyNormalized.length < 30) {
    agentReply = buildCopilotWelcomeMessage(user.userName, user.companyName);
    replyKind = 'welcome';
  }

  if (session?.id) {
    await recordAgentCopilotExchange({
      sessionId: session.id,
      inboundText: resolvedCommand || messageText,
      outboundText: agentReply,
    });
  }
  return { text: agentReply, replyKind };
}

/**
 * Agent copilot for a known company user (caller must verify company membership).
 */
export async function routeIfInternalUserForCompany(
  senderPhone: string,
  messageText: string,
  user: CompanyUserMatch,
  interactiveId?: string,
): Promise<boolean> {
  const resolvedText = resolveCopilotInboundCommand({ interactiveId, messageText });
  if (!config.agentAi?.enabled || !resolvedText.trim()) return false;

  const turnClaimed = await claimStaffCopilotTurn(user.companyId, user.userId);
  if (!turnClaimed) {
    return true;
  }

  const normalizedPhone = normalizeInboundWhatsAppPhone(senderPhone);

  try {
    const { text: response, replyKind } = await handleAgentMessage(user, messageText, interactiveId);
    await sendWhatsAppResponse(normalizedPhone, user.companyId, response);
    if (shouldSendCopilotShortcutMenu(replyKind)) {
      await sendStaffCopilotQuickActions(normalizedPhone, user.companyId);
    }
    return true;
  } catch (error: any) {
    logger.error('Agent AI routing failed', {
      phone: maskPhoneNumberForLogs(senderPhone),
      userId: user.userId,
      error: error?.message,
    });
    await sendWhatsAppResponse(
      normalizedPhone,
      user.companyId,
      'That request did not go through. Try a shorter command like "visits today" or "new leads today", or use the Investo dashboard.',
    );
    return true;
  } finally {
    await releaseStaffCopilotTurn(user.companyId, user.userId);
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

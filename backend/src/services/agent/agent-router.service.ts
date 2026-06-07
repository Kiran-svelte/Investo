import config from '../../config';
import logger from '../../config/logger';
import { maskPhoneNumberForLogs } from '../../utils/maskPhoneNumberForLogs';
import { normalizeInboundWhatsAppPhone } from '../../utils/phoneMatch';
import type { CompanyUserMatch } from '../inboundWhatsAppRouting.service';
import { ToolContext } from './agent-state';

import { isCopilotGreeting, normalizeCopilotInboundText } from '../../utils/copilotGreeting.util';
import { resolveCopilotInboundCommand, type CopilotReplyKind } from '../../utils/copilotShortcut.util';
import { resolveCopilotComponents } from '../copilot/copilotButtonPolicy.service';
import { resolveAttendanceButtonCommand } from '../attendanceWorkflow.service';
import {
  claimStaffCopilotTurn,
  releaseStaffCopilotTurn,
  claimStaffCopilotOutboundReply,
} from '../inboundMessageGuard.service';
import {
  beginOutboundTurn,
  endOutboundTurn,
  logOutboundBranch,
  logOutboundSend,
} from '../outboundTurnDebug.service';

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
    `*Hi ${name}!* Welcome to *Investo Copilot* for *${companyName}*.\n\n` +
    `I can help you with:\n` +
    `- *Visits* - "visits today", "visits tomorrow", "visits on 6th June"\n` +
    `- *Leads* - "new leads today", "get lead Rahul", "update lead status"\n` +
    `- *Properties* - "list properties", "property details"\n` +
    `- *Analytics* - "dashboard stats", "my performance"\n` +
    `- *Actions* - "confirm visit", "mark lead visited", "send brochure"\n\n` +
    `Just type your command or tap a shortcut below.`
  );
}

async function getPrisma() {
  const module = await import('../../config/prisma');
  return module.default;
}

async function sendStaffCopilotQuickActions(
  phone: string,
  companyId: string,
  buttons: Array<{ id: string; title: string }>,
): Promise<void> {
  try {
    const { whatsappService } = await import('../whatsapp.service');
    await whatsappService.sendCompanyInteractiveButtons(
      phone,
      companyId,
      'Tap a shortcut (or type your own command):',
      buttons,
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

/** Fire-and-forget lead_memory patch + RAG sync after staff copilot exchanges. */
async function patchStaffCopilotLeadMemory(
  leadId: string | null | undefined,
  lastIntent: string,
  inboundText: string,
  outboundText: string,
): Promise<void> {
  if (!leadId) return;
  const { patchLeadMemory } = await import('../lead-memory.service');
  const { syncLeadClientMemory } = await import('../clientMemory.service');
  void patchLeadMemory(leadId, {
    lastIntent,
    conversationSummary: `${inboundText.slice(0, 80)} → ${outboundText.slice(0, 120)}`,
  }).catch(() => undefined);
  syncLeadClientMemory(leadId).catch(() => undefined);
}

/**
 * Core staff copilot handler. Routes a normalized staff WhatsApp message through the
 * full AI pipeline: greeting fast-path → pending confirmations → deterministic CRM →
 * workflow LLM → intent orchestrator → LangGraph → deterministic fallback.
 *
 * G2 (staff): After every patchLeadMemory call, syncLeadClientMemory is called
 * fire-and-forget so the RAG vector index stays within one cycle of lead_memory.
 *
 * @param user - Authenticated staff user from company membership lookup.
 * @param messageText - Raw inbound WhatsApp text.
 * @param interactiveId - Optional interactive button/list ID from the WhatsApp payload.
 * @param inboundMessageId - Optional WhatsApp message ID used for deduplication.
 * @returns The reply text and its classification kind.
 */
async function handleAgentMessage(
  user: CompanyUserMatch,
  messageText: string,
  interactiveId?: string,
  inboundMessageId?: string,
): Promise<AgentMessageResult> {
  const attendanceCommand = resolveAttendanceButtonCommand(interactiveId);
  const resolvedCommand = attendanceCommand
    ?? resolveCopilotInboundCommand({ interactiveId, messageText });
  const normalizedText = normalizeCopilotInboundText(resolvedCommand);
  const isViewer = user.userRole === 'viewer';

  // FAST PATH: Greetings and help commands — deterministic, never hits LLM.
  if (isCopilotGreeting(normalizedText)) {
    const text = buildCopilotWelcomeMessage(user.userName, user.companyName);
    const { getOrCreateAgentSession } = await import('./agent-memory.service');
    const { recordAgentCopilotExchange } = await import('./agent-intent-orchestrator.service');
    const agentSession = await getOrCreateAgentSession(user.userId, user.phone, user.companyId);
    await recordAgentCopilotExchange({
      sessionId: agentSession.id,
      inboundText: resolvedCommand || messageText,
      outboundText: text,
    });
    return { text, replyKind: 'welcome' };
  }

  const prisma = await getPrisma();
  const { getOrCreateAgentSession } = await import('./agent-memory.service');
  const { checkAndResolvePendingConfirmation, executePendingAction } = await import('./confirmation.service');
  const { invokeAgent } = await import('./agent-graph.service');
  const agentSession = await getOrCreateAgentSession(user.userId, user.phone, user.companyId);
  const threadId = agentSession.threadId;
  const session = { id: agentSession.id };

  if (!isViewer) {
    const { tryStaffMessageForward } = await import('../staffMessageForward.service');
    const forwarded = await tryStaffMessageForward({
      user,
      messageText: resolvedCommand || messageText,
    });
    if (forwarded.handled) {
      const { recordAgentCopilotExchange } = await import('./agent-intent-orchestrator.service');
      await recordAgentCopilotExchange({
        sessionId: agentSession.id,
        inboundText: resolvedCommand || messageText,
        outboundText: forwarded.text,
      });
      return { text: forwarded.text, replyKind: 'workflow' };
    }
  }

  if (session && attendanceCommand === 'reschedule') {
    const pendingAttendance = await prisma.pendingAction.findFirst({
      where: {
        sessionId: session.id,
        actionType: 'attendance_check',
        status: 'awaiting',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (pendingAttendance) {
      const params = (pendingAttendance.actionParams ?? {}) as Record<string, unknown>;
      const customerName =
        typeof params.customerName === 'string' ? params.customerName : 'the customer';
      await prisma.pendingAction.update({
        where: { id: pendingAttendance.id },
        data: { status: 'expired', resolvedAt: new Date() },
      });
      return {
        text: `To reschedule ${customerName}'s visit, type "reschedule visit ${customerName}".`,
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

  // Deterministic CRM before pending confirmations — stale attendance checks must not block "visits today".
  const { tryDeterministicAgentCrmReply } = await import('./agent-crm-query.service');
  const crmReply = await tryDeterministicAgentCrmReply(toolContext, normalizedText, {
    sessionLeadId: sessionCtx.lastLeadId,
  });
  if (crmReply) {
    await recordAgentCopilotExchange({
      sessionId: session.id,
      inboundText: resolvedCommand || messageText,
      outboundText: crmReply,
    });
    if (!isViewer) {
      await patchStaffCopilotLeadMemory(
        sessionCtx.lastLeadId,
        'staff_copilot_crm',
        normalizedText,
        crmReply,
      );
    }
    return { text: crmReply, replyKind: 'crm' };
  }

  if (session) {
    const confirmation = await checkAndResolvePendingConfirmation(session.id, resolvedCommand);
    if (confirmation.hasPending && confirmation.isConfirmed) {
      return {
        text: await executePendingAction(confirmation.pendingActionId!),
        replyKind: 'confirmation',
      };
    }
    if (confirmation.hasPending && confirmation.isRejected) {
      if (confirmation.actionType === 'attendance_check') {
        const { handleAttendanceCheckRejected } = await import('./confirmation.service');
        const text = await handleAttendanceCheckRejected(
          user.companyId,
          confirmation.actionParams ?? {},
        );
        return { text, replyKind: 'confirmation' };
      }
      return { text: 'Action cancelled.', replyKind: 'confirmation' };
    }
    if (confirmation.hasPending) {
      return {
        text: `${confirmation.displayMessage}\n\nReply "yes" to confirm or "no" to cancel.`,
        replyKind: 'confirmation',
      };
    }
  }

  if (!isViewer) {
    const workflowReply = await classifyAndRunWorkflow({
      toolContext,
      messageText: normalizedText,
      recentMessages,
      companyName: user.companyName,
      sessionLeadId: sessionCtx.lastLeadId,
      sessionVisitId: sessionCtx.lastVisitId,
      staffPhone: user.phone,
    });
    if (workflowReply !== null && workflowReply !== undefined) {
      if (session?.id) {
        await recordAgentCopilotExchange({
          sessionId: session.id,
          inboundText: resolvedCommand || messageText,
          outboundText: workflowReply,
        });
        await patchStaffCopilotLeadMemory(
          sessionCtx.lastLeadId,
          'staff_copilot_workflow',
          normalizedText,
          workflowReply,
        );
      }
      return { text: workflowReply, replyKind: 'workflow' };
    }
  }

  const llmActive = config.agentAi?.enabled !== false && config.agentAi?.llmEnabled !== false;

  const intentReply = !isViewer && llmActive
    ? await classifyAndExecuteAgentIntent({
        toolContext,
        messageText: normalizedText,
        recentMessages,
        companyName: user.companyName,
        sessionLeadId: sessionCtx.lastLeadId,
        sessionVisitId: sessionCtx.lastVisitId,
        staffPhone: user.phone,
        inboundMessageId,
      })
    : null;
  if (intentReply !== null && intentReply !== undefined) {
    if (session?.id) {
      await recordAgentCopilotExchange({
        sessionId: session.id,
        inboundText: resolvedCommand || messageText,
        outboundText: intentReply,
      });
      await patchStaffCopilotLeadMemory(
        sessionCtx.lastLeadId,
        'staff_copilot_intent',
        normalizedText,
        intentReply,
      );
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

  if (!llmActive) {
    const deterministicFallback = await tryDeterministicAgentCrmReply(toolContext, normalizedText, {
      sessionLeadId: sessionCtx.lastLeadId,
    });
    const helpText =
      deterministicFallback
      || (isViewer
        ? `*Investo Copilot* (read-only)\n\n` +
          `You can ask:\n` +
          `- "visits today"\n- "new leads today"\n` +
          `- "get lead [name]"\n\n` +
          `Write actions require a sales or admin role.`
        : `*Investo Copilot* (deterministic mode)\n\n` +
          `LLM is off. These commands still work:\n` +
          `- "visits today"\n- "new leads today"\n` +
          `- "get lead [name]"\n- "confirm visit"\n\n` +
          `Or use the *Investo dashboard* for advanced operations.`);
    if (session?.id) {
      await recordAgentCopilotExchange({
        sessionId: session.id,
        inboundText: resolvedCommand || messageText,
        outboundText: helpText,
      });
      if (!isViewer && sessionCtx.lastLeadId) {
        await patchStaffCopilotLeadMemory(
          sessionCtx.lastLeadId,
          'staff_copilot_deterministic',
          normalizedText,
          helpText,
        );
      }
    }
    return { text: helpText, replyKind: deterministicFallback ? 'crm' : 'help_fallback' };
  }

  let agentReply: string;
  let replyKind: CopilotReplyKind = 'agent';
  logOutboundBranch('H3', 'agent-router.service.ts:invokeAgent', 'staff_invoke_agent', {
    textLen: normalizedText.length,
  });
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
        `I had trouble processing that request. These commands always work:\n\n` +
        `*Visit queries*\n` +
        `- "visits today"\n- "visits tomorrow"\n- "visits on 6th June"\n\n` +
        `*Lead queries*\n` +
        `- "new leads today"\n- "get lead [name]"\n\n` +
        `*Quick actions*\n` +
        `- "confirm visit"\n- "mark lead [name] visited"\n\n` +
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
    if (!isViewer && sessionCtx.lastLeadId) {
      await patchStaffCopilotLeadMemory(sessionCtx.lastLeadId, replyKind, normalizedText, agentReply);
    }
  }
  return { text: agentReply, replyKind };
}

/**
 * Agent copilot for a known company user (caller must verify company membership).
 *
 * @param senderPhone - Raw inbound WhatsApp phone number.
 * @param messageText - Raw inbound message text.
 * @param user - Authenticated company user record.
 * @param interactiveId - Optional interactive button/list ID.
 * @param inboundMessageId - Optional message ID for deduplication.
 * @returns true if the message was handled by the copilot, false to fall through.
 */
export async function routeIfInternalUserForCompany(
  senderPhone: string,
  messageText: string,
  user: CompanyUserMatch,
  interactiveId?: string,
  inboundMessageId?: string,
): Promise<boolean> {
  const resolvedText = resolveCopilotInboundCommand({ interactiveId, messageText });
  const copilotActive =
    config.agentAi?.enabled !== false && config.agentAi?.copilotEnabled !== false;
  if (!copilotActive || !resolvedText.trim()) return false;

  // Inbound messageId dedup (claimInboundMessageFull) already prevents Meta retries.
  // Do not fingerprint by text — staff legitimately repeat "visits today" etc.

  const turnClaimed = await claimStaffCopilotTurn(user.companyId, user.userId);
  if (!turnClaimed) {
    const normalizedPhone = normalizeInboundWhatsAppPhone(senderPhone);
    if (await claimStaffCopilotOutboundReply(user.companyId, inboundMessageId)) {
      await sendWhatsAppResponse(
        normalizedPhone,
        user.companyId,
        'Still working on your last message — please wait a moment, then try again.',
      );
    }
    return true;
  }

  const normalizedPhone = normalizeInboundWhatsAppPhone(senderPhone);

  beginOutboundTurn({
    channel: 'staff',
    inboundMessageId,
    companyId: user.companyId,
    route: 'staff_copilot',
  });

  try {
    const { text: response, replyKind } = await handleAgentMessage(
      user,
      messageText,
      interactiveId,
      inboundMessageId,
    );
    const outboundClaimed = await claimStaffCopilotOutboundReply(user.companyId, inboundMessageId);
    logOutboundBranch('H4', 'agent-router.service.ts:outbound', 'staff_primary_reply', {
      replyKind,
      outboundClaimed,
      preview: response.slice(0, 80),
    });
    if (outboundClaimed) {
      logOutboundSend('H4', 'agent-router.service.ts:send', 'staff_primary_text', response);
      await sendWhatsAppResponse(normalizedPhone, user.companyId, response);
    }
    const components = resolveCopilotComponents({ replyKind, outboundText: response });
    const quickActions = components[0]?.kind === 'buttons' ? components[0].buttons : null;
    if (quickActions?.length) {
      logOutboundBranch('H4', 'agent-router.service.ts:quickActions', 'staff_quick_actions', {
        count: quickActions.length,
      });
      await sendStaffCopilotQuickActions(normalizedPhone, user.companyId, quickActions);
    }
    endOutboundTurn('staff_ok');
    return true;
  } catch (error: any) {
    logger.error('Agent AI routing failed', {
      phone: maskPhoneNumberForLogs(senderPhone),
      userId: user.userId,
      error: error?.message,
    });
    if (await claimStaffCopilotOutboundReply(user.companyId, inboundMessageId)) {
      await sendWhatsAppResponse(
        normalizedPhone,
        user.companyId,
        'That request did not go through. Try a shorter command like "visits today" or "new leads today", or use the Investo dashboard.',
      );
    }
    endOutboundTurn('staff_error');
    return true;
  } finally {
    await releaseStaffCopilotTurn(user.companyId, user.userId);
  }
}

/**
 * @deprecated Use inboundWhatsAppRouting.routeCompanyScopedInbound with companyId.
 * Kept for backward compatibility in tests; requires companyId when possible.
 *
 * @param senderPhone - Raw inbound WhatsApp phone number.
 * @param messageText - Raw inbound message text.
 * @param companyId - Company scope for routing lookup.
 * @returns true if the message was handled, false otherwise.
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

/**
 * Exposed for use by the dashboard copilot REST endpoint (POST /api/copilot/chat).
 * Re-uses the full staff WhatsApp copilot pipeline without sending a WhatsApp reply.
 *
 * @param user - Authenticated staff user.
 * @param messageText - Message from the dashboard chat UI.
 * @returns The reply text and its classification kind.
 */
export { handleAgentMessage };

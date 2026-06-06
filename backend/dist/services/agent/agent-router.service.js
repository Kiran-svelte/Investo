"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentRouterService = void 0;
exports.routeIfInternalUserForCompany = routeIfInternalUserForCompany;
exports.routeIfInternalUser = routeIfInternalUser;
const config_1 = __importDefault(require("../../config"));
const logger_1 = __importDefault(require("../../config/logger"));
const maskPhoneNumberForLogs_1 = require("../../utils/maskPhoneNumberForLogs");
const phoneMatch_1 = require("../../utils/phoneMatch");
const copilotGreeting_util_1 = require("../../utils/copilotGreeting.util");
const copilotShortcut_util_1 = require("../../utils/copilotShortcut.util");
const inboundMessageGuard_service_1 = require("../inboundMessageGuard.service");
/**
 * Builds a deterministic welcome/help message for the agent copilot.
 * Shown whenever a staff user sends a greeting or "help" command.
 *
 * @param userName - Display name of the staff user.
 * @param companyName - Name of the company.
 * @returns Formatted WhatsApp-ready welcome string.
 */
function buildCopilotWelcomeMessage(userName, companyName) {
    const name = userName.trim() || 'there';
    return (`👋 *Hi ${name}!* Welcome to *Investo Copilot* for *${companyName}*.\n\n` +
        `I can help you with:\n` +
        `• 📅 *Visits* — "visits today", "visits tomorrow", "visits on 6th June"\n` +
        `• 👥 *Leads* — "new leads today", "get lead Rahul", "update lead status"\n` +
        `• 🏠 *Properties* — "list properties", "property details"\n` +
        `• 📊 *Analytics* — "dashboard stats", "my performance"\n` +
        `• ✅ *Actions* — "confirm visit", "mark lead visited", "send brochure"\n\n` +
        `Just type your command or tap a shortcut below.`);
}
async function getPrisma() {
    const module = await Promise.resolve().then(() => __importStar(require('../../config/prisma')));
    return module.default;
}
async function sendStaffCopilotQuickActions(phone, companyId, buttons) {
    try {
        const { whatsappService } = await Promise.resolve().then(() => __importStar(require('../whatsapp.service')));
        await whatsappService.sendCompanyInteractiveButtons(phone, companyId, 'Tap a shortcut (or type your own command):', buttons, 'Investo Copilot', 'CRM shortcuts');
    }
    catch (err) {
        logger_1.default.debug('Staff copilot quick actions skipped', {
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
async function sendWhatsAppResponse(phone, companyId, message) {
    const prisma = await getPrisma();
    const { whatsappService } = await Promise.resolve().then(() => __importStar(require('../whatsapp.service')));
    const dynamicSender = whatsappService.sendCompanyTextMessage;
    if (typeof dynamicSender === 'function') {
        await dynamicSender.call(whatsappService, phone, message, companyId);
        return;
    }
    const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { settings: true },
    });
    const settings = company?.settings || {};
    const whatsapp = settings?.whatsapp || {};
    const outboundConfig = {
        phoneNumberId: String(whatsapp.phoneNumberId || config_1.default.whatsapp.phoneNumberId || ''),
        accessToken: String(whatsapp.accessToken || config_1.default.whatsapp.accessToken || ''),
        verifyToken: String(whatsapp.verifyToken || config_1.default.whatsapp.verifyToken || ''),
    };
    await whatsappService.sendMessage(phone, message, outboundConfig);
}
async function handleAgentMessage(user, messageText, interactiveId, inboundMessageId) {
    const resolvedCommand = (0, copilotShortcut_util_1.resolveCopilotInboundCommand)({ interactiveId, messageText });
    const normalizedText = (0, copilotGreeting_util_1.normalizeCopilotInboundText)(resolvedCommand);
    // FAST PATH: Greetings and help commands — deterministic, never hits LLM.
    if ((0, copilotGreeting_util_1.isCopilotGreeting)(normalizedText)) {
        return {
            text: buildCopilotWelcomeMessage(user.userName, user.companyName),
            replyKind: 'welcome',
        };
    }
    const prisma = await getPrisma();
    const { getOrCreateThreadId } = await Promise.resolve().then(() => __importStar(require('./agent-memory.service')));
    const { checkAndResolvePendingConfirmation, executePendingAction } = await Promise.resolve().then(() => __importStar(require('./confirmation.service')));
    const { invokeAgent } = await Promise.resolve().then(() => __importStar(require('./agent-graph.service')));
    const threadId = await getOrCreateThreadId(user.userId, user.phone, user.companyId);
    const session = await prisma.agentSession.findUnique({ where: { threadId } });
    if (session) {
        const confirmation = await checkAndResolvePendingConfirmation(session.id, messageText);
        if (confirmation.hasPending && confirmation.isConfirmed) {
            return {
                text: await executePendingAction(confirmation.pendingActionId),
                replyKind: 'confirmation',
            };
        }
        if (confirmation.hasPending && confirmation.isRejected) {
            if (confirmation.actionType === 'attendance_check') {
                const { handleAttendanceCheckRejected } = await Promise.resolve().then(() => __importStar(require('./confirmation.service')));
                const text = await handleAttendanceCheckRejected(user.companyId, confirmation.actionParams ?? {});
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
    const { getAgentSessionContext } = await Promise.resolve().then(() => __importStar(require('../clientMemory.service')));
    const sessionCtx = await getAgentSessionContext(session?.id);
    const toolContext = {
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
    const { getRecentAgentSessionMessages } = await Promise.resolve().then(() => __importStar(require('./agent-session-messages.service')));
    const { classifyAndRunWorkflow } = await Promise.resolve().then(() => __importStar(require('../workflow/workflow-engine.service')));
    const { classifyAndExecuteAgentIntent, recordAgentCopilotExchange } = await Promise.resolve().then(() => __importStar(require('./agent-intent-orchestrator.service')));
    const recentMessages = await getRecentAgentSessionMessages(session?.id, 5);
    // Deterministic CRM before workflow LLM (avoids misclassifying "update status … today" as list leads)
    const { tryDeterministicAgentCrmReply } = await Promise.resolve().then(() => __importStar(require('./agent-crm-query.service')));
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
    if (workflowReply !== null && workflowReply !== undefined) {
        if (session?.id) {
            await recordAgentCopilotExchange({
                sessionId: session.id,
                inboundText: resolvedCommand || messageText,
                outboundText: workflowReply,
            });
        }
        return { text: workflowReply, replyKind: 'workflow' };
    }
    const llmActive = config_1.default.agentAi?.enabled !== false && config_1.default.agentAi?.llmEnabled !== false;
    const intentReply = llmActive
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
        }
        return { text: intentReply, replyKind: 'intent' };
    }
    const { buildClientMemoryContextForAgent, setAgentSessionClientContext } = await Promise.resolve().then(() => __importStar(require('../clientMemory.service')));
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
        .replace(/[\r\n]+/g, ' ') // collapse newlines
        .trim();
    if ((0, copilotGreeting_util_1.isCopilotGreeting)(aggressivelyNormalized) || aggressivelyNormalized.length === 0) {
        return {
            text: buildCopilotWelcomeMessage(user.userName, user.companyName),
            replyKind: 'welcome',
        };
    }
    if (!llmActive) {
        const deterministicFallback = await tryDeterministicAgentCrmReply(toolContext, normalizedText, {
            sessionLeadId: sessionCtx.lastLeadId,
        });
        const helpText = deterministicFallback
            || `📋 *Investo Copilot* (deterministic mode)\n\n` +
                `LLM is off — these commands still work:\n` +
                `• "visits today" • "new leads today"\n` +
                `• "get lead [name]" • "confirm visit"\n\n` +
                `Or use the *Investo dashboard* for advanced operations.`;
        if (session?.id) {
            await recordAgentCopilotExchange({
                sessionId: session.id,
                inboundText: resolvedCommand || messageText,
                outboundText: helpText,
            });
            if (sessionCtx.lastLeadId) {
                const { patchLeadMemory } = await Promise.resolve().then(() => __importStar(require('../lead-memory.service')));
                void patchLeadMemory(sessionCtx.lastLeadId, {
                    lastIntent: 'staff_copilot_deterministic',
                    conversationSummary: `${normalizedText.slice(0, 80)} → deterministic reply`,
                }).catch(() => undefined);
            }
        }
        return { text: helpText, replyKind: deterministicFallback ? 'crm' : 'help_fallback' };
    }
    let agentReply;
    let replyKind = 'agent';
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
    }
    catch (agentErr) {
        logger_1.default.error('invokeAgent failed', {
            userId: user.userId,
            error: agentErr instanceof Error ? agentErr.message : String(agentErr),
        });
        const fallback = await tryDeterministicAgentCrmReply(toolContext, normalizedText, {
            sessionLeadId: sessionCtx.lastLeadId,
        });
        if (fallback) {
            agentReply = fallback;
            replyKind = 'crm';
        }
        else if ((0, copilotGreeting_util_1.isCopilotGreeting)(normalizedText)) {
            agentReply = buildCopilotWelcomeMessage(user.userName, user.companyName);
            replyKind = 'welcome';
        }
        else {
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
        if (sessionCtx.lastLeadId) {
            const { patchLeadMemory } = await Promise.resolve().then(() => __importStar(require('../lead-memory.service')));
            void patchLeadMemory(sessionCtx.lastLeadId, {
                lastIntent: replyKind,
                conversationSummary: `${normalizedText.slice(0, 80)} → ${agentReply.slice(0, 120)}`,
            }).catch(() => undefined);
        }
    }
    return { text: agentReply, replyKind };
}
/**
 * Agent copilot for a known company user (caller must verify company membership).
 */
async function routeIfInternalUserForCompany(senderPhone, messageText, user, interactiveId, inboundMessageId) {
    const resolvedText = (0, copilotShortcut_util_1.resolveCopilotInboundCommand)({ interactiveId, messageText });
    const copilotActive = config_1.default.agentAi?.enabled !== false && config_1.default.agentAi?.copilotEnabled !== false;
    if (!copilotActive || !resolvedText.trim())
        return false;
    const fingerprintClaimed = await (0, inboundMessageGuard_service_1.claimStaffInboundFingerprint)(user.companyId, user.userId, resolvedText);
    if (!fingerprintClaimed) {
        return true;
    }
    const turnClaimed = await (0, inboundMessageGuard_service_1.claimStaffCopilotTurn)(user.companyId, user.userId);
    if (!turnClaimed) {
        return true;
    }
    const normalizedPhone = (0, phoneMatch_1.normalizeInboundWhatsAppPhone)(senderPhone);
    try {
        const { text: response, replyKind } = await handleAgentMessage(user, messageText, interactiveId, inboundMessageId);
        if (await (0, inboundMessageGuard_service_1.claimStaffCopilotOutboundReply)(user.companyId, inboundMessageId)) {
            await sendWhatsAppResponse(normalizedPhone, user.companyId, response);
        }
        const quickActions = (0, copilotShortcut_util_1.resolveStaffCopilotQuickActions)({ replyKind, outboundText: response });
        if (quickActions?.length) {
            await sendStaffCopilotQuickActions(normalizedPhone, user.companyId, quickActions);
        }
        return true;
    }
    catch (error) {
        logger_1.default.error('Agent AI routing failed', {
            phone: (0, maskPhoneNumberForLogs_1.maskPhoneNumberForLogs)(senderPhone),
            userId: user.userId,
            error: error?.message,
        });
        if (await (0, inboundMessageGuard_service_1.claimStaffCopilotOutboundReply)(user.companyId, inboundMessageId)) {
            await sendWhatsAppResponse(normalizedPhone, user.companyId, 'That request did not go through. Try a shorter command like "visits today" or "new leads today", or use the Investo dashboard.');
        }
        return true;
    }
    finally {
        await (0, inboundMessageGuard_service_1.releaseStaffCopilotTurn)(user.companyId, user.userId);
    }
}
/**
 * @deprecated Use inboundWhatsAppRouting.routeCompanyScopedInbound with companyId.
 * Kept for backward compatibility in tests; requires companyId when possible.
 */
async function routeIfInternalUser(senderPhone, messageText, companyId) {
    if (!companyId) {
        logger_1.default.warn('routeIfInternalUser called without companyId; skipping global agent match');
        return false;
    }
    const { findCompanyUserByPhone, routeCompanyScopedInbound } = await Promise.resolve().then(() => __importStar(require('../inboundWhatsAppRouting.service')));
    const user = await findCompanyUserByPhone(senderPhone, companyId);
    if (!user)
        return false;
    const result = await routeCompanyScopedInbound({
        senderPhone,
        messageText,
        companyId,
    });
    return result.handled;
}
exports.agentRouterService = { routeIfInternalUser, routeIfInternalUserForCompany };

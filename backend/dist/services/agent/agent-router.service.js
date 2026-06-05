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
async function sendStaffCopilotQuickActions(phone, companyId) {
    try {
        const { whatsappService } = await Promise.resolve().then(() => __importStar(require('../whatsapp.service')));
        await whatsappService.sendCompanyInteractiveButtons(phone, companyId, 'Tap a shortcut (or type your own command):', [
            { id: 'copilot-visits-today', title: 'Visits today' },
            { id: 'copilot-new-leads', title: 'New leads today' },
            { id: 'copilot-visits-tomorrow', title: 'Visits tomorrow' },
        ], 'Investo Copilot', 'CRM shortcuts');
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
async function handleAgentMessage(user, messageText) {
    const normalizedText = (0, copilotGreeting_util_1.normalizeCopilotInboundText)(messageText);
    // FAST PATH: Greetings and help commands — deterministic, never hits LLM.
    if ((0, copilotGreeting_util_1.isCopilotGreeting)(normalizedText)) {
        return buildCopilotWelcomeMessage(user.userName, user.companyName);
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
            return executePendingAction(confirmation.pendingActionId);
        }
        if (confirmation.hasPending && confirmation.isRejected) {
            // Attendance check NO: mark no_show + invite customer to reschedule.
            if (confirmation.actionType === 'attendance_check') {
                const { handleAttendanceCheckRejected } = await Promise.resolve().then(() => __importStar(require('./confirmation.service')));
                return handleAttendanceCheckRejected(user.companyId, confirmation.actionParams ?? {});
            }
            return 'Action cancelled.';
        }
        if (confirmation.hasPending) {
            return `${confirmation.displayMessage}\n\nReply "yes" to confirm or "no" to cancel.`;
        }
    }
    const toolContext = {
        userId: user.userId,
        companyId: user.companyId,
        userRole: user.userRole,
        userName: user.userName,
        sessionId: session?.id,
    };
    const { getAgentSessionContext } = await Promise.resolve().then(() => __importStar(require('../clientMemory.service')));
    const sessionCtx = await getAgentSessionContext(session?.id);
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
        return buildCopilotWelcomeMessage(user.userName, user.companyName);
    }
    let agentReply;
    try {
        agentReply = await invokeAgent({
            messageText: normalizedText,
            threadId,
            toolContext,
            companyName: user.companyName,
            clientMemoryBlock: memory.block,
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
        }
        else if ((0, copilotGreeting_util_1.isCopilotGreeting)(normalizedText)) {
            agentReply = buildCopilotWelcomeMessage(user.userName, user.companyName);
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
        }
    }
    // Post-LLM safety filter: if the LLM generated a vague refusal or "I couldn't
    // complete" style message for a short generic input, replace with the deterministic
    // help menu so the user always gets a useful response.
    const isLlmRefusal = /could\s+not\s+complete|unable\s+to\s+(retrieve|process)|try\s+a\s+shorter/i.test(agentReply);
    if (isLlmRefusal && aggressivelyNormalized.length < 30) {
        agentReply = buildCopilotWelcomeMessage(user.userName, user.companyName);
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
async function routeIfInternalUserForCompany(senderPhone, messageText, user) {
    if (!config_1.default.agentAi?.enabled || !messageText.trim())
        return false;
    try {
        const normalizedPhone = (0, phoneMatch_1.normalizeInboundWhatsAppPhone)(senderPhone);
        const response = await handleAgentMessage(user, messageText);
        await sendWhatsAppResponse(normalizedPhone, user.companyId, response);
        await sendStaffCopilotQuickActions(normalizedPhone, user.companyId);
        return true;
    }
    catch (error) {
        logger_1.default.error('Agent AI routing failed', {
            phone: (0, maskPhoneNumberForLogs_1.maskPhoneNumberForLogs)(senderPhone),
            userId: user.userId,
            error: error?.message,
        });
        await sendWhatsAppResponse((0, phoneMatch_1.normalizeInboundWhatsAppPhone)(senderPhone), user.companyId, 'I hit an issue processing that request. Please try again.');
        return true;
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

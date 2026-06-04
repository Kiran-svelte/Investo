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
async function getPrisma() {
    const module = await Promise.resolve().then(() => __importStar(require('../../config/prisma')));
    return module.default;
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
    const workflowReply = await classifyAndRunWorkflow({
        toolContext,
        messageText,
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
        messageText,
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
    const { tryDeterministicAgentCrmReply } = await Promise.resolve().then(() => __importStar(require('./agent-crm-query.service')));
    const deterministic = await tryDeterministicAgentCrmReply(toolContext, messageText, {
        sessionLeadId: sessionCtx.lastLeadId,
    });
    // visit cancel/reschedule handled inside tryDeterministicAgentCrmReply (mutation path first)
    // #region agent log
    fetch('http://127.0.0.1:7737/ingest/e570e274-2b9f-4460-95d9-ffd83c68631e', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'a72821' }, body: JSON.stringify({ sessionId: 'a72821', location: 'agent-router.service.ts', message: 'agent route branch', data: { userId: user.userId, role: user.userRole, usedDeterministic: Boolean(deterministic), preview: messageText.slice(0, 80) }, timestamp: Date.now(), hypothesisId: 'H2' }) }).catch(() => { });
    // #endregion
    if (deterministic) {
        if (session?.id) {
            await recordAgentCopilotExchange({
                sessionId: session.id,
                inboundText: messageText,
                outboundText: deterministic,
            });
        }
        return deterministic;
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
    const agentReply = await invokeAgent({
        messageText,
        threadId,
        toolContext,
        companyName: user.companyName,
        clientMemoryBlock: memory.block,
    });
    if (session?.id) {
        const { recordAgentCopilotExchange } = await Promise.resolve().then(() => __importStar(require('./agent-intent-orchestrator.service')));
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

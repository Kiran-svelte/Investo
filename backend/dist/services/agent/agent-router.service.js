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
exports.routeIfInternalUser = routeIfInternalUser;
const config_1 = __importDefault(require("../../config"));
const logger_1 = __importDefault(require("../../config/logger"));
const maskPhoneNumberForLogs_1 = require("../../utils/maskPhoneNumberForLogs");
const ELIGIBLE_ROLES = new Set(['super_admin', 'company_admin', 'sales_agent', 'operations']);
async function getPrisma() {
    const module = await Promise.resolve().then(() => __importStar(require('../../config/prisma')));
    return module.default;
}
function digits(phone) {
    return phone.replace(/\D/g, '');
}
async function findInternalUserByPhone(senderPhone) {
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
    if (!user || user.company.status !== 'active')
        return null;
    return {
        userId: user.id,
        companyId: user.companyId,
        companyName: user.company.name,
        userRole: user.role,
        userName: user.name,
        phone: user.phone ?? senderPhone,
    };
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
    return invokeAgent({
        messageText,
        threadId,
        toolContext,
        companyName: user.companyName,
    });
}
async function routeIfInternalUser(senderPhone, messageText, _webhookCompanyId) {
    if (!config_1.default.agentAi?.enabled || !messageText.trim())
        return false;
    const user = await findInternalUserByPhone(senderPhone);
    if (!user)
        return false;
    try {
        const response = await handleAgentMessage(user, messageText);
        await sendWhatsAppResponse(senderPhone, user.companyId, response);
        return true;
    }
    catch (error) {
        logger_1.default.error('Agent AI routing failed', {
            phone: (0, maskPhoneNumberForLogs_1.maskPhoneNumberForLogs)(senderPhone),
            userId: user.userId,
            error: error?.message,
        });
        await sendWhatsAppResponse(senderPhone, user.companyId, 'I hit an issue processing that request. Please try again.');
        return true;
    }
}
exports.agentRouterService = { routeIfInternalUser };

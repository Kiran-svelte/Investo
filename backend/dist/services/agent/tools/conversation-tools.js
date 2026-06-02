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
exports.createConversationTools = createConversationTools;
const zod_1 = require("zod");
const prisma_1 = __importDefault(require("../../../config/prisma"));
const agent_tools_constants_1 = require("../../../constants/agent-tools.constants");
const format_helpers_1 = require("./format-helpers");
const langchain_runtime_1 = require("./langchain-runtime");
function scope(context) {
    return { companyId: context.companyId, ...(context.userRole === 'sales_agent' ? { lead: { assignedAgentId: context.userId } } : {}) };
}
function createConversationTools(context) {
    return [
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'listConversations',
            description: 'List conversations by status or search. Sales agents see conversations for assigned leads.',
            schema: zod_1.z.object({ status: zod_1.z.enum(['ai_active', 'agent_active', 'closed']).optional(), search: zod_1.z.string().optional(), limit: zod_1.z.number().int().min(1).max(agent_tools_constants_1.MAX_LIST_LIMIT).optional() }),
            func: async ({ status, search, limit }) => {
                const where = { ...scope(context), ...(status ? { status } : {}) };
                if (search)
                    where.OR = [{ whatsappPhone: { contains: search } }, { lead: { customerName: { contains: search, mode: 'insensitive' } } }];
                const rows = await prisma_1.default.conversation.findMany({ where, include: { lead: { include: { assignedAgent: { select: { name: true } } } }, _count: { select: { messages: true } } }, orderBy: { updatedAt: 'desc' }, take: limit ?? agent_tools_constants_1.DEFAULT_LIST_LIMIT });
                if (!rows.length)
                    return 'No conversations found.';
                return ['*Conversations*', ...rows.map((c, i) => `${i + 1}. *${c.lead?.customerName ?? 'Unknown'}* ${(0, format_helpers_1.maskPhone)(c.whatsappPhone)}\n   Status: ${c.status} | AI: ${c.aiEnabled ? 'on' : 'off'} | Messages: ${c._count.messages}\n   ID: ${c.id}`)].join('\n\n');
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'getConversationMessages',
            description: 'Read recent messages from a conversation.',
            schema: zod_1.z.object({ conversationId: zod_1.z.string().uuid(), limit: zod_1.z.number().int().min(1).max(agent_tools_constants_1.MAX_MESSAGE_LIMIT).optional() }),
            func: async ({ conversationId, limit }) => {
                const conversation = await prisma_1.default.conversation.findFirst({ where: { id: conversationId, ...scope(context) }, include: { lead: true } });
                if (!conversation)
                    return 'Conversation not found or access denied.';
                const messages = await prisma_1.default.message.findMany({ where: { conversationId }, orderBy: { createdAt: 'desc' }, take: limit ?? agent_tools_constants_1.DEFAULT_MESSAGE_LIMIT });
                return [`*Messages: ${conversation.lead?.customerName ?? 'Unknown'}*`, ...messages.reverse().map((m) => `${(0, format_helpers_1.formatDateIST)(m.createdAt)} ${m.senderType}: ${(0, format_helpers_1.truncate)(m.content, 180)}`)].join('\n');
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'takeoverConversation',
            description: 'Take over a conversation from AI.',
            schema: zod_1.z.object({ conversationId: zod_1.z.string().uuid() }),
            func: async ({ conversationId }) => {
                const conversation = await prisma_1.default.conversation.findFirst({ where: { id: conversationId, ...scope(context) }, include: { lead: true } });
                if (!conversation)
                    return 'Conversation not found or access denied.';
                await prisma_1.default.conversation.update({ where: { id: conversationId }, data: { status: 'agent_active', aiEnabled: false } });
                return `Conversation for ${conversation.lead?.customerName ?? 'client'} is now in agent mode.`;
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'releaseConversation',
            description: 'Release a conversation back to AI.',
            schema: zod_1.z.object({ conversationId: zod_1.z.string().uuid() }),
            func: async ({ conversationId }) => {
                const conversation = await prisma_1.default.conversation.findFirst({ where: { id: conversationId, ...scope(context) }, include: { lead: true } });
                if (!conversation)
                    return 'Conversation not found or access denied.';
                await prisma_1.default.conversation.update({ where: { id: conversationId }, data: { status: 'ai_active', aiEnabled: true } });
                return `Conversation for ${conversation.lead?.customerName ?? 'client'} is back with AI.`;
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'sendMessageToClient',
            description: 'Send a WhatsApp text message to a client.',
            schema: zod_1.z.object({ conversationId: zod_1.z.string().uuid(), message: zod_1.z.string().min(1).max(2000) }),
            func: async ({ conversationId, message }) => {
                const conversation = await prisma_1.default.conversation.findFirst({ where: { id: conversationId, ...scope(context) }, include: { lead: true } });
                if (!conversation)
                    return 'Conversation not found or access denied.';
                await prisma_1.default.message.create({ data: { conversationId, senderType: 'agent', content: message } });
                const { whatsappService } = await Promise.resolve().then(() => __importStar(require('../../whatsapp.service')));
                await whatsappService.sendCompanyTextMessage(conversation.whatsappPhone, message, context.companyId);
                return `Message sent to ${conversation.lead?.customerName ?? (0, format_helpers_1.maskPhone)(conversation.whatsappPhone)}.`;
            },
        }),
    ];
}

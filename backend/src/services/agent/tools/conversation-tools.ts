import { z } from 'zod';
import prisma from '../../../config/prisma';
import { DEFAULT_LIST_LIMIT, DEFAULT_MESSAGE_LIMIT, MAX_LIST_LIMIT, MAX_MESSAGE_LIMIT } from '../../../constants/agent-tools.constants';
import { ToolContext } from '../agent-state';
import { formatDateIST, maskPhone, truncate } from './format-helpers';
import { DynamicStructuredTool, type AgentTool } from './langchain-runtime';

function scope(context: ToolContext): any {
  return { companyId: context.companyId, ...(context.userRole === 'sales_agent' ? { lead: { assignedAgentId: context.userId } } : {}) };
}

export function createConversationTools(context: ToolContext): AgentTool[] {
  return [
    new DynamicStructuredTool({
      name: 'listConversations',
      description: 'List conversations by status or search. Sales agents see conversations for assigned leads.',
      schema: z.object({ status: z.enum(['ai_active', 'agent_active', 'closed']).optional(), search: z.string().optional(), limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional() }),
      func: async ({ status, search, limit }) => {
        const where: any = { ...scope(context), ...(status ? { status } : {}) };
        if (search) where.OR = [{ whatsappPhone: { contains: search } }, { lead: { customerName: { contains: search, mode: 'insensitive' } } }];
        const rows = await prisma.conversation.findMany({ where, include: { lead: { include: { assignedAgent: { select: { name: true } } } }, _count: { select: { messages: true } } }, orderBy: { updatedAt: 'desc' }, take: limit ?? DEFAULT_LIST_LIMIT });
        if (!rows.length) return 'No conversations found.';
        return ['*Conversations*', ...rows.map((c, i) => `${i + 1}. *${c.lead?.customerName ?? 'Unknown'}* ${maskPhone(c.whatsappPhone)}\n   Status: ${c.status} | AI: ${c.aiEnabled ? 'on' : 'off'} | Messages: ${c._count.messages}\n   ID: ${c.id}`)].join('\n\n');
      },
    }),
    new DynamicStructuredTool({
      name: 'getConversationMessages',
      description: 'Read recent messages from a conversation.',
      schema: z.object({ conversationId: z.string().uuid(), limit: z.number().int().min(1).max(MAX_MESSAGE_LIMIT).optional() }),
      func: async ({ conversationId, limit }) => {
        const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, ...scope(context) }, include: { lead: true } });
        if (!conversation) return 'Conversation not found or access denied.';
        const messages = await prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: 'desc' }, take: limit ?? DEFAULT_MESSAGE_LIMIT });
        return [`*Messages: ${conversation.lead?.customerName ?? 'Unknown'}*`, ...messages.reverse().map((m) => `${formatDateIST(m.createdAt)} ${m.senderType}: ${truncate(m.content, 180)}`)].join('\n');
      },
    }),
    new DynamicStructuredTool({
      name: 'takeoverConversation',
      description: 'Take over a conversation from AI.',
      schema: z.object({ conversationId: z.string().uuid() }),
      func: async ({ conversationId }) => {
        const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, ...scope(context) }, include: { lead: true } });
        if (!conversation) return 'Conversation not found or access denied.';
        await prisma.conversation.update({ where: { id: conversationId }, data: { status: 'agent_active', aiEnabled: false } });
        return `Conversation for ${conversation.lead?.customerName ?? 'client'} is now in agent mode.`;
      },
    }),
    new DynamicStructuredTool({
      name: 'releaseConversation',
      description: 'Release a conversation back to AI.',
      schema: z.object({ conversationId: z.string().uuid() }),
      func: async ({ conversationId }) => {
        const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, ...scope(context) }, include: { lead: true } });
        if (!conversation) return 'Conversation not found or access denied.';
        await prisma.conversation.update({ where: { id: conversationId }, data: { status: 'ai_active', aiEnabled: true } });
        return `Conversation for ${conversation.lead?.customerName ?? 'client'} is back with AI.`;
      },
    }),
    new DynamicStructuredTool({
      name: 'sendMessageToClient',
      description: 'Send a WhatsApp text message to a client.',
      schema: z.object({ conversationId: z.string().uuid(), message: z.string().min(1).max(2000) }),
      func: async ({ conversationId, message }) => {
        const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, ...scope(context) }, include: { lead: true } });
        if (!conversation) return 'Conversation not found or access denied.';
        await prisma.message.create({ data: { conversationId, senderType: 'agent', content: message } });
        const { whatsappService } = await import('../../whatsapp.service');
        await whatsappService.sendCompanyTextMessage(conversation.whatsappPhone, message, context.companyId);
        return `Message sent to ${conversation.lead?.customerName ?? maskPhone(conversation.whatsappPhone)}.`;
      },
    }),
  ];
}

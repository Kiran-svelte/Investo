import { z } from 'zod';
import prisma from '../../../config/prisma';
import { DEFAULT_LIST_LIMIT, DEFAULT_MESSAGE_LIMIT, MAX_LIST_LIMIT, MAX_MESSAGE_LIMIT } from '../../../constants/agent-tools.constants';
import { buildPaginationMeta, parseAgentListPagination } from '../../../utils/pagination';
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
      schema: z.object({
        status: z.enum(['ai_active', 'agent_active', 'closed']).optional(),
        search: z.string().optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
      }),
      func: async ({ status, search, page, limit }) => {
        const where: any = { ...scope(context), ...(status ? { status } : {}) };
        if (search) where.OR = [{ whatsappPhone: { contains: search } }, { lead: { customerName: { contains: search, mode: 'insensitive' } } }];
        const paging = parseAgentListPagination({ page, limit }, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
        const [rows, total] = await Promise.all([
          prisma.conversation.findMany({
            where,
            include: { lead: { include: { assignedAgent: { select: { name: true } } } }, _count: { select: { messages: true } } },
            orderBy: { updatedAt: 'desc' },
            skip: paging.offset,
            take: paging.limit,
          }),
          prisma.conversation.count({ where }),
        ]);
        if (!rows.length) return 'No conversations found.';
        const meta = buildPaginationMeta(paging.page, paging.limit, total);
        return [
          '*Conversations*',
          ...rows.map((c, i) => `${(paging.page - 1) * paging.limit + i + 1}. *${c.lead?.customerName ?? 'Unknown'}* ${maskPhone(c.whatsappPhone)}\n   Status: ${c.status} | AI: ${c.aiEnabled ? 'on' : 'off'} | Messages: ${c._count.messages}\n   ID: ${c.id}`),
          `\nPage ${meta.page}/${meta.pages} (${meta.total} total). Use page=${meta.page + 1} for more.`,
        ].join('\n\n');
      },
    }),
    new DynamicStructuredTool({
      name: 'getConversationMessages',
      description: 'Read recent messages from a conversation.',
      schema: z.object({
        conversationId: z.string().uuid(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(MAX_MESSAGE_LIMIT).optional(),
      }),
      func: async ({ conversationId, page, limit }) => {
        const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, ...scope(context) }, include: { lead: true } });
        if (!conversation) return 'Conversation not found or access denied.';
        const paging = parseAgentListPagination({ page, limit }, DEFAULT_MESSAGE_LIMIT, MAX_MESSAGE_LIMIT);
        const [messages, total] = await Promise.all([
          prisma.message.findMany({
            where: { conversationId },
            orderBy: { createdAt: 'desc' },
            skip: paging.offset,
            take: paging.limit,
          }),
          prisma.message.count({ where: { conversationId } }),
        ]);
        const meta = buildPaginationMeta(paging.page, paging.limit, total);
        return [
          `*Messages: ${conversation.lead?.customerName ?? 'Unknown'}*`,
          ...messages.reverse().map((m) => `${formatDateIST(m.createdAt)} ${m.senderType}: ${truncate(m.content, 180)}`),
          `\nPage ${meta.page}/${meta.pages} (${meta.total} messages). Use page=${meta.page + 1} for older messages.`,
        ].join('\n');
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

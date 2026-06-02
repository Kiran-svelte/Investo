import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import prisma from '../../../config/prisma';
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from '../../../constants/agent-tools.constants';
import { ToolContext } from '../agent-state';
import { createPendingConfirmation } from '../confirmation.service';
import { buildAgentScopeFilter, formatCurrencyINR, formatDateIST, getStatusEmoji, maskPhone, truncate } from './format-helpers';

const leadStatus = z.enum(['new', 'contacted', 'visit_scheduled', 'visited', 'negotiation', 'closed_won', 'closed_lost']);

function formatBudget(min: unknown, max: unknown): string {
  if (min && max) return `${formatCurrencyINR(min as any)}-${formatCurrencyINR(max as any)}`;
  if (min) return `From ${formatCurrencyINR(min as any)}`;
  if (max) return `Up to ${formatCurrencyINR(max as any)}`;
  return 'not set';
}

function leadScope(context: ToolContext): Record<string, unknown> {
  return buildAgentScopeFilter(context.companyId, context.userRole, context.userId);
}

export function createLeadTools(context: ToolContext): DynamicStructuredTool[] {
  return [
    new DynamicStructuredTool({
      name: 'listLeads',
      description: 'List leads by status or search term. Sales agents see only assigned leads.',
      schema: z.object({ status: leadStatus.optional(), search: z.string().optional(), limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional() }),
      func: async ({ status, search, limit }) => {
        const where: any = { ...leadScope(context), ...(status ? { status } : {}) };
        if (search) where.OR = [{ customerName: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }];
        const leads = await prisma.lead.findMany({
          where,
          include: { assignedAgent: { select: { name: true } } },
          orderBy: { updatedAt: 'desc' },
          take: limit ?? DEFAULT_LIST_LIMIT,
        });
        if (!leads.length) return 'No leads found.';
        return ['*Leads*', ...leads.map((lead, i) => `${i + 1}. ${getStatusEmoji(lead.status)} *${lead.customerName ?? 'Unknown'}* ${maskPhone(lead.phone)}\n   Status: ${lead.status} | Agent: ${lead.assignedAgent?.name ?? 'Unassigned'}\n   Budget: ${formatBudget(lead.budgetMin, lead.budgetMax)}\n   ID: ${lead.id}`)].join('\n\n');
      },
    }),
    new DynamicStructuredTool({
      name: 'getLeadDetails',
      description: 'Get lead profile, notes, visits, and latest conversation preview.',
      schema: z.object({ leadId: z.string().uuid() }),
      func: async ({ leadId }) => {
        const lead = await prisma.lead.findFirst({
          where: { id: leadId, ...leadScope(context) },
          include: { assignedAgent: { select: { name: true } }, visits: { take: 3, orderBy: { scheduledAt: 'desc' } }, conversations: { take: 1, orderBy: { updatedAt: 'desc' } } },
        });
        if (!lead) return 'Lead not found or access denied.';
        const lastMessage = lead.conversations[0]
          ? await prisma.message.findFirst({ where: { conversationId: lead.conversations[0].id }, orderBy: { createdAt: 'desc' } })
          : null;
        return [
          `*Lead Details*`,
          `Name: ${lead.customerName ?? 'Unknown'}`,
          `Phone: ${maskPhone(lead.phone)}`,
          `Email: ${lead.email ?? 'not set'}`,
          `Status: ${lead.status}`,
          `Budget: ${formatBudget(lead.budgetMin, lead.budgetMax)}`,
          `Location: ${lead.locationPreference ?? 'not set'}`,
          `Agent: ${lead.assignedAgent?.name ?? 'Unassigned'}`,
          `Visits: ${lead.visits.length}`,
          lead.notes ? `Notes: ${lead.notes}` : '',
          lastMessage ? `Last message: ${truncate(lastMessage.content, 180)}` : '',
          `ID: ${lead.id}`,
        ].filter(Boolean).join('\n');
      },
    }),
    new DynamicStructuredTool({
      name: 'createLead',
      description: 'Create a new lead. Sales agents auto-assign the lead to themselves.',
      schema: z.object({
        customerName: z.string().min(1),
        phone: z.string().min(8),
        email: z.string().email().optional(),
        source: z.enum(['whatsapp', 'website', 'manual', 'referral']).default('manual'),
        notes: z.string().optional(),
        budgetMin: z.number().optional(),
        budgetMax: z.number().optional(),
        locationPreference: z.string().optional(),
        propertyType: z.enum(['villa', 'apartment', 'plot', 'commercial', 'other']).optional(),
      }),
      func: async (input) => {
        const lead = await prisma.lead.create({
          data: {
            companyId: context.companyId,
            customerName: input.customerName,
            phone: input.phone,
            email: input.email ?? null,
            source: input.source,
            notes: input.notes ?? null,
            budgetMin: input.budgetMin ?? null,
            budgetMax: input.budgetMax ?? null,
            locationPreference: input.locationPreference ?? null,
            propertyType: input.propertyType ?? null,
            assignedAgentId: context.userRole === 'sales_agent' ? context.userId : null,
          },
        });
        return `Lead created: ${lead.customerName ?? 'Unknown'} (${maskPhone(lead.phone)}). ID: ${lead.id}`;
      },
    }),
    new DynamicStructuredTool({
      name: 'updateLead',
      description: 'Update lead fields such as notes, email, budget, location, or property type.',
      schema: z.object({
        leadId: z.string().uuid(),
        notes: z.string().optional(),
        email: z.string().email().optional(),
        budgetMin: z.number().optional(),
        budgetMax: z.number().optional(),
        locationPreference: z.string().optional(),
        propertyType: z.enum(['villa', 'apartment', 'plot', 'commercial', 'other']).optional(),
      }),
      func: async ({ leadId, ...fields }) => {
        const existing = await prisma.lead.findFirst({ where: { id: leadId, ...leadScope(context) }, select: { id: true, customerName: true } });
        if (!existing) return 'Lead not found or access denied.';
        const data = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
        if (!Object.keys(data).length) return 'No fields provided.';
        await prisma.lead.update({ where: { id: leadId }, data });
        return `Updated ${existing.customerName ?? 'lead'}: ${Object.keys(data).join(', ')}`;
      },
    }),
    new DynamicStructuredTool({
      name: 'updateLeadStatus',
      description: 'Update lead pipeline status. closed_lost requires yes/no confirmation.',
      schema: z.object({ leadId: z.string().uuid(), status: leadStatus }),
      func: async ({ leadId, status }) => {
        const lead = await prisma.lead.findFirst({ where: { id: leadId, ...leadScope(context) }, select: { id: true, customerName: true, status: true } });
        if (!lead) return 'Lead not found or access denied.';
        if (status === 'closed_lost') {
          if (!context.sessionId) return 'Confirmation session unavailable.';
          const message = `Confirm marking ${lead.customerName ?? 'this lead'} as closed lost?\nReply "yes" to confirm or "no" to cancel.`;
          await createPendingConfirmation(context.sessionId, 'closeLeadLost', { leadId }, message);
          return message;
        }
        await prisma.lead.update({ where: { id: leadId }, data: { status } });
        return `Lead ${lead.customerName ?? 'Unknown'} moved from ${lead.status} to ${status}.`;
      },
    }),
    new DynamicStructuredTool({
      name: 'assignLead',
      description: 'Assign or reassign a lead to an agent. Reassignment requires yes/no confirmation.',
      schema: z.object({ leadId: z.string().uuid(), agentId: z.string().uuid() }),
      func: async ({ leadId, agentId }) => {
        const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId: context.companyId }, include: { assignedAgent: { select: { name: true } } } });
        const agent = await prisma.user.findFirst({ where: { id: agentId, companyId: context.companyId, status: 'active' }, select: { id: true, name: true } });
        if (!lead) return 'Lead not found.';
        if (!agent) return 'Agent not found or inactive.';
        if (lead.assignedAgentId && lead.assignedAgentId !== agentId) {
          if (!context.sessionId) return 'Confirmation session unavailable.';
          const message = `Confirm reassignment of ${lead.customerName ?? 'lead'} from ${lead.assignedAgent?.name ?? 'current agent'} to ${agent.name}?\nReply "yes" to confirm or "no" to cancel.`;
          await createPendingConfirmation(context.sessionId, 'reassignLead', { leadId, agentId }, message);
          return message;
        }
        await prisma.lead.update({ where: { id: leadId }, data: { assignedAgentId: agentId } });
        return `Assigned ${lead.customerName ?? 'lead'} to ${agent.name}.`;
      },
    }),
    new DynamicStructuredTool({
      name: 'deleteLead',
      description: 'Delete a lead. Requires yes/no confirmation.',
      schema: z.object({ leadId: z.string().uuid() }),
      func: async ({ leadId }) => {
        const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId: context.companyId }, select: { id: true, customerName: true, phone: true } });
        if (!lead) return 'Lead not found.';
        if (!context.sessionId) return 'Confirmation session unavailable.';
        const message = `Confirm permanent deletion of ${lead.customerName ?? 'this lead'} (${maskPhone(lead.phone)})?\nReply "yes" to confirm or "no" to cancel.`;
        await createPendingConfirmation(context.sessionId, 'deleteLead', { leadId }, message);
        return message;
      },
    }),
    new DynamicStructuredTool({
      name: 'reEngageLead',
      description: 'Store and send a re-engagement WhatsApp message to a lead.',
      schema: z.object({ leadId: z.string().uuid(), messageText: z.string().min(1).max(2000) }),
      func: async ({ leadId, messageText }) => {
        const lead = await prisma.lead.findFirst({ where: { id: leadId, ...leadScope(context) }, select: { id: true, customerName: true, phone: true } });
        if (!lead) return 'Lead not found or access denied.';
        const conversation = await prisma.conversation.findFirst({ where: { leadId, companyId: context.companyId }, orderBy: { updatedAt: 'desc' } });
        if (!conversation) return 'No conversation exists for this lead.';
        await prisma.message.create({ data: { conversationId: conversation.id, senderType: 'agent', content: messageText } });
        await prisma.lead.update({ where: { id: leadId }, data: { lastContactAt: new Date(), reEngagementSentAt: new Date(), reEngagementCount: { increment: 1 } } });
        const { whatsappService } = await import('../../whatsapp.service');
        await whatsappService.sendCompanyTextMessage(lead.phone, messageText, context.companyId);
        return `Re-engagement sent to ${lead.customerName ?? maskPhone(lead.phone)}.`;
      },
    }),
  ];
}

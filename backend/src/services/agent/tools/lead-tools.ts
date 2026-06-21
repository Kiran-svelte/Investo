import { z } from 'zod';
import prisma from '../../../config/prisma';
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from '../../../constants/agent-tools.constants';
import { parseAgentListPagination, buildPaginationMeta } from '../../../utils/pagination';
import { ToolContext } from '../agent-state';
import { createPendingConfirmation } from '../confirmation.service';
import {
  buildAgentScopeFilter,
  formatCurrencyINR,
  formatDateIST,
  getISTDayBounds,
  getStatusEmoji,
  getTodayIST,
  maskPhone,
  truncate,
} from './format-helpers';
import { updateLeadStatusById } from '../lead-status-actions';
import { DynamicStructuredTool, type AgentTool } from './langchain-runtime';

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

export function createLeadReadTools(context: ToolContext): AgentTool[] {
  return [
    new DynamicStructuredTool({
      name: 'listLeads',
      description: 'List leads by status or search term. Sales agents see only assigned leads.',
      schema: z.object({
        status: leadStatus.optional(),
        search: z.string().optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
      }),
      func: async ({ status, search, page, limit }) => {
        const where: any = { ...leadScope(context), ...(status ? { status } : {}) };
        if (search) where.OR = [{ customerName: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }];
        const paging = parseAgentListPagination({ page, limit }, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
        const [leads, total] = await Promise.all([
          prisma.lead.findMany({
            where,
            include: { assignedAgent: { select: { name: true } } },
            orderBy: { updatedAt: 'desc' },
            skip: paging.offset,
            take: paging.limit,
          }),
          prisma.lead.count({ where }),
        ]);
        if (!leads.length) return 'No leads found.';
        const meta = buildPaginationMeta(paging.page, paging.limit, total);
        return [
          '*Leads*',
          ...leads.map((lead, i) => `${(paging.page - 1) * paging.limit + i + 1}. ${getStatusEmoji(lead.status)} *${lead.customerName ?? 'Unknown'}* ${maskPhone(lead.phone)}\n   Status: ${lead.status} | Agent: ${lead.assignedAgent?.name ?? 'Unassigned'}\n   Budget: ${formatBudget(lead.budgetMin, lead.budgetMax)}\n   ID: ${lead.id}`),
          `\nPage ${meta.page}/${meta.pages} (${meta.total} total). Use page=${meta.page + 1} for more.`,
        ].join('\n\n');
      },
    }),
    new DynamicStructuredTool({
      name: 'listLeadsAddedToday',
      description:
        'List leads created today (IST). Sales agents only see leads assigned to them. Use for "new leads today" questions.',
      schema: z.object({
        limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
      }),
      func: async ({ limit }) => {
        const [start, end] = getISTDayBounds(getTodayIST());
        const where: Record<string, unknown> = {
          ...leadScope(context),
          createdAt: { gte: start, lte: end },
        };
        const leads = await prisma.lead.findMany({
          where: where as any,
          include: { assignedAgent: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: limit ?? DEFAULT_LIST_LIMIT,
        });
        if (!leads.length) return 'No new leads were added today in your scope.';
        const { formatStatusLabel, CRM_WHATSAPP_LIST_LIMIT } = await import('./format-helpers');
        const shown = leads.slice(0, CRM_WHATSAPP_LIST_LIMIT);
        const lines = shown.map(
          (lead, i) =>
            `${i + 1}. ${getStatusEmoji(lead.status)} *${lead.customerName ?? 'Unknown'}* ${maskPhone(lead.phone)}\n   Status: ${formatStatusLabel(lead.status)} | Agent: ${lead.assignedAgent?.name ?? 'Unassigned'}`,
        );
        if (leads.length > CRM_WHATSAPP_LIST_LIMIT) {
          lines.push(`_+${leads.length - CRM_WHATSAPP_LIST_LIMIT} more — reply with a narrower search (e.g. area or date)._`);
        }
        return [`*New leads today (${getTodayIST()})*`, ...lines].join('\n\n');
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
  ];
}

type LeadMutationToolOptions = {
  allowCreate?: boolean;
  allowAssign?: boolean;
  allowPortfolioTransfer?: boolean;
};

export function createLeadMutationTools(
  context: ToolContext,
  options: LeadMutationToolOptions = {},
): AgentTool[] {
  const {
    allowCreate = true,
    allowAssign = true,
    allowPortfolioTransfer = true,
  } = options;

  const tools: AgentTool[] = [
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
        const result = await updateLeadStatusById(context, leadId, status);
        return result.reply;
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
    new DynamicStructuredTool({
      name: 'addLeadNote',
      description: 'Append a timestamped note to a lead without overwriting existing notes.',
      schema: z.object({
        leadId: z.string().uuid(),
        note: z.string().min(1).max(2000),
      }),
      func: async ({ leadId, note }) => {
        const lead = await prisma.lead.findFirst({
          where: { id: leadId, ...leadScope(context) },
          select: { id: true, customerName: true, notes: true },
        });
        if (!lead) return 'Lead not found or access denied.';
        const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const newNote = `[${now}] ${note}`;
        const combined = lead.notes ? `${lead.notes}\n${newNote}` : newNote;
        await prisma.lead.update({ where: { id: leadId }, data: { notes: combined } });
        return `Note added to ${lead.customerName ?? 'lead'}.`;
      },
    }),
    new DynamicStructuredTool({
      name: 'flagLeadPriority',
      description: 'Set a lead priority flag (hot, warm, cold) in the lead metadata for AI routing.',
      schema: z.object({
        leadId: z.string().uuid(),
        priority: z.enum(['hot', 'warm', 'cold']),
      }),
      func: async ({ leadId, priority }) => {
        const lead = await prisma.lead.findFirst({
          where: { id: leadId, ...leadScope(context) },
          select: { id: true, customerName: true, metadata: true },
        });
        if (!lead) return 'Lead not found or access denied.';
        const existingMeta = typeof lead.metadata === 'object' && lead.metadata !== null && !Array.isArray(lead.metadata)
          ? lead.metadata as Record<string, unknown>
          : {};
        await prisma.lead.update({
          where: { id: leadId },
          data: { metadata: { ...existingMeta, lead_score: priority } },
        });
        return `${lead.customerName ?? 'Lead'} marked as ${priority}.`;
      },
    }),
    new DynamicStructuredTool({
      name: 'transferLeadPortfolio',
      description:
        'Transfer all active leads from one agent to another. ' +
        'Use when an agent leaves the company. Requires yes/no confirmation. Admin only.',
      schema: z.object({
        fromAgentId: z.string().uuid().describe('Agent whose leads to transfer'),
        toAgentId: z.string().uuid().describe('Agent who will receive the leads'),
      }),
      func: async ({ fromAgentId, toAgentId }) => {
        if (context.userRole !== 'company_admin' && context.userRole !== 'super_admin') {
          return 'Only admins can transfer lead portfolios.';
        }
        const [fromAgent, toAgent] = await Promise.all([
          prisma.user.findFirst({ where: { id: fromAgentId, companyId: context.companyId }, select: { id: true, name: true } }),
          prisma.user.findFirst({
            where: { id: toAgentId, companyId: context.companyId, role: 'sales_agent', status: 'active' },
            select: { id: true, name: true },
          }),
        ]);
        if (!fromAgent) return 'Source agent not found.';
        if (!toAgent) return 'Target agent not found or inactive.';
        const count = await prisma.lead.count({
          where: {
            companyId: context.companyId,
            assignedAgentId: fromAgentId,
            status: { notIn: ['closed_won', 'closed_lost'] },
          },
        });
        if (count === 0) return `${fromAgent.name} has no active leads to transfer.`;
        if (!context.sessionId) return 'Confirmation session unavailable.';
        const message =
          `Confirm transfer of ${count} active lead(s) from ${fromAgent.name} to ${toAgent.name}?\n` +
          `Reply "yes" to confirm or "no" to cancel.`;
        await createPendingConfirmation(
          context.sessionId,
          'reassignLead',
          { fromAgentId, toAgentId, bulkTransfer: true },
          message,
        );
        return message;
      },
    }),
  ];

  if (allowAssign) {
    tools.splice(2, 0, new DynamicStructuredTool({
      name: 'assignLead',
      description: 'Assign or reassign a lead to an agent. Reassignment requires yes/no confirmation.',
      schema: z.object({ leadId: z.string().uuid(), agentId: z.string().uuid() }),
      func: async ({ leadId, agentId }) => {
        const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId: context.companyId }, include: { assignedAgent: { select: { name: true } } } });
        const agent = await prisma.user.findFirst({
          where: { id: agentId, companyId: context.companyId, role: 'sales_agent', status: 'active' },
          select: { id: true, name: true },
        });
        if (!lead) return 'Lead not found.';
        if (!agent) return 'Agent not found or inactive in this company.';
        if (lead.assignedAgentId && lead.assignedAgentId !== agentId) {
          if (!context.sessionId) return 'Confirmation session unavailable.';
          const message = `Confirm reassignment of ${lead.customerName ?? 'lead'} from ${lead.assignedAgent?.name ?? 'current agent'} to ${agent.name}?\nReply "yes" to confirm or "no" to cancel.`;
          await createPendingConfirmation(context.sessionId, 'reassignLead', { leadId, agentId }, message);
          return message;
        }
        await prisma.lead.update({ where: { id: leadId }, data: { assignedAgentId: agentId } });
        return `Assigned ${lead.customerName ?? 'lead'} to ${agent.name}.`;
      },
    }));
  }

  if (allowCreate) {
    tools.unshift(new DynamicStructuredTool({
      name: 'createLead',
      description: 'Create a new lead.',
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
            assignedAgentId: null,
          },
        });
        return `Lead created: ${lead.customerName ?? 'Unknown'} (${maskPhone(lead.phone)}). ID: ${lead.id}`;
      },
    }));
  }

  if (!allowPortfolioTransfer) {
    return tools.filter((tool) => tool.name !== 'transferLeadPortfolio');
  }

  return tools;
}

export function createLeadTools(context: ToolContext): AgentTool[] {
  return [
    ...createLeadReadTools(context),
    ...createLeadMutationTools(context),
  ];
}

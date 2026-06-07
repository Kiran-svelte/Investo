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
exports.createLeadTools = createLeadTools;
const zod_1 = require("zod");
const prisma_1 = __importDefault(require("../../../config/prisma"));
const agent_tools_constants_1 = require("../../../constants/agent-tools.constants");
const pagination_1 = require("../../../utils/pagination");
const confirmation_service_1 = require("../confirmation.service");
const format_helpers_1 = require("./format-helpers");
const lead_status_actions_1 = require("../lead-status-actions");
const langchain_runtime_1 = require("./langchain-runtime");
const leadStatus = zod_1.z.enum(['new', 'contacted', 'visit_scheduled', 'visited', 'negotiation', 'closed_won', 'closed_lost']);
function formatBudget(min, max) {
    if (min && max)
        return `${(0, format_helpers_1.formatCurrencyINR)(min)}-${(0, format_helpers_1.formatCurrencyINR)(max)}`;
    if (min)
        return `From ${(0, format_helpers_1.formatCurrencyINR)(min)}`;
    if (max)
        return `Up to ${(0, format_helpers_1.formatCurrencyINR)(max)}`;
    return 'not set';
}
function leadScope(context) {
    return (0, format_helpers_1.buildAgentScopeFilter)(context.companyId, context.userRole, context.userId);
}
function createLeadTools(context) {
    return [
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'listLeads',
            description: 'List leads by status or search term. Sales agents see only assigned leads.',
            schema: zod_1.z.object({
                status: leadStatus.optional(),
                search: zod_1.z.string().optional(),
                page: zod_1.z.number().int().min(1).optional(),
                limit: zod_1.z.number().int().min(1).max(agent_tools_constants_1.MAX_LIST_LIMIT).optional(),
            }),
            func: async ({ status, search, page, limit }) => {
                const where = { ...leadScope(context), ...(status ? { status } : {}) };
                if (search)
                    where.OR = [{ customerName: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }];
                const paging = (0, pagination_1.parseAgentListPagination)({ page, limit }, agent_tools_constants_1.DEFAULT_LIST_LIMIT, agent_tools_constants_1.MAX_LIST_LIMIT);
                const [leads, total] = await Promise.all([
                    prisma_1.default.lead.findMany({
                        where,
                        include: { assignedAgent: { select: { name: true } } },
                        orderBy: { updatedAt: 'desc' },
                        skip: paging.offset,
                        take: paging.limit,
                    }),
                    prisma_1.default.lead.count({ where }),
                ]);
                if (!leads.length)
                    return 'No leads found.';
                const meta = (0, pagination_1.buildPaginationMeta)(paging.page, paging.limit, total);
                return [
                    '*Leads*',
                    ...leads.map((lead, i) => `${(paging.page - 1) * paging.limit + i + 1}. ${(0, format_helpers_1.getStatusEmoji)(lead.status)} *${lead.customerName ?? 'Unknown'}* ${(0, format_helpers_1.maskPhone)(lead.phone)}\n   Status: ${lead.status} | Agent: ${lead.assignedAgent?.name ?? 'Unassigned'}\n   Budget: ${formatBudget(lead.budgetMin, lead.budgetMax)}\n   ID: ${lead.id}`),
                    `\nPage ${meta.page}/${meta.pages} (${meta.total} total). Use page=${meta.page + 1} for more.`,
                ].join('\n\n');
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'listLeadsAddedToday',
            description: 'List leads created today (IST). Sales agents only see leads assigned to them. Use for "new leads today" questions.',
            schema: zod_1.z.object({
                limit: zod_1.z.number().int().min(1).max(agent_tools_constants_1.MAX_LIST_LIMIT).optional(),
            }),
            func: async ({ limit }) => {
                const [start, end] = (0, format_helpers_1.getISTDayBounds)((0, format_helpers_1.getTodayIST)());
                const where = {
                    ...leadScope(context),
                    createdAt: { gte: start, lte: end },
                };
                const leads = await prisma_1.default.lead.findMany({
                    where: where,
                    include: { assignedAgent: { select: { name: true } } },
                    orderBy: { createdAt: 'desc' },
                    take: limit ?? agent_tools_constants_1.DEFAULT_LIST_LIMIT,
                });
                if (!leads.length)
                    return 'No new leads were added today in your scope.';
                const { formatStatusLabel, CRM_WHATSAPP_LIST_LIMIT } = await Promise.resolve().then(() => __importStar(require('./format-helpers')));
                const shown = leads.slice(0, CRM_WHATSAPP_LIST_LIMIT);
                const lines = shown.map((lead, i) => `${i + 1}. ${(0, format_helpers_1.getStatusEmoji)(lead.status)} *${lead.customerName ?? 'Unknown'}* ${(0, format_helpers_1.maskPhone)(lead.phone)}\n   Status: ${formatStatusLabel(lead.status)} | Agent: ${lead.assignedAgent?.name ?? 'Unassigned'}`);
                if (leads.length > CRM_WHATSAPP_LIST_LIMIT) {
                    lines.push(`_+${leads.length - CRM_WHATSAPP_LIST_LIMIT} more — open the Investo dashboard for the full list._`);
                }
                return [`*New leads today (${(0, format_helpers_1.getTodayIST)()})*`, ...lines].join('\n\n');
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'getLeadDetails',
            description: 'Get lead profile, notes, visits, and latest conversation preview.',
            schema: zod_1.z.object({ leadId: zod_1.z.string().uuid() }),
            func: async ({ leadId }) => {
                const lead = await prisma_1.default.lead.findFirst({
                    where: { id: leadId, ...leadScope(context) },
                    include: { assignedAgent: { select: { name: true } }, visits: { take: 3, orderBy: { scheduledAt: 'desc' } }, conversations: { take: 1, orderBy: { updatedAt: 'desc' } } },
                });
                if (!lead)
                    return 'Lead not found or access denied.';
                const lastMessage = lead.conversations[0]
                    ? await prisma_1.default.message.findFirst({ where: { conversationId: lead.conversations[0].id }, orderBy: { createdAt: 'desc' } })
                    : null;
                return [
                    `*Lead Details*`,
                    `Name: ${lead.customerName ?? 'Unknown'}`,
                    `Phone: ${(0, format_helpers_1.maskPhone)(lead.phone)}`,
                    `Email: ${lead.email ?? 'not set'}`,
                    `Status: ${lead.status}`,
                    `Budget: ${formatBudget(lead.budgetMin, lead.budgetMax)}`,
                    `Location: ${lead.locationPreference ?? 'not set'}`,
                    `Agent: ${lead.assignedAgent?.name ?? 'Unassigned'}`,
                    `Visits: ${lead.visits.length}`,
                    lead.notes ? `Notes: ${lead.notes}` : '',
                    lastMessage ? `Last message: ${(0, format_helpers_1.truncate)(lastMessage.content, 180)}` : '',
                    `ID: ${lead.id}`,
                ].filter(Boolean).join('\n');
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'createLead',
            description: 'Create a new lead. Sales agents auto-assign the lead to themselves.',
            schema: zod_1.z.object({
                customerName: zod_1.z.string().min(1),
                phone: zod_1.z.string().min(8),
                email: zod_1.z.string().email().optional(),
                source: zod_1.z.enum(['whatsapp', 'website', 'manual', 'referral']).default('manual'),
                notes: zod_1.z.string().optional(),
                budgetMin: zod_1.z.number().optional(),
                budgetMax: zod_1.z.number().optional(),
                locationPreference: zod_1.z.string().optional(),
                propertyType: zod_1.z.enum(['villa', 'apartment', 'plot', 'commercial', 'other']).optional(),
            }),
            func: async (input) => {
                const lead = await prisma_1.default.lead.create({
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
                return `Lead created: ${lead.customerName ?? 'Unknown'} (${(0, format_helpers_1.maskPhone)(lead.phone)}). ID: ${lead.id}`;
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'updateLead',
            description: 'Update lead fields such as notes, email, budget, location, or property type.',
            schema: zod_1.z.object({
                leadId: zod_1.z.string().uuid(),
                notes: zod_1.z.string().optional(),
                email: zod_1.z.string().email().optional(),
                budgetMin: zod_1.z.number().optional(),
                budgetMax: zod_1.z.number().optional(),
                locationPreference: zod_1.z.string().optional(),
                propertyType: zod_1.z.enum(['villa', 'apartment', 'plot', 'commercial', 'other']).optional(),
            }),
            func: async ({ leadId, ...fields }) => {
                const existing = await prisma_1.default.lead.findFirst({ where: { id: leadId, ...leadScope(context) }, select: { id: true, customerName: true } });
                if (!existing)
                    return 'Lead not found or access denied.';
                const data = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
                if (!Object.keys(data).length)
                    return 'No fields provided.';
                await prisma_1.default.lead.update({ where: { id: leadId }, data });
                return `Updated ${existing.customerName ?? 'lead'}: ${Object.keys(data).join(', ')}`;
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'updateLeadStatus',
            description: 'Update lead pipeline status. closed_lost requires yes/no confirmation.',
            schema: zod_1.z.object({ leadId: zod_1.z.string().uuid(), status: leadStatus }),
            func: async ({ leadId, status }) => {
                const result = await (0, lead_status_actions_1.updateLeadStatusById)(context, leadId, status);
                return result.reply;
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'assignLead',
            description: 'Assign or reassign a lead to an agent. Reassignment requires yes/no confirmation.',
            schema: zod_1.z.object({ leadId: zod_1.z.string().uuid(), agentId: zod_1.z.string().uuid() }),
            func: async ({ leadId, agentId }) => {
                const lead = await prisma_1.default.lead.findFirst({ where: { id: leadId, companyId: context.companyId }, include: { assignedAgent: { select: { name: true } } } });
                const agent = await prisma_1.default.user.findFirst({ where: { id: agentId, companyId: context.companyId, status: 'active' }, select: { id: true, name: true } });
                if (!lead)
                    return 'Lead not found.';
                if (!agent)
                    return 'Agent not found or inactive.';
                if (lead.assignedAgentId && lead.assignedAgentId !== agentId) {
                    if (!context.sessionId)
                        return 'Confirmation session unavailable.';
                    const message = `Confirm reassignment of ${lead.customerName ?? 'lead'} from ${lead.assignedAgent?.name ?? 'current agent'} to ${agent.name}?\nReply "yes" to confirm or "no" to cancel.`;
                    await (0, confirmation_service_1.createPendingConfirmation)(context.sessionId, 'reassignLead', { leadId, agentId }, message);
                    return message;
                }
                await prisma_1.default.lead.update({ where: { id: leadId }, data: { assignedAgentId: agentId } });
                return `Assigned ${lead.customerName ?? 'lead'} to ${agent.name}.`;
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'deleteLead',
            description: 'Delete a lead. Requires yes/no confirmation.',
            schema: zod_1.z.object({ leadId: zod_1.z.string().uuid() }),
            func: async ({ leadId }) => {
                const lead = await prisma_1.default.lead.findFirst({ where: { id: leadId, companyId: context.companyId }, select: { id: true, customerName: true, phone: true } });
                if (!lead)
                    return 'Lead not found.';
                if (!context.sessionId)
                    return 'Confirmation session unavailable.';
                const message = `Confirm permanent deletion of ${lead.customerName ?? 'this lead'} (${(0, format_helpers_1.maskPhone)(lead.phone)})?\nReply "yes" to confirm or "no" to cancel.`;
                await (0, confirmation_service_1.createPendingConfirmation)(context.sessionId, 'deleteLead', { leadId }, message);
                return message;
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'reEngageLead',
            description: 'Store and send a re-engagement WhatsApp message to a lead.',
            schema: zod_1.z.object({ leadId: zod_1.z.string().uuid(), messageText: zod_1.z.string().min(1).max(2000) }),
            func: async ({ leadId, messageText }) => {
                const lead = await prisma_1.default.lead.findFirst({ where: { id: leadId, ...leadScope(context) }, select: { id: true, customerName: true, phone: true } });
                if (!lead)
                    return 'Lead not found or access denied.';
                const conversation = await prisma_1.default.conversation.findFirst({ where: { leadId, companyId: context.companyId }, orderBy: { updatedAt: 'desc' } });
                if (!conversation)
                    return 'No conversation exists for this lead.';
                await prisma_1.default.message.create({ data: { conversationId: conversation.id, senderType: 'agent', content: messageText } });
                await prisma_1.default.lead.update({ where: { id: leadId }, data: { lastContactAt: new Date(), reEngagementSentAt: new Date(), reEngagementCount: { increment: 1 } } });
                const { whatsappService } = await Promise.resolve().then(() => __importStar(require('../../whatsapp.service')));
                await whatsappService.sendCompanyTextMessage(lead.phone, messageText, context.companyId);
                return `Re-engagement sent to ${lead.customerName ?? (0, format_helpers_1.maskPhone)(lead.phone)}.`;
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'addLeadNote',
            description: 'Append a timestamped note to a lead without overwriting existing notes.',
            schema: zod_1.z.object({
                leadId: zod_1.z.string().uuid(),
                note: zod_1.z.string().min(1).max(2000),
            }),
            func: async ({ leadId, note }) => {
                const lead = await prisma_1.default.lead.findFirst({
                    where: { id: leadId, ...leadScope(context) },
                    select: { id: true, customerName: true, notes: true },
                });
                if (!lead)
                    return 'Lead not found or access denied.';
                const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
                const newNote = `[${now}] ${note}`;
                const combined = lead.notes ? `${lead.notes}\n${newNote}` : newNote;
                await prisma_1.default.lead.update({ where: { id: leadId }, data: { notes: combined } });
                return `Note added to ${lead.customerName ?? 'lead'}.`;
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'flagLeadPriority',
            description: 'Set a lead priority flag (hot, warm, cold) in the lead metadata for AI routing.',
            schema: zod_1.z.object({
                leadId: zod_1.z.string().uuid(),
                priority: zod_1.z.enum(['hot', 'warm', 'cold']),
            }),
            func: async ({ leadId, priority }) => {
                const lead = await prisma_1.default.lead.findFirst({
                    where: { id: leadId, ...leadScope(context) },
                    select: { id: true, customerName: true, metadata: true },
                });
                if (!lead)
                    return 'Lead not found or access denied.';
                const existingMeta = typeof lead.metadata === 'object' && lead.metadata !== null && !Array.isArray(lead.metadata)
                    ? lead.metadata
                    : {};
                await prisma_1.default.lead.update({
                    where: { id: leadId },
                    data: { metadata: { ...existingMeta, lead_score: priority } },
                });
                return `${lead.customerName ?? 'Lead'} marked as ${priority}.`;
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'transferLeadPortfolio',
            description: 'Transfer all active leads from one agent to another. ' +
                'Use when an agent leaves the company. Requires yes/no confirmation. Admin only.',
            schema: zod_1.z.object({
                fromAgentId: zod_1.z.string().uuid().describe('Agent whose leads to transfer'),
                toAgentId: zod_1.z.string().uuid().describe('Agent who will receive the leads'),
            }),
            func: async ({ fromAgentId, toAgentId }) => {
                if (context.userRole !== 'company_admin' && context.userRole !== 'super_admin') {
                    return 'Only admins can transfer lead portfolios.';
                }
                const [fromAgent, toAgent] = await Promise.all([
                    prisma_1.default.user.findFirst({ where: { id: fromAgentId, companyId: context.companyId }, select: { id: true, name: true } }),
                    prisma_1.default.user.findFirst({ where: { id: toAgentId, companyId: context.companyId, status: 'active' }, select: { id: true, name: true } }),
                ]);
                if (!fromAgent)
                    return 'Source agent not found.';
                if (!toAgent)
                    return 'Target agent not found or inactive.';
                const count = await prisma_1.default.lead.count({
                    where: {
                        companyId: context.companyId,
                        assignedAgentId: fromAgentId,
                        status: { notIn: ['closed_won', 'closed_lost'] },
                    },
                });
                if (count === 0)
                    return `${fromAgent.name} has no active leads to transfer.`;
                if (!context.sessionId)
                    return 'Confirmation session unavailable.';
                const message = `Confirm transfer of ${count} active lead(s) from ${fromAgent.name} to ${toAgent.name}?\n` +
                    `Reply "yes" to confirm or "no" to cancel.`;
                await (0, confirmation_service_1.createPendingConfirmation)(context.sessionId, 'reassignLead', { fromAgentId, toAgentId, bulkTransfer: true }, message);
                return message;
            },
        }),
    ];
}

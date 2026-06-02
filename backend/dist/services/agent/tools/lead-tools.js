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
const confirmation_service_1 = require("../confirmation.service");
const format_helpers_1 = require("./format-helpers");
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
            schema: zod_1.z.object({ status: leadStatus.optional(), search: zod_1.z.string().optional(), limit: zod_1.z.number().int().min(1).max(agent_tools_constants_1.MAX_LIST_LIMIT).optional() }),
            func: async ({ status, search, limit }) => {
                const where = { ...leadScope(context), ...(status ? { status } : {}) };
                if (search)
                    where.OR = [{ customerName: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }];
                const leads = await prisma_1.default.lead.findMany({
                    where,
                    include: { assignedAgent: { select: { name: true } } },
                    orderBy: { updatedAt: 'desc' },
                    take: limit ?? agent_tools_constants_1.DEFAULT_LIST_LIMIT,
                });
                if (!leads.length)
                    return 'No leads found.';
                return ['*Leads*', ...leads.map((lead, i) => `${i + 1}. ${(0, format_helpers_1.getStatusEmoji)(lead.status)} *${lead.customerName ?? 'Unknown'}* ${(0, format_helpers_1.maskPhone)(lead.phone)}\n   Status: ${lead.status} | Agent: ${lead.assignedAgent?.name ?? 'Unassigned'}\n   Budget: ${formatBudget(lead.budgetMin, lead.budgetMax)}\n   ID: ${lead.id}`)].join('\n\n');
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
                const lead = await prisma_1.default.lead.findFirst({ where: { id: leadId, ...leadScope(context) }, select: { id: true, customerName: true, status: true } });
                if (!lead)
                    return 'Lead not found or access denied.';
                if (status === 'closed_lost') {
                    if (!context.sessionId)
                        return 'Confirmation session unavailable.';
                    const message = `Confirm marking ${lead.customerName ?? 'this lead'} as closed lost?\nReply "yes" to confirm or "no" to cancel.`;
                    await (0, confirmation_service_1.createPendingConfirmation)(context.sessionId, 'closeLeadLost', { leadId }, message);
                    return message;
                }
                await prisma_1.default.lead.update({ where: { id: leadId }, data: { status } });
                return `Lead ${lead.customerName ?? 'Unknown'} moved from ${lead.status} to ${status}.`;
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
    ];
}

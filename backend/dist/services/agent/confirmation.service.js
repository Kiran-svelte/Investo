"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAndResolvePendingConfirmation = checkAndResolvePendingConfirmation;
exports.createPendingConfirmation = createPendingConfirmation;
exports.cleanupExpiredConfirmations = cleanupExpiredConfirmations;
exports.executePendingAction = executePendingAction;
const prisma_1 = __importDefault(require("../../config/prisma"));
const logger_1 = __importDefault(require("../../config/logger"));
const agent_ai_constants_1 = require("../../constants/agent-ai.constants");
const db = prisma_1.default;
function normalized(text) {
    return text.trim().toLowerCase();
}
function matchesKeyword(text, keywords) {
    if (keywords.has(text))
        return true;
    for (const keyword of keywords) {
        if (keyword.includes(' ') && text.includes(keyword))
            return true;
    }
    return false;
}
function asRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : {};
}
function getString(params, key) {
    const value = params[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
async function checkAndResolvePendingConfirmation(sessionId, messageText) {
    const pending = await db.pendingAction.findFirst({
        where: { sessionId, status: 'awaiting', expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
    });
    if (!pending)
        return { hasPending: false };
    const result = {
        hasPending: true,
        actionType: pending.actionType,
        actionParams: asRecord(pending.actionParams),
        pendingActionId: pending.id,
        displayMessage: pending.displayMessage,
    };
    const text = normalized(messageText);
    if (matchesKeyword(text, agent_ai_constants_1.CONFIRMATION_POSITIVE_KEYWORDS)) {
        await db.pendingAction.update({
            where: { id: pending.id },
            data: { status: 'confirmed', resolvedAt: new Date() },
        });
        return { ...result, isConfirmed: true };
    }
    if (matchesKeyword(text, agent_ai_constants_1.CONFIRMATION_NEGATIVE_KEYWORDS)) {
        await db.pendingAction.update({
            where: { id: pending.id },
            data: { status: 'rejected', resolvedAt: new Date() },
        });
        return { ...result, isRejected: true };
    }
    return result;
}
async function createPendingConfirmation(sessionId, actionType, actionParams, displayMessage) {
    await db.pendingAction.updateMany({
        where: { sessionId, status: 'awaiting' },
        data: { status: 'expired', resolvedAt: new Date() },
    });
    const created = await db.pendingAction.create({
        data: {
            sessionId,
            actionType,
            actionParams: actionParams,
            displayMessage,
            status: 'awaiting',
            expiresAt: new Date(Date.now() + agent_ai_constants_1.CONFIRMATION_TTL_MS),
        },
    });
    return created.id;
}
async function cleanupExpiredConfirmations() {
    const result = await db.pendingAction.updateMany({
        where: { status: 'awaiting', expiresAt: { lt: new Date() } },
        data: { status: 'expired', resolvedAt: new Date() },
    });
    return result.count;
}
async function executePendingAction(pendingActionId) {
    const pending = await db.pendingAction.findUnique({
        where: { id: pendingActionId },
        include: { session: { select: { companyId: true } } },
    });
    if (!pending)
        return 'Confirmation not found.';
    if (pending.status !== 'confirmed')
        return 'Confirmation is not approved.';
    const params = asRecord(pending.actionParams);
    const companyId = pending.session.companyId;
    switch (pending.actionType) {
        case 'deleteLead':
            return deleteLead(companyId, params);
        case 'cancelVisit':
            return cancelVisit(companyId, params);
        case 'closeLeadLost':
            return closeLeadLost(companyId, params);
        case 'reassignLead':
            return reassignLead(companyId, params);
        case 'deactivateAgent':
            return deactivateAgent(companyId, params);
        case 'bulkUpdateVisits':
            return bulkUpdateVisits(companyId, params);
        default:
            logger_1.default.warn('Unsupported pending action confirmed', { actionType: pending.actionType });
            return `Unsupported action: ${pending.actionType}`;
    }
}
async function deleteLead(companyId, params) {
    const leadId = getString(params, 'leadId');
    if (!leadId)
        return 'Missing lead id.';
    const lead = await db.lead.findFirst({ where: { id: leadId, companyId }, select: { id: true, customerName: true } });
    if (!lead)
        return 'Lead not found or access denied.';
    await db.lead.delete({ where: { id: leadId } });
    return `Deleted lead ${lead.customerName ?? 'Unknown'}.`;
}
async function cancelVisit(companyId, params) {
    const visitId = getString(params, 'visitId');
    if (!visitId)
        return 'Missing visit id.';
    const visit = await db.visit.findFirst({
        where: { id: visitId, companyId },
        select: { id: true, status: true, lead: { select: { customerName: true } } },
    });
    if (!visit)
        return 'Visit not found or access denied.';
    if (visit.status === 'completed')
        return 'Cannot cancel a completed visit.';
    await db.visit.update({
        where: { id: visitId },
        data: { status: 'cancelled', notes: getString(params, 'reason') ?? 'Cancelled by Agent AI' },
    });
    return `Cancelled visit for ${visit.lead?.customerName ?? 'Unknown'}.`;
}
async function closeLeadLost(companyId, params) {
    const leadId = getString(params, 'leadId');
    if (!leadId)
        return 'Missing lead id.';
    const lead = await db.lead.findFirst({ where: { id: leadId, companyId }, select: { id: true, customerName: true } });
    if (!lead)
        return 'Lead not found or access denied.';
    await db.lead.update({ where: { id: leadId }, data: { status: 'closed_lost' } });
    return `Marked ${lead.customerName ?? 'Unknown'} as closed lost.`;
}
async function reassignLead(companyId, params) {
    const leadId = getString(params, 'leadId');
    const agentId = getString(params, 'agentId');
    if (!leadId || !agentId)
        return 'Missing lead or agent id.';
    const [lead, agent] = await Promise.all([
        db.lead.findFirst({ where: { id: leadId, companyId }, select: { id: true, customerName: true } }),
        db.user.findFirst({ where: { id: agentId, companyId, status: 'active' }, select: { id: true, name: true } }),
    ]);
    if (!lead)
        return 'Lead not found or access denied.';
    if (!agent)
        return 'Agent not found or inactive.';
    await db.lead.update({ where: { id: leadId }, data: { assignedAgentId: agentId } });
    return `Reassigned ${lead.customerName ?? 'Unknown'} to ${agent.name}.`;
}
async function deactivateAgent(companyId, params) {
    const agentId = getString(params, 'agentId');
    if (!agentId)
        return 'Missing agent id.';
    const user = await db.user.findFirst({ where: { id: agentId, companyId, status: 'active' }, select: { id: true, name: true } });
    if (!user)
        return 'User not found or already inactive.';
    await db.user.update({ where: { id: agentId }, data: { status: 'inactive' } });
    await db.agentSession.updateMany({ where: { userId: agentId, companyId }, data: { status: 'inactive' } });
    return `Deactivated ${user.name}.`;
}
async function bulkUpdateVisits(companyId, params) {
    const visitIds = Array.isArray(params.visitIds) ? params.visitIds.filter((id) => typeof id === 'string') : [];
    const status = getString(params, 'status');
    if (!visitIds.length || !status)
        return 'Missing visit ids or status.';
    const result = await db.visit.updateMany({ where: { id: { in: visitIds }, companyId }, data: { status: status } });
    return `Updated ${result.count} visit(s) to ${status}.`;
}

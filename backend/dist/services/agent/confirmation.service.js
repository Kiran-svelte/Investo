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
exports.checkAndResolvePendingConfirmation = checkAndResolvePendingConfirmation;
exports.createPendingConfirmation = createPendingConfirmation;
exports.cleanupExpiredConfirmations = cleanupExpiredConfirmations;
exports.executePendingAction = executePendingAction;
exports.handleAttendanceCheckRejected = handleAttendanceCheckRejected;
const prisma_1 = __importDefault(require("../../config/prisma"));
const logger_1 = __importDefault(require("../../config/logger"));
const agent_action_log_service_1 = require("../agent-action-log.service");
const agent_ai_constants_1 = require("../../constants/agent-ai.constants");
const visitState_service_1 = require("../visitState.service");
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
function visitStateErrorMessage(error) {
    switch (error) {
        case 'visit_completed':
            return 'This visit is already completed.';
        case 'visit_cancelled':
            return 'This visit is already cancelled.';
        case 'visit_no_show':
            return 'This visit is already marked as no-show.';
        case 'invalid_transition':
            return 'That visit status change is not allowed from the current state.';
        case 'lead_transition_failed':
            return 'The visit was completed, but the lead could not be moved to visited because the pipeline transition is invalid.';
        case 'visit_not_found':
            return 'Visit not found or access denied.';
        default:
            return 'Visit status could not be updated.';
    }
}
async function checkAndResolvePendingConfirmation(sessionId, messageText) {
    const pending = await prisma_1.default.pendingAction.findFirst({
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
        await prisma_1.default.pendingAction.update({
            where: { id: pending.id },
            data: { status: 'confirmed', resolvedAt: new Date() },
        });
        return { ...result, isConfirmed: true };
    }
    if (matchesKeyword(text, agent_ai_constants_1.CONFIRMATION_NEGATIVE_KEYWORDS)) {
        await prisma_1.default.pendingAction.update({
            where: { id: pending.id },
            data: { status: 'rejected', resolvedAt: new Date() },
        });
        return { ...result, isRejected: true };
    }
    return result;
}
async function createPendingConfirmation(sessionId, actionType, actionParams, displayMessage) {
    await prisma_1.default.pendingAction.updateMany({
        where: { sessionId, status: 'awaiting' },
        data: { status: 'expired', resolvedAt: new Date() },
    });
    const created = await prisma_1.default.pendingAction.create({
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
    const result = await prisma_1.default.pendingAction.updateMany({
        where: { status: 'awaiting', expiresAt: { lt: new Date() } },
        data: { status: 'expired', resolvedAt: new Date() },
    });
    return result.count;
}
async function executePendingAction(pendingActionId) {
    const pending = await prisma_1.default.pendingAction.findUnique({
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
        case 'attendance_check':
            return attendanceCheckYes(companyId, params);
        case 'deleteLead':
            return deleteLead(companyId, params);
        case 'cancelVisit':
            return cancelVisit(companyId, params);
        case 'completeVisit':
            return completeVisitConfirmed(companyId, params);
        case 'markVisitNoShow':
            return markVisitNoShowConfirmed(companyId, params);
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
/**
 * Handles NO reply on an attendance_check pending action.
 * Marks the visit as no_show and sends the customer an invitation to reschedule.
 * Called by agent-router when the agent's reply is rejected (NO).
 *
 * @param companyId - Company scope for authorization.
 * @param params - ActionParams from the PendingAction record.
 * @returns Confirmation message for the agent.
 */
async function handleAttendanceCheckRejected(companyId, params) {
    const visitId = getString(params, 'visitId');
    const customerPhone = getString(params, 'customerPhone');
    const customerName = getString(params, 'customerName') ?? 'Customer';
    const propertyName = getString(params, 'propertyName') ?? 'your property';
    if (visitId) {
        const result = await (0, visitState_service_1.markVisitNoShow)({
            companyId,
            visitId,
            notes: 'Agent reported customer did not attend.',
        });
        if (!result.success)
            return visitStateErrorMessage(result.error);
        logger_1.default.info('Attendance check: visit marked no_show via agent NO reply', { visitId, companyId });
        void (0, agent_action_log_service_1.logAgentAction)({
            companyId,
            triggeredBy: 'inbound_message',
            action: 'attendance_check_no',
            resourceType: 'visit',
            resourceId: visitId,
            status: 'success',
            result: 'Visit marked no_show after agent attendance rejection',
        });
    }
    else {
        return 'Missing visit id.';
    }
    if (customerPhone) {
        const rescheduleMsg = [
            `Hi ${customerName}! \uD83D\uDC4B`,
            ``,
            `We missed you at *${propertyName}* today. Hope all is well!`,
            ``,
            `Would you like to reschedule your visit? Just reply with a preferred date and time \uD83D\uDCC5`,
            `(e.g. "this Saturday 11am")`,
        ].join('\n');
        try {
            const { whatsappService } = await Promise.resolve().then(() => __importStar(require('../whatsapp.service')));
            await whatsappService.sendCompanyTextMessage(customerPhone, rescheduleMsg, companyId);
            logger_1.default.info('Sent reschedule invitation to customer after no-show', { customerPhone, companyId });
        }
        catch (err) {
            logger_1.default.warn('Failed to send reschedule invitation to customer', {
                customerPhone,
                companyId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return [
        `\u274C Marked as no-show.`,
        customerPhone
            ? `\nA reschedule invitation has been sent to ${customerName}.`
            : '',
    ].join('');
}
/**
 * Handles YES reply on an attendance_check pending action.
 * Marks the visit as completed and updates lead status to visited.
 *
 * @param companyId - Company scope for authorization.
 * @param params - ActionParams from the PendingAction record.
 * @returns Confirmation message for the agent.
 */
async function attendanceCheckYes(companyId, params) {
    const visitId = getString(params, 'visitId');
    const leadId = getString(params, 'leadId');
    const customerName = getString(params, 'customerName') ?? 'Customer';
    const propertyName = getString(params, 'propertyName') ?? 'Property';
    if (visitId) {
        const result = await (0, visitState_service_1.markVisitAttended)({
            companyId,
            visitId,
            notes: 'Attendance confirmed by assigned agent.',
        });
        if (!result.success)
            return visitStateErrorMessage(result.error);
        logger_1.default.info('Attendance check: visit marked completed via agent YES reply', { visitId, companyId });
        logger_1.default.info('Lead status updated to visited after attendance confirmation', { leadId, companyId });
        void (0, agent_action_log_service_1.logAgentAction)({
            companyId,
            triggeredBy: 'inbound_message',
            action: 'attendance_check_yes',
            resourceType: 'visit',
            resourceId: visitId,
            status: 'success',
            result: 'Visit marked completed after agent attendance confirmation',
        });
    }
    else {
        return 'Missing visit id.';
    }
    return [
        `\u2705 *Attendance confirmed!*`,
        ``,
        `Visit with *${customerName}* at *${propertyName}* marked as *completed*.`,
        `Lead status updated to *Visited*.`,
        ``,
        `To log notes or next steps, type "update lead ${customerName}".`,
    ].join('\n');
}
async function deleteLead(companyId, params) {
    const leadId = getString(params, 'leadId');
    if (!leadId)
        return 'Missing lead id.';
    const lead = await prisma_1.default.lead.findFirst({ where: { id: leadId, companyId }, select: { id: true, customerName: true } });
    if (!lead)
        return 'Lead not found or access denied.';
    // Soft-delete per project policy (rule 54): user-owned data uses deleted_at, not hard delete.
    // TODO(agent): verify — if Lead model gains a deletedAt column, switch to { deletedAt: new Date() }
    await prisma_1.default.lead.update({ where: { id: leadId }, data: { status: 'closed_lost' } });
    void (0, agent_action_log_service_1.logAgentAction)({
        companyId,
        triggeredBy: 'inbound_message',
        action: 'delete_lead_confirmed',
        resourceType: 'lead',
        resourceId: leadId,
        status: 'success',
        result: `Lead ${lead.customerName ?? 'Unknown'} marked closed_lost (soft delete)`,
    });
    return `Closed lead ${lead.customerName ?? 'Unknown'} (marked as lost).`;
}
async function completeVisitConfirmed(companyId, params) {
    const visitId = getString(params, 'visitId');
    if (!visitId)
        return 'Missing visit id.';
    const result = await (0, visitState_service_1.markVisitAttended)({
        companyId,
        visitId,
        notes: getString(params, 'notes') ?? undefined,
    });
    if (!result.success)
        return visitStateErrorMessage(result.error);
    const visit = await prisma_1.default.visit.findFirst({
        where: { id: visitId, companyId },
        include: { lead: { select: { customerName: true } }, property: { select: { name: true } } },
    });
    const customerName = visit?.lead?.customerName ?? 'Customer';
    const propertyName = visit?.property?.name ?? 'the property';
    void (0, agent_action_log_service_1.logAgentAction)({
        companyId,
        triggeredBy: 'inbound_message',
        action: 'complete_visit_confirmed',
        resourceType: 'visit',
        resourceId: visitId,
        status: 'success',
        result: `Visit completed for ${customerName} at ${propertyName}`,
    });
    return [
        `Visit with *${customerName}* at *${propertyName}* marked as *completed*.`,
        `Lead status updated to *Visited*.`,
    ].join('\n');
}
async function markVisitNoShowConfirmed(companyId, params) {
    const visitId = getString(params, 'visitId');
    if (!visitId)
        return 'Missing visit id.';
    const result = await (0, visitState_service_1.markVisitNoShow)({
        companyId,
        visitId,
        notes: getString(params, 'notes') ?? 'Marked no-show by agent.',
    });
    if (!result.success)
        return visitStateErrorMessage(result.error);
    const visit = await prisma_1.default.visit.findFirst({
        where: { id: visitId, companyId },
        include: { lead: { select: { customerName: true } } },
    });
    void (0, agent_action_log_service_1.logAgentAction)({
        companyId,
        triggeredBy: 'inbound_message',
        action: 'mark_no_show_confirmed',
        resourceType: 'visit',
        resourceId: visitId,
        status: 'success',
        result: `Visit marked no-show for ${visit?.lead?.customerName ?? 'customer'}`,
    });
    return `Marked ${visit?.lead?.customerName ?? 'customer'}'s visit as no-show.`;
}
async function cancelVisit(companyId, params) {
    const visitId = getString(params, 'visitId');
    if (!visitId)
        return 'Missing visit id.';
    const visit = await prisma_1.default.visit.findFirst({
        where: { id: visitId, companyId },
        select: { id: true, status: true, lead: { select: { customerName: true } } },
    });
    if (!visit)
        return 'Visit not found or access denied.';
    if (visit.status === 'completed')
        return 'Cannot cancel a completed visit.';
    const result = await (0, visitState_service_1.cancelVisitById)({
        companyId,
        visitId,
        notes: getString(params, 'reason') ?? 'Cancelled by Agent AI',
    });
    if (!result.success)
        return visitStateErrorMessage(result.error);
    void (0, agent_action_log_service_1.logAgentAction)({
        companyId,
        triggeredBy: 'inbound_message',
        action: 'cancel_visit_confirmed',
        resourceType: 'visit',
        resourceId: visitId,
        status: 'success',
        result: `Visit cancelled for ${visit.lead?.customerName ?? 'Unknown'}`,
    });
    return `Cancelled visit for ${visit.lead?.customerName ?? 'Unknown'}.`;
}
async function closeLeadLost(companyId, params) {
    const leadId = getString(params, 'leadId');
    if (!leadId)
        return 'Missing lead id.';
    const lead = await prisma_1.default.lead.findFirst({ where: { id: leadId, companyId }, select: { id: true, customerName: true } });
    if (!lead)
        return 'Lead not found or access denied.';
    await prisma_1.default.lead.update({ where: { id: leadId }, data: { status: 'closed_lost' } });
    void (0, agent_action_log_service_1.logAgentAction)({
        companyId,
        triggeredBy: 'inbound_message',
        action: 'close_lead_lost_confirmed',
        resourceType: 'lead',
        resourceId: leadId,
        status: 'success',
        result: `Lead ${lead.customerName ?? 'Unknown'} closed as lost`,
    });
    return `Marked ${lead.customerName ?? 'Unknown'} as closed lost.`;
}
async function reassignLead(companyId, params) {
    // Bulk portfolio transfer mode
    if (params.bulkTransfer === true) {
        const fromAgentId = getString(params, 'fromAgentId');
        const toAgentId = getString(params, 'toAgentId');
        if (!fromAgentId || !toAgentId)
            return 'Missing fromAgentId or toAgentId.';
        const [fromAgent, toAgent] = await Promise.all([
            prisma_1.default.user.findFirst({ where: { id: fromAgentId, companyId }, select: { id: true, name: true } }),
            prisma_1.default.user.findFirst({ where: { id: toAgentId, companyId, status: 'active' }, select: { id: true, name: true } }),
        ]);
        if (!fromAgent)
            return 'Source agent not found.';
        if (!toAgent)
            return 'Target agent not found or inactive.';
        const result = await prisma_1.default.lead.updateMany({
            where: { companyId, assignedAgentId: fromAgentId, status: { notIn: ['closed_won', 'closed_lost'] } },
            data: { assignedAgentId: toAgentId },
        });
        return `Transferred ${result.count} lead(s) from ${fromAgent.name} to ${toAgent.name}.`;
    }
    // Single lead reassign mode
    const leadId = getString(params, 'leadId');
    const agentId = getString(params, 'agentId');
    if (!leadId || !agentId)
        return 'Missing lead or agent id.';
    const [lead, agent] = await Promise.all([
        prisma_1.default.lead.findFirst({ where: { id: leadId, companyId }, select: { id: true, customerName: true } }),
        prisma_1.default.user.findFirst({ where: { id: agentId, companyId, status: 'active' }, select: { id: true, name: true } }),
    ]);
    if (!lead)
        return 'Lead not found or access denied.';
    if (!agent)
        return 'Agent not found or inactive.';
    await prisma_1.default.lead.update({ where: { id: leadId }, data: { assignedAgentId: agentId } });
    return `Reassigned ${lead.customerName ?? 'Unknown'} to ${agent.name}.`;
}
async function deactivateAgent(companyId, params) {
    const agentId = getString(params, 'agentId');
    if (!agentId)
        return 'Missing agent id.';
    const user = await prisma_1.default.user.findFirst({ where: { id: agentId, companyId, status: 'active' }, select: { id: true, name: true } });
    if (!user)
        return 'User not found or already inactive.';
    await prisma_1.default.user.update({ where: { id: agentId }, data: { status: 'inactive' } });
    await prisma_1.default.agentSession.updateMany({ where: { userId: agentId, companyId }, data: { status: 'inactive' } });
    return `Deactivated ${user.name}.`;
}
async function bulkUpdateVisits(companyId, params) {
    const visitIds = Array.isArray(params.visitIds)
        ? params.visitIds.filter((id) => typeof id === 'string')
        : [];
    if (!visitIds.length)
        return 'Missing visit ids.';
    // Reassign mode: toAgentId provided
    const toAgentId = getString(params, 'toAgentId');
    if (toAgentId) {
        const agent = await prisma_1.default.user.findFirst({
            where: { id: toAgentId, companyId, status: 'active' },
            select: { id: true, name: true },
        });
        if (!agent)
            return 'Target agent not found or inactive.';
        const result = await prisma_1.default.visit.updateMany({
            where: { id: { in: visitIds }, companyId },
            data: { agentId: toAgentId },
        });
        return `Reassigned ${result.count} visit(s) to ${agent.name}.`;
    }
    // Snooze mode: postponeByDays provided
    const postponeByDaysRaw = params.postponeByDays;
    const postponeByDays = typeof postponeByDaysRaw === 'number' ? postponeByDaysRaw : null;
    if (postponeByDays !== null && postponeByDays > 0) {
        const visits = await prisma_1.default.visit.findMany({
            where: { id: { in: visitIds }, companyId },
            select: { id: true, scheduledAt: true },
        });
        let count = 0;
        for (const visit of visits) {
            const newTime = new Date(visit.scheduledAt.getTime() + postponeByDays * 24 * 60 * 60 * 1000);
            await prisma_1.default.visit.update({
                where: { id: visit.id },
                data: { scheduledAt: newTime, reminderSent: false },
            });
            count += 1;
        }
        return `Postponed ${count} visit(s) by ${postponeByDays} day(s).`;
    }
    // Status update mode
    const status = getString(params, 'status');
    if (!status)
        return 'Missing toAgentId, postponeByDays, or status.';
    const result = await prisma_1.default.visit.updateMany({
        where: { id: { in: visitIds }, companyId },
        data: { status: status },
    });
    return `Updated ${result.count} visit(s) to ${status}.`;
}

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.canTransitionLeadToVisitScheduledStatus = canTransitionLeadToVisitScheduledStatus;
exports.transitionLeadStatus = transitionLeadStatus;
exports.transitionLeadToVisitScheduled = transitionLeadToVisitScheduled;
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const validation_1 = require("../models/validation");
const socket_service_1 = require("./socket.service");
function canTransitionLeadToVisitScheduledStatus(status) {
    if (!status || !validation_1.LEAD_STATUSES.includes(status)) {
        return false;
    }
    const current = status;
    if (current === 'new') {
        return ((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'new', 'contacted') &&
            (0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'contacted', 'visit_scheduled'));
    }
    return (0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, current, 'visit_scheduled');
}
/**
 * Updates lead status only when the transition is valid per LEAD_TRANSITIONS.
 */
async function transitionLeadStatus(leadId, targetStatus, extra) {
    const lead = await prisma_1.default.lead.findUnique({ where: { id: leadId } });
    if (!lead) {
        return false;
    }
    const current = lead.status;
    if (current === targetStatus) {
        return true;
    }
    const allowReopen = current === 'closed_lost' && targetStatus === 'contacted';
    if (!extra?.force
        && !allowReopen
        && !(0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, current, targetStatus)) {
        logger_1.default.warn('Invalid lead status transition skipped', {
            leadId,
            from: current,
            to: targetStatus,
        });
        return false;
    }
    const updatedLead = await prisma_1.default.lead.update({
        where: { id: leadId },
        data: {
            status: targetStatus,
            ...(extra?.lastContactAt !== false && { lastContactAt: new Date() }),
        },
        select: { id: true, companyId: true, status: true },
    });
    // Real-time dashboard update for automatic transitions
    socket_service_1.socketService.emitToCompany(updatedLead.companyId, socket_service_1.SOCKET_EVENTS.LEAD_UPDATED, {
        lead: { id: updatedLead.id, status: updatedLead.status },
    });
    return true;
}
/** Chains valid transitions so a visit can be booked from `new` or `contacted`. */
async function transitionLeadToVisitScheduled(leadId) {
    const lead = await prisma_1.default.lead.findUnique({ where: { id: leadId } });
    if (!lead) {
        return false;
    }
    if (lead.status === 'visit_scheduled') {
        return true;
    }
    if (lead.status === 'new') {
        const contacted = await transitionLeadStatus(leadId, 'contacted');
        if (!contacted) {
            return false;
        }
    }
    return transitionLeadStatus(leadId, 'visit_scheduled');
}

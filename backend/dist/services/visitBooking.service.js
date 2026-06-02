"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleVisit = scheduleVisit;
exports.scheduleVisitFromWhatsApp = scheduleVisitFromWhatsApp;
exports.parseVisitTimeInteractiveId = parseVisitTimeInteractiveId;
exports.resolveVisitSlotToDate = resolveVisitSlotToDate;
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const leadAssignment_service_1 = require("./leadAssignment.service");
const leadTransition_service_1 = require("./leadTransition.service");
const notification_engine_1 = require("./notification.engine");
/**
 * Books a site visit (REST API, WhatsApp, or automation) with shared validation rules.
 */
async function scheduleVisit(input) {
    const { companyId, leadId, propertyId, scheduledAt, durationMinutes = 60, notes, agentId: inputAgentId } = input;
    const now = new Date();
    if (scheduledAt <= now) {
        return { success: false, error: 'past_date' };
    }
    const lead = await prisma_1.default.lead.findFirst({
        where: { id: leadId, companyId },
    });
    if (!lead) {
        return { success: false, error: 'lead_not_found' };
    }
    if (!(0, leadTransition_service_1.canTransitionLeadToVisitScheduledStatus)(lead.status)) {
        return { success: false, error: 'invalid_lead_transition' };
    }
    const property = await prisma_1.default.property.findFirst({
        where: { id: propertyId, companyId, status: 'available' },
    });
    if (!property) {
        return { success: false, error: 'property_not_found' };
    }
    let agentId = inputAgentId || lead.assignedAgentId;
    if (!agentId) {
        agentId = await (0, leadAssignment_service_1.assignLeadRoundRobin)(companyId);
        if (!agentId) {
            return { success: false, error: 'no_agent' };
        }
        await prisma_1.default.lead.update({
            where: { id: leadId },
            data: { assignedAgentId: agentId },
        });
    }
    const visitStart = scheduledAt.getTime();
    const visitEnd = visitStart + durationMinutes * 60 * 1000;
    const bufferStart = new Date(visitStart - 60 * 60 * 1000);
    const bufferEnd = new Date(visitEnd + 60 * 60 * 1000);
    const conflicts = await prisma_1.default.visit.findMany({
        where: {
            agentId,
            companyId,
            status: { not: 'cancelled' },
            scheduledAt: { gte: bufferStart, lte: bufferEnd },
        },
        select: { id: true, scheduledAt: true },
    });
    if (conflicts.length > 0) {
        return {
            success: false,
            error: 'agent_conflict',
            conflicts: conflicts.map((c) => ({ id: c.id, scheduledAt: c.scheduledAt })),
        };
    }
    const agent = await prisma_1.default.user.findFirst({
        where: { id: agentId, companyId, status: 'active' },
    });
    if (!agent) {
        return { success: false, error: 'no_agent' };
    }
    const visit = await prisma_1.default.visit.create({
        data: {
            companyId,
            leadId,
            propertyId,
            agentId,
            scheduledAt,
            durationMinutes,
            status: 'scheduled',
            notes: notes || null,
            reminderSent: false,
        },
    });
    await (0, leadTransition_service_1.transitionLeadToVisitScheduled)(leadId);
    await notification_engine_1.notificationEngine.onVisitScheduled(visit, lead, property, agent);
    logger_1.default.info('Visit scheduled', {
        visitId: visit.id,
        leadId,
        propertyId,
        agentId,
        source: inputAgentId ? 'api' : 'whatsapp',
    });
    return {
        success: true,
        visit: {
            id: visit.id,
            scheduledAt: visit.scheduledAt,
            agentId: visit.agentId,
            propertyId: visit.propertyId,
            leadId: visit.leadId,
            companyId: visit.companyId,
            durationMinutes: visit.durationMinutes,
            status: visit.status,
            notes: visit.notes,
        },
    };
}
/** @deprecated Use scheduleVisit — kept for call-site clarity. */
async function scheduleVisitFromWhatsApp(input) {
    return scheduleVisit(input);
}
/** Parse visit-time-{propertyUuid}-{slotSuffix} without breaking UUID hyphens. */
function parseVisitTimeInteractiveId(interactiveId) {
    const prefix = 'visit-time-';
    if (!interactiveId.startsWith(prefix))
        return null;
    const rest = interactiveId.slice(prefix.length);
    const slotSuffixes = ['tomorrow-10am', 'tomorrow-3pm', 'dayafter'];
    for (const slot of slotSuffixes) {
        const suffix = `-${slot}`;
        if (rest.endsWith(suffix)) {
            const propertyId = rest.slice(0, -suffix.length);
            if (propertyId.length >= 32) {
                return { propertyId, slot };
            }
        }
    }
    return null;
}
function resolveVisitSlotToDate(slot) {
    const proposedTime = new Date();
    if (slot.includes('tomorrow')) {
        proposedTime.setDate(proposedTime.getDate() + 1);
        if (slot.includes('10am'))
            proposedTime.setHours(10, 0, 0, 0);
        else if (slot.includes('3pm'))
            proposedTime.setHours(15, 0, 0, 0);
        else
            proposedTime.setHours(11, 0, 0, 0);
    }
    else if (slot.includes('dayafter')) {
        proposedTime.setDate(proposedTime.getDate() + 2);
        proposedTime.setHours(11, 0, 0, 0);
    }
    return proposedTime;
}

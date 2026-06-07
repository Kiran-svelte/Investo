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
exports.buildVisitIdempotencyKey = buildVisitIdempotencyKey;
exports.scheduleVisit = scheduleVisit;
exports.scheduleVisitFromWhatsApp = scheduleVisitFromWhatsApp;
exports.parseVisitTimeInteractiveId = parseVisitTimeInteractiveId;
exports.resolveVisitSlotToDate = resolveVisitSlotToDate;
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const leadAssignment_service_1 = require("./leadAssignment.service");
const leadTransition_service_1 = require("./leadTransition.service");
const notification_engine_1 = require("./notification.engine");
const visitLifecycle_service_1 = require("./visitLifecycle.service");
const opsMetrics_service_1 = require("./opsMetrics.service");
/** Shared visit booking idempotency key shape (workflow + commit + tools). */
function buildVisitIdempotencyKey(companyId, leadId, scheduledAtISO) {
    return `visit_book:${companyId}:${leadId}:${scheduledAtISO}`;
}
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
    const idemKey = input.idempotencyKey
        ?? buildVisitIdempotencyKey(companyId, leadId, scheduledAt.toISOString());
    const { deduplicationService } = await Promise.resolve().then(() => __importStar(require('./deduplication.service')));
    const redisKey = `visit-idem:${idemKey}`;
    // 86400s (24h) matches Meta's maximum webhook re-delivery window.
    const claimed = await deduplicationService.claimMessageProcessing(redisKey, 86400);
    if (!claimed) {
        const duplicate = await prisma_1.default.visit.findFirst({
            where: {
                companyId,
                leadId,
                scheduledAt,
                status: { in: ['scheduled', 'confirmed'] },
            },
            orderBy: { createdAt: 'desc' },
        });
        if (duplicate) {
            (0, opsMetrics_service_1.incrementOpsMetric)('visit_idem_hit');
            logger_1.default.info('scheduleVisit: idempotency hit (Redis), returning existing visit', {
                companyId,
                leadId,
                visitId: duplicate.id,
                idemKey,
            });
            return {
                success: true,
                visit: {
                    id: duplicate.id,
                    scheduledAt: duplicate.scheduledAt,
                    agentId: duplicate.agentId,
                    propertyId: duplicate.propertyId,
                    leadId: duplicate.leadId,
                    companyId: duplicate.companyId,
                    durationMinutes: duplicate.durationMinutes,
                    status: duplicate.status,
                    notes: duplicate.notes,
                },
            };
        }
    }
    const existingSameSlot = await prisma_1.default.visit.findFirst({
        where: {
            companyId,
            leadId,
            scheduledAt,
            status: { in: ['scheduled', 'confirmed'] },
        },
    });
    if (existingSameSlot) {
        (0, opsMetrics_service_1.incrementOpsMetric)('visit_idem_hit');
        logger_1.default.info('scheduleVisit: idempotency hit (DB unique slot), returning existing visit', {
            companyId,
            leadId,
            visitId: existingSameSlot.id,
        });
        return {
            success: true,
            visit: {
                id: existingSameSlot.id,
                scheduledAt: existingSameSlot.scheduledAt,
                agentId: existingSameSlot.agentId,
                propertyId: existingSameSlot.propertyId,
                leadId: existingSameSlot.leadId,
                companyId: existingSameSlot.companyId,
                durationMinutes: existingSameSlot.durationMinutes,
                status: existingSameSlot.status,
                notes: existingSameSlot.notes,
            },
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
    (0, visitLifecycle_service_1.emitVisitCreated)(companyId, visit);
    void (0, visitLifecycle_service_1.scheduleVisitReminderJobs)(visit.id, visit.scheduledAt, companyId, leadId);
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

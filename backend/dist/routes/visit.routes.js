"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const tenant_1 = require("../middleware/tenant");
const audit_1 = require("../middleware/audit");
const validate_1 = require("../middleware/validate");
const featureGate_1 = require("../middleware/featureGate");
const validation_1 = require("../models/validation");
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const notification_engine_1 = require("../services/notification.engine");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.use(tenant_1.tenantIsolation);
router.use((0, featureGate_1.requireFeature)('visit_scheduling'));
/**
 * GET /api/visits
 * List visits. Sales agents see only their visits.
 */
router.get('/', (0, rbac_1.authorize)('visits', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const where = { companyId };
        // Sales agent: only their visits
        if (req.user.role === 'sales_agent') {
            where.agentId = req.user.id;
        }
        // Date range filter
        const { from, to, status, agent_id } = req.query;
        if (from)
            where.scheduledAt = { ...where.scheduledAt, gte: new Date(from) };
        if (to)
            where.scheduledAt = { ...where.scheduledAt, lte: new Date(to) };
        if (status)
            where.status = status;
        if (agent_id)
            where.agentId = agent_id;
        const visits = await prisma_1.default.visit.findMany({
            where,
            include: {
                lead: { select: { customerName: true, phone: true } },
                property: { select: { name: true, locationArea: true } },
                agent: { select: { name: true } },
            },
            orderBy: { scheduledAt: 'asc' },
        });
        const data = visits.map(({ lead, property, agent, ...v }) => ({
            ...v,
            customer_name: lead?.customerName || null,
            customer_phone: lead?.phone || null,
            property_name: property?.name || null,
            property_area: property?.locationArea || null,
            agent_name: agent?.name || null,
        }));
        res.json({ data, total: data.length });
    }
    catch (err) {
        logger_1.default.error('Failed to fetch visits', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch visits' });
    }
});
/**
 * GET /api/visits/:id
 */
router.get('/:id', (0, rbac_1.authorize)('visits', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const visit = await prisma_1.default.visit.findFirst({
            where: { id: req.params.id, companyId },
            include: {
                lead: { select: { customerName: true, phone: true } },
                property: { select: { name: true } },
                agent: { select: { name: true } },
            },
        });
        if (!visit) {
            res.status(404).json({ error: 'Visit not found' });
            return;
        }
        if (req.user.role === 'sales_agent' && visit.agentId !== req.user.id) {
            res.status(403).json({ error: 'Can only view assigned visits' });
            return;
        }
        const { lead, property, agent, ...visitData } = visit;
        res.json({
            data: {
                ...visitData,
                customer_name: lead?.customerName || null,
                customer_phone: lead?.phone || null,
                property_name: property?.name || null,
                agent_name: agent?.name || null,
            },
        });
    }
    catch (err) {
        logger_1.default.error('Failed to fetch visit', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch visit' });
    }
});
/**
 * POST /api/visits
 * Schedule a visit. Enforces:
 * - Cannot schedule in the past
 * - Cannot double-book agent (60 min gap)
 */
router.post('/', (0, rbac_1.authorize)('visits', 'create'), (0, validate_1.validate)(validation_1.createVisitSchema), (0, audit_1.auditLog)('create', 'visits'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const { lead_id, property_id, agent_id, scheduled_at, duration_minutes, notes } = req.body;
        const scheduledDate = new Date(scheduled_at);
        const now = new Date();
        // FORBIDDEN: Cannot schedule in the past
        if (scheduledDate <= now) {
            res.status(400).json({ error: 'Cannot schedule visits in the past' });
            return;
        }
        // FORBIDDEN: Cannot double-book agent (60 min gap)
        const duration = duration_minutes || 60;
        const visitStart = scheduledDate.getTime();
        const visitEnd = visitStart + duration * 60 * 1000;
        const bufferStart = new Date(visitStart - 60 * 60 * 1000);
        const bufferEnd = new Date(visitEnd + 60 * 60 * 1000);
        const conflicts = await prisma_1.default.visit.findMany({
            where: {
                agentId: agent_id,
                companyId,
                status: { not: 'cancelled' },
                scheduledAt: { gte: bufferStart, lte: bufferEnd },
            },
        });
        if (conflicts.length > 0) {
            res.status(409).json({
                error: 'Agent has a conflicting visit within 60 minutes of this time slot',
                conflicts: conflicts.map((c) => ({
                    id: c.id,
                    scheduled_at: c.scheduledAt,
                })),
            });
            return;
        }
        // Verify lead exists in same company
        const lead = await prisma_1.default.lead.findFirst({ where: { id: lead_id, companyId } });
        if (!lead) {
            res.status(404).json({ error: 'Lead not found' });
            return;
        }
        // Verify agent exists in same company
        const agent = await prisma_1.default.user.findFirst({ where: { id: agent_id, companyId, status: 'active' } });
        if (!agent) {
            res.status(404).json({ error: 'Agent not found' });
            return;
        }
        const visit = await prisma_1.default.visit.create({
            data: {
                companyId,
                leadId: lead_id,
                propertyId: property_id || null,
                agentId: agent_id,
                scheduledAt: scheduledDate,
                durationMinutes: duration,
                status: 'scheduled',
                notes: notes || null,
                reminderSent: false,
            },
        });
        // Auto-update lead status to visit_scheduled if currently contacted
        if (lead.status === 'contacted') {
            await prisma_1.default.lead.update({
                where: { id: lead_id },
                data: { status: 'visit_scheduled' },
            });
        }
        const property = property_id
            ? await prisma_1.default.property.findFirst({ where: { id: property_id, companyId } })
            : null;
        await notification_engine_1.notificationEngine.onVisitScheduled(visit, lead, property, agent);
        res.status(201).json({ data: visit, id: visit.id });
    }
    catch (err) {
        logger_1.default.error('Failed to create visit', { error: err.message });
        res.status(500).json({ error: 'Failed to create visit' });
    }
});
/**
 * PATCH /api/visits/:id/status
 * Update visit status. Enforces state machine.
 */
router.patch('/:id/status', (0, rbac_1.authorize)('visits', 'update'), (0, validate_1.validate)(validation_1.updateVisitStatusSchema), (0, audit_1.auditLog)('status_change', 'visits'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const { id } = req.params;
        const { status: newStatus } = req.body;
        const visit = await prisma_1.default.visit.findFirst({ where: { id, companyId } });
        if (!visit) {
            res.status(404).json({ error: 'Visit not found' });
            return;
        }
        if (req.user.role === 'sales_agent' && visit.agentId !== req.user.id) {
            res.status(403).json({ error: 'Can only update assigned visits' });
            return;
        }
        const current = visit.status;
        const target = newStatus;
        if (!(0, validation_1.isValidTransition)(validation_1.VISIT_TRANSITIONS, current, target)) {
            res.status(400).json({
                error: `Invalid visit status transition: ${current} -> ${target}`,
                allowed: validation_1.VISIT_TRANSITIONS[current],
            });
            return;
        }
        const updated = await prisma_1.default.visit.update({
            where: { id },
            data: { status: target },
        });
        const leadForNotification = await prisma_1.default.lead.findFirst({
            where: { id: visit.leadId, companyId },
        });
        const company = await prisma_1.default.company.findFirst({
            where: { id: companyId },
            select: { whatsappPhone: true, settings: true },
        });
        await notification_engine_1.notificationEngine.onVisitStatusChange(updated, current, target, leadForNotification, company);
        // Auto-update lead status based on visit outcome
        if (target === 'completed' || target === 'no_show') {
            const lead = await prisma_1.default.lead.findFirst({ where: { id: visit.leadId } });
            if (lead && lead.status === 'visit_scheduled') {
                await prisma_1.default.lead.update({
                    where: { id: visit.leadId },
                    data: { status: 'visited' },
                });
            }
        }
        // If visit cancelled, revert lead to contacted
        if (target === 'cancelled') {
            const lead = await prisma_1.default.lead.findFirst({ where: { id: visit.leadId } });
            if (lead && lead.status === 'visit_scheduled') {
                await prisma_1.default.lead.update({
                    where: { id: visit.leadId },
                    data: { status: 'contacted' },
                });
            }
        }
        res.json({ data: updated });
    }
    catch (err) {
        logger_1.default.error('Failed to update visit status', { error: err.message });
        res.status(500).json({ error: 'Failed to update visit status' });
    }
});
/**
 * PUT /api/visits/:id
 * Reschedule a visit (change time/agent).
 */
router.put('/:id', (0, rbac_1.authorize)('visits', 'update'), (0, audit_1.auditLog)('reschedule', 'visits'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const { id } = req.params;
        const visit = await prisma_1.default.visit.findFirst({ where: { id, companyId } });
        if (!visit) {
            res.status(404).json({ error: 'Visit not found' });
            return;
        }
        // Can only reschedule scheduled or confirmed visits
        if (!['scheduled', 'confirmed'].includes(visit.status)) {
            res.status(400).json({ error: 'Can only reschedule scheduled or confirmed visits' });
            return;
        }
        const { scheduled_at, agent_id, notes, property_id } = req.body;
        if (agent_id) {
            const targetAgent = await prisma_1.default.user.findFirst({
                where: { id: agent_id, companyId, status: 'active' },
            });
            if (!targetAgent) {
                res.status(404).json({ error: 'Agent not found' });
                return;
            }
        }
        const oldTime = visit.scheduledAt;
        if (scheduled_at) {
            const scheduledDate = new Date(scheduled_at);
            if (scheduledDate <= new Date()) {
                res.status(400).json({ error: 'Cannot schedule visits in the past' });
                return;
            }
            // Check agent conflicts for new time
            const targetAgent = agent_id || visit.agentId;
            const duration = visit.durationMinutes || 60;
            const visitStart = scheduledDate.getTime();
            const visitEnd = visitStart + duration * 60 * 1000;
            const bufferStart = new Date(visitStart - 60 * 60 * 1000);
            const bufferEnd = new Date(visitEnd + 60 * 60 * 1000);
            const conflicts = await prisma_1.default.visit.findMany({
                where: {
                    agentId: targetAgent,
                    companyId,
                    id: { not: id },
                    status: { not: 'cancelled' },
                    scheduledAt: { gte: bufferStart, lte: bufferEnd },
                },
            });
            if (conflicts.length > 0) {
                res.status(409).json({ error: 'Agent has a conflicting visit within 60 minutes' });
                return;
            }
        }
        const updated = await prisma_1.default.visit.update({
            where: { id },
            data: {
                ...(scheduled_at && { scheduledAt: new Date(scheduled_at) }),
                ...(agent_id && { agentId: agent_id }),
                ...(notes !== undefined && { notes }),
                ...(property_id !== undefined && { propertyId: property_id }),
                reminderSent: false,
            },
        });
        if (scheduled_at) {
            const leadForNotification = await prisma_1.default.lead.findFirst({
                where: { id: visit.leadId, companyId },
            });
            const company = await prisma_1.default.company.findFirst({
                where: { id: companyId },
                select: { whatsappPhone: true, settings: true },
            });
            await notification_engine_1.notificationEngine.onVisitRescheduled(updated, oldTime, new Date(scheduled_at), leadForNotification, company);
        }
        res.json({ data: updated });
    }
    catch (err) {
        logger_1.default.error('Failed to reschedule visit', { error: err.message });
        res.status(500).json({ error: 'Failed to reschedule visit' });
    }
});
exports.default = router;
//# sourceMappingURL=visit.routes.js.map
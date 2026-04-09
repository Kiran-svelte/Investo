import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import { auditLog } from '../middleware/audit';
import { validate } from '../middleware/validate';
import { requireFeature } from '../middleware/featureGate';
import { createVisitSchema, updateVisitStatusSchema, isValidTransition, VISIT_TRANSITIONS, VisitStatus } from '../models/validation';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { notificationEngine } from '../services/notification.engine';

const router = Router();

router.use(authenticate);
router.use(tenantIsolation);
router.use(requireFeature('visit_scheduling'));

/**
 * GET /api/visits
 * List visits. Sales agents see only their visits.
 */
router.get(
  '/',
  authorize('visits', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const where: any = { companyId };

      // Sales agent: only their visits
      if (req.user!.role === 'sales_agent') {
        where.agentId = req.user!.id;
      }

      // Date range filter
      const { from, to, status, agent_id } = req.query;
      if (from) where.scheduledAt = { ...where.scheduledAt, gte: new Date(from as string) };
      if (to) where.scheduledAt = { ...where.scheduledAt, lte: new Date(to as string) };
      if (status) where.status = status as string;
      if (agent_id) where.agentId = agent_id as string;

      const visits = await prisma.visit.findMany({
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
    } catch (err: any) {
      logger.error('Failed to fetch visits', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch visits' });
    }
  }
);

/**
 * GET /api/visits/:id
 */
router.get(
  '/:id',
  authorize('visits', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const visit = await prisma.visit.findFirst({
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

      if (req.user!.role === 'sales_agent' && visit.agentId !== req.user!.id) {
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
    } catch (err: any) {
      logger.error('Failed to fetch visit', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch visit' });
    }
  }
);

/**
 * POST /api/visits
 * Schedule a visit. Enforces:
 * - Cannot schedule in the past
 * - Cannot double-book agent (60 min gap)
 */
router.post(
  '/',
  authorize('visits', 'create'),
  validate(createVisitSchema),
  auditLog('create', 'visits'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
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

      const conflicts = await prisma.visit.findMany({
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
      const lead = await prisma.lead.findFirst({ where: { id: lead_id, companyId } });
      if (!lead) {
        res.status(404).json({ error: 'Lead not found' });
        return;
      }

      // Verify agent exists in same company
      const agent = await prisma.user.findFirst({ where: { id: agent_id, companyId, status: 'active' } });
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      const visit = await prisma.visit.create({
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
        await prisma.lead.update({
          where: { id: lead_id },
          data: { status: 'visit_scheduled' },
        });
      }
      const property = property_id
        ? await prisma.property.findFirst({ where: { id: property_id, companyId } })
        : null;
      await notificationEngine.onVisitScheduled(visit, lead, property, agent);

      res.status(201).json({ data: visit, id: visit.id });
    } catch (err: any) {
      logger.error('Failed to create visit', { error: err.message });
      res.status(500).json({ error: 'Failed to create visit' });
    }
  }
);

/**
 * PATCH /api/visits/:id/status
 * Update visit status. Enforces state machine.
 */
router.patch(
  '/:id/status',
  authorize('visits', 'update'),
  validate(updateVisitStatusSchema),
  auditLog('status_change', 'visits'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;
      const { status: newStatus } = req.body;

      const visit = await prisma.visit.findFirst({ where: { id, companyId } });
      if (!visit) {
        res.status(404).json({ error: 'Visit not found' });
        return;
      }

      if (req.user!.role === 'sales_agent' && visit.agentId !== req.user!.id) {
        res.status(403).json({ error: 'Can only update assigned visits' });
        return;
      }

      const current = visit.status as VisitStatus;
      const target = newStatus as VisitStatus;

      if (!isValidTransition(VISIT_TRANSITIONS, current, target)) {
        res.status(400).json({
          error: `Invalid visit status transition: ${current} -> ${target}`,
          allowed: VISIT_TRANSITIONS[current],
        });
        return;
      }

      const updated = await prisma.visit.update({
        where: { id },
        data: { status: target },
      });
      const leadForNotification = await prisma.lead.findFirst({
        where: { id: visit.leadId, companyId },
      });
      const company = await prisma.company.findFirst({
        where: { id: companyId },
        select: { whatsappPhone: true, settings: true },
      });
      await notificationEngine.onVisitStatusChange(
        updated,
        current,
        target,
        leadForNotification,
        company
      );

      // Auto-update lead status based on visit outcome
      if (target === 'completed' || target === 'no_show') {
        const lead = await prisma.lead.findFirst({ where: { id: visit.leadId } });
        if (lead && lead.status === 'visit_scheduled') {
          await prisma.lead.update({
            where: { id: visit.leadId },
            data: { status: 'visited' },
          });
        }
      }

      // If visit cancelled, revert lead to contacted
      if (target === 'cancelled') {
        const lead = await prisma.lead.findFirst({ where: { id: visit.leadId } });
        if (lead && lead.status === 'visit_scheduled') {
          await prisma.lead.update({
            where: { id: visit.leadId },
            data: { status: 'contacted' },
          });
        }
      }

      res.json({ data: updated });
    } catch (err: any) {
      logger.error('Failed to update visit status', { error: err.message });
      res.status(500).json({ error: 'Failed to update visit status' });
    }
  }
);

/**
 * PUT /api/visits/:id
 * Reschedule a visit (change time/agent).
 */
router.put(
  '/:id',
  authorize('visits', 'update'),
  auditLog('reschedule', 'visits'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;

      const visit = await prisma.visit.findFirst({ where: { id, companyId } });
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
        const targetAgent = await prisma.user.findFirst({
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

        const conflicts = await prisma.visit.findMany({
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

      const updated = await prisma.visit.update({
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
        const leadForNotification = await prisma.lead.findFirst({
          where: { id: visit.leadId, companyId },
        });
        const company = await prisma.company.findFirst({
          where: { id: companyId },
          select: { whatsappPhone: true, settings: true },
        });
        await notificationEngine.onVisitRescheduled(
          updated,
          oldTime,
          new Date(scheduled_at),
          leadForNotification,
          company
        );
      }

      res.json({ data: updated });
    } catch (err: any) {
      logger.error('Failed to reschedule visit', { error: err.message });
      res.status(500).json({ error: 'Failed to reschedule visit' });
    }
  }
);

export default router;

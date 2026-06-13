import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { strictTenantIsolation, getCompanyId } from '../middleware/tenant';
import { auditLog } from '../middleware/audit';
import { validate } from '../middleware/validate';
import { requireFeature } from '../middleware/featureGate';
import { createVisitSchema, updateVisitStatusSchema, rescheduleVisitSchema, isValidTransition, VISIT_TRANSITIONS, VisitStatus } from '../models/validation';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { notificationEngine } from '../services/notification.engine';
import { scheduleVisit } from '../services/visitBooking.service';
import { propertyCompletenessGate } from '../middleware/propertyCompletenessGate';
import { automationService } from '../services/automation.service';
import { cancelVisitById, markVisitAttended, markVisitNoShow } from '../services/visitState.service';
import { buildPaginationMeta, parsePagination } from '../utils/pagination';
import {
  deleteVisitPermanently,
  ResourceDeleteError,
} from '../services/resourceDelete.service';

const router = Router();

function handleDeleteError(err: unknown, res: Response): void {
  if (err instanceof ResourceDeleteError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : 'Delete failed';
  logger.error('Delete failed', { error: message });
  res.status(500).json({ error: message });
}

type VisitWithRelations = {
  id: string;
  companyId: string;
  leadId: string;
  propertyId: string | null;
  agentId: string;
  scheduledAt: Date;
  durationMinutes: number;
  status: string;
  notes: string | null;
  reminderSent: boolean;
  createdAt: Date;
  updatedAt: Date;
  lead?: { customerName: string | null; phone: string | null } | null;
  property?: { name?: string | null; locationArea?: string | null } | null;
  agent?: { name: string | null } | null;
};

export function mapVisitToSnakeCaseDTO(visit: VisitWithRelations) {
  return {
    id: visit.id,
    company_id: visit.companyId,
    lead_id: visit.leadId,
    property_id: visit.propertyId,
    agent_id: visit.agentId,
    scheduled_at: visit.scheduledAt.toISOString(),
    duration_minutes: visit.durationMinutes,
    status: visit.status,
    notes: visit.notes,
    reminder_sent: visit.reminderSent,
    created_at: visit.createdAt.toISOString(),
    updated_at: visit.updatedAt.toISOString(),
    customer_name: visit.lead?.customerName || null,
    customer_phone: visit.lead?.phone || null,
    property_name: visit.property?.name || null,
    property_area: visit.property?.locationArea || null,
    agent_name: visit.agent?.name || null,
  };
}

router.use(authenticate);
router.use(strictTenantIsolation);
router.use(propertyCompletenessGate);
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

      const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>, {
        limit: 50,
        maxLimit: 200,
      });

      const [visits, total] = await Promise.all([
        prisma.visit.findMany({
          where,
          include: {
            lead: { select: { customerName: true, phone: true } },
            property: { select: { name: true, locationArea: true } },
            agent: { select: { name: true } },
          },
          orderBy: { scheduledAt: 'asc' },
          skip: offset,
          take: limit,
        }),
        prisma.visit.count({ where }),
      ]);

      const data = visits.map((visit) => mapVisitToSnakeCaseDTO(visit));

      res.json({
        data,
        pagination: buildPaginationMeta(page, limit, total),
      });
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

      res.json({ data: mapVisitToSnakeCaseDTO(visit) });
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

      if (!property_id) {
        res.status(400).json({ error: 'property_id is required' });
        return;
      }

      const result = await scheduleVisit({
        companyId,
        leadId: lead_id,
        propertyId: property_id,
        agentId: agent_id,
        scheduledAt: new Date(scheduled_at),
        durationMinutes: duration_minutes || 60,
        notes,
      });

      if (!result.success) {
        if (result.error === 'past_date') {
          res.status(400).json({ error: 'Cannot schedule visits in the past' });
          return;
        }
        if (result.error === 'lead_not_found') {
          res.status(404).json({ error: 'Lead not found' });
          return;
        }
        if (result.error === 'property_not_found') {
          res.status(404).json({ error: 'Property not found' });
          return;
        }
        if (result.error === 'no_agent') {
          res.status(404).json({ error: 'Agent not found' });
          return;
        }
        if (result.error === 'invalid_lead_transition') {
          res.status(409).json({ error: 'Lead status does not allow scheduling a visit' });
          return;
        }
        if (result.error === 'agent_conflict') {
          res.status(409).json({
            error: 'Agent has a conflicting visit within 60 minutes of this time slot',
            conflicts: result.conflicts?.map((c) => ({
              id: c.id,
              scheduled_at: c.scheduledAt,
            })),
          });
          return;
        }
        res.status(500).json({ error: 'Failed to create visit' });
        return;
      }

      const visit = await prisma.visit.findFirst({
        where: { id: result.visit!.id, companyId },
        include: {
          lead: { select: { customerName: true, phone: true } },
          property: { select: { name: true, locationArea: true } },
          agent: { select: { name: true } },
        },
      });

      res.status(201).json({ data: mapVisitToSnakeCaseDTO(visit!), id: visit!.id });
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

      let updated: any;
      if (target === 'completed') {
        const result = await markVisitAttended({ companyId, visitId: id });
        if (!result.success) {
          res.status(400).json({ error: result.error || 'Failed to complete visit' });
          return;
        }
        updated = result.visit;
        await automationService.scheduleVisitPostFollowUp(visit.leadId, visit.id);
      } else if (target === 'no_show') {
        const result = await markVisitNoShow({ companyId, visitId: id });
        if (!result.success) {
          res.status(400).json({ error: result.error || 'Failed to mark no-show' });
          return;
        }
        updated = result.visit;
      } else if (target === 'cancelled') {
        const result = await cancelVisitById({ companyId, visitId: id });
        if (!result.success) {
          res.status(400).json({ error: result.error || 'Failed to cancel visit' });
          return;
        }
        updated = result.visit;
      } else {
        updated = await prisma.visit.update({
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
      }

      const full = await prisma.visit.findFirst({
        where: { id, companyId },
        include: {
          lead: { select: { customerName: true, phone: true } },
          property: { select: { name: true, locationArea: true } },
          agent: { select: { name: true } },
        },
      });
      res.json({ data: full ? mapVisitToSnakeCaseDTO(full) : updated });
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
  validate(rescheduleVisitSchema),
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

/**
 * DELETE /api/visits/:id
 * Permanently remove a visit record.
 */
router.delete(
  '/:id',
  authorize('visits', 'delete'),
  auditLog('delete', 'visits'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const visit = await prisma.visit.findFirst({
        where: { id: req.params.id, companyId },
      });

      if (!visit) {
        res.status(404).json({ error: 'Visit not found' });
        return;
      }

      if (req.user!.role === 'sales_agent' && visit.agentId !== req.user!.id) {
        res.status(403).json({ error: 'Can only delete your own visits' });
        return;
      }

      await deleteVisitPermanently(companyId, req.params.id);
      res.json({ message: 'Visit deleted permanently' });
    } catch (err: unknown) {
      handleDeleteError(err, res);
    }
  },
);

export default router;

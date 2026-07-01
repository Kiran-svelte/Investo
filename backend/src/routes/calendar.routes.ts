import { Router, Response } from 'express';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { strictTenantIsolation, getCompanyId } from '../middleware/tenant';
import { ensureCallRequestsSchema, type CallRequestStatus } from '../services/callRequest.service';
import { getBookingApprovalById } from '../services/bookingApproval.service';
import { resolveVisitApproval } from '../services/visitPendingApproval.service';

const router = Router();
const PENDING_VISIT_CALENDAR_ID = 'INVESTO-20260701-PENDING-VISIT-CALENDAR';

type CalendarEvent = {
  id: string;
  type: 'visit' | 'call';
  lead_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  property_id: string | null;
  property_name: string | null;
  property_area: string | null;
  agent_id: string;
  agent_name: string | null;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
  notes: string | null;
  approval_id?: string | null;
  is_pending_approval?: boolean;
  resolution_id?: string;
};

type CallCalendarRow = {
  id: string;
  lead_id: string;
  agent_id: string;
  scheduled_at: Date;
  duration_minutes: number;
  status: CallRequestStatus;
  notes: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  agent_name: string | null;
};

type PendingVisitApprovalCalendarRow = {
  approval_id: string;
  lead_id: string;
  property_id: string | null;
  agent_id: string;
  scheduled_at: Date;
  customer_name: string | null;
  customer_phone: string | null;
  property_name: string | null;
  property_area: string | null;
  agent_name: string | null;
};

function parseDateParam(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field}_required`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field}_invalid`);
  }
  return parsed;
}

router.use(strictTenantIsolation);

router.get('/conflicts', authorize('visits', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const agentId = typeof req.query.agent_id === 'string' ? req.query.agent_id : req.user!.id;
    const scheduledAt = parseDateParam(req.query.scheduled_at, 'scheduled_at');
    const excludeVisitId = typeof req.query.exclude_visit_id === 'string'
      ? req.query.exclude_visit_id
      : undefined;

    const windowStart = new Date(scheduledAt.getTime() - 60 * 60 * 1000);
    const windowEnd = new Date(scheduledAt.getTime() + 60 * 60 * 1000);

    const conflicts = await prisma.visit.findMany({
      where: {
        companyId,
        agentId,
        id: excludeVisitId ? { not: excludeVisitId } : undefined,
        status: { in: ['scheduled', 'confirmed'] },
        scheduledAt: { gte: windowStart, lte: windowEnd },
      },
      select: {
        id: true,
        scheduledAt: true,
        status: true,
        lead: { select: { customerName: true } },
        property: { select: { name: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    res.json({
      data: {
        has_conflict: conflicts.length > 0,
        conflicts: conflicts.map((visit) => ({
          id: visit.id,
          scheduled_at: visit.scheduledAt.toISOString(),
          status: visit.status,
          customer_name: visit.lead?.customerName ?? null,
          property_name: visit.property?.name ?? null,
        })),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'scheduled_at_required' || message === 'scheduled_at_invalid') {
      res.status(400).json({ error: message });
      return;
    }
    logger.error('Failed to check calendar conflicts', { error: message });
    res.status(500).json({ error: 'Failed to check calendar conflicts' });
  }
});

router.get('/events', authorize('visits', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const from = parseDateParam(req.query.from, 'from');
    const to = parseDateParam(req.query.to, 'to');
    if (from > to) {
      res.status(400).json({ error: 'from must be before to' });
      return;
    }

    const requestedAgentId = typeof req.query.agent_id === 'string' ? req.query.agent_id : undefined;
    const scopedAgentId = req.user!.role === 'sales_agent' ? req.user!.id : requestedAgentId;

    const visitWhere: any = {
      companyId,
      scheduledAt: { gte: from, lte: to },
      ...(scopedAgentId ? { agentId: scopedAgentId } : {}),
    };

    await ensureCallRequestsSchema();

    const callParams: unknown[] = [companyId, from, to];
    let callAgentClause = '';
    if (scopedAgentId) {
      callParams.push(scopedAgentId);
      callAgentClause = ` AND cr.agent_id = $${callParams.length}::uuid`;
    }

    const pendingVisitParams: unknown[] = [companyId, from, to];
    let pendingVisitAgentClause = '';
    if (scopedAgentId) {
      pendingVisitParams.push(scopedAgentId);
      pendingVisitAgentClause = ` AND bar.agent_id = $${pendingVisitParams.length}::uuid`;
    }

    const [visits, calls, pendingVisitApprovals] = await Promise.all([
      prisma.visit.findMany({
        where: visitWhere,
        include: {
          lead: { select: { customerName: true, phone: true } },
          property: { select: { id: true, name: true, locationArea: true } },
          agent: { select: { name: true } },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 500,
      }),
      prisma.$queryRawUnsafe<CallCalendarRow[]>(
        `SELECT
           cr.id::text,
           cr.lead_id::text,
           cr.agent_id::text,
           cr.scheduled_at,
           cr.duration_minutes,
           cr.status,
           cr.notes,
           l.customer_name,
           l.phone AS customer_phone,
           u.name AS agent_name
         FROM call_requests cr
         LEFT JOIN leads l ON l.id = cr.lead_id
         LEFT JOIN users u ON u.id = cr.agent_id
         WHERE cr.company_id = $1::uuid
           AND cr.scheduled_at >= $2
           AND cr.scheduled_at <= $3
           ${callAgentClause}
         ORDER BY cr.scheduled_at ASC
         LIMIT 500`,
        ...callParams,
      ),
      prisma.$queryRawUnsafe<PendingVisitApprovalCalendarRow[]>(
        `SELECT
           bar.id::text AS approval_id,
           bar.lead_id::text,
           bar.property_id::text,
           bar.agent_id::text,
           bar.scheduled_at,
           COALESCE(bar.customer_name, l.customer_name) AS customer_name,
           COALESCE(bar.customer_phone, l.phone) AS customer_phone,
           p.name AS property_name,
           p.location_area AS property_area,
           u.name AS agent_name
         FROM booking_approval_requests bar
         LEFT JOIN leads l ON l.id = bar.lead_id
         LEFT JOIN properties p ON p.id = bar.property_id
         LEFT JOIN users u ON u.id = bar.agent_id
         WHERE bar.company_id = $1::uuid
           AND bar.kind = 'visit'
           AND bar.status = 'pending'
           AND bar.expires_at > now()
           AND bar.scheduled_at >= $2
           AND bar.scheduled_at <= $3
           ${pendingVisitAgentClause}
           AND NOT EXISTS (
             SELECT 1
             FROM visits v
             WHERE v.company_id = bar.company_id
               AND v.lead_id = bar.lead_id
               AND v.scheduled_at = bar.scheduled_at
               AND v.status IN ('scheduled', 'confirmed')
           )
         ORDER BY bar.scheduled_at ASC
         LIMIT 500`,
        ...pendingVisitParams,
      ),
    ]);

    const events: CalendarEvent[] = [
      // INVESTO-20260701-PENDING-VISIT-CALENDAR:
      // Buyer-requested visits live in booking_approval_requests until agent approval.
      // Expose them as calendar events so staff can see and act before confirmation.
      ...pendingVisitApprovals.map((approval) => ({
        id: `visit-approval-${approval.approval_id}`,
        type: 'visit' as const,
        lead_id: approval.lead_id,
        customer_name: approval.customer_name,
        customer_phone: approval.customer_phone,
        property_id: approval.property_id,
        property_name: approval.property_name,
        property_area: approval.property_area,
        agent_id: approval.agent_id,
        agent_name: approval.agent_name,
        scheduled_at: new Date(approval.scheduled_at).toISOString(),
        duration_minutes: 60,
        status: 'pending_approval',
        notes: 'Buyer requested this site visit. Waiting for agent confirmation.',
        approval_id: approval.approval_id,
        is_pending_approval: true,
        resolution_id: PENDING_VISIT_CALENDAR_ID,
      })),
      ...visits.map((visit) => ({
        id: visit.id,
        type: 'visit' as const,
        lead_id: visit.leadId,
        customer_name: visit.lead?.customerName ?? null,
        customer_phone: visit.lead?.phone ?? null,
        property_id: visit.propertyId,
        property_name: visit.property?.name ?? null,
        property_area: visit.property?.locationArea ?? null,
        agent_id: visit.agentId,
        agent_name: visit.agent?.name ?? null,
        scheduled_at: visit.scheduledAt.toISOString(),
        duration_minutes: visit.durationMinutes,
        status: visit.status,
        notes: visit.notes,
      })),
      ...calls.map((call) => ({
        id: call.id,
        type: 'call' as const,
        lead_id: call.lead_id,
        customer_name: call.customer_name,
        customer_phone: call.customer_phone,
        property_id: null,
        property_name: null,
        property_area: null,
        agent_id: call.agent_id,
        agent_name: call.agent_name,
        scheduled_at: new Date(call.scheduled_at).toISOString(),
        duration_minutes: call.duration_minutes,
        status: call.status,
        notes: call.notes,
      })),
    ].sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

    res.json({ data: events });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'from_required' || message === 'to_required' || message.endsWith('_invalid')) {
      res.status(400).json({ error: message });
      return;
    }
    logger.error('Failed to fetch calendar events', { error: message });
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

router.patch('/visit-approvals/:id/status', authorize('visits', 'update'), async (req: AuthRequest, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const target = String(req.body?.status || '');
    if (target !== 'scheduled' && target !== 'cancelled') {
      res.status(400).json({
        error: 'status must be scheduled or cancelled',
        code: 'invalid_pending_visit_status',
        resolution_id: PENDING_VISIT_CALENDAR_ID,
      });
      return;
    }

    const approval = await getBookingApprovalById(req.params.id);
    if (!approval || approval.companyId !== companyId) {
      res.status(404).json({
        error: 'Pending visit request not found',
        code: 'pending_visit_not_found',
        resolution_id: PENDING_VISIT_CALENDAR_ID,
      });
      return;
    }
    if (approval.kind !== 'visit' || approval.status !== 'pending') {
      res.status(409).json({
        error: 'This visit request is no longer pending',
        code: 'pending_visit_already_resolved',
        resolution_id: PENDING_VISIT_CALENDAR_ID,
      });
      return;
    }
    if (req.user!.role === 'sales_agent' && approval.agentId !== req.user!.id) {
      res.status(403).json({
        error: 'Can only update assigned visit requests',
        code: 'pending_visit_agent_scope',
        resolution_id: PENDING_VISIT_CALENDAR_ID,
      });
      return;
    }

    const approved = target === 'scheduled';
    const result = await resolveVisitApproval(approval.id, approved, companyId, approval.agentId);
    res.status(result.ok ? 200 : 400).json({
      data: { ok: result.ok, message: result.message },
      resolution_id: PENDING_VISIT_CALENDAR_ID,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to update pending visit approval', { error: message, resolutionId: PENDING_VISIT_CALENDAR_ID });
    res.status(500).json({
      error: 'Failed to update pending visit approval',
      resolution_id: PENDING_VISIT_CALENDAR_ID,
    });
  }
});

export default router;

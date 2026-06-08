import { Router, Response } from 'express';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import { ensureCallRequestsSchema, type CallRequestStatus } from '../services/callRequest.service';

const router = Router();

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

router.use(tenantIsolation);

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

    const [visits, calls] = await Promise.all([
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
    ]);

    const events: CalendarEvent[] = [
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

export default router;

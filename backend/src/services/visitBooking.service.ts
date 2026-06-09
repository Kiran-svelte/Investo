import prisma from '../config/prisma';
import logger from '../config/logger';
import { assignLeadRoundRobin } from './leadAssignment.service';
import {
  canTransitionLeadToVisitScheduledStatus,
  transitionLeadToVisitScheduled,
} from './leadTransition.service';
import { notificationEngine } from './notification.engine';
import { emitVisitCreated } from './visitLifecycle.service';
import { incrementOpsMetric } from './opsMetrics.service';

export interface ScheduleVisitInput {
  companyId: string;
  leadId: string;
  propertyId: string;
  scheduledAt: Date;
  durationMinutes?: number;
  notes?: string;
  /** When omitted, uses lead.assignedAgentId or round-robin. */
  agentId?: string;
  /** Shared idempotency key across workflow, commit, and tool paths. */
  idempotencyKey?: string;
}

/** Shared visit booking idempotency key shape (workflow + commit + tools). */
export function buildVisitIdempotencyKey(
  companyId: string,
  leadId: string,
  scheduledAtISO: string,
): string {
  return `visit_book:${companyId}:${leadId}:${scheduledAtISO}`;
}

export interface ScheduleVisitResult {
  success: boolean;
  visit?: {
    id: string;
    scheduledAt: Date;
    agentId: string;
    propertyId: string | null;
    leadId: string;
    companyId: string;
    durationMinutes: number;
    status: string;
    notes: string | null;
  };
  error?:
    | 'past_date'
    | 'agent_conflict'
    | 'lead_not_found'
    | 'property_not_found'
    | 'no_agent'
    | 'invalid_lead_transition';
  conflicts?: Array<{ id: string; scheduledAt: Date }>;
}

/**
 * Books a site visit (REST API, WhatsApp, or automation) with shared validation rules.
 */
export async function scheduleVisit(input: ScheduleVisitInput): Promise<ScheduleVisitResult> {
  const { companyId, leadId, propertyId, scheduledAt, durationMinutes = 60, notes, agentId: inputAgentId } =
    input;
  const now = new Date();

  if (scheduledAt <= now) {
    return { success: false, error: 'past_date' };
  }

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId },
  });
  if (!lead) {
    return { success: false, error: 'lead_not_found' };
  }

  if (!canTransitionLeadToVisitScheduledStatus(lead.status)) {
    return { success: false, error: 'invalid_lead_transition' };
  }

  const property = await prisma.property.findFirst({
    where: { id: propertyId, companyId, status: { in: ['available', 'upcoming'] } },
  });
  if (!property) {
    return { success: false, error: 'property_not_found' };
  }

  let agentId = inputAgentId || lead.assignedAgentId;
  if (!agentId) {
    agentId = await assignLeadRoundRobin(companyId);
    if (!agentId) {
      return { success: false, error: 'no_agent' };
    }
    await prisma.lead.update({
      where: { id: leadId },
      data: { assignedAgentId: agentId },
    });
  }

  const visitStart = scheduledAt.getTime();
  const visitEnd = visitStart + durationMinutes * 60 * 1000;
  const bufferStart = new Date(visitStart - 60 * 60 * 1000);
  const bufferEnd = new Date(visitEnd + 60 * 60 * 1000);

  const conflicts = await prisma.visit.findMany({
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
  const { deduplicationService } = await import('./deduplication.service');
  const redisKey = `visit-idem:${idemKey}`;
  // 86400s (24h) matches Meta's maximum webhook re-delivery window.
  const claimed = await deduplicationService.claimMessageProcessing(redisKey, 86_400);
  if (!claimed) {
    const duplicate = await prisma.visit.findFirst({
      where: {
        companyId,
        leadId,
        scheduledAt,
        status: { in: ['scheduled', 'confirmed'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (duplicate) {
      incrementOpsMetric('visit_idem_hit');
      logger.info('scheduleVisit: idempotency hit (Redis), returning existing visit', {
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

  const existingSameSlot = await prisma.visit.findFirst({
    where: {
      companyId,
      leadId,
      scheduledAt,
      status: { in: ['scheduled', 'confirmed'] },
    },
  });
  if (existingSameSlot) {
    incrementOpsMetric('visit_idem_hit');
    logger.info('scheduleVisit: idempotency hit (DB unique slot), returning existing visit', {
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

  const agent = await prisma.user.findFirst({
    where: { id: agentId, companyId, status: 'active' },
  });
  if (!agent) {
    return { success: false, error: 'no_agent' };
  }

  const visit = await prisma.visit.create({
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

  await transitionLeadToVisitScheduled(leadId);

  await notificationEngine.onVisitScheduled(visit, lead, property, agent);
  emitVisitCreated(companyId, visit);

  logger.info('Visit scheduled', {
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
export async function scheduleVisitFromWhatsApp(
  input: Omit<ScheduleVisitInput, 'agentId'>,
): Promise<ScheduleVisitResult> {
  return scheduleVisit(input);
}

/** Parse visit-time-{propertyUuid}-{slotSuffix} without breaking UUID hyphens. */
export function parseVisitTimeInteractiveId(interactiveId: string): {
  propertyId: string;
  slot: string;
} | null {
  const prefix = 'visit-time-';
  if (!interactiveId.startsWith(prefix)) return null;

  const rest = interactiveId.slice(prefix.length);
  const slotSuffixes = ['tomorrow-10am', 'tomorrow-3pm', 'dayafter'] as const;

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

/** IST offset in milliseconds: UTC+05:30 = 5.5 * 3600 * 1000 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Resolve a slot suffix (e.g. 'tomorrow-10am', 'dayafter') to a UTC Date
 * that corresponds to the correct IST wall-clock time shown to the buyer.
 *
 * Railway (and most cloud hosts) run in UTC. Using `new Date()` + `setHours(10)`
 * sets 10:00 UTC = 15:30 IST — a 5.5-hour error. Instead we compute "today" and
 * "tomorrow" in IST, set the hours in IST, then convert back to UTC for DB storage.
 */
export function resolveVisitSlotToDate(slot: string): Date {
  // Current moment expressed in IST (UTC+5:30)
  const nowUtcMs = Date.now();
  const nowIst = new Date(nowUtcMs + IST_OFFSET_MS);

  // Target calendar date in IST
  let daysToAdd = 0;
  if (slot.includes('tomorrow')) daysToAdd = 1;
  else if (slot.includes('dayafter')) daysToAdd = 2;

  // Target hour in IST
  let targetHourIst = 11; // default 11 AM IST
  if (slot.includes('10am')) targetHourIst = 10;
  else if (slot.includes('3pm')) targetHourIst = 15;

  // Build target datetime in IST then convert to UTC for DB storage.
  // Date.UTC sets a moment in UTC; using IST hours here gives us "10:00 IST expressed as UTC".
  const istWallClockAsUtc = new Date(Date.UTC(
    nowIst.getUTCFullYear(),
    nowIst.getUTCMonth(),
    nowIst.getUTCDate() + daysToAdd,
    targetHourIst,
    0,
    0,
    0,
  ));

  // Subtract the IST offset to get the true UTC equivalent for DB storage.
  return new Date(istWallClockAsUtc.getTime() - IST_OFFSET_MS);
}

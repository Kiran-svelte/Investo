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

export function resolveVisitSlotToDate(slot: string): Date {
  const proposedTime = new Date();
  if (slot.includes('tomorrow')) {
    proposedTime.setDate(proposedTime.getDate() + 1);
    if (slot.includes('10am')) proposedTime.setHours(10, 0, 0, 0);
    else if (slot.includes('3pm')) proposedTime.setHours(15, 0, 0, 0);
    else proposedTime.setHours(11, 0, 0, 0);
  } else if (slot.includes('dayafter')) {
    proposedTime.setDate(proposedTime.getDate() + 2);
    proposedTime.setHours(11, 0, 0, 0);
  }
  return proposedTime;
}

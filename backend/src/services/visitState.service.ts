import prisma from '../config/prisma';
import logger from '../config/logger';
import {
  isValidVisitTransition,
  type VisitStatus,
} from '../models/validation';
import {
  transitionLeadStatus,
  transitionLeadToVisitScheduled,
} from './leadTransition.service';
import { notificationEngine } from './notification.engine';

type VisitStateError =
  | 'visit_not_found'
  | 'visit_completed'
  | 'visit_cancelled'
  | 'visit_no_show'
  | 'past_date'
  | 'lead_transition_failed'
  | 'invalid_transition';

type VisitStateResult = {
  success: boolean;
  visit?: any;
  oldStatus?: string;
  error?: VisitStateError;
};

function terminalError(status: string): VisitStateError | null {
  if (status === 'completed') return 'visit_completed';
  if (status === 'cancelled') return 'visit_cancelled';
  if (status === 'no_show') return 'visit_no_show';
  return null;
}

async function loadVisit(companyId: string, visitId: string) {
  return prisma.visit.findFirst({
    where: { id: visitId, companyId },
    include: {
      lead: true,
      property: { select: { name: true } },
      agent: { select: { id: true, name: true, phone: true } },
    },
  });
}

async function notifyStatusChange(visitId: string, oldStatus: string, newStatus: string): Promise<void> {
  try {
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      include: {
        lead: true,
        property: { select: { name: true } },
      },
    });
    if (!visit?.lead) return;
    const company = await prisma.company.findUnique({ where: { id: visit.companyId } });
    if (!company) return;
    await notificationEngine.onVisitStatusChange(visit, oldStatus, newStatus, visit.lead, company);
  } catch (err: unknown) {
    logger.warn('visitState notification failed', {
      visitId,
      oldStatus,
      newStatus,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function notifyRescheduled(
  visitId: string,
  oldTime: Date,
  suppressCustomerNotification = false,
): Promise<void> {
  try {
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      include: {
        lead: true,
        property: { select: { name: true } },
      },
    });
    if (!visit?.lead) return;
    const company = await prisma.company.findUnique({ where: { id: visit.companyId } });
    if (!company) return;
    await notificationEngine.onVisitRescheduled(
      visit,
      oldTime,
      visit.scheduledAt,
      visit.lead,
      company,
      suppressCustomerNotification,
    );
  } catch (err: unknown) {
    logger.warn('visitState reschedule notification failed', {
      visitId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function moveLeadToVisited(leadId: string): Promise<boolean> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { status: true } });
  if (!lead) return false;
  if (lead.status === 'visited') return true;
  if (lead.status === 'new' || lead.status === 'contacted') {
    const scheduled = await transitionLeadToVisitScheduled(leadId);
    if (!scheduled) return false;
  }
  return transitionLeadStatus(leadId, 'visited', { force: false });
}

export async function markVisitAttended(input: {
  companyId: string;
  visitId: string;
  notes?: string;
}): Promise<VisitStateResult> {
  const visit = await loadVisit(input.companyId, input.visitId);
  if (!visit) return { success: false, error: 'visit_not_found' };
  if (visit.status === 'completed') return { success: true, visit, oldStatus: visit.status };
  const blocked = terminalError(visit.status);
  if (blocked) return { success: false, visit, error: blocked };
  if (!isValidVisitTransition(visit.status as VisitStatus, 'completed')) {
    return { success: false, visit, error: 'invalid_transition' };
  }

  const oldStatus = visit.status;
  const updated = await prisma.visit.update({
    where: { id: visit.id },
    data: {
      status: 'completed',
      notes: input.notes ?? undefined,
    },
    include: {
      lead: true,
      property: { select: { name: true } },
      agent: { select: { id: true, name: true, phone: true } },
    },
  });

  const leadMoved = await moveLeadToVisited(updated.leadId);
  if (!leadMoved) {
    logger.warn('Completed visit but could not transition lead to visited', {
      companyId: input.companyId,
      visitId: visit.id,
      leadId: updated.leadId,
    });
    return { success: false, visit: updated, oldStatus, error: 'lead_transition_failed' };
  }

  await notifyStatusChange(updated.id, oldStatus, 'completed');
  return { success: true, visit: updated, oldStatus };
}

export async function markVisitNoShow(input: {
  companyId: string;
  visitId: string;
  notes?: string;
}): Promise<VisitStateResult> {
  const visit = await loadVisit(input.companyId, input.visitId);
  if (!visit) return { success: false, error: 'visit_not_found' };
  if (visit.status === 'no_show') return { success: true, visit, oldStatus: visit.status };
  const blocked = terminalError(visit.status);
  if (blocked) return { success: false, visit, error: blocked };
  if (!isValidVisitTransition(visit.status as VisitStatus, 'no_show')) {
    return { success: false, visit, error: 'invalid_transition' };
  }

  const oldStatus = visit.status;
  const updated = await prisma.visit.update({
    where: { id: visit.id },
    data: {
      status: 'no_show',
      notes: input.notes ?? undefined,
    },
    include: {
      lead: true,
      property: { select: { name: true } },
      agent: { select: { id: true, name: true, phone: true } },
    },
  });

  await notifyStatusChange(updated.id, oldStatus, 'no_show');
  return { success: true, visit: updated, oldStatus };
}

export async function cancelVisitById(input: {
  companyId: string;
  visitId: string;
  notes?: string;
}): Promise<VisitStateResult> {
  const visit = await loadVisit(input.companyId, input.visitId);
  if (!visit) return { success: false, error: 'visit_not_found' };
  if (visit.status === 'cancelled') return { success: true, visit, oldStatus: visit.status };
  if (visit.status === 'completed') return { success: false, visit, error: 'visit_completed' };
  if (!isValidVisitTransition(visit.status as VisitStatus, 'cancelled')) {
    return { success: false, visit, error: 'invalid_transition' };
  }

  const oldStatus = visit.status;
  const updated = await prisma.visit.update({
    where: { id: visit.id },
    data: {
      status: 'cancelled',
      notes: input.notes ?? undefined,
    },
    include: {
      lead: true,
      property: { select: { name: true } },
      agent: { select: { id: true, name: true, phone: true } },
    },
  });

  if (updated.leadId) {
    await transitionLeadStatus(updated.leadId, 'contacted', { force: false });
  }

  await notifyStatusChange(updated.id, oldStatus, 'cancelled');
  return { success: true, visit: updated, oldStatus };
}

export async function rescheduleVisitById(input: {
  companyId: string;
  visitId: string;
  scheduledAt: Date;
  notes?: string;
  suppressCustomerNotification?: boolean;
}): Promise<VisitStateResult> {
  if (input.scheduledAt <= new Date()) return { success: false, error: 'past_date' };

  const visit = await loadVisit(input.companyId, input.visitId);
  if (!visit) return { success: false, error: 'visit_not_found' };
  const blocked = terminalError(visit.status);
  if (blocked) return { success: false, visit, error: blocked };

  const oldTime = visit.scheduledAt;
  const oldStatus = visit.status;
  const nextStatus: VisitStatus = visit.status === 'confirmed' ? 'confirmed' : 'scheduled';
  const updated = await prisma.visit.update({
    where: { id: visit.id },
    data: {
      scheduledAt: input.scheduledAt,
      status: nextStatus,
      reminderSent: false,
      notes: input.notes ?? undefined,
    },
    include: {
      lead: true,
      property: { select: { name: true } },
      agent: { select: { id: true, name: true, phone: true } },
    },
  });

  await notifyRescheduled(updated.id, oldTime, Boolean(input.suppressCustomerNotification));
  return { success: true, visit: updated, oldStatus };
}

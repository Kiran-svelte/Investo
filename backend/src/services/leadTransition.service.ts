import prisma from '../config/prisma';
import logger from '../config/logger';
import { isValidTransition, LEAD_STATUSES, LEAD_TRANSITIONS, LeadStatus } from '../models/validation';

export function canTransitionLeadToVisitScheduledStatus(status: string | null | undefined): boolean {
  if (!status || !(LEAD_STATUSES as readonly string[]).includes(status)) {
    return false;
  }

  const current = status as LeadStatus;
  if (current === 'new') {
    return (
      isValidTransition(LEAD_TRANSITIONS, 'new', 'contacted') &&
      isValidTransition(LEAD_TRANSITIONS, 'contacted', 'visit_scheduled')
    );
  }

  return isValidTransition(LEAD_TRANSITIONS, current, 'visit_scheduled');
}

/**
 * Updates lead status only when the transition is valid per LEAD_TRANSITIONS.
 */
export async function transitionLeadStatus(
  leadId: string,
  targetStatus: LeadStatus,
  extra?: { lastContactAt?: boolean; force?: boolean },
): Promise<boolean> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) {
    return false;
  }

  const current = lead.status as LeadStatus;
  if (current === targetStatus) {
    return true;
  }

  const allowReopen = current === 'closed_lost' && targetStatus === 'contacted';
  if (
    !extra?.force
    && !allowReopen
    && !isValidTransition(LEAD_TRANSITIONS, current, targetStatus)
  ) {
    logger.warn('Invalid lead status transition skipped', {
      leadId,
      from: current,
      to: targetStatus,
    });
    return false;
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      status: targetStatus,
      ...(extra?.lastContactAt !== false && { lastContactAt: new Date() }),
    },
  });

  return true;
}

/** Chains valid transitions so a visit can be booked from `new` or `contacted`. */
export async function transitionLeadToVisitScheduled(leadId: string): Promise<boolean> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) {
    return false;
  }
  if (lead.status === 'visit_scheduled') {
    return true;
  }
  if (lead.status === 'new') {
    const contacted = await transitionLeadStatus(leadId, 'contacted');
    if (!contacted) {
      return false;
    }
  }
  return transitionLeadStatus(leadId, 'visit_scheduled');
}

import prisma from '../../config/prisma';
import logger from '../../config/logger';
import {
  CONFIRMATION_NEGATIVE_KEYWORDS,
  CONFIRMATION_POSITIVE_KEYWORDS,
  CONFIRMATION_TTL_MS,
} from '../../constants/agent-ai.constants';

const db = prisma as any;

export interface PendingConfirmationResult {
  hasPending: boolean;
  isConfirmed?: boolean;
  isRejected?: boolean;
  actionType?: string;
  actionParams?: Record<string, unknown>;
  pendingActionId?: string;
  displayMessage?: string;
}

function normalized(text: string): string {
  return text.trim().toLowerCase();
}

function matchesKeyword(text: string, keywords: ReadonlySet<string>): boolean {
  if (keywords.has(text)) return true;
  for (const keyword of keywords) {
    if (keyword.includes(' ') && text.includes(keyword)) return true;
  }
  return false;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getString(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function checkAndResolvePendingConfirmation(
  sessionId: string,
  messageText: string,
): Promise<PendingConfirmationResult> {
  const pending = await db.pendingAction.findFirst({
    where: { sessionId, status: 'awaiting', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  if (!pending) return { hasPending: false };

  const result: PendingConfirmationResult = {
    hasPending: true,
    actionType: pending.actionType,
    actionParams: asRecord(pending.actionParams),
    pendingActionId: pending.id,
    displayMessage: pending.displayMessage,
  };

  const text = normalized(messageText);
  if (matchesKeyword(text, CONFIRMATION_POSITIVE_KEYWORDS)) {
    await db.pendingAction.update({
      where: { id: pending.id },
      data: { status: 'confirmed', resolvedAt: new Date() },
    });
    return { ...result, isConfirmed: true };
  }

  if (matchesKeyword(text, CONFIRMATION_NEGATIVE_KEYWORDS)) {
    await db.pendingAction.update({
      where: { id: pending.id },
      data: { status: 'rejected', resolvedAt: new Date() },
    });
    return { ...result, isRejected: true };
  }

  return result;
}

export async function createPendingConfirmation(
  sessionId: string,
  actionType: string,
  actionParams: Record<string, unknown>,
  displayMessage: string,
): Promise<string> {
  await db.pendingAction.updateMany({
    where: { sessionId, status: 'awaiting' },
    data: { status: 'expired', resolvedAt: new Date() },
  });

  const created = await db.pendingAction.create({
    data: {
      sessionId,
      actionType,
      actionParams: actionParams as any,
      displayMessage,
      status: 'awaiting',
      expiresAt: new Date(Date.now() + CONFIRMATION_TTL_MS),
    },
  });

  return created.id;
}

export async function cleanupExpiredConfirmations(): Promise<number> {
  const result = await db.pendingAction.updateMany({
    where: { status: 'awaiting', expiresAt: { lt: new Date() } },
    data: { status: 'expired', resolvedAt: new Date() },
  });
  return result.count;
}

export async function executePendingAction(pendingActionId: string): Promise<string> {
  const pending = await db.pendingAction.findUnique({
    where: { id: pendingActionId },
    include: { session: { select: { companyId: true } } },
  });

  if (!pending) return 'Confirmation not found.';
  if (pending.status !== 'confirmed') return 'Confirmation is not approved.';

  const params = asRecord(pending.actionParams);
  const companyId = pending.session.companyId;

  switch (pending.actionType) {
    case 'attendance_check':
      return attendanceCheckYes(companyId, params);
    case 'deleteLead':
      return deleteLead(companyId, params);
    case 'cancelVisit':
      return cancelVisit(companyId, params);
    case 'closeLeadLost':
      return closeLeadLost(companyId, params);
    case 'reassignLead':
      return reassignLead(companyId, params);
    case 'deactivateAgent':
      return deactivateAgent(companyId, params);
    case 'bulkUpdateVisits':
      return bulkUpdateVisits(companyId, params);
    default:
      logger.warn('Unsupported pending action confirmed', { actionType: pending.actionType });
      return `Unsupported action: ${pending.actionType}`;
  }
}

/**
 * Handles NO reply on an attendance_check pending action.
 * Marks the visit as no_show and sends the customer an invitation to reschedule.
 * Called by agent-router when the agent's reply is rejected (NO).
 *
 * @param companyId - Company scope for authorization.
 * @param params - ActionParams from the PendingAction record.
 * @returns Confirmation message for the agent.
 */
export async function handleAttendanceCheckRejected(
  companyId: string,
  params: Record<string, unknown>,
): Promise<string> {
  const visitId = getString(params, 'visitId');
  const customerPhone = getString(params, 'customerPhone');
  const customerName = getString(params, 'customerName') ?? 'Customer';
  const propertyName = getString(params, 'propertyName') ?? 'your property';

  if (visitId) {
    await db.visit.update({
      where: { id: visitId },
      data: { status: 'no_show' },
    });
    logger.info('Attendance check: visit marked no_show via agent NO reply', { visitId, companyId });
  }

  if (customerPhone) {
    const rescheduleMsg = [
      `Hi ${customerName}! \uD83D\uDC4B`,
      ``,
      `We missed you at *${propertyName}* today. Hope all is well!`,
      ``,
      `Would you like to reschedule your visit? Just reply with a preferred date and time \uD83D\uDCC5`,
      `(e.g. "this Saturday 11am")`,
    ].join('\n');
    try {
      const { whatsappService } = await import('../whatsapp.service');
      await whatsappService.sendCompanyTextMessage(customerPhone, rescheduleMsg, companyId);
      logger.info('Sent reschedule invitation to customer after no-show', { customerPhone, companyId });
    } catch (err: unknown) {
      logger.warn('Failed to send reschedule invitation to customer', {
        customerPhone,
        companyId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return [
    `\u274C Marked as no-show.`,
    customerPhone
      ? `\nA reschedule invitation has been sent to ${customerName}.`
      : '',
  ].join('');
}

/**
 * Handles YES reply on an attendance_check pending action.
 * Marks the visit as completed and updates lead status to visited.
 *
 * @param companyId - Company scope for authorization.
 * @param params - ActionParams from the PendingAction record.
 * @returns Confirmation message for the agent.
 */
async function attendanceCheckYes(
  companyId: string,
  params: Record<string, unknown>,
): Promise<string> {
  const visitId = getString(params, 'visitId');
  const leadId = getString(params, 'leadId');
  const customerName = getString(params, 'customerName') ?? 'Customer';
  const propertyName = getString(params, 'propertyName') ?? 'Property';

  if (visitId) {
    await db.visit.update({
      where: { id: visitId },
      data: { status: 'completed' },
    });
    logger.info('Attendance check: visit marked completed via agent YES reply', { visitId, companyId });
  }

  if (leadId) {
    await db.lead.update({
      where: { id: leadId },
      data: { status: 'visited' },
    });
    logger.info('Lead status updated to visited after attendance confirmation', { leadId, companyId });
  }

  return [
    `\u2705 *Attendance confirmed!*`,
    ``,
    `Visit with *${customerName}* at *${propertyName}* marked as *completed*.`,
    `Lead status updated to *Visited*.`,
    ``,
    `To log notes or next steps, type "update lead ${customerName}".`,
  ].join('\n');
}

async function deleteLead(companyId: string, params: Record<string, unknown>): Promise<string> {
  const leadId = getString(params, 'leadId');
  if (!leadId) return 'Missing lead id.';
  const lead = await db.lead.findFirst({ where: { id: leadId, companyId }, select: { id: true, customerName: true } });
  if (!lead) return 'Lead not found or access denied.';
  await db.lead.delete({ where: { id: leadId } });
  return `Deleted lead ${lead.customerName ?? 'Unknown'}.`;
}

async function cancelVisit(companyId: string, params: Record<string, unknown>): Promise<string> {
  const visitId = getString(params, 'visitId');
  if (!visitId) return 'Missing visit id.';
  const visit = await db.visit.findFirst({
    where: { id: visitId, companyId },
    select: { id: true, status: true, lead: { select: { customerName: true } } },
  });
  if (!visit) return 'Visit not found or access denied.';
  if (visit.status === 'completed') return 'Cannot cancel a completed visit.';
  const oldStatus = visit.status;
  await db.visit.update({
    where: { id: visitId },
    data: { status: 'cancelled', notes: getString(params, 'reason') ?? 'Cancelled by Agent AI' },
  });
  void import('../visitNotificationBridge.service').then(({ notifyVisitStatusChangeFromTool }) =>
    notifyVisitStatusChangeFromTool(visitId, oldStatus, 'cancelled'),
  );
  return `Cancelled visit for ${visit.lead?.customerName ?? 'Unknown'}.`;
}

async function closeLeadLost(companyId: string, params: Record<string, unknown>): Promise<string> {
  const leadId = getString(params, 'leadId');
  if (!leadId) return 'Missing lead id.';
  const lead = await db.lead.findFirst({ where: { id: leadId, companyId }, select: { id: true, customerName: true } });
  if (!lead) return 'Lead not found or access denied.';
  await db.lead.update({ where: { id: leadId }, data: { status: 'closed_lost' } });
  return `Marked ${lead.customerName ?? 'Unknown'} as closed lost.`;
}

async function reassignLead(companyId: string, params: Record<string, unknown>): Promise<string> {
  // Bulk portfolio transfer mode
  if (params.bulkTransfer === true) {
    const fromAgentId = getString(params, 'fromAgentId');
    const toAgentId = getString(params, 'toAgentId');
    if (!fromAgentId || !toAgentId) return 'Missing fromAgentId or toAgentId.';
    const [fromAgent, toAgent] = await Promise.all([
      db.user.findFirst({ where: { id: fromAgentId, companyId }, select: { id: true, name: true } }),
      db.user.findFirst({ where: { id: toAgentId, companyId, status: 'active' }, select: { id: true, name: true } }),
    ]);
    if (!fromAgent) return 'Source agent not found.';
    if (!toAgent) return 'Target agent not found or inactive.';
    const result = await db.lead.updateMany({
      where: { companyId, assignedAgentId: fromAgentId, status: { notIn: ['closed_won', 'closed_lost'] } },
      data: { assignedAgentId: toAgentId },
    });
    return `Transferred ${result.count} lead(s) from ${fromAgent.name} to ${toAgent.name}.`;
  }

  // Single lead reassign mode
  const leadId = getString(params, 'leadId');
  const agentId = getString(params, 'agentId');
  if (!leadId || !agentId) return 'Missing lead or agent id.';
  const [lead, agent] = await Promise.all([
    db.lead.findFirst({ where: { id: leadId, companyId }, select: { id: true, customerName: true } }),
    db.user.findFirst({ where: { id: agentId, companyId, status: 'active' }, select: { id: true, name: true } }),
  ]);
  if (!lead) return 'Lead not found or access denied.';
  if (!agent) return 'Agent not found or inactive.';
  await db.lead.update({ where: { id: leadId }, data: { assignedAgentId: agentId } });
  return `Reassigned ${lead.customerName ?? 'Unknown'} to ${agent.name}.`;
}

async function deactivateAgent(companyId: string, params: Record<string, unknown>): Promise<string> {
  const agentId = getString(params, 'agentId');
  if (!agentId) return 'Missing agent id.';
  const user = await db.user.findFirst({ where: { id: agentId, companyId, status: 'active' }, select: { id: true, name: true } });
  if (!user) return 'User not found or already inactive.';
  await db.user.update({ where: { id: agentId }, data: { status: 'inactive' } });
  await db.agentSession.updateMany({ where: { userId: agentId, companyId }, data: { status: 'inactive' } });
  return `Deactivated ${user.name}.`;
}

async function bulkUpdateVisits(companyId: string, params: Record<string, unknown>): Promise<string> {
  const visitIds = Array.isArray(params.visitIds)
    ? params.visitIds.filter((id): id is string => typeof id === 'string')
    : [];
  if (!visitIds.length) return 'Missing visit ids.';

  // Reassign mode: toAgentId provided
  const toAgentId = getString(params, 'toAgentId');
  if (toAgentId) {
    const agent = await db.user.findFirst({
      where: { id: toAgentId, companyId, status: 'active' },
      select: { id: true, name: true },
    });
    if (!agent) return 'Target agent not found or inactive.';
    const result = await db.visit.updateMany({
      where: { id: { in: visitIds }, companyId },
      data: { agentId: toAgentId },
    });
    return `Reassigned ${result.count} visit(s) to ${agent.name}.`;
  }

  // Snooze mode: postponeByDays provided
  const postponeByDaysRaw = params.postponeByDays;
  const postponeByDays = typeof postponeByDaysRaw === 'number' ? postponeByDaysRaw : null;
  if (postponeByDays !== null && postponeByDays > 0) {
    const visits = await db.visit.findMany({
      where: { id: { in: visitIds }, companyId },
      select: { id: true, scheduledAt: true },
    });
    let count = 0;
    for (const visit of visits) {
      const newTime = new Date(visit.scheduledAt.getTime() + postponeByDays * 24 * 60 * 60 * 1000);
      await db.visit.update({
        where: { id: visit.id },
        data: { scheduledAt: newTime, reminderSent: false },
      });
      count += 1;
    }
    return `Postponed ${count} visit(s) by ${postponeByDays} day(s).`;
  }

  // Status update mode
  const status = getString(params, 'status');
  if (!status) return 'Missing toAgentId, postponeByDays, or status.';
  const result = await db.visit.updateMany({
    where: { id: { in: visitIds }, companyId },
    data: { status: status as any },
  });
  return `Updated ${result.count} visit(s) to ${status}.`;
}


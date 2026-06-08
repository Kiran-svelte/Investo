import prisma from '../config/prisma';
import logger from '../config/logger';
import { automationQueueService } from './automationQueue.service';
import { logAgentAction } from './agent-action-log.service';
import { incrementOpsMetric } from './opsMetrics.service';
import { formatDateIST } from './agent/tools/format-helpers';

export type BookingApprovalKind = 'visit' | 'call';
export type BookingApprovalStatus = 'pending' | 'approved' | 'declined' | 'cancelled' | 'expired';

export interface BookingApprovalRow {
  id: string;
  companyId: string;
  kind: BookingApprovalKind;
  status: BookingApprovalStatus;
  leadId: string;
  agentId: string;
  propertyId: string | null;
  callRequestId: string | null;
  scheduledAt: Date;
  customerPhone: string;
  customerName: string | null;
  conversationId: string | null;
  idempotencyKey: string;
  expiresAt: Date;
  resolvedAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBookingApprovalInput {
  companyId: string;
  kind: BookingApprovalKind;
  leadId: string;
  agentId: string;
  scheduledAt: Date;
  customerPhone: string;
  customerName?: string | null;
  propertyId?: string | null;
  callRequestId?: string | null;
  conversationId?: string | null;
  idempotencyKey: string;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

const DEFAULT_APPROVAL_EXPIRY_MS = 4 * 60 * 60 * 1000;
const AGENT_NUDGE_DELAY_MS = 30 * 60 * 1000;

function approvalModel(): any {
  return (prisma as any).bookingApprovalRequest;
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapApproval(row: any): BookingApprovalRow {
  return {
    id: row.id,
    companyId: row.companyId,
    kind: row.kind,
    status: row.status,
    leadId: row.leadId,
    agentId: row.agentId,
    propertyId: row.propertyId ?? null,
    callRequestId: row.callRequestId ?? null,
    scheduledAt: row.scheduledAt instanceof Date ? row.scheduledAt : new Date(row.scheduledAt),
    customerPhone: row.customerPhone,
    customerName: row.customerName ?? null,
    conversationId: row.conversationId ?? null,
    idempotencyKey: row.idempotencyKey,
    expiresAt: row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt),
    resolvedAt: row.resolvedAt ? (row.resolvedAt instanceof Date ? row.resolvedAt : new Date(row.resolvedAt)) : null,
    metadata: normalizeMetadata(row.metadata),
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt),
  };
}

export function buildVisitApprovalIdempotencyKey(input: {
  companyId: string;
  leadId: string;
  propertyId: string;
  scheduledAt: Date;
}): string {
  return `visit_approval:${input.companyId}:${input.leadId}:${input.propertyId}:${input.scheduledAt.toISOString()}`;
}

export function buildCallApprovalIdempotencyKey(input: {
  companyId: string;
  leadId: string;
  scheduledAt: Date;
}): string {
  return `call_approval:${input.companyId}:${input.leadId}:${input.scheduledAt.toISOString()}`;
}

async function cancelApprovalJobs(approvalId: string): Promise<void> {
  await Promise.all([
    automationQueueService.cancel('booking_approval_agent_nudge', approvalId).catch(() => false),
    automationQueueService.cancel('booking_approval_expire', approvalId).catch(() => false),
  ]);
}

async function scheduleApprovalJobs(approval: BookingApprovalRow): Promise<void> {
  const now = Date.now();
  await cancelApprovalJobs(approval.id);

  const nudgeAt = new Date(now + AGENT_NUDGE_DELAY_MS);
  if (nudgeAt < approval.expiresAt) {
    await automationQueueService.schedule(
      'booking_approval_agent_nudge',
      approval.id,
      nudgeAt,
      { approvalId: approval.id },
    ).catch((err: unknown) => {
      logger.warn('Booking approval nudge schedule failed', {
        approvalId: approval.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    });
  }

  if (approval.expiresAt.getTime() > now) {
    await automationQueueService.schedule(
      'booking_approval_expire',
      approval.id,
      approval.expiresAt,
      { approvalId: approval.id },
    ).catch((err: unknown) => {
      logger.warn('Booking approval expiry schedule failed', {
        approvalId: approval.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    });
  }
}

export async function createBookingApprovalRequest(
  input: CreateBookingApprovalInput,
): Promise<{ approval: BookingApprovalRow; created: boolean; idempotencyHit: boolean }> {
  const model = approvalModel();
  if (!model?.findUnique || !model?.create || !model?.update) {
    throw new Error('bookingApprovalRequest Prisma model is not available. Run migrations and prisma generate.');
  }

  const expiresAt = input.expiresAt ?? new Date(Date.now() + DEFAULT_APPROVAL_EXPIRY_MS);
  const data = {
    companyId: input.companyId,
    kind: input.kind,
    status: 'pending' as BookingApprovalStatus,
    leadId: input.leadId,
    agentId: input.agentId,
    propertyId: input.propertyId ?? null,
    callRequestId: input.callRequestId ?? null,
    scheduledAt: input.scheduledAt,
    customerPhone: input.customerPhone,
    customerName: input.customerName ?? null,
    conversationId: input.conversationId ?? null,
    idempotencyKey: input.idempotencyKey,
    expiresAt,
    resolvedAt: null,
    metadata: input.metadata ?? {},
  };

  const existing = await model.findUnique({
    where: { companyId_idempotencyKey: { companyId: input.companyId, idempotencyKey: input.idempotencyKey } },
  });

  if (existing) {
    const row = mapApproval(existing);
    if (row.status === 'pending') {
      incrementOpsMetric('booking_approval_idem_hit');
      return { approval: row, created: false, idempotencyHit: true };
    }

    const updated = await model.update({
      where: { id: existing.id },
      data,
    });
    const approval = mapApproval(updated);
    await scheduleApprovalJobs(approval);
    void logAgentAction({
      companyId: approval.companyId,
      triggeredBy: 'inbound_message',
      action: 'booking_approval_reopened',
      resourceType: approval.kind === 'visit' ? 'visit' : 'call_request',
      resourceId: approval.callRequestId ?? approval.id,
      status: 'success',
      inputs: { kind: approval.kind, leadId: approval.leadId, scheduledAt: approval.scheduledAt.toISOString() },
    });
    return { approval, created: false, idempotencyHit: false };
  }

  const created = await model.create({ data });
  const approval = mapApproval(created);
  await scheduleApprovalJobs(approval);
  void logAgentAction({
    companyId: approval.companyId,
    triggeredBy: 'inbound_message',
    action: 'booking_approval_created',
    resourceType: approval.kind === 'visit' ? 'visit' : 'call_request',
    resourceId: approval.callRequestId ?? approval.id,
    status: 'success',
    inputs: { kind: approval.kind, leadId: approval.leadId, scheduledAt: approval.scheduledAt.toISOString() },
  });
  return { approval, created: true, idempotencyHit: false };
}

export async function getBookingApprovalById(approvalId: string): Promise<BookingApprovalRow | null> {
  const model = approvalModel();
  if (!model?.findUnique) return null;
  const row = await model.findUnique({ where: { id: approvalId } });
  return row ? mapApproval(row) : null;
}

export async function findPendingBookingApproval(input: {
  companyId: string;
  kind: BookingApprovalKind;
  agentId?: string;
  leadId?: string;
  approvalId?: string;
  callRequestId?: string;
}): Promise<BookingApprovalRow | null> {
  const model = approvalModel();
  if (!model?.findFirst) return null;
  const row = await model.findFirst({
    where: {
      companyId: input.companyId,
      kind: input.kind,
      status: 'pending',
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.leadId ? { leadId: input.leadId } : {}),
      ...(input.approvalId ? { id: input.approvalId } : {}),
      ...(input.callRequestId ? { callRequestId: input.callRequestId } : {}),
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });
  return row ? mapApproval(row) : null;
}

export async function updatePendingBookingApprovalSchedule(input: {
  approvalId: string;
  scheduledAt: Date;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}): Promise<BookingApprovalRow | null> {
  const model = approvalModel();
  if (!model?.updateMany || !model?.findUnique) return null;
  const expiresAt = new Date(Date.now() + DEFAULT_APPROVAL_EXPIRY_MS);
  const current = await model.findUnique({ where: { id: input.approvalId } });
  if (!current || current.status !== 'pending') return null;
  const metadata = { ...normalizeMetadata(current.metadata), ...(input.metadata ?? {}) };
  await model.updateMany({
    where: { id: input.approvalId, status: 'pending' },
    data: {
      scheduledAt: input.scheduledAt,
      expiresAt,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      metadata,
    },
  });
  const updated = await model.findUnique({ where: { id: input.approvalId } });
  if (!updated) return null;
  const approval = mapApproval(updated);
  await scheduleApprovalJobs(approval);
  void logAgentAction({
    companyId: approval.companyId,
    triggeredBy: 'inbound_message',
    action: 'booking_approval_rescheduled',
    resourceType: approval.kind === 'visit' ? 'visit' : 'call_request',
    resourceId: approval.callRequestId ?? approval.id,
    status: 'success',
    inputs: { kind: approval.kind, scheduledAt: approval.scheduledAt.toISOString() },
  });
  return approval;
}

export async function resolveBookingApprovalStatus(input: {
  approvalId: string;
  status: Exclude<BookingApprovalStatus, 'pending'>;
}): Promise<BookingApprovalRow | null> {
  const model = approvalModel();
  if (!model?.updateMany || !model?.findUnique) return null;
  const current = await model.findUnique({ where: { id: input.approvalId } });
  if (!current || current.status !== 'pending') return current ? mapApproval(current) : null;
  await model.updateMany({
    where: { id: input.approvalId, status: 'pending' },
    data: { status: input.status, resolvedAt: new Date() },
  });
  await cancelApprovalJobs(input.approvalId);
  const updated = await model.findUnique({ where: { id: input.approvalId } });
  if (!updated) return null;
  const approval = mapApproval(updated);
  void logAgentAction({
    companyId: approval.companyId,
    triggeredBy: input.status === 'expired' ? 'automation' : 'inbound_message',
    action: `booking_approval_${input.status}`,
    resourceType: approval.kind === 'visit' ? 'visit' : 'call_request',
    resourceId: approval.callRequestId ?? approval.id,
    status: 'success',
    inputs: { kind: approval.kind, leadId: approval.leadId, scheduledAt: approval.scheduledAt.toISOString() },
  });
  return approval;
}

export async function cancelPendingBookingApproval(
  approvalId: string,
): Promise<BookingApprovalRow | null> {
  return resolveBookingApprovalStatus({ approvalId, status: 'cancelled' });
}

export async function sendBookingApprovalAgentNudge(approvalId: string): Promise<void> {
  const approval = await getBookingApprovalById(approvalId);
  if (!approval || approval.status !== 'pending' || approval.expiresAt <= new Date()) return;

  const [agent, lead, property] = await Promise.all([
    prisma.user.findUnique({ where: { id: approval.agentId }, select: { phone: true, name: true } }),
    prisma.lead.findUnique({ where: { id: approval.leadId }, select: { customerName: true, phone: true } }),
    approval.propertyId
      ? prisma.property.findUnique({ where: { id: approval.propertyId }, select: { name: true } })
      : Promise.resolve(null),
  ]);
  if (!agent?.phone) return;

  const when = formatDateIST(approval.scheduledAt);
  const customer = approval.customerName ?? lead?.customerName ?? lead?.phone ?? approval.customerPhone;
  const subject = approval.kind === 'visit'
    ? `site visit${property?.name ? ` for ${property.name}` : ''}`
    : 'callback';
  const approveId = approval.kind === 'visit'
    ? `visit-approve-${approval.id}`
    : `call-approve-${approval.callRequestId ?? approval.id}`;
  const declineId = approval.kind === 'visit'
    ? `visit-decline-${approval.id}`
    : `call-decline-${approval.callRequestId ?? approval.id}`;

  const { whatsappService } = await import('./whatsapp.service');
  await whatsappService.sendCompanyInteractiveButtons(
    agent.phone,
    approval.companyId,
    `Reminder: *${customer}* is waiting for ${subject} approval.\n\nWhen: *${when}*\n\nPlease confirm or decline.`,
    [
      { id: approveId, title: 'Confirm' },
      { id: declineId, title: 'Decline' },
    ],
    'Approval pending',
    'Investo CRM',
  );
}

export async function expireBookingApproval(approvalId: string): Promise<boolean> {
  const approval = await getBookingApprovalById(approvalId);
  if (!approval || approval.status !== 'pending') return false;
  if (approval.expiresAt > new Date()) return false;

  const expired = await resolveBookingApprovalStatus({ approvalId, status: 'expired' });
  if (!expired) return false;

  const { whatsappService } = await import('./whatsapp.service');
  const text = expired.kind === 'visit'
    ? `We could not confirm your visit request in time. Please reply with a fresh date and time, and I will request approval again.`
    : `We could not confirm your callback request in time. Please reply with another preferred call time, and I will request approval again.`;
  if (expired.customerPhone) {
    await whatsappService.sendCompanyTextMessage(expired.customerPhone, text, expired.companyId).catch((err: unknown) => {
      logger.warn('Booking approval expiry customer notification failed', {
        approvalId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
  return true;
}

export async function expireStaleBookingApprovals(limit = 50): Promise<number> {
  const model = approvalModel();
  if (!model?.findMany) return 0;
  const rows = await model.findMany({
    where: { status: 'pending', expiresAt: { lte: new Date() } },
    orderBy: { expiresAt: 'asc' },
    take: limit,
  });
  let count = 0;
  for (const row of rows) {
    if (await expireBookingApproval(row.id)) count += 1;
  }
  return count;
}


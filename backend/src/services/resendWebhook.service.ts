import prisma from '../config/prisma';
import logger from '../config/logger';

const EMAIL_ERROR_MAX_LENGTH = 2000;

export type ResendEmailWebhookEvent = {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    message_id?: string;
    to?: string[];
    subject?: string;
    bounce?: {
      message?: string;
      type?: string;
      subType?: string;
    };
  };
};

export type ResendInviteWebhookResult =
  | { status: 'ignored'; reason: 'unsupported_event' | 'missing_email_id' | 'unknown_message_id'; emailId?: string }
  | { status: 'duplicate'; inviteId: string; emailId: string }
  | { status: 'updated'; inviteId: string; emailId: string; deliveryStatus: string };

const EVENT_STATUS: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.failed': 'failed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.suppressed': 'suppressed',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
};

const STATUS_RANK: Record<string, number> = {
  pending: 0,
  sent: 1,
  delivery_delayed: 2,
  delivered: 3,
  opened: 4,
  clicked: 4,
  failed: 5,
  bounced: 5,
  complained: 5,
  suppressed: 5,
};

function parseEventAt(value?: string): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function truncate(value?: string): string | null {
  if (!value) return null;
  return value.slice(0, EMAIL_ERROR_MAX_LENGTH);
}

function failureReason(event: ResendEmailWebhookEvent): string | null {
  if (event.data?.bounce?.message) return truncate(event.data.bounce.message);
  if (event.type === 'email.complained') return 'Recipient marked this email as spam.';
  if (event.type === 'email.suppressed') return 'Resend suppressed delivery to this recipient.';
  if (event.type === 'email.failed') return 'Resend reported email delivery failure.';
  return null;
}

function resolveNextStatus(currentStatus: string | null | undefined, eventStatus: string): string {
  const current = currentStatus || 'pending';
  const currentRank = STATUS_RANK[current] ?? 0;
  const eventRank = STATUS_RANK[eventStatus] ?? 0;
  return eventRank >= currentRank ? eventStatus : current;
}

export async function applyResendEmailEventToAgencyInvite(
  event: ResendEmailWebhookEvent,
  deliveryId: string,
): Promise<ResendInviteWebhookResult> {
  const eventStatus = EVENT_STATUS[event.type];
  if (!eventStatus) {
    return { status: 'ignored', reason: 'unsupported_event' };
  }

  const emailId = event.data?.email_id;
  if (!emailId) {
    return { status: 'ignored', reason: 'missing_email_id' };
  }

  const invite = await prisma.agencyInvite.findFirst({
    where: { emailMessageId: emailId },
    select: {
      id: true,
      emailDeliveryStatus: true,
      emailLastEventId: true,
    },
  });

  if (!invite) {
    logger.warn('Resend webhook ignored: no agency invite for email id', {
      emailId,
      eventType: event.type,
      deliveryId,
    });
    return { status: 'ignored', reason: 'unknown_message_id', emailId };
  }

  if (invite.emailLastEventId === deliveryId) {
    return { status: 'duplicate', inviteId: invite.id, emailId };
  }

  const eventAt = parseEventAt(event.created_at);
  const nextStatus = resolveNextStatus(invite.emailDeliveryStatus, eventStatus);
  const data: Record<string, unknown> = {
    emailDeliveryStatus: nextStatus,
    emailLastEventAt: eventAt,
    emailLastEventId: deliveryId,
  };

  if (eventStatus === 'sent') {
    data.emailSentAt = eventAt;
  }

  if (eventStatus === 'delivered' && nextStatus === 'delivered') {
    data.emailDeliveredAt = eventAt;
    data.emailLastError = null;
  }

  if (['failed', 'bounced', 'complained', 'suppressed'].includes(eventStatus) && nextStatus === eventStatus) {
    data.emailLastError = failureReason(event);
  }

  await prisma.agencyInvite.update({
    where: { id: invite.id },
    data,
  });

  logger.info('Agency invite email event recorded', {
    inviteId: invite.id,
    emailId,
    eventType: event.type,
    status: nextStatus,
    deliveryId,
  });

  return { status: 'updated', inviteId: invite.id, emailId, deliveryStatus: nextStatus };
}

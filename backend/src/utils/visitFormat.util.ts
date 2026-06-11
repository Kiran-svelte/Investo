/**
 * Canonical customer-facing visit message formatters.
 * All buyer-visible visit status messages should use these functions.
 */

function formatVisitDateTime(scheduledAt: Date): string {
  return scheduledAt.toLocaleString('en-IN', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

/**
 * Canonical confirmation message for a newly scheduled or rescheduled visit.
 * Used by all paths: text parser, workflow action, interactive buttons.
 */
export function formatBuyerVisitScheduled(
  scheduledAt: Date,
  propertyName: string,
  agentName?: string | null,
  mode: 'scheduled' | 'rescheduled' = 'scheduled',
): string {
  const when = formatVisitDateTime(scheduledAt);
  const title = mode === 'rescheduled' ? 'Visit rescheduled' : 'Visit scheduled';
  return (
    `*${title}*\n\n` +
    `Property: *${propertyName}*\n` +
    `Date: ${when}\n\n` +
    `Our specialist${agentName ? ` *${agentName}*` : ''} will call you about an hour before the visit to confirm. See you then! 😊`
  );
}

/**
 * Canonical cancellation message for a buyer-initiated visit cancel.
 */
export function formatBuyerVisitCancelled(
  scheduledAt: Date,
  propertyName: string,
): string {
  const when = formatVisitDateTime(scheduledAt);
  return (
    `Your site visit for *${propertyName}* (${when}) has been *cancelled*.\n\n` +
    `Reply with a new date and time if you'd like to book again.`
  );
}

/**
 * Canonical pending-approval message when auto-confirm is off.
 */
export function formatBuyerVisitPendingApproval(agentName?: string | null): string {
  return `Thanks! I've shared your preferred visit time with our sales specialist *${agentName || 'team'}*. You'll receive WhatsApp confirmation once they approve the slot. 🙂`;
}

/** Pending-approval reply with the requested slot — used by typed and button booking paths. */
export function formatBuyerVisitPendingApprovalReply(
  scheduledAt: Date,
  agentName?: string | null,
): string {
  return `${formatBuyerVisitPendingApproval(agentName)}\n\nRequested time: ${formatVisitDateTime(scheduledAt)}`;
}

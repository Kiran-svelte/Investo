import { formatDateIST } from '../services/agent/tools/format-helpers';
import {
  isGenericSafeBuyerFallback,
  shouldNotifyStaffForBuyerAiFailure,
} from './buyerAiTransparency.util';

export type SafeBuyerFallbackContext = {
  activeVisit?: {
    propertyName?: string | null;
    scheduledAt: Date | string;
    status?: string;
  } | null;
};

export { isGenericSafeBuyerFallback, shouldNotifyStaffForBuyerAiFailure };

/**
 * Safe fallback when LLM fails, times out, or post-filter rejects output (fix.md §9).
 * Never invents connection errors or duplicate welcomes.
 */
export function buildSafeBuyerFallback(ctx: SafeBuyerFallbackContext = {}): string {
  const visit = ctx.activeVisit;
  if (visit?.propertyName && visit.scheduledAt) {
    const when = formatDateIST(new Date(visit.scheduledAt));
    const prop = visit.propertyName;
    return (
      `I could not safely verify new visit details just now. Your visit to *${prop}* on ${when} is still on record. ` +
      `Our team is being notified. Tell me a new preferred time here, or reply *cancel visit* if you want to cancel.`
    );
  }
  return (
    'I could not safely complete that request just now. ' +
    'Our team is being notified, and I will continue using only verified property and visit details.'
  );
}

/** Stage-bleed safe reply when LLM asks for budget/area during visit_booking. */
export function buildVisitBookingStageSafeReply(propertyName?: string | null): string {
  const prop = propertyName ? `*${propertyName}*` : 'your selected property';
  return `Let's lock in your visit to ${prop}. Tell me your preferred date and time here, and I will confirm only after it is recorded.`;
}

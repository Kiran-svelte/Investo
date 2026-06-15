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
      `I'm having a brief delay. Your visit to *${prop}* on ${when} is still on record. ` +
      `Reply *Confirm*, *Reschedule*, or *Cancel*.`
    );
  }
  return "I'm sorry, I'm temporarily unable to respond. Please type *Talk to agent* for immediate help.";
}

/** Stage-bleed safe reply when LLM asks for budget/area during visit_booking. */
export function buildVisitBookingStageSafeReply(propertyName?: string | null): string {
  const prop = propertyName ? `*${propertyName}*` : 'your selected property';
  return `Let's lock in your visit to ${prop}. Tap a time button above, or tell me your preferred date and time.`;
}

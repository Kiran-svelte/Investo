import type { LiveLeadContext } from '../services/liveLeadContext.service';

/** CRM lead statuses that mean the buyer is past first-time qualification. */
export const ADVANCED_LEAD_STATUSES = new Set([
  'visit_scheduled',
  'visited',
  'negotiation',
  'closed_won',
]);

/** Lead statuses where a site visit already happened (post-visit UX). */
export const POST_VISIT_LEAD_STATUSES = new Set([
  'visited',
  'negotiation',
  'closed_won',
]);

export function isAdvancedLeadStatus(status?: string | null): boolean {
  if (!status) return false;
  return ADVANCED_LEAD_STATUSES.has(status);
}

export function isPostVisitLeadStatus(status?: string | null): boolean {
  if (!status) return false;
  return POST_VISIT_LEAD_STATUSES.has(status);
}

/**
 * Conversation stage to use when CRM shows progress but DB stage is still rapport.
 */
export function resolveStageFromLeadStatus(status: string): 'shortlist' | 'commitment' {
  if (status === 'negotiation' || status === 'closed_won') return 'commitment';
  return 'shortlist';
}

/**
 * True when buyer should get post-visit buttons and skip re-qualification.
 * Uses completed visit rows OR CRM visited/negotiation/closed_won without active booking.
 */
export function isPostVisitBuyer(liveCtx: Pick<LiveLeadContext, 'activeVisit' | 'recentCompletedVisit' | 'leadStatus'>): boolean {
  if (liveCtx.activeVisit) return false;
  if (liveCtx.recentCompletedVisit) return true;
  return isPostVisitLeadStatus(liveCtx.leadStatus);
}

export function buildPostVisitWelcomeReply(input: {
  customerName?: string | null;
  companyName: string;
  propertyName?: string | null;
}): string {
  const name = (input.customerName ?? '').trim();
  const company = input.companyName.trim() || 'our team';
  const property = input.propertyName?.trim();
  const visitRef = property ? `your visit to *${property}*` : 'your recent site visit';
  const greeting = name ? `Welcome back, *${name}*!` : 'Welcome back!';
  return (
    `${greeting} How did ${visitRef} go?\n\n` +
    `I can help you share feedback, talk to your agent, or explore more options from *${company}*.`
  );
}

export function buildAdvancedReturningReply(input: {
  customerName?: string | null;
  companyName: string;
  leadStatus: string;
  locationPreference?: string | null;
}): string {
  if (isPostVisitLeadStatus(input.leadStatus)) {
    return buildPostVisitWelcomeReply({
      customerName: input.customerName,
      companyName: input.companyName,
    });
  }
  const name = (input.customerName ?? '').trim();
  const area = input.locationPreference?.trim();
  const areaHint = area ? `Still interested in *${area}*?` : 'Ready to pick up where we left off?';
  return name
    ? `Hi *${name}*! ${areaHint} Tell me what you'd like next — more options, a visit, or property details.`
    : `Hi! ${areaHint} Tell me what you'd like next — more options, a visit, or property details.`;
}

/**
 * @module mutationLanguageGuard.service
 *
 * Guards against false booking/update/cancellation claims in AI-generated text.
 *
 * Problem: the LLM language brain has no awareness of whether a backend mutation
 * actually succeeded this turn. Without this guard it can freely produce phrases
 * like "Your visit is booked for tomorrow at 4pm" even when no DB write occurred.
 *
 * Solution: intercept every buyer-facing text before sending, check whether any
 * mutation-claim language is present, and replace the false claim with a safe
 * redirect if no successful mutation is recorded in the turn context.
 *
 * This service must be called after LLM generation and before the outbound send.
 * It is intentionally NOT applied to workflow success replies — those already
 * carry `actionResult.status === 'success'` and are correct by construction.
 */

import logger from '../../config/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MutationLanguageTurnContext = {
  companyId?: string;
  leadId?: string;
  visitCommitted?: boolean;
  workflowSuccess?: boolean;
  workflowId?: string;
  actionStatus?: 'success' | 'failed' | 'needs_confirmation';
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Booking-claim patterns that should only appear in buyer text when a mutation
 * actually succeeded. Case-insensitive.
 *
 * Deliberately strict — require action verb + state noun combination to avoid
 * false positives on phrases like "we'll confirm shortly".
 */
const BOOKING_CLAIM_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(your visit is|visit is) (booked|scheduled|confirmed)\b/i,
  /\bsuccessfully (booked|scheduled|confirmed|cancelled|canceled|rescheduled)\b/i,
  /\b(i'?ve?|i have) (booked|scheduled|confirmed|cancelled|canceled|rescheduled)\b/i,
  /\byour visit has been (booked|scheduled|confirmed|cancelled|canceled|rescheduled)\b/i,
  /\bvisit (booked|confirmed|scheduled) for\b/i,
  /\b(booking|appointment|visit) confirmed\b/i,
  /\byour (cancellation|reschedule) is confirmed\b/i,
  /\b(cancelled|canceled|rescheduled) your visit\b/i,
];

/** Simple fallback pattern used when none of the structured patterns match
 * but the word appears in a clearly false success context. */
const BOOKING_CLAIM_PATTERN_FALLBACK =
  /\b(booked|scheduled|confirmed|updated|cancelled|canceled|rescheduled|completed)\b/i;

/**
 * Safe redirect text when booking language is detected without a confirmed mutation.
 * Must not contain any booking/update claim itself.
 */
const SAFE_BOOKING_REDIRECT =
  'I can help with that — which project and time works for you? Reply with the details and I will confirm once everything is locked in.';

/**
 * Safe redirect for cancellation/reschedule claims without confirmed mutation.
 */
const SAFE_MUTATION_REDIRECT =
  'I want to make sure I process that correctly. Could you confirm what you\'d like to change? I\'ll take care of it right away.';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the text contains a booking/update claim pattern.
 *
 * @param text - Outbound text to inspect.
 * @returns Whether a claim pattern matched.
 */
function containsBookingClaim(text: string): boolean {
  return BOOKING_CLAIM_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Returns true if a mutation succeeded this turn.
 * A mutation is considered successful when any of these hold:
 *   - A visit commit DB write occurred (`visitCommitted`)
 *   - A workflow mutation step completed (`workflowSuccess`)
 *   - Explicit `actionStatus === 'success'`
 *
 * @param ctx - Turn context carrying mutation outcome flags.
 */
function hasMutationSucceeded(ctx: MutationLanguageTurnContext): boolean {
  return (
    ctx.visitCommitted === true
    || ctx.workflowSuccess === true
    || ctx.actionStatus === 'success'
  );
}

/**
 * Select the appropriate safe redirect based on message content.
 *
 * @param text - Outbound text to inspect for mutation type hints.
 */
function selectSafeRedirect(text: string): string {
  const isCancelOrReschedule = /\b(cancel|reschedule|change|move)\b/i.test(text);
  return isCancelOrReschedule ? SAFE_MUTATION_REDIRECT : SAFE_BOOKING_REDIRECT;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Inspects buyer-facing text for false booking/update claims and replaces them
 * with a safe redirect when no mutation succeeded this turn.
 *
 * Call this after LLM text generation and before sending any buyer outbound.
 * Safe to call on non-LLM paths (workflow replies, fast-paths) — those already
 * have `actionResult` set so no replacement will occur.
 *
 * @param text - Raw outbound text (may come from LLM, workflow, or fast-path).
 * @param turnContext - Per-turn context with mutation outcome flags.
 * @returns The original text, or a safe replacement if a false claim was detected.
 *
 * @throws Never — all errors are caught and logged; original text is returned on error.
 *
 * @example
 * // LLM falsely claimed booking — replaced with redirect:
 * guardBookingClaims(
 *   "Your visit is booked for tomorrow at 4pm!",
 *   { visitCommitted: false, workflowSuccess: false }
 * );
 * // → "I can help with that — which project and time works for you?..."
 *
 * @example
 * // Workflow confirmed booking — text passes through unchanged:
 * guardBookingClaims(
 *   "✅ Your visit at Lake Vista is confirmed for Saturday at 4pm.",
 *   { visitCommitted: false, workflowSuccess: true }
 * );
 * // → "✅ Your visit at Lake Vista is confirmed for Saturday at 4pm."
 */
export function guardBookingClaims(
  text: string,
  turnContext: MutationLanguageTurnContext,
): string {
  try {
    const trimmed = text?.trim();
    if (!trimmed) return text;

    if (hasMutationSucceeded(turnContext)) return text;

    const hasStructuredClaim = containsBookingClaim(trimmed);
    if (!hasStructuredClaim) return text;

    const safeRedirect = selectSafeRedirect(trimmed);

    logger.warn('mutationLanguageGuard: false booking claim detected — replacing with safe redirect', {
      companyId: turnContext.companyId ?? 'unknown',
      leadId: turnContext.leadId ?? 'unknown',
      visitCommitted: turnContext.visitCommitted ?? false,
      workflowSuccess: turnContext.workflowSuccess ?? false,
      workflowId: turnContext.workflowId ?? null,
      originalTextSample: trimmed.slice(0, 120),
    });

    return safeRedirect;
  } catch (err: unknown) {
    logger.error('mutationLanguageGuard: unexpected error — returning original text', {
      error: err instanceof Error ? err.message : String(err),
    });
    return text;
  }
}

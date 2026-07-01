import type { BuyerAssistReason } from '../services/buyerAgentAssist.service';

/** Snippets in buyer-visible replies that mean AI/system failed — staff must be alerted. */
const STAFF_ALERT_SNIPPETS = [
  "I'm sorry, I'm temporarily unable to respond",
  'I could not safely complete that request just now',
  'I could not safely fetch your visit details just now',
  'I could not safely verify new visit details just now',
  'Our team is being notified',
  'Sorry, I had a brief issue',
  "I couldn't fetch your visit details just now",
  'I could not fetch your visit details just now',
  'having a brief delay',
  'Please type *Talk to agent*',
  'type *Talk to agent* for immediate help',
  'type *Talk to agent* for help',
] as const;

/** Normal browse / clarification replies — not AI infrastructure failures. */
const STAFF_ALERT_EXCLUDE_PATTERNS = [
  /\bcouldn't find a \*\d/i,
  /\bmatching options\b/i,
  /\bactive project\b/i,
  /\bview listings\b/i,
  /\bbook visit\b/i,
  /\btap a time button\b/i,
  /\block in your visit\b/i,
] as const;

export type BuyerStaffAssistDetection = {
  shouldNotify: true;
  reason: BuyerAssistReason;
  summary: string;
  detail?: string;
};

export function isGenericSafeBuyerFallback(text: string): boolean {
  return (
    text.includes("I'm sorry, I'm temporarily unable to respond") ||
    text.includes('I could not safely complete that request just now')
  );
}

/**
 * Returns true when outbound text indicates the buyer AI could not help and staff should follow up.
 * Excludes normal inventory clarifications ("couldn't find 3 BHK in X").
 */
export function shouldNotifyStaffForBuyerAiFailure(text: string): boolean {
  return detectBuyerAiStaffAssist({ outboundText: text }) !== null;
}

/**
 * Detect whether staff should be notified for this buyer turn.
 * Prefer explicit `staffAssist` on TurnResult when the handler already knows the failure reason.
 */
export function detectBuyerAiStaffAssist(input: {
  outboundText: string;
  customerMessage?: string | null;
  explicitReason?: BuyerAssistReason;
  explicitSummary?: string;
  explicitDetail?: string | null;
}): BuyerStaffAssistDetection | null {
  if (input.explicitReason) {
    return {
      shouldNotify: true,
      reason: input.explicitReason,
      summary: input.explicitSummary ?? 'Buyer AI could not complete this request',
      detail: input.explicitDetail ?? undefined,
    };
  }

  const text = input.outboundText.trim();
  if (!text) return null;

  if (STAFF_ALERT_EXCLUDE_PATTERNS.some((re) => re.test(text))) {
    return null;
  }

  const matchedSnippet = STAFF_ALERT_SNIPPETS.find((snippet) => text.includes(snippet));
  if (!matchedSnippet) {
    return null;
  }

  let reason: BuyerAssistReason = 'ai_action_blocked';
  let summary = 'Buyer AI could not respond — customer needs agent follow-up';

  if (text.includes('fetch your visit details') || text.includes('brief delay')) {
    reason = 'visit_booking_failure';
    summary = 'Buyer AI could not fetch visit details — customer may need manual help';
  }

  if (text.includes('visit details') || text.includes('brief delay')) {
    reason = 'visit_booking_failure';
    summary = 'Buyer AI could not verify visit details - customer may need manual help';
  } else {
    summary = 'Buyer AI could not safely complete the request - agent follow-up needed';
  }

  return {
    shouldNotify: true,
    reason,
    summary,
    detail: `Matched failure pattern: ${matchedSnippet.slice(0, 80)}`,
  };
}

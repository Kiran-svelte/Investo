/**
 * Post-LLM guard: ensures replies never dead-end without an alternative CTA.
 */

import { stripUngroundedClaims, buildGroundedNumberAllowlist } from './groundingGuard.service';
import type { PropertyLike } from './propertyCompleteness.service';

const DEAD_END_PATTERNS = [
  /\bwe don'?t have\b/i,
  /\bnot available\b/i,
  /\bsorry,? we\b/i,
  /\bnothing (available|matches)\b/i,
  /\bno (inventory|properties|listings)\b/i,
  /\bunfortunately\b/i,
];

export interface NeverSayNoGuardInput {
  text: string;
  hasInventoryAlternatives: boolean;
  fallbackCta: string;
  groundedProperties?: PropertyLike[];
  conversionPromptBlock?: string;
  /** Skip redundant visit-booking CTA when a slot is already discussed or confirmed. */
  skipFallbackCta?: boolean;
}

const VISIT_ALREADY_ADDRESSED = [
  /\bvisit\s+(scheduled|confirmed|booked|noted|set)\b/i,
  /\b(site\s+)?visit\b.*\b(saturday|sunday|monday|tuesday|wednesday|thursday|friday|tomorrow|today)\b/i,
  /\bagent will (call|give you a call|contact)\b/i,
  /\bsee you (then|there|soon)\b/i,
  /\bpreferred (visit )?time\b/i,
  /\bnoted your preference\b/i,
  /\bconfirm everything\b/i,
  /✅\s*\*?Visit scheduled/i,
];

function visitAlreadyAddressed(text: string): boolean {
  return VISIT_ALREADY_ADDRESSED.some((p) => p.test(text));
}

function applyGrounding(text: string, input: NeverSayNoGuardInput): { text: string; guardApplied: boolean } {
  if (!input.groundedProperties?.length) {
    return { text, guardApplied: false };
  }
  const allowlist = buildGroundedNumberAllowlist(input.groundedProperties, input.conversionPromptBlock);
  return stripUngroundedClaims(text, allowlist);
}

export function enforceNeverSayNoResponse(input: NeverSayNoGuardInput): {
  text: string;
  guardApplied: boolean;
} {
  const trimmed = input.text.trim();
  let resultText: string;
  let guardApplied = false;

  if (!trimmed) {
    resultText = `${input.fallbackCta}\n\nWhich option should I share first?`;
    guardApplied = true;
  } else {
    const hasDeadEnd = DEAD_END_PATTERNS.some((p) => p.test(trimmed));
    const lacksQuestion = !trimmed.includes('?');

    const skipCta = input.skipFallbackCta || visitAlreadyAddressed(trimmed);

    if (!hasDeadEnd && (!lacksQuestion || skipCta)) {
      resultText = trimmed;
    } else if (hasDeadEnd || (lacksQuestion && !input.hasInventoryAlternatives)) {
      const bridge = input.hasInventoryAlternatives
        ? 'I do have strong alternatives for you — let me share the best matches.'
        : 'I can still help with waitlist, EMI options, partner inventory, or a free legal check on any property you find.';
      resultText = `${bridge}\n\n${input.fallbackCta}`;
      guardApplied = true;
    } else if (lacksQuestion && !skipCta) {
      resultText = `${trimmed}\n\n${input.fallbackCta}`;
      guardApplied = true;
    } else {
      resultText = trimmed;
    }
  }

  const grounded = applyGrounding(resultText, input);
  return {
    text: grounded.text,
    guardApplied: guardApplied || grounded.guardApplied,
  };
}

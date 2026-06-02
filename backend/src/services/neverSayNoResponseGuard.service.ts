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

    if (!hasDeadEnd && !lacksQuestion) {
      resultText = trimmed;
    } else if (hasDeadEnd || (lacksQuestion && !input.hasInventoryAlternatives)) {
      const bridge = input.hasInventoryAlternatives
        ? 'I do have strong alternatives for you — let me share the best matches.'
        : 'I can still help with waitlist, EMI options, partner inventory, or a free legal check on any property you find.';
      resultText = `${bridge}\n\n${input.fallbackCta}`;
      guardApplied = true;
    } else if (lacksQuestion) {
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

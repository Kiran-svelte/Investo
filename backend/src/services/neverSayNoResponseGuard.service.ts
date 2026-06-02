/**
 * Post-LLM guard: ensures replies never dead-end without an alternative CTA.
 */

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
}

export function enforceNeverSayNoResponse(input: NeverSayNoGuardInput): {
  text: string;
  guardApplied: boolean;
} {
  const trimmed = input.text.trim();
  if (!trimmed) {
    return {
      text: `${input.fallbackCta}\n\nWhich option should I share first?`,
      guardApplied: true,
    };
  }

  const hasDeadEnd = DEAD_END_PATTERNS.some((p) => p.test(trimmed));
  const lacksQuestion = !trimmed.includes('?');

  if (!hasDeadEnd && !lacksQuestion) {
    return { text: trimmed, guardApplied: false };
  }

  if (hasDeadEnd || (lacksQuestion && !input.hasInventoryAlternatives)) {
    const bridge = input.hasInventoryAlternatives
      ? 'I do have strong alternatives for you — let me share the best matches.'
      : 'I can still help with waitlist, EMI options, partner inventory, or a free legal check on any property you find.';

    return {
      text: `${bridge}\n\n${input.fallbackCta}`,
      guardApplied: true,
    };
  }

  if (lacksQuestion) {
    return {
      text: `${trimmed}\n\n${input.fallbackCta}`,
      guardApplied: true,
    };
  }

  return { text: trimmed, guardApplied: false };
}

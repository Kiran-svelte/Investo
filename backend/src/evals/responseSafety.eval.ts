import type { EvalCase } from './evalTypes';
import { guardBookingClaims } from '../services/whatsapp/mutationLanguageGuard.service';
import { stripBuyerInternalMetadata } from '../services/whatsapp/whatsappResponseSanitizer.service';
import { enforceNeverSayNoResponse } from '../services/neverSayNoResponseGuard.service';

export type ResponseSafetyInput = {
  text: string;
  mutationSucceeded?: boolean;
  hasInventoryAlternatives?: boolean;
};

export type ResponseSafetyExpected = {
  safe: true;
};

export type ResponseSafetyActual = {
  sanitizedText: string;
  violations: string[];
};

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

const INTERNAL_LEAKS: Array<{ id: string; pattern: RegExp }> = [
  { id: 'uuid', pattern: UUID_RE },
  { id: 'match_score', pattern: /\bmatch score\s*:/i },
  { id: 'workflow_name', pattern: /\bworkflow\s+"[^"]+"/i },
  { id: 'internal_id_line', pattern: /^id\s*:/im },
  { id: 'grounded_label', pattern: /\bcatalog matches\s*\(grounded\)/i },
];

const CLAIM_RE = /\b(your visit is|visit is) (booked|scheduled|confirmed)\b|\b(i'?ve?|i have) (booked|scheduled|confirmed|cancelled|canceled|rescheduled)\b|\byour visit has been (booked|scheduled|confirmed|cancelled|canceled|rescheduled)\b/i;

export const responseSafetyEvalCases: Array<EvalCase<ResponseSafetyInput, ResponseSafetyExpected>> = [
  {
    id: 'response-safety-strip-catalog-debug',
    category: 'response-safety',
    description: 'Buyer must never see catalog IDs, UUIDs, match scores, or grounded labels.',
    severity: 'critical',
    input: {
      text:
        'Catalog matches (grounded)\n\nSunset Heights\nID: b96bdfc6-ebd7-497c-8152-3e1e62f6ebdc\nMatch score: 3',
    },
    expected: { safe: true },
  },
  {
    id: 'response-safety-false-booking-claim',
    category: 'response-safety',
    description: 'AI text cannot claim booking success unless a backend mutation succeeded.',
    severity: 'critical',
    input: {
      text: 'Your visit is booked for tomorrow at 4pm.',
      mutationSucceeded: false,
    },
    expected: { safe: true },
  },
  {
    id: 'response-safety-true-booking-claim',
    category: 'response-safety',
    description: 'Confirmed workflow success text is allowed to mention completed booking.',
    severity: 'high',
    input: {
      text: 'Your visit is confirmed for tomorrow at 4pm.',
      mutationSucceeded: true,
    },
    expected: { safe: true },
  },
  {
    id: 'response-safety-never-say-no',
    category: 'response-safety',
    description: 'No-inventory style response must include a useful alternative CTA.',
    severity: 'high',
    input: {
      text: 'Sorry, no properties are available.',
      hasInventoryAlternatives: true,
    },
    expected: { safe: true },
  },
];

export function evaluateResponseSafety(input: ResponseSafetyInput): ResponseSafetyActual {
  const neverSayNo = enforceNeverSayNoResponse({
    text: input.text,
    hasInventoryAlternatives: Boolean(input.hasInventoryAlternatives),
    fallbackCta: 'Share your budget and preferred area, and I will shortlist the closest options.',
    skipFallbackCta: false,
  });

  const stripped = stripBuyerInternalMetadata(neverSayNo.text);
  const sanitizedText = guardBookingClaims(stripped, {
    visitCommitted: input.mutationSucceeded === true,
    workflowSuccess: input.mutationSucceeded === true,
    actionStatus: input.mutationSucceeded === true ? 'success' : undefined,
  });

  const violations: string[] = [];
  for (const leak of INTERNAL_LEAKS) {
    if (leak.pattern.test(sanitizedText)) violations.push(leak.id);
  }

  if (input.mutationSucceeded !== true && CLAIM_RE.test(sanitizedText)) {
    violations.push('false_mutation_claim');
  }

  if (
    input.hasInventoryAlternatives &&
    /\b(no properties|not available|nothing available)\b/i.test(sanitizedText) &&
    !/\b(share|shortlist|alternative|closest|options)\b/i.test(sanitizedText)
  ) {
    violations.push('dead_end_no_inventory_reply');
  }

  return { sanitizedText, violations };
}

export function evaluateResponseRisk(input: ResponseSafetyInput): { riskScore: number; violations: string[] } {
  const violations: string[] = [];
  for (const leak of INTERNAL_LEAKS) {
    if (leak.pattern.test(input.text)) violations.push(leak.id);
  }
  if (input.mutationSucceeded !== true && CLAIM_RE.test(input.text)) {
    violations.push('false_mutation_claim');
  }
  if (
    input.hasInventoryAlternatives &&
    /\b(no properties|not available|nothing available)\b/i.test(input.text) &&
    !/\b(share|shortlist|alternative|closest|options)\b/i.test(input.text)
  ) {
    violations.push('dead_end_no_inventory_reply');
  }

  const weights: Record<string, number> = {
    uuid: 90,
    match_score: 85,
    workflow_name: 80,
    internal_id_line: 85,
    grounded_label: 75,
    false_mutation_claim: 95,
    dead_end_no_inventory_reply: 70,
  };

  if (violations.length === 0) {
    return { riskScore: 0, violations };
  }

  return {
    violations,
    riskScore: Math.max(...violations.map((violation) => weights[violation] ?? 70)),
  };
}

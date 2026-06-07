/**
 * Detects and replaces staff/admin instructions that must never reach buyer WhatsApp.
 */
const STAFF_INSTRUCTION_PATTERNS: RegExp[] = [
  /\bupload one in (?:the )?(?:property settings|investo dashboard)[^.]*\.?/gi,
  /\bupload (?:one|a brochure) in (?:the )?(?:properties|property settings|dashboard)[^.]*\.?/gi,
  /\bno brochure (?:is )?uploaded for[^.]*\.\s*upload[^.]*\.?/gi,
  /\btry (?:again )?from the dashboard\.?/gi,
  /\bopen the investo dashboard[^.]*\.?/gi,
  /\buse the investo dashboard[^.]*\.?/gi,
  /\bthen i can send it to the customer\.?/gi,
];

const BROCHURE_MISSING_BUYER_REPLY =
  "I don't have a brochure PDF for that project in chat yet. I can share pricing and photos, or our team can send the brochure — what works best?";

export function containsStaffOnlyBuyerCopy(text: string): boolean {
  return STAFF_INSTRUCTION_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

export function sanitizeStaffInstructionsForBuyer(text: string): string {
  let out = text;
  for (const pattern of STAFF_INSTRUCTION_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, '');
  }

  out = out
    .replace(/\bno brochure (?:is )?uploaded for \*([^*]+)\* yet\.?/gi, BROCHURE_MISSING_BUYER_REPLY)
    .replace(/\bno brochure (?:is )?uploaded for ([^.]+)\.?\s*$/gi, BROCHURE_MISSING_BUYER_REPLY)
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!out && containsStaffOnlyBuyerCopy(text)) {
    return BROCHURE_MISSING_BUYER_REPLY;
  }

  return out;
}

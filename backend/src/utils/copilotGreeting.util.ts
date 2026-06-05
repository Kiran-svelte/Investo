/**
 * Staff WhatsApp copilot greeting detection (deterministic fast path).
 *
 * WhatsApp Web and the mobile app occasionally append invisible characters to
 * messages — most commonly U+00A0 (non-breaking space) and U+FE0F (emoji
 * variation selector). These cause an exact-match regex to fail even when the
 * visible text is just "Hello". We strip them in normalizeCopilotInboundText
 * and also include \u00a0 in the regex trailing character class as a safety net.
 */

export const COPILOT_GREETING_PATTERN =
  /^(hi|hello|hey|hii|hola|namaste|good\s*(morning|afternoon|evening)|start|help|what\s+can\s+you\s+do|commands?)[!.,?\s\u00a0]*$/i;

/**
 * Strips invisible Unicode characters that WhatsApp injects into messages
 * and collapses multi-line inputs to a single space-separated line.
 *
 * Characters stripped:
 * - U+200B–U+200F: zero-width spaces, directional marks
 * - U+2028–U+2029: line/paragraph separator
 * - U+FEFF: BOM / zero-width no-break space
 * - U+00AD: soft hyphen
 * - U+00A0: non-breaking space (common WhatsApp suffix)
 * - U+FE0F: emoji variation selector (common WhatsApp suffix)
 *
 * @param message - Raw inbound message text from WhatsApp
 * @returns Normalized, trimmed plain-text string
 */
export function normalizeCopilotInboundText(message: string): string {
  return message
    .replace(/[\u200b-\u200f\u2028\u2029\ufeff\u00ad\u00a0\ufe0f]/g, '') // invisible Unicode
    .replace(/[\r\n]+/g, ' ')                                               // collapse multi-line
    .trim();
}

/**
 * Returns true when the (normalized) message is a greeting or help command
 * and should receive the deterministic welcome response without LLM invocation.
 *
 * @param message - Raw or pre-normalized message text
 * @returns true if message is a greeting/help command
 */
export function isCopilotGreeting(message: string): boolean {
  const trimmed = normalizeCopilotInboundText(message);
  if (!trimmed || trimmed.length > 50) return false;
  return COPILOT_GREETING_PATTERN.test(trimmed);
}

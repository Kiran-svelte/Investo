/** Staff WhatsApp copilot greeting detection (deterministic fast path). */

export const COPILOT_GREETING_PATTERN =
  /^(hi|hello|hey|hii|hola|namaste|good\s*(morning|afternoon|evening)|start|help|what\s+can\s+you\s+do|commands?)[!.,?\s]*$/i;

export function normalizeCopilotInboundText(message: string): string {
  return message
    .replace(/[\u200b-\u200f\u2028\u2029\ufeff\u00ad]/g, '') // invisible Unicode & soft-hyphen
    .replace(/[\r\n]+/g, ' ')                                  // collapse multi-line messages
    .trim();
}

export function isCopilotGreeting(message: string): boolean {
  const trimmed = normalizeCopilotInboundText(message);
  if (!trimmed || trimmed.length > 50) return false;
  return COPILOT_GREETING_PATTERN.test(trimmed);
}

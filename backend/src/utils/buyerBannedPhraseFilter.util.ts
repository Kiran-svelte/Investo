import logger from '../config/logger';

export type BannedPhraseContext = {
  hasPriorOutbound?: boolean;
  stage?: string;
};

const ALWAYS_BANNED = [
  'connection issue',
  'trouble connecting',
  'technical difficulty',
  'brief connection issue',
  'brief technical issue',
  'having trouble connecting',
];

const MID_CONVERSATION_BANNED = [
  'how can i help you find your dream property',
  'how can i help you find your dream',
  'here is how i can help',
  "here's how i can help",
  'thanks for messaging',
];

const QUALIFICATION_BLEED =
  /\b(share your|preferred)\s+(area|budget)|\b(budget|bhk)\b.*\b(area|bhk)\b/i;

/**
 * Detects LLM output that violates fix.md §6 post-processing rules.
 */
export function containsBannedBuyerPhrase(text: string, ctx: BannedPhraseContext = {}): boolean {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return false;

  if (ALWAYS_BANNED.some((p) => normalized.includes(p))) return true;
  if (/^\s*\d+\.\s+/m.test(text)) return true;

  if (ctx.hasPriorOutbound) {
    if (MID_CONVERSATION_BANNED.some((p) => normalized.includes(p))) return true;
  }

  if (ctx.stage === 'visit_booking' || ctx.stage === 'confirmation') {
    if (QUALIFICATION_BLEED.test(text)) return true;
    if (normalized.includes('welcome back') && ctx.stage === 'visit_booking') return true;
  }

  return false;
}

export function logBannedPhraseBlocked(reason: string, preview: string): void {
  logger.warn('Buyer outbound banned phrase blocked', {
    reason,
    preview: preview.slice(0, 80),
    metric: 'buyer_banned_phrase_blocked',
  });
}

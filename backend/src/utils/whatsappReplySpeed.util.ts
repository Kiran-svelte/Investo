import config from '../config';
import type { ReplyPacingMode } from '../services/whatsappPresence.service';

const SIMPLE_GREETING_PATTERN =
  /^(hi|hello|hey|hii|hola|namaste|good\s*(morning|afternoon|evening)|start)\b[!.,?\s\u00a0]*$/i;

/** Default ON — set FEATURE_FAST_WHATSAPP_REPLIES=false to restore human pacing delays. */
export function isFastWhatsAppRepliesEnabled(): boolean {
  return config.features.fastWhatsAppReplies !== false;
}

export function isReplyPacingDisabled(): boolean {
  if (config.whatsapp.replyPacingEnabled === false) return true;
  if (process.env.WHATSAPP_REPLY_PACING_ENABLED === 'false') return true;
  return isFastWhatsAppRepliesEnabled();
}

/** Pacing for deterministic fast paths (H2, H5, buttons). */
export function resolveDefaultReplyPacing(): ReplyPacingMode {
  if (isReplyPacingDisabled()) return 'none';
  return 'minimal';
}

/** Pacing after LLM path (H9) — was `full` (up to 1.2s delay); fast mode uses none. */
export function resolveLlmReplyPacing(): ReplyPacingMode {
  if (isReplyPacingDisabled()) return 'none';
  if (process.env.WHATSAPP_REPLY_PACING_FULL === 'true') return 'full';
  return 'minimal';
}

export function getBuyerLlmTimeoutMs(): number {
  const configured = config.whatsapp.buyerLlmTimeoutMs;
  if (Number.isFinite(configured) && configured > 0) return configured;
  return isFastWhatsAppRepliesEnabled() ? 12_000 : 28_000;
}

export function getStaffCopilotTimeoutMs(): number {
  const configured = config.agentAi?.copilotTimeoutMs;
  if (typeof configured === 'number' && configured > 0) return configured;
  return isFastWhatsAppRepliesEnabled() ? 18_000 : 30_000;
}

/**
 * Skip expensive conversation-summary RAG block on simple turns when fast mode is on.
 */
export function shouldSkipHeavyBuyerContext(messageText: string, historyLength: number): boolean {
  if (!isFastWhatsAppRepliesEnabled()) return false;
  const trimmed = messageText.trim();
  if (/\b(property|project|amenit|price|carpet|possession|bhk|details?)\b/i.test(trimmed)) return false;
  if (SIMPLE_GREETING_PATTERN.test(trimmed)) return true;
  if (historyLength < 4 && trimmed.length <= 120) return true;
  return false;
}

export const FAST_REPLY_BUDGETS_MS = {
  /** Artificial pacing delay budget (after handler completes). */
  pacingNone: 25,
  pacingMinimal: 450,
  pacingFull: 1_350,
  /** Orchestrator deterministic path (mocked DB) — p95 target. */
  deterministicHandlerP95: 800,
  /** Production health live probe — p95 target. */
  healthLiveP95: 1_500,
  /** Buyer LLM wall-clock cap (handler timeout). */
  buyerLlmCap: 12_000,
  /** Staff copilot wall-clock cap. */
  staffCopilotCap: 18_000,
} as const;

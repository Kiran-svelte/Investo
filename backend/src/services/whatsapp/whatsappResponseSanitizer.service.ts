import { stripInternalCustomerMeta } from '../aiTransparency.service';
import { enforceNeverSayNoResponse } from '../neverSayNoResponseGuard.service';
import { polishOutboundMessage } from '../messagePolish.service';
import { sanitizeStaffInstructionsForBuyer } from '../../utils/buyerStaffCopyGuard.util';
import type { PropertyLike } from '../propertyCompleteness.service';
import type { MutationLanguageTurnContext } from './mutationLanguageGuard.service';
import { guardBookingClaims } from './mutationLanguageGuard.service';
import {
  containsBannedBuyerPhrase,
  logBannedPhraseBlocked,
  type BannedPhraseContext,
} from '../../utils/buyerBannedPhraseFilter.util';
import {
  buildSafeBuyerFallback,
  buildVisitBookingStageSafeReply,
  type SafeBuyerFallbackContext,
} from '../../utils/safeBuyerFallback.util';
import config from '../../config';
import { validateBuyerOutbound, type OutboundValidateInput } from '../buyer/buyerOutboundValidator.service';

export type SanitizeChannel = 'buyer' | 'staff';

export type SanitizeBuyerOutboundInput = {
  text: string;
  channel?: 'buyer';
  /** neverSayNo guard inputs */
  hasInventoryAlternatives?: boolean;
  fallbackCta?: string;
  groundedProperties?: PropertyLike[];
  conversionPromptBlock?: string;
  skipFallbackCta?: boolean;
  /** polish inputs */
  groundedFactsBlock?: string;
  language?: string;
  companyName?: string;
  maxLength?: number;
  /** mutation language guard */
  turnContext?: MutationLanguageTurnContext;
  /** Post-filter context (fix.md §6) */
  bannedPhraseContext?: BannedPhraseContext;
  activeVisit?: SafeBuyerFallbackContext['activeVisit'];
  selectedPropertyName?: string | null;
  outboundPropertyValidate?: Omit<OutboundValidateInput, 'text' | 'language'>;
};

export type SanitizeStaffOutboundInput = {
  text: string;
  channel: 'staff';
  companyName?: string;
  maxLength?: number;
};

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const BUYER_INTERNAL_LINE =
  /^(ID:|Match score:|Workflow|grounded|propertyId:|handler not configured|Confidence:|Sources:)/i;
// Strip trailing LLM-hallucinated signatures like "— Palm via Investo", "— *Palm* via Investo", "— Riya"
const TRAILING_SIGNATURE_RE = /\s*—\s*[\w\s*_]+(\s+via\s+[\w\s*_]+)?\s*$/i;

/**
 * Strip UUIDs, internal metadata, and workflow leakage from buyer-facing text.
 */
export function stripBuyerInternalMetadata(text: string): string {
  let out = stripInternalCustomerMeta(text);
  out = out.replace(UUID_RE, '');
  out = out
    .split(/\r?\n/)
    .filter((line) => !BUYER_INTERNAL_LINE.test(line.trim()))
    .join('\n')
    .replace(/\bMatch score:\s*\d+/gi, '')
    .replace(/\bpropertyId:\s*\S+/gi, '')
    .replace(/\bWorkflow\s+"[^"]+"/gi, '')
    .replace(/\bgrounded\b/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(TRAILING_SIGNATURE_RE, '')
    .trim();
  return out;
}

/**
 * Full buyer outbound pipeline: neverSayNo → internal strip → polish → mutation guard.
 */
function resolveBannedPhraseFallback(input: SanitizeBuyerOutboundInput): string {
  if (
    input.bannedPhraseContext?.stage === 'visit_booking' ||
    input.bannedPhraseContext?.stage === 'confirmation'
  ) {
    return buildVisitBookingStageSafeReply(input.selectedPropertyName);
  }
  return buildSafeBuyerFallback({ activeVisit: input.activeVisit ?? null });
}

export async function sanitizeBuyerOutbound(input: SanitizeBuyerOutboundInput): Promise<string> {
  if (containsBannedBuyerPhrase(input.text, input.bannedPhraseContext)) {
    logBannedPhraseBlocked('pre_pipeline', input.text);
    return resolveBannedPhraseFallback(input);
  }

  const fallbackCta = input.fallbackCta ?? 'Share your budget and preferred area, and I will shortlist options.';

  const guarded = enforceNeverSayNoResponse({
    text: input.text,
    hasInventoryAlternatives: input.hasInventoryAlternatives ?? false,
    fallbackCta,
    groundedProperties: input.groundedProperties,
    conversionPromptBlock: input.conversionPromptBlock,
    skipFallbackCta: input.skipFallbackCta,
  });

  let text = stripBuyerInternalMetadata(guarded.text);
  text = sanitizeStaffInstructionsForBuyer(text);

  // Strip robotic capability-listing openers the LLM sometimes generates despite instructions.
  text = text
    .replace(/^I['']?m here to (assist|help) you with[^.!?]*[.!?]\s*/i, '')
    .replace(/^Here['']?s (what|how) I can (help|do)[^.!?]*[.!?]\s*/i, '')
    .trim();

  const polished = await polishOutboundMessage({
    rawText: text,
    groundedFactsBlock: input.groundedFactsBlock,
    channel: 'whatsapp',
    language: input.language,
    companyName: input.companyName,
    maxLength: input.maxLength,
  });
  text = polished.text;

  if (input.turnContext) {
    text = guardBookingClaims(text, input.turnContext);
  }

  if (containsBannedBuyerPhrase(text, input.bannedPhraseContext)) {
    logBannedPhraseBlocked('post_pipeline', text);
    text = resolveBannedPhraseFallback(input);
  }

  if (input.outboundPropertyValidate && config.features.outboundPropertyValidate) {
    text = validateBuyerOutbound({
      text,
      language: input.language ?? 'en',
      ...input.outboundPropertyValidate,
    }).text;
  }

  return text.trim();
}

/**
 * Lighter staff outbound strip — keeps CRM terms, removes audit footers only.
 */
export async function sanitizeStaffOutbound(input: SanitizeStaffOutboundInput): Promise<string> {
  const polished = await polishOutboundMessage({
    rawText: stripInternalCustomerMeta(input.text),
    channel: 'whatsapp',
    companyName: input.companyName,
    maxLength: input.maxLength,
  });
  return polished.text.trim();
}

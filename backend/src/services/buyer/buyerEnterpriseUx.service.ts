/**
 * Enterprise buyer UX — single source of truth for visit-aware buttons,
 * CRM button flags, and greeting language policy. All buyer-facing orchestrators
 * should use this module instead of duplicating visit/booking guards.
 */

import type { WhatsAppComponent } from '../../types/whatsapp-turn.types';
import type { LiveLeadContext } from '../liveLeadContext.service';
import { isPostVisitBuyer } from '../../utils/buyerLeadProgress.util';
import {
  hindiGreetingFollowupBlock,
  normalizeBuyerLang,
  resolveBuyerLanguage,
} from '../../utils/buyerI18n.util';
import { buildActiveVisitActionButtons } from '../projectBrowse.service';

/** CRM snapshot used for contextual WhatsApp buttons on every buyer turn. */
export type BuyerCrmButtonFlags = {
  hasActiveVisit: boolean;
  hasActiveCall: boolean;
  visitStatus?: string;
  visitProperty?: string;
  visitTime?: string;
  visitPropertyProjectId: string | null;
  visitPropertyId: string | null;
  hasCompletedVisit: boolean;
  leadId?: string;
  liveLeadSnapshot: Pick<LiveLeadContext, 'activeVisit' | 'recentCompletedVisit' | 'leadStatus'>;
};

const VISIT_SITUATIONS = new Set([
  'visit_scheduled',
  'visit_confirmed',
  'visit_pending_approval',
  'visit_time_prompt',
]);

/**
 * Build CRM button flags from live lead context — used by turn orchestrator,
 * button policy, and legacy whatsapp.service paths.
 */
export function buildBuyerCrmButtonFlags(
  liveCtx: LiveLeadContext,
  leadId?: string,
  visitTime?: string,
): BuyerCrmButtonFlags {
  const activeVisit = liveCtx.activeVisit;
  const recentVisit = liveCtx.recentCompletedVisit;

  return {
    hasActiveVisit: Boolean(activeVisit),
    hasActiveCall: Boolean(liveCtx.activeCall),
    visitStatus: activeVisit?.status,
    visitProperty: activeVisit?.propertyName ?? undefined,
    visitTime,
    visitPropertyProjectId: activeVisit?.projectId ?? recentVisit?.projectId ?? null,
    visitPropertyId: activeVisit?.propertyId ?? recentVisit?.propertyId ?? null,
    hasCompletedVisit: isPostVisitBuyer(liveCtx),
    leadId,
    liveLeadSnapshot: {
      activeVisit: liveCtx.activeVisit,
      recentCompletedVisit: liveCtx.recentCompletedVisit,
      leadStatus: liveCtx.leadStatus,
    },
  };
}

/** Language for interactive button taps — lead preference when message text is absent. */
export function resolveInteractiveBuyerLanguage(leadLanguage?: string | null): string {
  return resolveBuyerLanguage({ leadLanguage });
}

/** Language for a buyer message turn — current message wins; basic social → English. */
export function resolveTurnBuyerLanguage(input: {
  messageText?: string | null;
  leadLanguage?: string | null;
}): string {
  return resolveBuyerLanguage({
    message: input.messageText,
    leadLanguage: input.leadLanguage,
  });
}

/**
 * Enterprise rule: when buyer has an active visit, never offer Book Visit / Property Details
 * except during explicit visit-scheduling prompts.
 */
export function shouldUseVisitAwareButtonsOnly(
  hasActiveVisit: boolean | undefined,
  situation: string,
): boolean {
  if (!hasActiveVisit) return false;
  return !VISIT_SITUATIONS.has(situation);
}

/** Standard visit-era action buttons (Change Time, View Listings, Call Agent). */
export function buildVisitAwareButtonComponent(
  projectId: string | null,
  lang: string,
): WhatsAppComponent {
  return buildActiveVisitActionButtons(projectId, lang);
}

/**
 * Append Hindi follow-up to English greetings for Hindi-preference leads (bilingual Hi policy).
 */
export function appendHindiLeadGreetingSuffix(
  text: string,
  replyLang: string,
  leadLanguage: string | null | undefined,
  company: string,
  customerName?: string | null,
): string {
  if (replyLang !== 'en' || normalizeBuyerLang(leadLanguage) !== 'hi') {
    return text;
  }
  return text + hindiGreetingFollowupBlock(company, customerName);
}

/** Whether Book Visit / More Info actions are allowed for this CRM state. */
export function canOfferPropertyBookingActions(flags: Pick<BuyerCrmButtonFlags, 'hasActiveVisit' | 'hasActiveCall'>): boolean {
  return !flags.hasActiveVisit && !flags.hasActiveCall;
}

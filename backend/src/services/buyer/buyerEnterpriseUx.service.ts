/**
 * Enterprise buyer UX — single source of truth for visit-aware buttons,
 * CRM button flags, and greeting language policy.
 */

import config from '../../config';
import type { WhatsAppComponent } from '../../types/whatsapp-turn.types';
import type { LiveLeadContext } from '../liveLeadContext.service';
import { isPostVisitBuyer } from '../../utils/buyerLeadProgress.util';
import {
  hindiGreetingFollowupBlock,
  normalizeBuyerLang,
  resolveBuyerLanguage,
} from '../../utils/buyerI18n.util';
import { buildActiveVisitActionButtons } from '../projectBrowse.service';

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

export type SecondVisitPolicyInput = {
  hasActiveVisit: boolean;
  activeVisitPropertyId: string | null;
  activeVisitProjectId: string | null;
  targetPropertyId: string | null;
  targetProjectId: string | null;
  explicitCrossProjectIntent?: boolean;
  hasActiveCall?: boolean;
};

export type SecondVisitDecision =
  | { allow: true; reason: 'no_active_visit' | 'different_project' | 'different_property' }
  | { allow: false; reason: 'same_property_already_booked' | 'active_call' | 'pending_same_property' }
  | { clarify: true; reason: 'cross_project_needs_confirm'; messageKey: 'second_visit_cross_project_confirm' };

const VISIT_SITUATIONS = new Set(['visit_scheduled', 'visit_confirmed', 'visit_pending_approval', 'visit_time_prompt']);
const EXPLICIT_BOOK_INTENT = /\b(book|schedule)\s+(a\s+)?(visit|site visit)/i;

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

export function resolveInteractiveBuyerLanguage(leadLanguage?: string | null): string {
  return resolveBuyerLanguage({ leadLanguage });
}

export function resolveTurnBuyerLanguage(input: {
  messageText?: string | null;
  leadLanguage?: string | null;
}): string {
  return resolveBuyerLanguage({ message: input.messageText, leadLanguage: input.leadLanguage });
}

export function evaluateSecondVisitPolicy(input: SecondVisitPolicyInput): SecondVisitDecision {
  if (input.hasActiveCall && !input.hasActiveVisit) return { allow: false, reason: 'active_call' };
  if (!config.features.secondVisitPolicy) {
    if (!input.hasActiveVisit) return { allow: true, reason: 'no_active_visit' };
    return { allow: false, reason: 'same_property_already_booked' };
  }
  if (!input.hasActiveVisit) return { allow: true, reason: 'no_active_visit' };
  if (input.hasActiveCall) return { allow: false, reason: 'active_call' };

  const activeProp = input.activeVisitPropertyId;
  const targetProp = input.targetPropertyId;
  if (!targetProp) {
    return { clarify: true, reason: 'cross_project_needs_confirm', messageKey: 'second_visit_cross_project_confirm' };
  }
  if (activeProp && targetProp === activeProp) return { allow: false, reason: 'same_property_already_booked' };

  const activeProject = input.activeVisitProjectId;
  const targetProject = input.targetProjectId;
  if (activeProject && targetProject && activeProject !== targetProject) {
    if (input.explicitCrossProjectIntent) return { allow: true, reason: 'different_project' };
    return { clarify: true, reason: 'cross_project_needs_confirm', messageKey: 'second_visit_cross_project_confirm' };
  }
  if (activeProp && targetProp !== activeProp) {
    return { clarify: true, reason: 'cross_project_needs_confirm', messageKey: 'second_visit_cross_project_confirm' };
  }
  return { allow: true, reason: 'different_property' };
}

const PROPERTY_DETAIL_SITUATIONS = new Set([
  'single_property_focus',
  'brochure_or_location',
  'price_discussed',
]);

export function shouldUseVisitAwareButtonsOnly(
  hasActiveVisit: boolean | undefined,
  situation: string,
  options?: {
    inboundMessageText?: string;
    explicitBookPropertyId?: string | null;
    visitPropertyId?: string | null;
    activeVisitProjectId?: string | null;
    targetProjectId?: string | null;
  },
): boolean {
  if (!hasActiveVisit) return false;
  if (VISIT_SITUATIONS.has(situation)) return false;
  if (PROPERTY_DETAIL_SITUATIONS.has(situation)) {
    return false;
  }
  if (
    config.features.secondVisitPolicy
    && options?.explicitBookPropertyId
    && EXPLICIT_BOOK_INTENT.test(options.inboundMessageText ?? '')
  ) {
    const decision = evaluateSecondVisitPolicy({
      hasActiveVisit: true,
      activeVisitPropertyId: options.visitPropertyId ?? null,
      activeVisitProjectId: options.activeVisitProjectId ?? null,
      targetPropertyId: options.explicitBookPropertyId,
      targetProjectId: options.targetProjectId ?? null,
      explicitCrossProjectIntent: true,
    });
    if ('allow' in decision && decision.allow) return false;
  }
  return true;
}

export function buildVisitAwareButtonComponent(projectId: string | null, lang: string): WhatsAppComponent {
  return buildActiveVisitActionButtons(projectId, lang);
}

export function appendHindiLeadGreetingSuffix(
  text: string,
  replyLang: string,
  leadLanguage: string | null | undefined,
  company: string,
  customerName?: string | null,
): string {
  if (replyLang !== 'en' || normalizeBuyerLang(leadLanguage) !== 'hi') return text;
  return text + hindiGreetingFollowupBlock(company, customerName);
}

export function canOfferPropertyBookingActions(
  flags: Pick<BuyerCrmButtonFlags, 'hasActiveVisit' | 'hasActiveCall'> & Partial<BuyerCrmButtonFlags>,
  target?: { propertyId: string | null; projectId: string | null },
): boolean {
  if (flags.hasActiveCall) return false;
  if (!config.features.secondVisitPolicy || !target) return !flags.hasActiveVisit && !flags.hasActiveCall;
  const decision = evaluateSecondVisitPolicy({
    hasActiveVisit: flags.hasActiveVisit,
    activeVisitPropertyId: flags.visitPropertyId ?? null,
    activeVisitProjectId: flags.visitPropertyProjectId ?? null,
    targetPropertyId: target.propertyId,
    targetProjectId: target.projectId,
    explicitCrossProjectIntent: true,
    hasActiveCall: flags.hasActiveCall,
  });
  if ('clarify' in decision && decision.clarify) return false;
  return 'allow' in decision && decision.allow;
}

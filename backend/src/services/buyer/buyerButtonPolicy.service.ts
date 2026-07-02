import type { NextBestAction } from '../conversationStateMachine';
import type { WhatsAppComponent } from '../../types/whatsapp-turn.types';
import { shouldAttachContextualQuickReplies, type QuickReplyRecentAction } from '../../utils/contextQuickReplies.util';
import { resolveSituationBuyerButtons, type BrowseFilterButton } from '../../utils/buyerSituationButtons.util';
import { isPostVisitBuyer } from '../../utils/buyerLeadProgress.util';
import type { LiveLeadContext } from '../liveLeadContext.service';
import { readBuyerConversationFocus } from './buyerConversationFocus.service';

export type BuyerButtonContext = {
  stage: string;
  outboundText: string;
  inboundMessageText?: string;
  nextAction?: NextBestAction;
  recentAction?: QuickReplyRecentAction;
  sentPropertyFilters?: boolean;
  propertyId?: string | null;
  recommendedPropertyIds?: string[];
  properties?: Array<{ id: string; name: string }>;
  hasActiveVisit?: boolean;
  hasActiveCall?: boolean;
  visitStatus?: string;
  visitProperty?: string;
  visitTime?: string;
  visitPropertyProjectId?: string | null;
  visitPropertyId?: string | null;
  isReturningGreeting?: boolean;
  hasCompletedVisit?: boolean;
  leadId?: string | null;
  liveLeadSnapshot?: Pick<LiveLeadContext, 'activeVisit' | 'recentCompletedVisit' | 'leadStatus'>;
  browseFilters?: BrowseFilterButton[];
  language?: string;
  allowedPropertyIds?: string[];
  focusedProjectId?: string | null;
  locationAvailablePropertyIds?: string[];
};

const BARE_GREETING_OUTBOUND =
  /^(hi|hello|hey|good\s+(morning|afternoon|evening))[\s,!]*$/i;

function advancedHasCompletedVisit(ctx: BuyerButtonContext): boolean {
  if (ctx.liveLeadSnapshot) return isPostVisitBuyer(ctx.liveLeadSnapshot);
  return Boolean(ctx.hasCompletedVisit);
}

export function resolveBuyerComponents(ctx: BuyerButtonContext): WhatsAppComponent[] {
  const hasCompletedVisit = advancedHasCompletedVisit(ctx);
  const outbound = ctx.outboundText.trim();
  if (BARE_GREETING_OUTBOUND.test(outbound) && !hasCompletedVisit && !ctx.propertyId) return [];
  if (ctx.stage === 'visit_booking') return [];
  if (
    !shouldAttachContextualQuickReplies({
      stage: ctx.stage,
      outboundText: ctx.outboundText,
      nextAction: ctx.nextAction,
      recentAction: ctx.recentAction,
      sentPropertyFilters: ctx.sentPropertyFilters,
    })
  ) {
    return [];
  }

  const focus = readBuyerConversationFocus({
    selectedPropertyId: ctx.propertyId ?? null,
    recommendedPropertyIds: ctx.recommendedPropertyIds,
    commitments: undefined,
  });
  const allowedPropertyIds = ctx.allowedPropertyIds ?? focus.allowedPropertyIds;
  const focusedProjectId = ctx.focusedProjectId ?? focus.focusedProjectId;

  const buttons = resolveSituationBuyerButtons({
    stage: ctx.stage,
    outboundText: ctx.outboundText,
    inboundMessageText: ctx.inboundMessageText,
    propertyId: ctx.propertyId,
    recommendedPropertyIds: ctx.recommendedPropertyIds,
    properties: ctx.properties,
    hasActiveVisit: ctx.hasActiveVisit,
    hasActiveCall: ctx.hasActiveCall,
    hasCompletedVisit,
    visitStatus: ctx.visitStatus,
    visitPropertyProjectId: ctx.visitPropertyProjectId,
    visitPropertyId: ctx.visitPropertyId,
    browseFilters: ctx.browseFilters,
    language: ctx.language,
    allowedPropertyIds,
    focusedProjectId,
    locationAvailablePropertyIds: ctx.locationAvailablePropertyIds,
  });

  if (!buttons?.length) return [];
  return [{ kind: 'buttons', buttons }];
}

export function resolvePostVisitButtons(
  propertyId?: string | null,
  browseFilters?: BrowseFilterButton[],
): WhatsAppComponent {
  const buttons = resolveSituationBuyerButtons({
    stage: 'confirmation',
    outboundText: 'How was your visit?',
    hasCompletedVisit: true,
    propertyId,
    browseFilters,
  }) ?? [
    { id: 'share-visit-feedback', title: 'Share Feedback' },
    { id: 'call-me', title: 'Talk to Agent' },
  ];
  return { kind: 'buttons', buttons };
}

import type { NextBestAction } from '../conversationStateMachine';
import type { WhatsAppComponent } from '../../types/whatsapp-turn.types';
import { shouldAttachContextualQuickReplies, type QuickReplyRecentAction } from '../../utils/contextQuickReplies.util';
import { resolveSituationBuyerButtons, type BrowseFilterButton } from '../../utils/buyerSituationButtons.util';
import { isPostVisitBuyer } from '../../utils/buyerLeadProgress.util';
import type { LiveLeadContext } from '../liveLeadContext.service';

export type BuyerButtonContext = {
  stage: string;
  outboundText: string;
  /** Last buyer message — improves situation detection (optional). */
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
  isReturningGreeting?: boolean;
  hasCompletedVisit?: boolean;
  leadId?: string | null;
  liveLeadSnapshot?: Pick<LiveLeadContext, 'activeVisit' | 'recentCompletedVisit' | 'leadStatus'>;
  /** Company-specific inventory filters — loaded from DB, never hardcoded types. */
  browseFilters?: BrowseFilterButton[];
};

const BARE_GREETING_OUTBOUND =
  /^(hi|hello|hey|good\s+(morning|afternoon|evening))[\s,!]*$/i;

function advancedHasCompletedVisit(ctx: BuyerButtonContext): boolean {
  if (ctx.liveLeadSnapshot) {
    return isPostVisitBuyer(ctx.liveLeadSnapshot);
  }
  return Boolean(ctx.hasCompletedVisit);
}

/**
 * Resolve at most one interactive component for a buyer turn.
 * Buttons are chosen from message situation + CRM context — not static stage menus.
 */
export function resolveBuyerComponents(ctx: BuyerButtonContext): WhatsAppComponent[] {
  const hasCompletedVisit = advancedHasCompletedVisit(ctx);

  if (ctx.isReturningGreeting && !hasCompletedVisit) {
    return [];
  }

  const outbound = ctx.outboundText.trim();
  if (BARE_GREETING_OUTBOUND.test(outbound) && !hasCompletedVisit && !ctx.propertyId) {
    return [];
  }

  if (ctx.stage === 'visit_booking') {
    return [];
  }

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
    browseFilters: ctx.browseFilters,
  });

  if (!buttons?.length) {
    return [];
  }

  return [{ kind: 'buttons', buttons }];
}

/** @deprecated Use resolveBuyerComponents — kept for interactive orchestrator imports. */
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

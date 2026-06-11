import type { NextBestAction } from '../conversationStateMachine';
import type { WhatsAppComponent } from '../../types/whatsapp-turn.types';
import { shouldAttachContextualQuickReplies, type QuickReplyRecentAction } from '../../utils/contextQuickReplies.util';
import { resolveCustomerQuickActions } from '../../utils/customerQuickReplies.util';

export type BuyerButtonContext = {
  stage: string;
  outboundText: string;
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
  /** When true, suppress greeting-stage filter buttons (returning buyer short ack). */
  isReturningGreeting?: boolean;
  /** When true, buyer completed a recent site visit — show post-visit buttons, not "Book Free Visit". */
  hasCompletedVisit?: boolean;
};

const STAGE_REPLIES: Partial<
  Record<string, { body: string; buttons: Array<{ id: string; title: string }> }>
> = {
  rapport: {
    body: 'What are you looking for?',
    buttons: [
      { id: 'filter-apartment', title: 'Apartments' },
      { id: 'filter-villa', title: 'Villas' },
      { id: 'call-me', title: 'Call Me' },
    ],
  },
  qualify: {
    body: 'Filter by property type:',
    buttons: [
      { id: 'filter-apartment', title: 'Apartment' },
      { id: 'filter-villa', title: 'Villa' },
      { id: 'filter-plot', title: 'Plot' },
    ],
  },
  shortlist: {
    body: 'Ready for your next step?',
    buttons: [
      { id: 'book-visit', title: 'Book Free Visit' },
      { id: 'emi-calculator', title: 'EMI Calculator' },
      { id: 'call-me', title: 'Call Me' },
    ],
  },
  commitment: {
    body: "Let's take the next step",
    buttons: [
      { id: 'book-visit', title: 'Book Visit' },
      { id: 'call-me', title: 'Call Me' },
      { id: 'more-info', title: 'Show Location' },
    ],
  },
  visit_booking: {
    body: 'Pick a time that works for you',
    buttons: [
      { id: 'visit-slot-morning', title: 'Morning 10AM' },
      { id: 'visit-slot-afternoon', title: 'Afternoon 3PM' },
      { id: 'call-me', title: 'Call to Confirm' },
    ],
  },
  confirmation: {
    body: 'Anything else I can help with?',
    buttons: [
      { id: 'more-info', title: 'Property Details' },
      { id: 'emi-calculator', title: 'EMI Calculator' },
      { id: 'call-me', title: 'Call Me' },
    ],
  },
};

function withPropertyIds(
  buttons: Array<{ id: string; title: string }>,
  propertyId: string,
): Array<{ id: string; title: string }> {
  const pid = propertyId || '';
  return buttons.map((btn) => {
    if (btn.id === 'book-visit' && pid) return { ...btn, id: `book-visit-${pid}` };
    if (btn.id === 'more-info' && pid) return { ...btn, id: `more-info-${pid}` };
    return btn;
  });
}

function resolveCallButtons(_ctx: BuyerButtonContext): WhatsAppComponent {
  return {
    kind: 'buttons',
    buttons: [
      { id: 'call-reschedule', title: 'Change Time' },
      { id: 'call-cancel', title: 'Cancel Call' },
      { id: 'call-me', title: 'Call Agent' },
    ],
  };
}

export function resolvePostVisitButtons(propertyId?: string | null): WhatsAppComponent {
  const pid = propertyId?.trim() ?? '';
  return {
    kind: 'buttons',
    buttons: [
      { id: 'share-visit-feedback', title: 'Share Feedback' },
      { id: 'call-me', title: 'Talk to Agent' },
      { id: pid ? `more-info-${pid}` : 'filter-apartment', title: 'See More Options' },
    ],
  };
}

function resolveVisitButtons(ctx: BuyerButtonContext): WhatsAppComponent | null {
  const pid = ctx.propertyId ?? '';
  if (ctx.visitStatus === 'pending_approval') {
    return {
      kind: 'buttons',
      buttons: [
        { id: 'visit-reschedule', title: 'Change Time' },
        { id: pid ? `more-info-${pid}` : 'more-info', title: 'Property Details' },
        { id: 'call-me', title: 'Call Agent' },
      ],
    };
  }

  if (ctx.visitStatus === 'confirmed') {
    return {
      kind: 'buttons',
      buttons: [
        { id: 'visit-reschedule', title: 'Change Time' },
        { id: pid ? `more-info-${pid}` : 'more-info', title: 'Property Details' },
        { id: 'call-me', title: 'Call Agent' },
      ],
    };
  }

  return {
    kind: 'buttons',
    buttons: [
      { id: 'visit-confirm', title: 'Confirm Visit' },
      { id: 'visit-reschedule', title: 'Reschedule' },
      { id: 'call-me', title: 'Call Agent' },
    ],
  };
}

const BARE_GREETING_OUTBOUND =
  /^(hi|hello|hey|good\s+(morning|afternoon|evening))[\s,!]*$/i;

const VISIT_FLOW_STAGES = ['rapport', 'qualify', 'shortlist', 'commitment', 'confirmation', 'visit_booking'];

/**
 * Resolve at most one interactive component for a buyer turn.
 * Returns empty array when no buttons should be sent.
 */
export function resolveBuyerComponents(ctx: BuyerButtonContext): WhatsAppComponent[] {
  if (ctx.isReturningGreeting && !ctx.hasCompletedVisit) return [];

  const outbound = ctx.outboundText.trim();
  if (BARE_GREETING_OUTBOUND.test(outbound) && !ctx.hasCompletedVisit) return [];

  if (ctx.stage === 'visit_booking') return [];

  const visitStages = VISIT_FLOW_STAGES;
  if (ctx.hasActiveCall && visitStages.includes(ctx.stage)) {
    return [resolveCallButtons(ctx)];
  }

  if (ctx.hasActiveVisit && visitStages.includes(ctx.stage)) {
    return [resolveVisitButtons(ctx)!];
  }

  if (ctx.hasCompletedVisit && !ctx.hasActiveVisit) {
    return [resolvePostVisitButtons(ctx.propertyId)];
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

  const dynamic = resolveCustomerQuickActions({
    stage: ctx.stage,
    outboundText: ctx.outboundText,
    selectedPropertyId: ctx.propertyId,
    recommendedPropertyIds: ctx.recommendedPropertyIds,
    properties: ctx.properties,
    hasActiveVisit: ctx.hasActiveVisit,
    hasCompletedVisit: ctx.hasCompletedVisit,
  });
  if (dynamic) {
    return [{ kind: 'buttons', buttons: dynamic.buttons }];
  }

  const stageConfig = STAGE_REPLIES[ctx.stage];
  if (!stageConfig) return [];

  const pid = ctx.propertyId ?? '';
  const buttons = withPropertyIds(stageConfig.buttons, pid);
  return [{ kind: 'buttons', buttons }];
}

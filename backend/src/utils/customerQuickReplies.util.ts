/**
 * Dynamic customer WhatsApp quick-action buttons (property-aware, stage-aware).
 * Rule-based by default; optional LLM refinement when CUSTOMER_QUICK_ACTIONS_LLM=1.
 */

export type CustomerQuickActionProperty = { id: string; name: string };

export type CustomerQuickActions = {
  body: string;
  buttons: Array<{ id: string; title: string }>;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function propertiesMentionedInText(
  outboundText: string,
  properties: CustomerQuickActionProperty[],
): CustomerQuickActionProperty[] {
  return properties.filter((p) => {
    if (!p.name?.trim()) return false;
    return new RegExp(`\\b${escapeRegExp(p.name.trim())}\\b`, 'i').test(outboundText);
  });
}

function pickPrimaryPropertyId(input: {
  outboundText: string;
  selectedPropertyId?: string | null;
  recommendedPropertyIds?: string[];
  properties?: CustomerQuickActionProperty[];
}): string {
  if (input.selectedPropertyId) return input.selectedPropertyId;
  const mentioned = propertiesMentionedInText(input.outboundText, input.properties ?? []);
  if (mentioned.length) return mentioned[0].id;
  const rec = input.recommendedPropertyIds?.[0];
  if (rec) return rec;
  return input.properties?.[0]?.id ?? '';
}

/**
 * Resolve contextual buyer buttons after an AI property reply.
 * Returns null when no actionable menu fits this turn.
 */
export function resolveCustomerQuickActions(input: {
  stage: string;
  outboundText: string;
  selectedPropertyId?: string | null;
  recommendedPropertyIds?: string[];
  properties?: CustomerQuickActionProperty[];
  hasActiveVisit?: boolean;
  hasActiveCall?: boolean;
  hasCompletedVisit?: boolean;
  browseFilters?: Array<{ id: string; title: string }>;
}): CustomerQuickActions | null {
  if (input.hasActiveVisit || input.hasActiveCall) return null;

  if (input.hasCompletedVisit) {
    const primaryId = pickPrimaryPropertyId(input);
    const browseMore = (input.browseFilters ?? []).find((f) => f.id !== 'call-me');
    const buttons = [
      { id: 'share-visit-feedback', title: 'Share Feedback' },
      { id: 'call-me', title: 'Talk to Agent' },
      primaryId
        ? { id: `more-info-${primaryId}`, title: 'See More Options' }
        : browseMore
          ? { id: browseMore.id, title: browseMore.title }
          : { id: 'call-me', title: 'See More Options' },
    ];
    return { body: 'What would you like to do next?', buttons };
  }

  const actionableStages = new Set(['rapport', 'qualify', 'shortlist', 'commitment', 'confirmation']);
  if (!actionableStages.has(input.stage)) return null;

  const mentioned = propertiesMentionedInText(input.outboundText, input.properties ?? []);
  if (
    input.stage === 'rapport' &&
    !mentioned.length &&
    !input.selectedPropertyId &&
    !(input.recommendedPropertyIds?.length)
  ) {
    return null;
  }

  const primaryId = pickPrimaryPropertyId(input);
  const primaryName =
    mentioned[0]?.name
    ?? input.properties?.find((p) => p.id === primaryId)?.name
    ?? 'this project';

  const buttons: Array<{ id: string; title: string }> = [];

  if (primaryId) {
    buttons.push({ id: `book-visit-${primaryId}`, title: '🗓️ Book Visit' });
    buttons.push({ id: `more-info-${primaryId}`, title: '🏗️ Property Details' });
  } else {
    buttons.push({ id: 'book-visit', title: '🗓️ Book Visit' });
    buttons.push({ id: 'more-info', title: '🏗️ Property Details' });
  }

  if (mentioned.length > 1 && mentioned[1]?.id) {
    const alt = mentioned[1];
    buttons.push({ id: `more-info-${alt.id}`, title: `🏠 ${alt.name.slice(0, 12)}` });
  } else {
    buttons.push({ id: 'call-me', title: '📞 Call Me' });
  }

  const body =
    mentioned.length > 1
      ? `Interested in *${primaryName}* or another option? Tap below 👇`
      : `Next step for *${primaryName}* 👇`;

  return { body, buttons: buttons.slice(0, 3) };
}

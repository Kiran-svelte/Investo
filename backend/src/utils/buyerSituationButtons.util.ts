/**
 * Situation-aware buyer WhatsApp buttons — driven by outbound message + CRM context,
 * not hardcoded conversation stage menus.
 */

export type BuyerButtonSituation =
  | 'active_call'
  | 'visit_pending_approval'
  | 'visit_confirmed'
  | 'visit_scheduled'
  | 'post_visit'
  | 'catalog_empty'
  | 'multi_property_list'
  | 'single_property_focus'
  | 'price_discussed'
  | 'brochure_or_location'
  | 'visit_time_prompt'
  | 'discovery_welcome'
  | 'inventory_summary'
  | 'general_followup'
  | 'none';

export type SituationButtonInput = {
  stage: string;
  outboundText: string;
  inboundMessageText?: string;
  propertyId?: string | null;
  recommendedPropertyIds?: string[];
  properties?: Array<{ id: string; name: string }>;
  hasActiveVisit?: boolean;
  hasActiveCall?: boolean;
  hasCompletedVisit?: boolean;
  visitStatus?: string;
};

const BARE_GREETING =
  /^(hi|hello|hey|good\s+(morning|afternoon|evening))[\s,!]*$/i;

const OUTBOUND_CATALOG_EMPTY =
  /couldn't find|no exact match|closest matches|tell me your (preferred )?area|tap a filter/i;

const OUTBOUND_CATALOG_LIST =
  /\b(here are|matching projects|active project|available project|shortlist|options for you)\b/i;

const OUTBOUND_PRICE =
  /\b(price|pricing|cost|rate|₹|lakh|crore|budget|emi)\b/i;

const OUTBOUND_BROCHURE_OR_LOCATION =
  /\b(brochure|pdf|document|open in maps|📍|location|directions)\b/i;

const OUTBOUND_VISIT_TIME =
  /\b(pick a time|when would you|preferred time|schedule your visit|site visit for)\b/i;

const OUTBOUND_INVENTORY_COUNT =
  /\b(active project|upcoming project|in our catalog|projects?\s+(in|across))\b/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function propertiesMentionedInText(
  outboundText: string,
  properties: Array<{ id: string; name: string }>,
): Array<{ id: string; name: string }> {
  return properties.filter((p) => {
    if (!p.name?.trim()) return false;
    return new RegExp(`\\b${escapeRegExp(p.name.trim())}\\b`, 'i').test(outboundText);
  });
}

function pickPrimaryPropertyId(input: SituationButtonInput): string {
  if (input.propertyId) return input.propertyId;
  const mentioned = propertiesMentionedInText(input.outboundText, input.properties ?? []);
  if (mentioned.length) return mentioned[0].id;
  return input.recommendedPropertyIds?.[0] ?? input.properties?.[0]?.id ?? '';
}

function withPropertyId(buttonId: string, propertyId: string): string {
  if (!propertyId) return buttonId;
  if (buttonId === 'book-visit') return `book-visit-${propertyId}`;
  if (buttonId === 'more-info') return `more-info-${propertyId}`;
  if (buttonId === 'send-brochure') return `brochure-${propertyId}`;
  return buttonId;
}

export function detectBuyerButtonSituation(input: SituationButtonInput): BuyerButtonSituation {
  if (input.hasActiveCall) return 'active_call';
  if (input.hasCompletedVisit && !input.hasActiveVisit) return 'post_visit';

  if (input.hasActiveVisit) {
    if (input.visitStatus === 'pending_approval') return 'visit_pending_approval';
    if (input.visitStatus === 'confirmed') return 'visit_confirmed';
    return 'visit_scheduled';
  }

  const text = input.outboundText.trim();
  if (!text) return 'none';

  if (input.stage === 'visit_booking' && OUTBOUND_VISIT_TIME.test(text)) {
    return 'visit_time_prompt';
  }

  if (OUTBOUND_CATALOG_EMPTY.test(text)) return 'catalog_empty';
  if (OUTBOUND_INVENTORY_COUNT.test(text) && !OUTBOUND_CATALOG_LIST.test(text)) {
    return 'inventory_summary';
  }

  const mentioned = propertiesMentionedInText(text, input.properties ?? []);
  const propertyContext = Boolean(
    input.propertyId
    || mentioned.length
    || (input.recommendedPropertyIds?.length ?? 0) > 0,
  );

  if (OUTBOUND_BROCHURE_OR_LOCATION.test(text) && propertyContext) {
    return 'brochure_or_location';
  }
  if (OUTBOUND_PRICE.test(text) && propertyContext) return 'price_discussed';

  if ((input.recommendedPropertyIds?.length ?? 0) > 1 || OUTBOUND_CATALOG_LIST.test(text)) {
    return 'multi_property_list';
  }

  if (propertyContext || mentioned.length === 1) {
    return 'single_property_focus';
  }

  if (BARE_GREETING.test(text) || /\bwelcome\b/i.test(text)) {
    return 'discovery_welcome';
  }

  if (propertyContext) return 'general_followup';

  return 'none';
}

export function resolveButtonsForBuyerSituation(
  situation: BuyerButtonSituation,
  input: SituationButtonInput,
): Array<{ id: string; title: string }> | null {
  const primaryId = pickPrimaryPropertyId(input);
  const mentioned = propertiesMentionedInText(input.outboundText, input.properties ?? []);

  switch (situation) {
    case 'active_call':
      return [
        { id: 'call-reschedule', title: 'Change Time' },
        { id: 'call-cancel', title: 'Cancel Call' },
        { id: 'call-me', title: 'Call Agent' },
      ];

    case 'visit_pending_approval':
    case 'visit_confirmed':
      return [
        { id: 'visit-reschedule', title: 'Change Time' },
        { id: withPropertyId('more-info', primaryId), title: 'Property Details' },
        { id: 'call-me', title: 'Call Agent' },
      ];

    case 'visit_scheduled':
      return [
        { id: 'visit-confirm', title: 'Confirm Visit' },
        { id: 'visit-reschedule', title: 'Reschedule' },
        { id: 'call-me', title: 'Call Agent' },
      ];

    case 'post_visit':
      return [
        { id: 'share-visit-feedback', title: 'Share Feedback' },
        { id: 'call-me', title: 'Talk to Agent' },
        primaryId
          ? { id: withPropertyId('more-info', primaryId), title: 'See More Options' }
          : { id: 'filter-apartment', title: 'Browse Projects' },
      ];

    case 'catalog_empty':
      return [
        { id: 'filter-apartment', title: 'Apartments' },
        { id: 'filter-villa', title: 'Villas' },
        { id: 'filter-4bhk', title: '4 BHK' },
      ];

    case 'multi_property_list':
      return [
        { id: 'filter-apartment', title: 'Narrow Search' },
        { id: 'call-me', title: 'Call Me' },
        primaryId
          ? { id: withPropertyId('book-visit', primaryId), title: 'Book Visit' }
          : { id: 'book-visit', title: 'Book Visit' },
      ];

    case 'single_property_focus':
    case 'general_followup': {
      const buttons: Array<{ id: string; title: string }> = [];
      if (primaryId) {
        buttons.push({ id: withPropertyId('book-visit', primaryId), title: 'Book Visit' });
        buttons.push({ id: withPropertyId('more-info', primaryId), title: 'Property Details' });
      } else {
        buttons.push({ id: 'book-visit', title: 'Book Visit' });
        buttons.push({ id: 'more-info', title: 'Property Details' });
      }
      if (mentioned.length > 1 && mentioned[1]?.id) {
        buttons.push({ id: withPropertyId('more-info', mentioned[1].id), title: mentioned[1].name.slice(0, 12) });
      } else {
        buttons.push({ id: 'call-me', title: 'Call Me' });
      }
      return buttons.slice(0, 3);
    }

    case 'price_discussed':
      return [
        { id: withPropertyId('book-visit', primaryId), title: 'Book Visit' },
        { id: 'emi-calculator', title: 'EMI Calculator' },
        { id: 'call-me', title: 'Call Me' },
      ];

    case 'brochure_or_location':
      return [
        { id: withPropertyId('book-visit', primaryId), title: 'Book Visit' },
        { id: withPropertyId('more-info', primaryId), title: 'More Details' },
        { id: 'call-me', title: 'Call Agent' },
      ];

    case 'inventory_summary':
      return [
        { id: 'filter-apartment', title: 'Show Apartments' },
        { id: 'filter-villa', title: 'Show Villas' },
        { id: 'call-me', title: 'Call Me' },
      ];

    case 'discovery_welcome':
      return [
        { id: 'filter-apartment', title: 'Apartments' },
        { id: 'filter-villa', title: 'Villas' },
        { id: 'call-me', title: 'Call Me' },
      ];

    case 'visit_time_prompt':
    case 'none':
    default:
      return null;
  }
}

export function resolveSituationBuyerButtons(
  input: SituationButtonInput,
): Array<{ id: string; title: string }> | null {
  const situation = detectBuyerButtonSituation(input);
  return resolveButtonsForBuyerSituation(situation, input);
}

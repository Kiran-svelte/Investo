/**
 * Situation-aware buyer WhatsApp buttons — driven by outbound message + CRM context,
 * not hardcoded conversation stage menus.
 */

import { buyerButtonTitle } from './buyerI18n.util';
import { buildActiveVisitActionButtons } from '../services/projectBrowse.service';
import { shouldUseVisitAwareButtonsOnly } from '../services/buyer/buyerEnterpriseUx.service';

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

export type BrowseFilterButton = { id: string; title: string };

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
  /** Buyer language for button titles. */
  language?: string;
  /** Project board id for the active visit property (enables View Listings). */
  visitPropertyProjectId?: string | null;
  /** Property id tied to the active visit. */
  visitPropertyId?: string | null;
  /** Company inventory filters — never show apartment/villa buttons the company does not list. */
  browseFilters?: BrowseFilterButton[];
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

function inventoryFilterButtons(
  browseFilters: BrowseFilterButton[] | undefined,
  options: { includeCallMe?: boolean; maxFilters?: number; language?: string },
): Array<{ id: string; title: string }> {
  const lang = options.language ?? 'en';
  const maxFilters = options.maxFilters ?? (options.includeCallMe ? 2 : 3);
  const filterOnly = (browseFilters ?? []).filter((f) => f.id !== 'call-me');
  if (!filterOnly.length) {
    return options.includeCallMe
      ? [{ id: 'call-me', title: buyerButtonTitle(lang, 'call_me') }]
      : [{ id: 'call-me', title: buyerButtonTitle(lang, 'call_agent') }];
  }
  const buttons = filterOnly.slice(0, maxFilters).map((f) => ({ id: f.id, title: f.title }));
  if (options.includeCallMe && buttons.length < 3) {
    buttons.push({ id: 'call-me', title: buyerButtonTitle(lang, 'call_me') });
  }
  return buttons.slice(0, 3);
}

function firstBrowseFilter(browseFilters: BrowseFilterButton[] | undefined): BrowseFilterButton | null {
  const filterOnly = (browseFilters ?? []).filter((f) => f.id !== 'call-me');
  return filterOnly[0] ?? null;
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
  const lang = input.language ?? 'en';

  switch (situation) {
    case 'active_call':
      return [
        { id: 'call-reschedule', title: buyerButtonTitle(lang, 'change_time') },
        { id: 'call-cancel', title: buyerButtonTitle(lang, 'cancel_call') },
        { id: 'call-me', title: buyerButtonTitle(lang, 'call_agent') },
      ];

    case 'visit_pending_approval':
    case 'visit_confirmed': {
      const component = buildActiveVisitActionButtons(input.visitPropertyProjectId ?? null, lang);
      return component.kind === 'buttons' ? component.buttons : null;
    }

    case 'visit_scheduled':
      return [
        { id: 'visit-confirm', title: buyerButtonTitle(lang, 'confirm_visit') },
        { id: 'visit-reschedule', title: buyerButtonTitle(lang, 'reschedule') },
        { id: 'call-me', title: buyerButtonTitle(lang, 'call_agent') },
      ];

    case 'post_visit': {
      const buttons: Array<{ id: string; title: string }> = [
        { id: 'share-visit-feedback', title: buyerButtonTitle(lang, 'share_feedback') },
        { id: 'call-me', title: buyerButtonTitle(lang, 'talk_agent') },
      ];
      if (input.visitPropertyProjectId) {
        buttons.push({
          id: `project-properties-${input.visitPropertyProjectId}`,
          title: buyerButtonTitle(lang, 'view_project_listings'),
        });
      } else {
        buttons.push({ id: 'browse-projects', title: buyerButtonTitle(lang, 'browse_projects') });
      }
      return buttons.slice(0, 3);
    }

    case 'catalog_empty':
      return inventoryFilterButtons(input.browseFilters, { includeCallMe: false, maxFilters: 3, language: lang });

    case 'multi_property_list': {
      if (input.hasActiveVisit) {
        const visitButtons = buildActiveVisitActionButtons(input.visitPropertyProjectId ?? null, lang);
        return visitButtons.kind === 'buttons' ? visitButtons.buttons : null;
      }
      const narrow = firstBrowseFilter(input.browseFilters);
      const buttons: Array<{ id: string; title: string }> = [];
      if (narrow) buttons.push({ id: narrow.id, title: buyerButtonTitle(lang, 'narrow_search') });
      buttons.push({ id: 'call-me', title: buyerButtonTitle(lang, 'call_me') });
      buttons.push(
        primaryId
          ? { id: withPropertyId('book-visit', primaryId), title: buyerButtonTitle(lang, 'book_visit') }
          : { id: 'book-visit', title: buyerButtonTitle(lang, 'book_visit') },
      );
      return buttons.slice(0, 3);
    }

    case 'single_property_focus':
    case 'general_followup': {
      if (input.hasActiveVisit) {
        const visitButtons = buildActiveVisitActionButtons(input.visitPropertyProjectId ?? null, lang);
        return visitButtons.kind === 'buttons' ? visitButtons.buttons : null;
      }
      const buttons: Array<{ id: string; title: string }> = [];
      if (primaryId) {
        buttons.push({ id: withPropertyId('book-visit', primaryId), title: buyerButtonTitle(lang, 'book_visit') });
        buttons.push({ id: withPropertyId('more-info', primaryId), title: buyerButtonTitle(lang, 'property_details') });
      } else {
        buttons.push({ id: 'book-visit', title: buyerButtonTitle(lang, 'book_visit') });
        buttons.push({ id: 'more-info', title: buyerButtonTitle(lang, 'property_details') });
      }
      if (mentioned.length > 1 && mentioned[1]?.id) {
        buttons.push({ id: withPropertyId('more-info', mentioned[1].id), title: mentioned[1].name.slice(0, 12) });
      } else {
        buttons.push({ id: 'call-me', title: buyerButtonTitle(lang, 'call_me') });
      }
      return buttons.slice(0, 3);
    }

    case 'price_discussed': {
      if (input.hasActiveVisit) {
        const visitButtons = buildActiveVisitActionButtons(input.visitPropertyProjectId ?? null, lang);
        return visitButtons.kind === 'buttons' ? visitButtons.buttons : null;
      }
      return [
        { id: withPropertyId('book-visit', primaryId), title: buyerButtonTitle(lang, 'book_visit') },
        { id: 'emi-calculator', title: buyerButtonTitle(lang, 'emi') },
        { id: 'call-me', title: buyerButtonTitle(lang, 'call_me') },
      ];
    }

    case 'brochure_or_location': {
      if (input.hasActiveVisit) {
        const visitButtons = buildActiveVisitActionButtons(input.visitPropertyProjectId ?? null, lang);
        return visitButtons.kind === 'buttons' ? visitButtons.buttons : null;
      }
      return [
        { id: withPropertyId('book-visit', primaryId), title: buyerButtonTitle(lang, 'book_visit') },
        { id: withPropertyId('more-info', primaryId), title: buyerButtonTitle(lang, 'more_details') },
        { id: 'call-me', title: buyerButtonTitle(lang, 'call_agent') },
      ];
    }

    case 'inventory_summary':
      return inventoryFilterButtons(input.browseFilters, { includeCallMe: true, language: lang });

    case 'discovery_welcome':
      return inventoryFilterButtons(input.browseFilters, { includeCallMe: true, language: lang });

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
  const lang = input.language ?? 'en';

  if (shouldUseVisitAwareButtonsOnly(input.hasActiveVisit, situation)) {
    const visitButtons = buildActiveVisitActionButtons(input.visitPropertyProjectId ?? null, lang);
    return visitButtons.kind === 'buttons' ? visitButtons.buttons : null;
  }

  return resolveButtonsForBuyerSituation(situation, input);
}

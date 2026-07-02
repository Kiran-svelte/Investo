import config from '../../config';
import logger from '../../config/logger';
import { buyerButtonTitle } from '../../utils/buyerI18n.util';

export type ButtonScopeContext = {
  allowedPropertyIds: string[];
  visitPropertyId?: string | null;
  hasActiveVisit?: boolean;
  language?: string;
};

const NEVER_STRIP_EXACT = new Set(['browse-projects', 'call-me', 'emi-calculator', 'share-visit-feedback']);

function isNeverStripButton(id: string): boolean {
  if (NEVER_STRIP_EXACT.has(id)) return true;
  if (id.startsWith('filter-')) return true;
  if (id.startsWith('project-properties-')) return true;
  if (id.startsWith('project-select-')) return true;
  if (id === 'visit-reschedule' || id === 'visit-confirm') return true;
  if (id.startsWith('visit-time-')) return true;
  if (id.startsWith('call-')) return true;
  return false;
}

type PropertyButtonKind = 'book' | 'more' | 'brochure' | 'location' | 'other';

function parsePropertyButton(id: string): { kind: PropertyButtonKind; propertyId: string | null } {
  if (id.startsWith('book-visit-')) return { kind: 'book', propertyId: id.slice('book-visit-'.length) };
  if (id === 'book-visit') return { kind: 'book', propertyId: null };
  if (id.startsWith('more-info-')) return { kind: 'more', propertyId: id.slice('more-info-'.length) };
  if (id === 'more-info') return { kind: 'more', propertyId: null };
  if (id.startsWith('brochure-')) return { kind: 'brochure', propertyId: id.slice('brochure-'.length) };
  if (id.startsWith('location-')) return { kind: 'location', propertyId: id.slice('location-'.length) };
  return { kind: 'other', propertyId: null };
}

function rewriteBarePropertyButton(kind: PropertyButtonKind, propertyId: string, title: string) {
  if (kind === 'book') return { id: `book-visit-${propertyId}`, title };
  if (kind === 'more') return { id: `more-info-${propertyId}`, title };
  if (kind === 'location') return { id: `location-${propertyId}`, title };
  return { id: `brochure-${propertyId}`, title };
}

function isPropertyAllowed(propertyId: string, ctx: ButtonScopeContext): boolean {
  if (ctx.visitPropertyId && propertyId === ctx.visitPropertyId) return true;
  const allowed = ctx.allowedPropertyIds;
  if (!allowed.length) return true;
  return allowed.includes(propertyId);
}

function fallbackButton(lang: string, existing: Array<{ id: string; title: string }>) {
  const ids = new Set(existing.map((b) => b.id));
  if (!ids.has('call-me')) return { id: 'call-me', title: buyerButtonTitle(lang, 'call_agent') };
  if (!ids.has('browse-projects')) return { id: 'browse-projects', title: buyerButtonTitle(lang, 'browse_projects') };
  return null;
}

export function validateBuyerButtonSet(
  buttons: Array<{ id: string; title: string }>,
  ctx: ButtonScopeContext,
): Array<{ id: string; title: string }> {
  if (!config.features.buttonScopeValidate) return buttons;

  const lang = ctx.language ?? 'en';
  const allowed = ctx.allowedPropertyIds;
  const singleAllowed = allowed.length === 1 ? allowed[0] : null;
  const validated: Array<{ id: string; title: string }> = [];

  for (const button of buttons) {
    if (isNeverStripButton(button.id)) {
      validated.push(button);
      continue;
    }
    const parsed = parsePropertyButton(button.id);
    if (parsed.kind === 'other') {
      validated.push(button);
      continue;
    }
    if (!parsed.propertyId) {
      if (singleAllowed) validated.push(rewriteBarePropertyButton(parsed.kind, singleAllowed, button.title));
      else logger.warn('buyerButton.scopeViolation', { buttonId: button.id, allowedPropertyIds: allowed });
      continue;
    }
    if (isPropertyAllowed(parsed.propertyId, ctx)) validated.push(button);
    else logger.warn('buyerButton.scopeViolation', { buttonId: button.id, allowedPropertyIds: allowed });
  }

  while (validated.length < buttons.length && validated.length < 3) {
    const fill = fallbackButton(lang, validated);
    if (!fill) break;
    validated.push(fill);
  }
  return validated.slice(0, 3);
}

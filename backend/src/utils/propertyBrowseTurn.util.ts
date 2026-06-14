import prisma from '../config/prisma';
import type { WhatsAppComponent } from '../types/whatsapp-turn.types';
import { matchCatalogPropertiesForQuery, getInventorySummary } from '../services/propertyKnowledge.service';
import { isPropertyInquiryMessage } from '../services/customerMessageFastPath.service';
import { resolveBrochureUrlForWhatsApp, resolveFirstPropertyHeroMediaComponent } from '../services/brochureDelivery.service';
import {
  buildCatalogFilterButtonSet,
  getCompanyBrowseSnapshot,
} from '../services/companyInventoryBrowse.service';
import {
  companyUsesProjectBrowse,
  listProjectsForBuyerBrowse,
  formatProjectCatalogIntro,
  buildProjectSelectListComponent,
  getProjectInventorySummary,
} from '../services/projectBrowse.service';
import {
  formatBuyerCatalogEmpty,
  formatBuyerCatalogMatches,
  formatInventoryCountReply,
  isInventoryCountQuery,
} from './formatBuyerCatalog.util';
import { buyerButtonTitle, tBuyer } from './buyerI18n.util';
import { findSoldPropertyMentionedByName } from '../services/buyerPropertyContext.service';
import {
  isMultilingualBrowseIntent,
  parseMultilingualBrowseFilters,
} from './buyerBrowseIntent.util';

export type PropertyBrowseContext = {
  companyId: string;
  messageText: string;
  stage: string;
  leadLanguage?: string | null;
};

export type PropertyBrowseTurnPayload = {
  reply: string;
  propertyIds: string[];
  properties: Array<{ id: string; name: string }>;
  components: WhatsAppComponent[];
};

function parseBrowseFilters(messageText: string): { propertyType?: string; bedrooms?: number } {
  const t = messageText.toLowerCase();
  const filters: { propertyType?: string; bedrooms?: number } = {};
  if (/\bvillas?\b/.test(t)) filters.propertyType = 'villa';
  else if (/\b(apartments?|flats?)\b/.test(t)) filters.propertyType = 'apartment';
  else if (/\bplots?\b/.test(t)) filters.propertyType = 'plot';
  else if (/\bcommercial\b/.test(t)) filters.propertyType = 'commercial';
  const bhk = t.match(/\b(\d)\s*bhk\b/);
  if (bhk) filters.bedrooms = Number(bhk[1]);

  const ml = parseMultilingualBrowseFilters(messageText);
  if (ml.propertyType && !filters.propertyType) filters.propertyType = ml.propertyType;
  if (ml.bedrooms != null && filters.bedrooms == null) filters.bedrooms = ml.bedrooms;

  return filters;
}

async function resolveProjectFirstBrowseTurn(
  input: PropertyBrowseContext,
  filters?: { propertyType?: string; bedrooms?: number },
): Promise<PropertyBrowseTurnPayload | null> {
  const usesProjects = await companyUsesProjectBrowse(input.companyId);
  if (!usesProjects) return null;

  const projects = await listProjectsForBuyerBrowse(input.companyId, filters);
  const lang = input.leadLanguage ?? 'en';

  if (!projects.length) {
    const snapshot = await getCompanyBrowseSnapshot(input.companyId);
    return {
      reply: tBuyer(lang, 'project_browse_none'),
      propertyIds: [],
      properties: [],
      components: buildFilterButtonsComponent(snapshot, lang),
    };
  }

  const reply = formatProjectCatalogIntro(projects, lang);
  const snapshot = await getCompanyBrowseSnapshot(input.companyId);

  return {
    reply,
    propertyIds: [],
    properties: [],
    components: [
      buildProjectSelectListComponent(projects, lang),
      ...buildFilterButtonsComponent(snapshot, lang),
    ],
  };
}

export async function resolvePropertyBrowseTurn(
  input: PropertyBrowseContext,
): Promise<PropertyBrowseTurnPayload | null> {
  const { companyId, messageText } = input;
  const lang = input.leadLanguage ?? 'en';

  if (isPropertyInquiryMessage(messageText)) {
    const sold = await findSoldPropertyMentionedByName(companyId, messageText);
    if (sold) {
      return buildSoldPropertyTurnPayload(sold, lang);
    }
    return null;
  }

  const filters = parseBrowseFilters(messageText);

  if (isInventoryCountQuery(messageText)) {
    const usesProjects = await companyUsesProjectBrowse(companyId);
    const projectTurn = await resolveProjectFirstBrowseTurn(input, filters);
    if (projectTurn && usesProjects) {
      const summary = await getProjectInventorySummary(companyId);
      return {
        ...projectTurn,
        reply: `${formatInventoryCountReply({ ...summary, usesProjects: true }, lang)}\n\n${projectTurn.reply}`,
      };
    }

    const summary = await getInventorySummary(companyId);
    const reply = formatInventoryCountReply(
      { ...summary, propertyCount: summary.total, usesProjects: false },
      lang,
    );
    const properties = await prisma.property.findMany({
      where: { companyId, status: { in: ['available', 'upcoming'] } },
      take: 10,
      select: { id: true, name: true },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      reply,
      propertyIds: properties.map((p) => p.id),
      properties,
      components: await buildPropertyBrowseComponents({
        matches: properties.map((p) => ({ id: p.id, name: p.name, propertyType: null })),
        stage: input.stage,
        outboundText: reply,
        properties,
        companyId,
        lang,
      }),
    };
  }

  if (isMultilingualBrowseIntent(messageText)) {
    const projectTurn = await resolveProjectFirstBrowseTurn(input, filters);
    if (projectTurn) return projectTurn;
  }

  const projectTurn = await resolveProjectFirstBrowseTurn(input, filters);
  if (projectTurn) {
    return projectTurn;
  }

  const matches = await matchCatalogPropertiesForQuery({
    companyId,
    query: messageText,
    limit: 10,
  });

  if (!matches.length) {
    const sold = await findSoldPropertyMentionedByName(companyId, messageText);
    if (sold) {
      return buildSoldPropertyTurnPayload(sold, lang);
    }
    const snapshot = await getCompanyBrowseSnapshot(companyId);
    return {
      reply: formatBuyerCatalogEmpty(messageText, lang),
      propertyIds: [],
      properties: [],
      components: buildFilterButtonsComponent(snapshot, lang),
    };
  }

  const reply = formatBuyerCatalogMatches(matches, lang);
  const properties = matches.map((p) => ({ id: p.id, name: p.name }));
  const propertyIds = matches.map((p) => p.id);

  const mediaComponents = await resolveProactiveBrowseMedia(companyId, matches);
  const interactive = await buildPropertyBrowseComponents({
    matches,
    stage: input.stage,
    outboundText: reply,
    properties,
    companyId,
    lang,
  });

  return {
    reply,
    propertyIds,
    properties,
    components: [...mediaComponents, ...interactive],
  };
}

function buildFilterButtonsComponent(
  snapshot: Awaited<ReturnType<typeof getCompanyBrowseSnapshot>>,
  lang?: string,
): WhatsAppComponent[] {
  const buttons = buildCatalogFilterButtonSet(snapshot, lang);
  if (!buttons.length) return [];
  return [{ kind: 'buttons', buttons }];
}

function buildSoldPropertyTurnPayload(
  sold: { id: string; name: string; projectId: string | null },
  lang: string,
): PropertyBrowseTurnPayload {
  const reply = tBuyer(lang, 'property_sold_explanation', { name: sold.name });
  const buttons: Array<{ id: string; title: string }> = [];
  if (sold.projectId) {
    buttons.push({
      id: `project-properties-${sold.projectId}`,
      title: buyerButtonTitle(lang, 'view_project_listings'),
    });
  } else {
    buttons.push({ id: 'browse-projects', title: buyerButtonTitle(lang, 'browse_projects') });
  }
  buttons.push({ id: 'call-me', title: buyerButtonTitle(lang, 'call_me') });

  return {
    reply,
    propertyIds: [],
    properties: [{ id: sold.id, name: sold.name }],
    components: [{ kind: 'buttons', buttons: buttons.slice(0, 3) }],
  };
}

async function buildPropertyBrowseComponents(input: {
  matches: Array<{ id: string; name: string; propertyType: string | null }>;
  stage: string;
  outboundText: string;
  properties: Array<{ id: string; name: string }>;
  companyId: string;
  lang: string;
}): Promise<WhatsAppComponent[]> {
  const lang = input.lang;
  if (input.matches.length >= 2) {
    return [{
      kind: 'list',
      title: tBuyer(lang, 'browse_list_title').slice(0, 24),
      sections: [{
        title: tBuyer(lang, 'browse_list_section').slice(0, 24),
        rows: input.matches.slice(0, 10).map((p) => ({
          id: `more-info-${p.id}`,
          title: p.name.slice(0, 24),
          description: (p.propertyType ?? 'listing').slice(0, 72),
        })),
      }],
    }];
  }

  const primary = input.matches[0];
  if (!primary) {
    const snapshot = await getCompanyBrowseSnapshot(input.companyId);
    return buildFilterButtonsComponent(snapshot, lang);
  }

  return [{
    kind: 'buttons',
    buttons: [
      { id: `more-info-${primary.id}`, title: buyerButtonTitle(lang, 'property_details') },
      { id: `book-visit-${primary.id}`, title: buyerButtonTitle(lang, 'book_visit') },
      { id: 'call-me', title: buyerButtonTitle(lang, 'call_me') },
    ],
  }];
}

/** Hero image + brochure for a single shortlisted property (proactive, before user asks). */
async function resolveProactiveBrowseMedia(
  companyId: string,
  matches: Array<{ id: string; brochureUrl?: string | null; name: string; images?: unknown }>,
): Promise<WhatsAppComponent[]> {
  const out: WhatsAppComponent[] = [];
  const primary = matches[0];
  if (!primary) return out;

  const full = await prisma.property.findFirst({
    where: { id: primary.id, companyId },
    select: { brochureUrl: true, images: true, name: true },
  });
  if (!full) return out;

  if (full.brochureUrl) {
    const url = await resolveBrochureUrlForWhatsApp(full.brochureUrl);
    if (url) {
      out.push({ kind: 'media', url, mime: 'application/pdf', caption: full.name });
    }
  }

  const heroMedia = await resolveFirstPropertyHeroMediaComponent({
    images: full.images,
    caption: full.name,
  });
  if (heroMedia) {
    out.push(heroMedia);
  }

  return out.slice(0, 2);
}

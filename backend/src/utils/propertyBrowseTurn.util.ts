import prisma from '../config/prisma';
import type { WhatsAppComponent } from '../types/whatsapp-turn.types';
import { matchCatalogPropertiesForQuery, getInventorySummary } from '../services/propertyKnowledge.service';
import { isPropertyInquiryMessage } from '../services/customerMessageFastPath.service';
import { resolveBrochureUrlForWhatsApp } from '../services/brochureDelivery.service';
import {
  buildCatalogFilterButtonSet,
  getCompanyBrowseSnapshot,
} from '../services/companyInventoryBrowse.service';
import {
  companyUsesProjectBrowse,
  listProjectsForBuyerBrowse,
  formatProjectCatalogIntro,
  buildProjectSelectListComponent,
} from '../services/projectBrowse.service';
import {
  formatBuyerCatalogEmpty,
  formatBuyerCatalogMatches,
  formatInventoryCountReply,
  isInventoryCountQuery,
} from './formatBuyerCatalog.util';
import { tBuyer } from './buyerI18n.util';

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
      components: buildFilterButtonsComponent(snapshot),
    };
  }

  const reply = formatProjectCatalogIntro(projects, lang);
  const snapshot = await getCompanyBrowseSnapshot(input.companyId);

  return {
    reply,
    propertyIds: [],
    properties: [],
    components: [
      buildProjectSelectListComponent(projects),
      ...buildFilterButtonsComponent(snapshot),
    ],
  };
}

export async function resolvePropertyBrowseTurn(
  input: PropertyBrowseContext,
): Promise<PropertyBrowseTurnPayload | null> {
  const { companyId, messageText } = input;

  if (isPropertyInquiryMessage(messageText)) {
    return null;
  }

  const filters = parseBrowseFilters(messageText);

  if (isInventoryCountQuery(messageText)) {
    const projectTurn = await resolveProjectFirstBrowseTurn(input, filters);
    if (projectTurn) {
      const summary = await getInventorySummary(companyId);
      return {
        ...projectTurn,
        reply: `${formatInventoryCountReply(summary)}\n\n${projectTurn.reply}`,
      };
    }

    const summary = await getInventorySummary(companyId);
    const reply = formatInventoryCountReply(summary);
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
      }),
    };
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
    const snapshot = await getCompanyBrowseSnapshot(companyId);
    return {
      reply: formatBuyerCatalogEmpty(messageText),
      propertyIds: [],
      properties: [],
      components: buildFilterButtonsComponent(snapshot),
    };
  }

  const reply = formatBuyerCatalogMatches(matches);
  const properties = matches.map((p) => ({ id: p.id, name: p.name }));
  const propertyIds = matches.map((p) => p.id);

  const mediaComponents = await resolveProactiveBrowseMedia(companyId, matches);
  const interactive = await buildPropertyBrowseComponents({
    matches,
    stage: input.stage,
    outboundText: reply,
    properties,
    companyId,
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
): WhatsAppComponent[] {
  const buttons = buildCatalogFilterButtonSet(snapshot);
  if (!buttons.length) return [];
  return [{ kind: 'buttons', buttons }];
}

async function buildPropertyBrowseComponents(input: {
  matches: Array<{ id: string; name: string; propertyType: string | null }>;
  stage: string;
  outboundText: string;
  properties: Array<{ id: string; name: string }>;
  companyId: string;
}): Promise<WhatsAppComponent[]> {
  if (input.matches.length >= 2) {
    return [{
      kind: 'list',
      title: 'View properties',
      sections: [{
        title: 'Matching listings',
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
    return buildFilterButtonsComponent(snapshot);
  }

  return [{
    kind: 'buttons',
    buttons: [
      { id: `more-info-${primary.id}`, title: '🏗️ Property Details' },
      { id: `book-visit-${primary.id}`, title: '🗓️ Book Visit' },
      { id: 'call-me', title: '📞 Call Me' },
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

  const images = full.images;
  if (Array.isArray(images)) {
    const hero = images.find((u) => typeof u === 'string' && u.startsWith('https://')) as string | undefined;
    if (hero) {
      out.push({ kind: 'media', url: hero, mime: 'image/jpeg', caption: full.name });
    }
  }

  return out.slice(0, 2);
}

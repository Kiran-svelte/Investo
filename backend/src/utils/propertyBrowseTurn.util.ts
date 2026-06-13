import prisma from '../config/prisma';
import type { WhatsAppComponent } from '../types/whatsapp-turn.types';
import { matchCatalogPropertiesForQuery, getInventorySummary } from '../services/propertyKnowledge.service';
import { isPropertyInquiryMessage } from '../services/customerMessageFastPath.service';
import { resolveBrochureUrlForWhatsApp } from '../services/brochureDelivery.service';
import {
  formatBuyerCatalogEmpty,
  formatBuyerCatalogMatches,
  formatInventoryCountReply,
  isInventoryCountQuery,
} from './formatBuyerCatalog.util';

export type PropertyBrowseContext = {
  companyId: string;
  messageText: string;
  stage: string;
};

export type PropertyBrowseTurnPayload = {
  reply: string;
  propertyIds: string[];
  properties: Array<{ id: string; name: string }>;
  components: WhatsAppComponent[];
};

export async function resolvePropertyBrowseTurn(
  input: PropertyBrowseContext,
): Promise<PropertyBrowseTurnPayload | null> {
  const { companyId, messageText } = input;

  if (isPropertyInquiryMessage(messageText)) {
    return null;
  }

  if (isInventoryCountQuery(messageText)) {
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
      components: buildPropertyBrowseComponents({
        matches: properties.map((p) => ({ id: p.id, name: p.name, propertyType: null })),
        stage: input.stage,
        outboundText: reply,
        properties,
      }),
    };
  }

  const matches = await matchCatalogPropertiesForQuery({
    companyId,
    query: messageText,
    limit: 5,
  });

  if (!matches.length) {
    return {
      reply: formatBuyerCatalogEmpty(messageText),
      propertyIds: [],
      properties: [],
      components: buildFilterButtonsComponent(),
    };
  }

  const reply = formatBuyerCatalogMatches(matches);
  const properties = matches.map((p) => ({ id: p.id, name: p.name }));
  const propertyIds = matches.map((p) => p.id);

  const mediaComponents = await resolveProactiveBrowseMedia(companyId, matches);
  const interactive = buildPropertyBrowseComponents({
    matches,
    stage: input.stage,
    outboundText: reply,
    properties,
  });

  return {
    reply,
    propertyIds,
    properties,
    components: [...mediaComponents, ...interactive],
  };
}

function buildFilterButtonsComponent(): WhatsAppComponent[] {
  return [{
    kind: 'buttons',
    buttons: [
      { id: 'filter-apartment', title: '🏢 Apartments' },
      { id: 'filter-villa', title: '🏡 Villas' },
      { id: 'filter-4bhk', title: '4 BHK' },
    ],
  }];
}

function buildPropertyBrowseComponents(input: {
  matches: Array<{ id: string; name: string; propertyType: string | null }>;
  stage: string;
  outboundText: string;
  properties: Array<{ id: string; name: string }>;
}): WhatsAppComponent[] {
  if (input.matches.length >= 2) {
    return [{
      kind: 'list',
      title: 'View projects',
      sections: [{
        title: 'Matching projects',
        rows: input.matches.slice(0, 10).map((p) => ({
          id: `more-info-${p.id}`,
          title: p.name.slice(0, 24),
          description: (p.propertyType ?? 'project').slice(0, 72),
        })),
      }],
    }];
  }

  const primary = input.matches[0];
  if (!primary) return buildFilterButtonsComponent();

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
  matches: Array<{ id: string; name: string; brochureUrl: string | null }>,
): Promise<WhatsAppComponent[]> {
  if (matches.length !== 1) return [];

  const prop = await prisma.property.findFirst({
    where: { id: matches[0].id, companyId },
    select: { id: true, name: true, images: true, brochureUrl: true },
  });
  if (!prop) return [];

  const components: WhatsAppComponent[] = [];
  const images = Array.isArray(prop.images) ? (prop.images as string[]) : [];
  const heroUrl = images.find((url) => typeof url === 'string' && url.startsWith('https://'));
  if (heroUrl) {
    components.push({ kind: 'media', url: heroUrl, mime: 'image/jpeg', caption: prop.name });
  }

  const brochureStored = prop.brochureUrl ?? matches[0].brochureUrl;
  if (brochureStored) {
    const pdfUrl = await resolveBrochureUrlForWhatsApp(brochureStored);
    if (pdfUrl) {
      components.push({
        kind: 'media',
        url: pdfUrl,
        mime: 'application/pdf',
        caption: `${prop.name} — Brochure`,
      });
    }
  }

  return components.slice(0, 2);
}

import prisma from '../config/prisma';

export type BuyerPropertyContextProperty = {
  id: string;
  name: string | null;
};

export type BuyerPropertyContextPatch = {
  selectedPropertyId?: string | null;
  recommendedPropertyIds?: string[];
};

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasPropertyFollowupIntent(messageText: string): boolean {
  return /\b(property|project|option|details?|info|brochure|pdf|price|cost|available|availability|visit|book|about)\b/i.test(
    messageText,
  );
}

function resolveOrdinalReference(messageText: string): number | null {
  if (!hasPropertyFollowupIntent(messageText)) return null;

  const match = messageText.match(
    /\b(?:option|project|property|details?|info|brochure|pdf|about|on|number|no\.?|#)\s*#?\s*(\d{1,2})(?!\s*(?:am|pm)\b)/i,
  );
  if (!match?.[1]) return null;

  const index = Number(match[1]);
  if (!Number.isInteger(index) || index <= 0) return null;
  return index;
}

function propertyMentionIndex(messageText: string, propertyName: string | null): number {
  const name = normalizeText(propertyName ?? '');
  if (!name || name.length < 3) return -1;
  return normalizeText(messageText).indexOf(name);
}

async function findPropertyMentionedByName(
  companyId: string,
  messageText: string,
): Promise<string | null> {
  const properties = await prisma.property.findMany({
    where: { companyId, status: 'available' },
    select: { id: true, name: true },
    take: 100,
  });

  const matches = properties
    .map((property) => ({ property, index: propertyMentionIndex(messageText, property.name) }))
    .filter((match) => match.index >= 0)
    .sort((a, b) => {
      if (a.index !== b.index) return a.index - b.index;
      return (b.property.name?.length ?? 0) - (a.property.name?.length ?? 0);
    });

  return matches[0]?.property.id ?? null;
}

export async function resolveBuyerPropertyReference(input: {
  companyId: string;
  messageText: string;
  selectedPropertyId?: string | null;
  recommendedPropertyIds?: readonly string[] | null;
}): Promise<string | null> {
  const byName = await findPropertyMentionedByName(input.companyId, input.messageText);
  if (byName) return byName;

  const recommended = [...(input.recommendedPropertyIds ?? [])].filter(Boolean);
  const ordinal = resolveOrdinalReference(input.messageText);
  if (ordinal && recommended[ordinal - 1]) {
    return recommended[ordinal - 1];
  }

  if (input.selectedPropertyId) {
    return input.selectedPropertyId;
  }

  if (recommended.length === 1) {
    return recommended[0];
  }

  return null;
}

export function inferBuyerPropertyContextFromOutbound(input: {
  outboundText: string;
  properties: BuyerPropertyContextProperty[];
}): BuyerPropertyContextPatch {
  const matches = input.properties
    .map((property) => ({ property, index: propertyMentionIndex(input.outboundText, property.name) }))
    .filter((match) => match.index >= 0)
    .sort((a, b) => a.index - b.index);

  const recommendedPropertyIds = Array.from(new Set(matches.map((match) => match.property.id)));
  if (recommendedPropertyIds.length === 0) return {};

  return {
    recommendedPropertyIds,
    selectedPropertyId: recommendedPropertyIds.length === 1 ? recommendedPropertyIds[0] : null,
  };
}

import prisma from '../config/prisma';
import type { PropertyStatus } from '@prisma/client';
import logger from '../config/logger';

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
  statuses: PropertyStatus[] = ['available', 'upcoming'],
): Promise<string | null> {
  const properties = await prisma.property.findMany({
    where: { companyId, status: { in: statuses } },
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

function extractUnitNumberTokens(messageText: string): string[] {
  return [...messageText.matchAll(/\b(\d{3,4})\b/g)].map((m) => m[1]);
}

/** Match sold/unavailable units when buyer asks by name or unit number. */
export async function findSoldPropertyMentionedByName(
  companyId: string,
  messageText: string,
): Promise<{ id: string; name: string; projectId: string | null; status: string } | null> {
  const byName = await findPropertyMentionedByName(companyId, messageText, ['sold']);
  if (byName) {
    const row = await prisma.property.findFirst({
      where: { id: byName, companyId },
      select: { id: true, name: true, projectId: true, status: true },
    });
    if (row) return row;
  }

  const unitTokens = extractUnitNumberTokens(messageText);
  if (!unitTokens.length) return null;

  const soldUnits = await prisma.property.findMany({
    where: { companyId, status: 'sold' },
    select: { id: true, name: true, projectId: true, status: true },
    take: 80,
  });

  for (const token of unitTokens) {
    const match = soldUnits.find((p) => p.name?.includes(token));
    if (match) return match;
  }

  return null;
}

/**
 * Returns true when the message explicitly names a property (proper noun or project keyword)
 * that is NOT just a follow-up on a prior context. When the user says "book visit for
 * Commercial Hub" we must not fall back to a stale selectedPropertyId (e.g. Sunset Heights).
 */
function hasExplicitPropertyNameIntent(messageText: string): boolean {
  // Detect "for <PropertyName>", "at <PropertyName>", "of <PropertyName>", "<PropertyName> visit"
  return /\b(for|at|of|in)\s+[A-Z][a-z]+/i.test(messageText) ||
    /\b(villa|heights|hub|gardens?|residenc|enclave|court|towers?|park|valley|grove|estate|square|city|bay|lake|phase)\b/i.test(messageText);
}

export async function resolveBuyerPropertyReference(input: {
  companyId: string;
  messageText: string;
  selectedPropertyId?: string | null;
  recommendedPropertyIds?: readonly string[] | null;
}): Promise<string | null> {
  const byName = await findPropertyMentionedByName(input.companyId, input.messageText);
  if (byName) return byName;

  // If the message explicitly names a specific property that isn't in the catalog,
  // do NOT silently fall back to selectedPropertyId — that would book the wrong property.
  // Return null and let the orchestrator ask the user to clarify.
  if (hasExplicitPropertyNameIntent(input.messageText)) {
    logger.info('resolveBuyerPropertyReference: explicit name intent but no DB match — returning null to avoid wrong-property fallback', {
      messageText: input.messageText.slice(0, 80),
      selectedPropertyId: input.selectedPropertyId,
    });
    return null;
  }

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

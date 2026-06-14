import prisma from '../config/prisma';
import type { PropertyStatus } from '@prisma/client';
import config from '../config';
import logger from '../config/logger';

export type BuyerPropertyContextProperty = {
  id: string;
  name: string | null;
};

export type BuyerPropertyContextPatch = {
  selectedPropertyId?: string | null;
  recommendedPropertyIds?: string[];
};

export type BuyerPropertyResolveInput = {
  companyId: string;
  messageText: string;
  selectedPropertyId?: string | null;
  recommendedPropertyIds?: readonly string[] | null;
  /** When set, name search prefers properties in this project */
  scopedProjectId?: string | null;
  /** When true, return ambiguity instead of first match */
  strictMultiMatch?: boolean;
};

export type BuyerPropertyResolveResult = {
  propertyId: string | null;
  /** Multiple name matches across projects — caller must clarify */
  ambiguousMatches?: Array<{ id: string; name: string; projectId: string | null }>;
  /** Match found but in different project than scopedProjectId */
  crossProjectSwitch?: boolean;
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

function propertyMentionIndexWithUnits(messageText: string, propertyName: string | null): number {
  const base = propertyMentionIndex(messageText, propertyName);
  if (base >= 0) return base;

  const name = normalizeText(propertyName ?? '');
  if (!name) return -1;
  const normalizedMessage = normalizeText(messageText);
  for (const token of extractUnitNumberTokens(messageText)) {
    if (token.length >= 3 && name.includes(token)) {
      const idx = normalizedMessage.indexOf(token);
      if (idx >= 0) return idx;
    }
  }
  return -1;
}

type PropertyNameRow = { id: string; name: string | null; projectId?: string | null };

function rankPropertyNameMatches(
  properties: PropertyNameRow[],
  messageText: string,
  allowUnitTokens = false,
): Array<{ id: string; name: string | null; projectId: string | null; index: number }> {
  const mentionIndex = allowUnitTokens ? propertyMentionIndexWithUnits : propertyMentionIndex;
  return properties
    .map((property) => ({
      id: property.id,
      name: property.name,
      projectId: property.projectId ?? null,
      index: mentionIndex(messageText, property.name),
    }))
    .filter((match) => match.index >= 0)
    .sort((a, b) => {
      if (a.index !== b.index) return a.index - b.index;
      return (b.name?.length ?? 0) - (a.name?.length ?? 0);
    });
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

  const matches = rankPropertyNameMatches(properties, messageText);
  return matches[0]?.id ?? null;
}

async function findPropertyMentionedByNameScoped(
  companyId: string,
  messageText: string,
  projectId: string,
  statuses: PropertyStatus[] = ['available', 'upcoming'],
): Promise<string | null> {
  const properties = await prisma.property.findMany({
    where: { companyId, projectId, status: { in: statuses } },
    select: { id: true, name: true, projectId: true },
    take: 100,
  });
  const matches = rankPropertyNameMatches(properties, messageText, true);
  return matches[0]?.id ?? null;
}

function detectAmbiguousMatches(
  matches: Array<{ id: string; name: string | null; projectId: string | null }>,
  messageText: string,
): BuyerPropertyResolveResult['ambiguousMatches'] | undefined {
  if (matches.length < 2) return undefined;

  const distinctProjectIds = new Set(matches.map((m) => m.projectId).filter(Boolean));
  const unitTokens = extractUnitNumberTokens(messageText);
  const sharedUnitAmbiguity = unitTokens.some((token) =>
    matches.filter((m) => m.name?.includes(token)).length > 1,
  );

  if (distinctProjectIds.size <= 1 && !sharedUnitAmbiguity) return undefined;

  return matches.slice(0, 5).map((m) => ({
    id: m.id,
    name: m.name ?? 'Property',
    projectId: m.projectId,
  }));
}

async function findPropertyMentionedByNameGlobalWithMeta(
  companyId: string,
  messageText: string,
  statuses: PropertyStatus[] = ['available', 'upcoming'],
): Promise<Pick<BuyerPropertyResolveResult, 'propertyId' | 'ambiguousMatches'>> {
  const properties = await prisma.property.findMany({
    where: { companyId, status: { in: statuses } },
    select: { id: true, name: true, projectId: true },
    take: 100,
  });

  const matches = rankPropertyNameMatches(properties, messageText, true);
  if (matches.length === 0) return { propertyId: null };

  const ambiguousMatches = detectAmbiguousMatches(matches, messageText);
  if (ambiguousMatches?.length) {
    return { propertyId: null, ambiguousMatches };
  }

  return { propertyId: matches[0].id };
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
  return /\b(for|at|of|in)\s+[A-Z][a-z]+/i.test(messageText) ||
    /\b(villa|heights|hub|gardens?|residenc|enclave|court|towers?|park|valley|grove|estate|square|city|bay|lake|phase)\b/i.test(messageText);
}

async function resolvePropertyProjectId(propertyId: string): Promise<string | null> {
  const row = await prisma.property.findFirst({
    where: { id: propertyId },
    select: { projectId: true },
  });
  return row?.projectId ?? null;
}

async function resolveBuyerPropertyReferenceWithMeta(
  input: BuyerPropertyResolveInput,
): Promise<BuyerPropertyResolveResult> {
  if (input.scopedProjectId) {
    const scopedMatch = await findPropertyMentionedByNameScoped(
      input.companyId,
      input.messageText,
      input.scopedProjectId,
    );
    if (scopedMatch) return { propertyId: scopedMatch };
  }

  const explicitIntent = hasExplicitPropertyNameIntent(input.messageText);
  const useStrictGlobal = explicitIntent || input.strictMultiMatch;

  if (useStrictGlobal) {
    const global = await findPropertyMentionedByNameGlobalWithMeta(input.companyId, input.messageText);
    if (global.ambiguousMatches?.length) {
      return { propertyId: null, ambiguousMatches: global.ambiguousMatches };
    }
    if (global.propertyId) {
      if (input.scopedProjectId) {
        const projectId = await resolvePropertyProjectId(global.propertyId);
        if (projectId && projectId !== input.scopedProjectId) {
          return { propertyId: global.propertyId, crossProjectSwitch: true };
        }
      }
      return { propertyId: global.propertyId };
    }
    if (explicitIntent) {
      logger.info('resolveBuyerPropertyReference: explicit name intent but no DB match — returning null to avoid wrong-property fallback', {
        messageText: input.messageText.slice(0, 80),
        selectedPropertyId: input.selectedPropertyId,
      });
      return { propertyId: null };
    }
  } else {
    const byName = await findPropertyMentionedByName(input.companyId, input.messageText);
    if (byName) {
      if (input.scopedProjectId) {
        const projectId = await resolvePropertyProjectId(byName);
        if (projectId && projectId !== input.scopedProjectId) {
          return { propertyId: byName, crossProjectSwitch: true };
        }
      }
      return { propertyId: byName };
    }
  }

  const recommended = [...(input.recommendedPropertyIds ?? [])].filter(Boolean);
  const ordinal = resolveOrdinalReference(input.messageText);
  if (ordinal && recommended[ordinal - 1]) {
    return { propertyId: recommended[ordinal - 1] };
  }

  if (input.selectedPropertyId && !explicitIntent) {
    return { propertyId: input.selectedPropertyId };
  }

  if (recommended.length === 1) {
    return { propertyId: recommended[0] };
  }

  return { propertyId: null };
}

export function buildPropertyAmbiguityClarifyReply(
  matches: Array<{ name: string }>,
): string {
  const lines = matches.slice(0, 5).map((m, i) => `${i + 1}. ${m.name}`);
  return [
    'I found more than one match:',
    ...lines,
    'Which one do you mean? Reply with the number or full name.',
  ].join('\n');
}

export async function resolveBuyerPropertyReference(input: BuyerPropertyResolveInput): Promise<string | null> {
  if (!config.features.scopedPropertyResolve) {
    const byName = await findPropertyMentionedByName(input.companyId, input.messageText);
    if (byName) return byName;

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

  const meta = await resolveBuyerPropertyReferenceWithMeta(input);
  return meta.propertyId;
}

/** Enterprise property reference — checks sold units before available catalog match. */
export async function resolveBuyerPropertyReferenceEnterprise(input: BuyerPropertyResolveInput): Promise<{
  availablePropertyId: string | null;
  soldProperty: Awaited<ReturnType<typeof findSoldPropertyMentionedByName>>;
  ambiguousMatches?: BuyerPropertyResolveResult['ambiguousMatches'];
  crossProjectSwitch?: boolean;
}> {
  const soldProperty = await findSoldPropertyMentionedByName(input.companyId, input.messageText);
  if (soldProperty) {
    return { availablePropertyId: null, soldProperty };
  }

  if (!config.features.scopedPropertyResolve) {
    const availablePropertyId = await resolveBuyerPropertyReference(input);
    return { availablePropertyId, soldProperty: null };
  }

  const meta = await resolveBuyerPropertyReferenceWithMeta({
    ...input,
    strictMultiMatch: input.strictMultiMatch ?? true,
  });
  return {
    availablePropertyId: meta.propertyId,
    soldProperty: null,
    ambiguousMatches: meta.ambiguousMatches,
    crossProjectSwitch: meta.crossProjectSwitch,
  };
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

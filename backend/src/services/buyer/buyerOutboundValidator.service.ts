import config from '../../config';
import logger from '../../config/logger';
import prisma from '../../config/prisma';
import { tBuyer } from '../../utils/buyerI18n.util';

export type CatalogNameRow = { id: string; name: string; projectId: string | null };

export type OutboundValidateInput = {
  text: string;
  allowedPropertyIds: string[];
  propertyNamesById: Map<string, string>;
  catalogNamesForDetection: CatalogNameRow[];
  visitPropertyIds?: string[];
  language: string;
};

export type OutboundValidateResult = {
  text: string;
  modified: boolean;
  strippedMentions: string[];
  action: 'none' | 'strip_sentences' | 'append_clarify' | 'replace_with_clarify';
};

const nameCache = new Map<string, { at: number; rows: CatalogNameRow[] }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function loadCatalogNamesForDetection(companyId: string): Promise<CatalogNameRow[]> {
  const cached = nameCache.get(companyId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;
  const rows = await prisma.property.findMany({
    where: { companyId, status: { in: ['available', 'upcoming'] } },
    select: { id: true, name: true, projectId: true },
    take: 200,
    orderBy: { updatedAt: 'desc' },
  });
  nameCache.set(companyId, { at: Date.now(), rows });
  return rows;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((p) => p.trim()).filter(Boolean);
}

export function validateBuyerOutbound(input: OutboundValidateInput): OutboundValidateResult {
  if (!config.features.outboundPropertyValidate) {
    return { text: input.text, modified: false, strippedMentions: [], action: 'none' };
  }

  const allowedSet = new Set(input.allowedPropertyIds);
  const visitSet = new Set(input.visitPropertyIds ?? []);
  const strippedMentions: string[] = [];
  const keptSentences: string[] = [];

  for (const sentence of splitSentences(input.text)) {
    let violates = false;
    for (const row of input.catalogNamesForDetection) {
      const name = row.name?.trim();
      if (!name || name.length < 4) continue;
      if (allowedSet.has(row.id) || visitSet.has(row.id)) continue;
      if (new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(sentence)) {
        violates = true;
        if (!strippedMentions.includes(name)) strippedMentions.push(name);
      }
    }
    if (!violates) keptSentences.push(sentence);
  }

  if (!strippedMentions.length) {
    return { text: input.text, modified: false, strippedMentions: [], action: 'none' };
  }

  const strippedText = keptSentences.join(' ').trim();
  const removedRatio = (input.text.length - strippedText.length) / Math.max(input.text.length, 1);
  let action: OutboundValidateResult['action'] = 'strip_sentences';
  let text = strippedText;

  if (strippedText.length < 40 || removedRatio > 0.4) {
    action = 'replace_with_clarify';
    text = tBuyer(input.language, 'scoped_browse_offer');
  } else {
    action = 'append_clarify';
    text = `${strippedText}\n\n${tBuyer(input.language, 'out_of_scope_property_clarify')}`;
  }

  if (config.features.shadowMode) {
    logger.warn('buyerOutboundValidator.shadow', {
      strippedMentions,
      allowedPropertyIds: input.allowedPropertyIds,
      originalLength: input.text.length,
      action,
    });
  }

  return { text, modified: text !== input.text, strippedMentions, action };
}

export async function validateBuyerOutboundForTurn(input: {
  companyId: string;
  text: string;
  allowedPropertyIds: string[];
  scopeProperties: Array<{ id: string; name: string }>;
  visitPropertyRows?: Array<{ id: string; name: string }>;
  visitPropertyIds?: string[];
  language: string;
}): Promise<OutboundValidateResult> {
  const catalogNamesForDetection = await loadCatalogNamesForDetection(input.companyId);
  const propertyNamesById = new Map<string, string>();
  for (const row of [...input.scopeProperties, ...(input.visitPropertyRows ?? [])]) {
    if (row.name?.trim()) propertyNamesById.set(row.id, row.name.trim());
  }
  return validateBuyerOutbound({
    text: input.text,
    allowedPropertyIds: input.allowedPropertyIds,
    propertyNamesById,
    catalogNamesForDetection,
    visitPropertyIds: input.visitPropertyIds,
    language: input.language,
  });
}

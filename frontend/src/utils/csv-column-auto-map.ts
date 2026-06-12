/**
 * Client-side column → field auto-mapping for bulk CSV import.
 * Mirrors backend csv-import.service resolve logic so mapping works even before API deploy catches up.
 */

import {
  BULK_IMPORT_FIELDS,
  BULK_IMPORT_PRICE_SINGLE_FIELD,
} from '../constants/property-import-fields.constants';

const FIELD_KEYS = new Set(BULK_IMPORT_FIELDS.map((field) => field.key));

const COLUMN_ALIASES: Record<string, string> = (() => {
  const aliases: Record<string, string> = {
    rate: BULK_IMPORT_PRICE_SINGLE_FIELD,
    'single price': BULK_IMPORT_PRICE_SINGLE_FIELD,
    'all inclusive price': 'price',
  };

  for (const field of BULK_IMPORT_FIELDS) {
    if (field.key === BULK_IMPORT_PRICE_SINGLE_FIELD) {
      continue;
    }
    const keyNormalised = field.key.replace(/_/g, ' ');
    aliases[keyNormalised] = field.key;
    aliases[field.key.replace(/_/g, '')] = field.key;
  }

  return aliases;
})();

function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_\-/\\]+/g, ' ').replace(/\s+/g, ' ');
}

function resolveHeaderAlias(header: string): string {
  const trimmed = header.trim();
  if (!trimmed || /^__empty/i.test(trimmed)) {
    return 'skip';
  }

  const snakeKey = trimmed.toLowerCase().replace(/[\s-]+/g, '_');
  if (FIELD_KEYS.has(snakeKey)) {
    return snakeKey;
  }

  const normalised = normaliseHeader(header);
  const exact = COLUMN_ALIASES[normalised];
  if (exact) {
    return exact;
  }

  const aliasEntries = Object.entries(COLUMN_ALIASES).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, field] of aliasEntries) {
    if (normalised.includes(alias)) {
      return field;
    }
  }

  return 'skip';
}

/** Builds a header → target field mapping from spreadsheet column names. */
export function buildSuggestedColumnMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const usedTargets = new Set<string>();

  for (const header of headers) {
    const target = resolveHeaderAlias(header);

    if (target !== 'skip' && usedTargets.has(target)) {
      mapping[header] = 'skip';
      continue;
    }

    mapping[header] = target;
    if (target !== 'skip') {
      usedTargets.add(target);
    }
  }

  return mapping;
}

/** Prefer client auto-map when backend still returns legacy skip/name mappings. */
export function mergeSuggestedColumnMappings(
  headers: string[],
  backendMapping: Record<string, string>,
): Record<string, string> {
  const clientMapping = buildSuggestedColumnMapping(headers);
  const merged: Record<string, string> = {};

  for (const header of headers) {
    const clientTarget = clientMapping[header] ?? 'skip';
    const backendTarget = backendMapping[header] ?? 'skip';

    if (clientTarget !== 'skip') {
      merged[header] = clientTarget;
    } else {
      merged[header] = backendTarget;
    }
  }

  return merged;
}

export function autoDetectedHeadersFromMapping(mapping: Record<string, string>): string[] {
  return Object.entries(mapping)
    .filter(([, field]) => field && field !== 'skip')
    .map(([header]) => header);
}

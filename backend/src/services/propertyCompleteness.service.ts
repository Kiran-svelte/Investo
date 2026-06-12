import type { Property, PropertyImportDraft, PropertyType } from '@prisma/client';
import prisma from '../config/prisma';
import { isFixMdEnabled } from '../utils/fixMdFeatures.util';

const RESIDENTIAL_TYPES: PropertyType[] = ['apartment', 'villa'];

export type PropertyCompletenessField =
  | 'name'
  | 'propertyType'
  | 'locationCity'
  | 'locationArea'
  | 'price'
  | 'bedrooms'
  | 'descriptionOrBrochure'
  | 'customerMedia'
  | 'status';

export interface PropertyCompletenessResult {
  isPublishable: boolean;
  missingFields: PropertyCompletenessField[];
  humanMissing: string[];
}

export type PropertyLike = {
  name?: string | null;
  propertyType?: string | null;
  locationCity?: string | null;
  locationArea?: string | null;
  priceMin?: unknown;
  priceMax?: unknown;
  bedrooms?: number | null;
  description?: string | null;
  brochureUrl?: string | null;
  images?: unknown;
  status?: string | null;
};

function hasPrice(priceMin: unknown, priceMax: unknown): boolean {
  const min = toNumber(priceMin);
  const max = toNumber(priceMax);
  return (min !== null && min > 0) || (max !== null && max > 0);
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }
  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasCustomerMedia(input: PropertyLike): boolean {
  if (isNonEmptyString(input.brochureUrl)) return true;
  const images = Array.isArray(input.images) ? input.images : [];
  return images.some(
    (url) => typeof url === 'string' && /^https?:\/\//i.test(url.trim()),
  );
}

function pickDraftImages(data: Record<string, unknown>): unknown {
  const raw = data.images ?? data.image_urls ?? data.imageUrls;
  return Array.isArray(raw) ? raw : null;
}

const FIELD_LABELS: Record<PropertyCompletenessField, string> = {
  name: 'Property name',
  propertyType: 'Property type',
  locationCity: 'City',
  locationArea: 'Area / locality',
  price: 'Price (min or max)',
  bedrooms: 'Bedrooms (residential)',
  descriptionOrBrochure: 'Description or brochure',
  customerMedia: 'Hero image or brochure PDF (WhatsApp media)',
  status: 'Listing status',
};

/**
 * Required fields for a property to be customer-facing / publishable.
 */
export function assessPropertyCompleteness(input: PropertyLike): PropertyCompletenessResult {
  const missingFields: PropertyCompletenessField[] = [];

  if (!isNonEmptyString(input.name)) missingFields.push('name');
  if (!isNonEmptyString(input.propertyType)) missingFields.push('propertyType');
  if (!isNonEmptyString(input.locationCity)) missingFields.push('locationCity');
  if (!isNonEmptyString(input.locationArea)) missingFields.push('locationArea');
  if (!hasPrice(input.priceMin, input.priceMax)) missingFields.push('price');

  const type = (input.propertyType || '').toLowerCase();
  if (RESIDENTIAL_TYPES.includes(type as PropertyType) && (input.bedrooms === null || input.bedrooms === undefined)) {
    missingFields.push('bedrooms');
  }

  const hasDescription = isNonEmptyString(input.description);
  const hasBrochure = isNonEmptyString(input.brochureUrl);
  if (!hasDescription && !hasBrochure) missingFields.push('descriptionOrBrochure');

  if (isFixMdEnabled('fixMdPropertyMediaCompleteness') && !hasCustomerMedia(input)) {
    missingFields.push('customerMedia');
  }

  if (!isNonEmptyString(input.status)) missingFields.push('status');

  return {
    isPublishable: missingFields.length === 0,
    missingFields,
    humanMissing: missingFields.map((f) => FIELD_LABELS[f]),
  };
}

export function assessDraftCompleteness(draftData: Record<string, unknown>): PropertyCompletenessResult {
  return assessPropertyCompleteness({
    name: pickDraftString(draftData, ['name']),
    propertyType: pickDraftString(draftData, ['property_type', 'propertyType']),
    locationCity: pickDraftString(draftData, ['location_city', 'locationCity']),
    locationArea: pickDraftString(draftData, ['location_area', 'locationArea']),
    priceMin: draftData.price_min ?? draftData.priceMin,
    priceMax: draftData.price_max ?? draftData.priceMax,
    bedrooms: pickDraftInt(draftData, ['bedrooms']),
    description: pickDraftString(draftData, ['description']),
    brochureUrl: pickDraftString(draftData, ['brochure_url', 'brochureUrl']),
    images: pickDraftImages(draftData),
    status: pickDraftString(draftData, ['status']) || 'available',
  });
}

function pickDraftString(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function pickDraftInt(data: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    if (typeof v === 'string' && v.trim()) {
      const n = parseInt(v, 10);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

export interface UserCatalogBlock {
  blocked: boolean;
  reasons: Array<{
    type: 'import_draft' | 'published_property';
    id: string;
    label: string;
    missingFields: string[];
  }>;
  promptMessage: string;
}

/** Only block other app areas when admin must fix data before publish — not while still uploading/extracting. */
const BLOCKING_DRAFT_STATUSES = ['review_ready', 'publish_ready'] as const;

export async function getUserCatalogCompletenessBlock(
  companyId: string,
  userId: string,
): Promise<UserCatalogBlock | null> {
  const reasons: UserCatalogBlock['reasons'] = [];

  const drafts = await prisma.propertyImportDraft.findMany({
    where: {
      companyId,
      createdByUserId: userId,
      status: { in: [...BLOCKING_DRAFT_STATUSES] },
    },
    select: { id: true, draftData: true, status: true },
    take: 20,
  });

  for (const draft of drafts) {
    const assessment = assessDraftCompleteness((draft.draftData as Record<string, unknown>) || {});
    if (!assessment.isPublishable) {
      reasons.push({
        type: 'import_draft',
        id: draft.id,
        label: `Import draft (${draft.status})`,
        missingFields: assessment.humanMissing,
      });
    }
  }

  const publishedFromUser = await prisma.propertyImportDraft.findMany({
    where: {
      companyId,
      createdByUserId: userId,
      publishedPropertyId: { not: null },
    },
    select: { publishedPropertyId: true },
  });

  const propertyIds = [
    ...new Set(
      publishedFromUser
        .map((d) => d.publishedPropertyId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (propertyIds.length > 0) {
    const properties = await prisma.property.findMany({
      where: { companyId, id: { in: propertyIds }, status: 'available' },
    });
    for (const property of properties) {
      const assessment = assessPropertyCompleteness(property);
      if (!assessment.isPublishable) {
        reasons.push({
          type: 'published_property',
          id: property.id,
          label: property.name || 'Published property',
          missingFields: assessment.humanMissing,
        });
      }
    }
  }

  if (reasons.length === 0) return null;

  const lines = reasons.flatMap((r) => [
    `• ${r.label}: ${r.missingFields.join(', ')}`,
  ]);

  return {
    blocked: true,
    reasons,
    promptMessage: `Please complete your property catalog before using other features.\n\nMissing details:\n${lines.join('\n')}\n\nUpdate your property import or listing in Properties.`,
  };
}

export function propertyToCompletenessInput(property: Property): PropertyLike {
  return {
    name: property.name,
    propertyType: property.propertyType,
    locationCity: property.locationCity,
    locationArea: property.locationArea,
    priceMin: property.priceMin,
    priceMax: property.priceMax,
    bedrooms: property.bedrooms,
    description: property.description,
    brochureUrl: property.brochureUrl,
    images: property.images,
    status: property.status,
  };
}

export function formatCompletenessForAgentTool(result: PropertyCompletenessResult): string {
  if (result.isPublishable) return 'Property is publishable.';
  return `Not publishable. Missing: ${result.humanMissing.join(', ')}`;
}

/** Notify the brochure uploader (company admin) to complete missing fields. */
export async function notifyUploaderOfMissingFields(
  companyId: string,
  userId: string,
  draftId: string,
  assessment: PropertyCompletenessResult,
): Promise<void> {
  if (assessment.isPublishable) return;

  await prisma.notification.create({
    data: {
      companyId,
      userId,
      type: 'system',
      title: 'Complete property details',
      message: `Your property import needs: ${assessment.humanMissing.join(', ')}. Update the draft in Properties → Import. Until this is complete, other CRM actions may be limited.`,
      data: { draftId, missingFields: assessment.humanMissing },
    },
  });
}

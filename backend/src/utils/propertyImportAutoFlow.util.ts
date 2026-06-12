/**
 * Image-only property imports: auto-approve review and skip manual knowledge Q&A.
 */

const IMAGE_ASSET_TYPES = new Set(['image']);
const VISION_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const IMAGE_AUTO_FLOW_MODE = 'image_auto';

export function isImageAutoImportFlow(draftData: unknown): boolean {
  if (!draftData || typeof draftData !== 'object' || Array.isArray(draftData)) {
    return false;
  }
  return (draftData as Record<string, unknown>).import_flow_mode === IMAGE_AUTO_FLOW_MODE;
}

export function isImageOnlyPropertyImportMedia(
  media: Array<{ assetType?: string | null; mimeType?: string | null }>,
): boolean {
  if (media.length === 0) {
    return false;
  }
  return media.every((item) => {
    const assetType = String(item.assetType || '').toLowerCase();
    if (IMAGE_ASSET_TYPES.has(assetType)) {
      return true;
    }
    const mime = String(item.mimeType || '').toLowerCase();
    return VISION_MIMES.has(mime);
  });
}

function readTypeKnowledge(draftData: Record<string, unknown>): Record<string, string> {
  const raw = draftData.type_knowledge ?? draftData.typeKnowledge;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim()) {
      out[key] = value.trim();
    }
  }
  return out;
}

function formatPriceLabel(draftData: Record<string, unknown>): string | null {
  const min = draftData.price_min ?? draftData.priceMin;
  const max = draftData.price_max ?? draftData.priceMax;
  const minStr = min != null && String(min).trim() ? String(min).trim() : '';
  const maxStr = max != null && String(max).trim() ? String(max).trim() : '';
  if (minStr && maxStr) return `₹${minStr} – ₹${maxStr}`;
  if (minStr) return `From ₹${minStr}`;
  if (maxStr) return `Up to ₹${maxStr}`;
  return null;
}

/** Map vision/PDF extraction fields into type_knowledge so publish gate passes. */
function syncExtractedFieldsToTypeKnowledge(draftData: Record<string, unknown>): Record<string, string> {
  const typeKnowledge = readTypeKnowledge(draftData);
  const propertyType = String(draftData.property_type || draftData.propertyType || '').toLowerCase();

  const bedrooms = draftData.bedrooms ?? draftData.bhk;
  if (bedrooms != null && String(bedrooms).trim() && !typeKnowledge.bhk) {
    typeKnowledge.bhk = String(bedrooms).trim();
  }

  const priceLabel = formatPriceLabel(draftData);
  if (priceLabel && !typeKnowledge.price) {
    typeKnowledge.price = priceLabel;
  }

  const amenities = draftData.amenities;
  if (Array.isArray(amenities) && amenities.length > 0 && !typeKnowledge.amenities) {
    typeKnowledge.amenities = amenities.map(String).filter(Boolean).slice(0, 12).join(', ');
  }

  const areaKeys = ['carpet_area_sqft', 'built_up_area_sqft', 'plot_area_sqft', 'commercial_area_sqft'] as const;
  for (const key of areaKeys) {
    const direct = draftData[key] ?? draftData[key.replace(/_sqft$/, '')];
    if (direct != null && String(direct).trim() && !typeKnowledge[key]) {
      typeKnowledge[key] = String(direct).trim();
    }
  }

  if (propertyType === 'apartment' && draftData.possession_date && !typeKnowledge.possession_date) {
    typeKnowledge.possession_date = String(draftData.possession_date);
  }

  typeKnowledge.anything_else_skipped = 'true';
  return typeKnowledge;
}

function hasMinimumExtractedIdentity(draftData: Record<string, unknown>): boolean {
  const name = String(draftData.name || '').trim();
  const hasLocation = Boolean(
    String(draftData.location_city || draftData.locationCity || '').trim()
    || String(draftData.location_area || draftData.locationArea || '').trim(),
  );
  const hasPrice = Boolean(formatPriceLabel(draftData));
  const bedrooms = draftData.bedrooms ?? draftData.bhk;
  const hasBedrooms = bedrooms != null && String(bedrooms).trim().length > 0;
  return Boolean(name) || (hasLocation && (hasPrice || hasBedrooms));
}

export function applyImageImportAutoFlow(
  draftData: Record<string, unknown>,
  media: Array<{ assetType?: string | null; mimeType?: string | null }>,
): Record<string, unknown> {
  if (!isImageOnlyPropertyImportMedia(media)) {
    return draftData;
  }

  if (!hasMinimumExtractedIdentity(draftData)) {
    return draftData;
  }

  const merged = { ...draftData };
  merged.import_flow_mode = IMAGE_AUTO_FLOW_MODE;
  merged.type_knowledge = syncExtractedFieldsToTypeKnowledge(merged);

  const existingReview = (merged.import_review && typeof merged.import_review === 'object')
    ? { ...(merged.import_review as Record<string, unknown>) }
    : {};

  merged.import_review = {
    ...existingReview,
    status: 'approved',
    reviewed_at: new Date().toISOString(),
    approved_at: new Date().toISOString(),
    review_notes: 'Auto-approved from property image extraction',
  };

  return merged;
}

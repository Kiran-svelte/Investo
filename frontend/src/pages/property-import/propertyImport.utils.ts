import type {
  PropertyImportDraft,
  PropertyImportDraftStatus,
  PropertyImportMediaStatus,
} from '../../services/propertyImport';

export interface PropertyImportFormValues {
  name: string;
  builder: string;
  location_city: string;
  location_area: string;
  location_pincode: string;
  price_min: string;
  price_max: string;
  bedrooms: string;
  property_type: string;
  description: string;
  rera_number: string;
  status: 'available' | 'sold' | 'upcoming';
  amenities: string;
  review_notes: string;
  mapping_source_type: string;
  mapping_profile_name: string;
  mapping_confidence_threshold: string;
  mapping_low_confidence_threshold: string;
  mapping_require_human_review: boolean;
  mapping_field_mappings: PropertyImportFieldMappingFormValue[];
}

export interface PropertyImportFieldMappingFormValue {
  source_field: string;
  target_field: string;
  confidence: string;
  required: boolean;
  label: string;
  notes: string;
}

export interface PropertyImportReviewHint {
  field: string;
  confidence: number;
  source_field: string | null;
  note: string | null;
}

export interface PropertyImportMappingMetadata {
  source_type: string;
  profile_name: string | null;
  field_mappings: PropertyImportFieldMappingFormValue[];
  review_settings: {
    confidence_threshold: string;
    low_confidence_threshold: string;
    require_human_review: boolean;
  };
}

export interface PropertyImportReviewMetadata {
  status: 'not_required' | 'needs_review' | 'approved';
  confidence_hints: PropertyImportReviewHint[];
  review_notes: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
}

export type PropertyImportStageKey =
  | 'upload'
  | 'queue'
  | 'extract'
  | 'review'
  | 'publish'
  | 'published'
  | 'failed'
  | 'cancelled';

export interface PropertyImportStageSummary {
  key: PropertyImportStageKey;
  label: string;
  description: string;
  tone: 'neutral' | 'active' | 'complete' | 'warning' | 'danger';
}

export const PROPERTY_IMPORT_PROPERTY_TYPES = ['apartment', 'villa', 'plot', 'commercial'] as const;
export const PROPERTY_IMPORT_PROPERTY_STATUSES = ['available', 'sold', 'upcoming'] as const;

export const PROPERTY_IMPORT_DEFAULT_FORM_VALUES: PropertyImportFormValues = {
  name: '',
  builder: '',
  location_city: '',
  location_area: '',
  location_pincode: '',
  price_min: '',
  price_max: '',
  bedrooms: '',
  property_type: '',
  description: '',
  rera_number: '',
  status: 'available',
  amenities: '',
  review_notes: '',
  mapping_source_type: 'manual',
  mapping_profile_name: '',
  mapping_confidence_threshold: '0.75',
  mapping_low_confidence_threshold: '0.55',
  mapping_require_human_review: true,
  mapping_field_mappings: [],
};

export const PROPERTY_IMPORT_STAGE_ORDER: PropertyImportStageKey[] = [
  'upload',
  'queue',
  'extract',
  'review',
  'publish',
  'published',
];

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumberString(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  return '';
}

function asAmenitiesString(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .join(', ');
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .join(', ');
      }
    } catch {
      return value;
    }
  }

  return '';
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }

    if (normalized === 'false') {
      return false;
    }
  }

  return fallback;
}

function asConfidenceString(value: unknown, fallback = '0.75'): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = value > 1 ? value / 100 : value;
    return String(Math.min(1, Math.max(0, normalized)));
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      const normalized = parsed > 1 ? parsed / 100 : parsed;
      return String(Math.min(1, Math.max(0, normalized)));
    }
  }

  return fallback;
}

function asFieldMappings(value: unknown): PropertyImportFieldMappingFormValue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): PropertyImportFieldMappingFormValue | null => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null;
      }

      const record = item as Record<string, unknown>;
      const sourceField = asTrimmedString(record.source_field ?? record.sourceField);
      const targetField = asTrimmedString(record.target_field ?? record.targetField);

      if (!sourceField && !targetField) {
        return null;
      }

      return {
        source_field: sourceField,
        target_field: targetField,
        confidence: asConfidenceString(record.confidence, ''),
        required: asBoolean(record.required, false),
        label: asTrimmedString(record.label),
        notes: asTrimmedString(record.notes),
      };
    })
    .filter((item): item is PropertyImportFieldMappingFormValue => Boolean(item));
}

export function getPropertyImportMappingMetadata(draftData?: Record<string, unknown> | null): PropertyImportMappingMetadata {
  const mapping = draftData && typeof draftData === 'object'
    ? (draftData.import_mapping ?? draftData.importMapping) as Record<string, unknown> | undefined
    : undefined;

  return {
    source_type: asTrimmedString(mapping?.source_type ?? mapping?.sourceType) || 'manual',
    profile_name: asTrimmedString(mapping?.profile_name ?? mapping?.profileName),
    field_mappings: asFieldMappings(mapping?.field_mappings ?? mapping?.fieldMappings),
    review_settings: {
      confidence_threshold: asConfidenceString(mapping?.review_settings && typeof mapping.review_settings === 'object' && !Array.isArray(mapping.review_settings)
        ? (mapping.review_settings as Record<string, unknown>).confidence_threshold ?? (mapping.review_settings as Record<string, unknown>).confidenceThreshold
        : undefined),
      low_confidence_threshold: asConfidenceString(mapping?.review_settings && typeof mapping.review_settings === 'object' && !Array.isArray(mapping.review_settings)
        ? (mapping.review_settings as Record<string, unknown>).low_confidence_threshold ?? (mapping.review_settings as Record<string, unknown>).lowConfidenceThreshold
        : undefined,
      '0.55'),
      require_human_review: asBoolean(mapping?.review_settings && typeof mapping.review_settings === 'object' && !Array.isArray(mapping.review_settings)
        ? (mapping.review_settings as Record<string, unknown>).require_human_review ?? (mapping.review_settings as Record<string, unknown>).requireHumanReview
        : undefined,
      true),
    },
  };
}

export function getPropertyImportReviewMetadata(draftData?: Record<string, unknown> | null): PropertyImportReviewMetadata {
  const review = draftData && typeof draftData === 'object'
    ? (draftData.import_review ?? draftData.importReview) as Record<string, unknown> | undefined
    : undefined;

  const hints = Array.isArray(review?.confidence_hints ?? review?.confidenceHints)
    ? (review?.confidence_hints ?? review?.confidenceHints) as Array<Record<string, unknown>>
    : [];

  return {
    status: ((review?.status as PropertyImportReviewMetadata['status']) || 'not_required'),
    confidence_hints: hints
      .map((hint) => ({
        field: asTrimmedString(hint.field) || asTrimmedString(hint.field_name) || '',
        confidence: typeof hint.confidence === 'number' ? hint.confidence : Number(hint.confidence) || 0,
        source_field: asTrimmedString(hint.source_field ?? hint.sourceField),
        note: asTrimmedString(hint.note ?? hint.reason),
      }))
      .filter((hint) => Boolean(hint.field)),
    review_notes: asTrimmedString(review?.review_notes ?? review?.reviewNotes),
    reviewed_by_user_id: asTrimmedString(review?.reviewed_by_user_id ?? review?.reviewedByUserId),
    reviewed_at: asTrimmedString(review?.reviewed_at ?? review?.reviewedAt),
    approved_at: asTrimmedString(review?.approved_at ?? review?.approvedAt),
  };
}

export function createPropertyImportFormValues(draftData?: Record<string, unknown> | null): PropertyImportFormValues {
  if (!draftData) {
    return { ...PROPERTY_IMPORT_DEFAULT_FORM_VALUES };
  }

  const mapping = getPropertyImportMappingMetadata(draftData);
  const review = getPropertyImportReviewMetadata(draftData);

  const status = asTrimmedString(draftData.status);

  return {
    name: asTrimmedString(draftData.name),
    builder: asTrimmedString(draftData.builder),
    location_city: asTrimmedString(draftData.location_city ?? draftData.locationCity),
    location_area: asTrimmedString(draftData.location_area ?? draftData.locationArea),
    location_pincode: asTrimmedString(draftData.location_pincode ?? draftData.locationPincode),
    price_min: asNumberString(draftData.price_min ?? draftData.priceMin),
    price_max: asNumberString(draftData.price_max ?? draftData.priceMax),
    bedrooms: asNumberString(draftData.bedrooms),
    property_type: asTrimmedString(draftData.property_type ?? draftData.propertyType),
    description: asTrimmedString(draftData.description),
    rera_number: asTrimmedString(draftData.rera_number ?? draftData.reraNumber),
    status: PROPERTY_IMPORT_PROPERTY_STATUSES.includes(status as (typeof PROPERTY_IMPORT_PROPERTY_STATUSES)[number])
      ? (status as PropertyImportFormValues['status'])
      : 'available',
    amenities: asAmenitiesString(draftData.amenities),
    review_notes: review.review_notes || asTrimmedString(draftData.review_notes ?? draftData.reviewNotes),
    mapping_source_type: mapping.source_type,
    mapping_profile_name: mapping.profile_name || '',
    mapping_confidence_threshold: mapping.review_settings.confidence_threshold,
    mapping_low_confidence_threshold: mapping.review_settings.low_confidence_threshold,
    mapping_require_human_review: mapping.review_settings.require_human_review,
    mapping_field_mappings: mapping.field_mappings.length > 0 ? mapping.field_mappings : [{
      source_field: '',
      target_field: '',
      confidence: '',
      required: false,
      label: '',
      notes: '',
    }],
  };
}

export function serializePropertyImportFormValues(
  values: PropertyImportFormValues,
  existingDraftData?: Record<string, unknown> | null,
): Record<string, unknown> {
  const amenities = values.amenities
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const nextFieldMappings = values.mapping_field_mappings
    .map((item) => ({
      source_field: item.source_field.trim(),
      target_field: item.target_field.trim(),
      confidence: (() => {
        const parsed = Number(item.confidence);
        return item.confidence.trim() && Number.isFinite(parsed) ? parsed : null;
      })(),
      required: item.required,
      label: item.label.trim() || null,
      notes: item.notes.trim() || null,
    }))
    .filter((item) => item.source_field || item.target_field);

  const existingMapping = getPropertyImportMappingMetadata(existingDraftData);
  const existingReview = getPropertyImportReviewMetadata(existingDraftData);

  return {
    ...(existingDraftData && typeof existingDraftData === 'object' ? existingDraftData : {}),
    name: values.name.trim(),
    builder: values.builder.trim() || null,
    location_city: values.location_city.trim() || null,
    location_area: values.location_area.trim() || null,
    location_pincode: values.location_pincode.trim() || null,
    price_min: values.price_min.trim() ? Number(values.price_min) : null,
    price_max: values.price_max.trim() ? Number(values.price_max) : null,
    bedrooms: values.bedrooms.trim() ? Number(values.bedrooms) : null,
    property_type: values.property_type.trim() || null,
    description: values.description.trim() || null,
    rera_number: values.rera_number.trim() || null,
    status: values.status,
    amenities,
    import_mapping: {
      source_type: values.mapping_source_type.trim() || existingMapping.source_type || 'manual',
      profile_name: values.mapping_profile_name.trim() || null,
      field_mappings: nextFieldMappings,
      review_settings: {
        confidence_threshold: values.mapping_confidence_threshold.trim() || existingMapping.review_settings.confidence_threshold,
        low_confidence_threshold: values.mapping_low_confidence_threshold.trim() || existingMapping.review_settings.low_confidence_threshold,
        require_human_review: values.mapping_require_human_review,
      },
      source_record: (existingDraftData && typeof existingDraftData === 'object'
        ? ((existingDraftData.import_mapping ?? existingDraftData.importMapping) as Record<string, unknown> | undefined)?.source_record
        : undefined) ?? null,
    },
    import_review: {
      ...existingReview,
      review_notes: values.review_notes.trim() || null,
    },
  };
}

export function isPropertyImportTerminalStatus(status: PropertyImportDraftStatus): boolean {
  return status === 'published' || status === 'cancelled';
}

export function getPropertyImportStage(
  draft: Pick<PropertyImportDraft, 'status' | 'extractionStatus'> | null | undefined,
): PropertyImportStageSummary {
  if (!draft) {
    return {
      key: 'upload',
      label: 'Upload media',
      description: 'Create a draft and upload property photos, brochures, or walkthrough videos.',
      tone: 'active',
    };
  }

  switch (draft.status) {
    case 'draft':
      return {
        key: 'upload',
        label: 'Upload requested',
        description: 'The draft is waiting for browser uploads to complete.',
        tone: 'active',
      };
    case 'extracting':
      return {
        key: draft.extractionStatus === 'queued' ? 'queue' : 'extract',
        label: draft.extractionStatus === 'queued' ? 'Queued for extraction' : 'Extracting media',
        description: 'Uploaded assets are being verified and processed by the worker.',
        tone: 'active',
      };
    case 'review_ready':
      return {
        key: 'review',
        label: 'Review needed',
        description: 'Extraction finished. Review and adjust the draft details before publishing.',
        tone: 'warning',
      };
    case 'publish_ready':
      return {
        key: 'publish',
        label: 'Ready to publish',
        description: 'The draft is ready for catalog publishing.',
        tone: 'complete',
      };
    case 'published':
      return {
        key: 'published',
        label: 'Published',
        description: 'The property is live in the catalog.',
        tone: 'complete',
      };
    case 'failed':
      return {
        key: 'failed',
        label: 'Failed',
        description: 'One or more uploads or extraction jobs failed. You can retry the draft.',
        tone: 'danger',
      };
    case 'cancelled':
      return {
        key: 'cancelled',
        label: 'Cancelled',
        description: 'This import was cancelled and can no longer be edited.',
        tone: 'neutral',
      };
    default:
      return {
        key: 'upload',
        label: 'Upload media',
        description: 'Create a draft and upload property assets from the browser.',
        tone: 'active',
      };
  }
}

export function getPropertyImportMediaLabel(status: PropertyImportMediaStatus): PropertyImportStageSummary {
  switch (status) {
    case 'upload_requested':
      return { key: 'upload', label: 'Upload requested', description: 'Waiting for browser upload.', tone: 'active' };
    case 'uploaded':
      return { key: 'queue', label: 'Uploaded', description: 'File uploaded to storage and awaiting confirmation.', tone: 'complete' };
    case 'verified':
      return { key: 'queue', label: 'Verified', description: 'Upload verified by backend.', tone: 'complete' };
    case 'queued_for_extraction':
      return { key: 'queue', label: 'Queued', description: 'Queued for extraction.', tone: 'active' };
    case 'extracted':
      return { key: 'review', label: 'Extracted', description: 'Metadata extracted successfully.', tone: 'complete' };
    case 'failed':
      return { key: 'failed', label: 'Failed', description: 'This asset failed processing.', tone: 'danger' };
    case 'cancelled':
      return { key: 'cancelled', label: 'Cancelled', description: 'This asset was cancelled.', tone: 'neutral' };
    default:
      return { key: 'upload', label: 'Upload requested', description: 'Waiting for browser upload.', tone: 'active' };
  }
}

export function getPropertyImportDraftStatusTone(status: PropertyImportDraftStatus): PropertyImportStageSummary['tone'] {
  return getPropertyImportStage({ status, extractionStatus: 'pending_upload' }).tone;
}

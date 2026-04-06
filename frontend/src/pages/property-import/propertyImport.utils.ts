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

export function createPropertyImportFormValues(draftData?: Record<string, unknown> | null): PropertyImportFormValues {
  if (!draftData) {
    return { ...PROPERTY_IMPORT_DEFAULT_FORM_VALUES };
  }

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
    review_notes: asTrimmedString(draftData.review_notes ?? draftData.reviewNotes),
  };
}

export function serializePropertyImportFormValues(values: PropertyImportFormValues): Record<string, unknown> {
  const amenities = values.amenities
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return {
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

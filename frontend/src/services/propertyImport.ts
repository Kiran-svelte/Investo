import axios from 'axios';
import api, { ApiResponse } from './api';

export type PropertyImportDraftStatus =
  | 'draft'
  | 'extracting'
  | 'review_ready'
  | 'publish_ready'
  | 'published'
  | 'failed'
  | 'cancelled';

export type PropertyImportExtractionStatus =
  | 'pending_upload'
  | 'upload_completed'
  | 'queued'
  | 'processing'
  | 'extracted'
  | 'failed'
  | 'cancelled';

export type PropertyImportMediaStatus =
  | 'upload_requested'
  | 'uploaded'
  | 'verified'
  | 'queued_for_extraction'
  | 'extracted'
  | 'failed'
  | 'cancelled';

export type PropertyImportAssetType = 'image' | 'brochure' | 'video';

export interface PropertyImportMedia {
  id: string;
  draftId: string;
  companyId: string;
  assetType: PropertyImportAssetType;
  status: PropertyImportMediaStatus;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
  publicUrl: string;
  uploadToken: string;
  eTag: string | null;
  failureReason: string | null;
  extractedMetadata: Record<string, unknown>;
  uploadedAt: string | null;
  verifiedAt: string | null;
  extractedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyImportJob {
  id: string;
  draftId: string;
  companyId: string;
  mediaId: string | null;
  jobType: string;
  status: string;
  queueName: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  failureReason: string | null;
  attempt: number;
  maxAttempts: number;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyImportProperty {
  id: string;
  name: string;
  builder: string | null;
  location_city: string | null;
  location_area: string | null;
  location_pincode: string | null;
  price_min: number | null;
  price_max: number | null;
  bedrooms: number | null;
  property_type: string | null;
  status: string;
  images: string[] | string;
  amenities: string[] | string;
  description: string | null;
  rera_number: string | null;
}

/** Ensure list relations exist so UI never reads `.length` on undefined. */
export function normalizePropertyImportDraft(draft: PropertyImportDraft): PropertyImportDraft {
  return {
    ...draft,
    mediaAssets: Array.isArray(draft.mediaAssets) ? draft.mediaAssets : [],
    extractionJobs: Array.isArray(draft.extractionJobs) ? draft.extractionJobs : [],
    units: Array.isArray(draft.units) ? draft.units : [],
  };
}

export interface PropertyImportDraft {
  id: string;
  companyId: string;
  createdByUserId: string;
  reviewedByUserId: string | null;
  publishedPropertyId: string | null;
  status: PropertyImportDraftStatus;
  extractionStatus: PropertyImportExtractionStatus;
  retryCount: number;
  maxRetries: number;
  failureReason: string | null;
  draftData: Record<string, unknown>;
  reviewNotes: string | null;
  extractionRequestedAt: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  mediaAssets: PropertyImportMedia[];
  extractionJobs: PropertyImportJob[];
  units?: PropertyImportUnitRecord[];
  publishedProperty: PropertyImportProperty | null;
}

export interface CreatePropertyImportDraftInput {
  draft_data?: Record<string, unknown>;
  max_retries?: number;
}

export interface RegisterPropertyImportUploadInput {
  file_name: string;
  mime_type: string;
  file_size: number;
  asset_type: PropertyImportAssetType;
}

export interface RegisterPropertyImportUploadResult {
  media: PropertyImportMedia;
  upload: {
    key: string;
    upload_url: string;
    fallback_upload_url?: string | null;
    public_url: string;
    expires_in_seconds: number;
    content_type: string;
    upload_token: string;
  };
}

export interface SavePropertyImportDraftInput {
  draft_data: Record<string, unknown>;
  review_notes?: string | null;
  mark_publish_ready?: boolean;
}

export interface PublishPropertyImportDraftInput {
  force_republish?: boolean;
}

export interface RetryPropertyImportDraftInput {
  reason?: string | null;
}

export interface CancelPropertyImportDraftInput {
  reason?: string | null;
}

export interface PropertyImportUploadProgress {
  percent: number;
}

export const PROPERTY_IMPORT_SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export const PROPERTY_IMPORT_SPREADSHEET_MIME_TYPES = [
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export interface PropertyImportUnitRecord {
  id: string;
  draftId: string;
  companyId: string;
  sortOrder: number;
  label: string | null;
  unitData: Record<string, unknown>;
  publishedPropertyId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export const PROPERTY_IMPORT_ASSET_TYPE_LABELS: Record<PropertyImportAssetType, string> = {
  image: 'Image',
  brochure: 'Brochure',
  video: 'Video',
};

export function inferPropertyImportAssetType(file: File): PropertyImportAssetType {
  const mimeType = file.type.toLowerCase();

  if (mimeType === 'application/pdf') {
    return 'brochure';
  }

  if (
    mimeType === 'text/csv'
    || mimeType.includes('spreadsheet')
    || mimeType.includes('excel')
  ) {
    return 'brochure';
  }

  if (mimeType.startsWith('video/')) {
    return 'video';
  }

  return 'image';
}

export function isPropertyImportMimeTypeSupported(mimeType: string): boolean {
  return PROPERTY_IMPORT_SUPPORTED_MIME_TYPES.includes(
    mimeType as typeof PROPERTY_IMPORT_SUPPORTED_MIME_TYPES[number],
  );
}

export interface PropertyImportDraftSummary {
  id: string;
  status: PropertyImportDraftStatus;
  extractionStatus: string;
  name: string;
  property_type: string | null;
  knowledge_deferred: boolean;
  knowledge_gap_count: number;
  media_count: number;
  updated_at: string;
  created_at: string;
}

export async function listPropertyImportDrafts(): Promise<PropertyImportDraftSummary[]> {
  const { data } = await api.get<ApiResponse<PropertyImportDraftSummary[]>>('/property-imports/drafts');
  return Array.isArray(data.data) ? data.data : [];
}

export async function createPropertyImportDraft(input: CreatePropertyImportDraftInput) {
  const { data } = await api.post<ApiResponse<PropertyImportDraft>>('/property-imports/drafts', input);
  return normalizePropertyImportDraft(data.data);
}

export async function getPropertyImportDraft(draftId: string) {
  const { data } = await api.get<ApiResponse<PropertyImportDraft>>(`/property-imports/drafts/${draftId}`);
  return normalizePropertyImportDraft(data.data);
}

export interface PropertyImportKnowledgeGate {
  blocked: boolean;
  draftId: string | null;
  gapCount: number;
  propertyType: string | null;
  reason: string | null;
}

export async function getPropertyImportKnowledgeGate(): Promise<PropertyImportKnowledgeGate> {
  const { data } = await api.get<ApiResponse<PropertyImportKnowledgeGate>>('/property-imports/knowledge-gate');
  return data.data;
}

export async function deferPropertyImportKnowledge(draftId: string): Promise<PropertyImportDraft> {
  const { data } = await api.post<ApiResponse<PropertyImportDraft>>(
    `/property-imports/drafts/${draftId}/defer-knowledge`,
  );
  return normalizePropertyImportDraft(data.data);
}

export async function registerPropertyImportUpload(draftId: string, input: RegisterPropertyImportUploadInput) {
  const { data } = await api.post<ApiResponse<RegisterPropertyImportUploadResult>>(
    `/property-imports/drafts/${draftId}/uploads`,
    input,
  );
  return data.data;
}

async function putUploadFile(
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress?: (progress: PropertyImportUploadProgress) => void,
): Promise<void> {
  await axios.put(uploadUrl, file, {
    headers: {
      'Content-Type': contentType,
    },
    onUploadProgress: (event) => {
      if (!onProgress || !event.total) {
        return;
      }

      onProgress({
        percent: Math.round((event.loaded / event.total) * 100),
      });
    },
  });
}

export async function uploadPropertyImportFile(
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress?: (progress: PropertyImportUploadProgress) => void,
  fallbackUploadUrl?: string | null,
): Promise<void> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await putUploadFile(uploadUrl, file, contentType, onProgress);
      return;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const payload = error.response?.data as { error?: string; message?: string } | undefined;
        const serverMessage = payload?.error || payload?.message || '';

        if (error.response?.status === 409 && /already been completed/i.test(serverMessage)) {
          return;
        }

        const isNetworkOnlyError = !error.response && (error.code === 'ERR_NETWORK' || error.message === 'Network Error');
        if (isNetworkOnlyError && fallbackUploadUrl && fallbackUploadUrl !== uploadUrl) {
          try {
            await putUploadFile(fallbackUploadUrl, file, contentType, onProgress);
            return;
          } catch (fallbackError) {
            throw fallbackError;
          }
        }

        if (isNetworkOnlyError && attempt < maxAttempts) {
          await new Promise((resolve) => window.setTimeout(resolve, 750 * attempt));
          continue;
        }
      }

      throw error;
    }
  }
}

export async function confirmPropertyImportUpload(draftId: string, uploadToken: string) {
  const { data } = await api.post<ApiResponse<{ media: PropertyImportMedia; draft: PropertyImportDraft; job: PropertyImportJob; queued: boolean }>>(
    `/property-imports/drafts/${draftId}/uploads/confirm`,
    { upload_token: uploadToken },
  );
  const payload = data.data;
  return {
    ...payload,
    ...(payload.draft ? { draft: normalizePropertyImportDraft(payload.draft) } : {}),
  };
}

export async function savePropertyImportDraft(draftId: string, input: SavePropertyImportDraftInput) {
  const { data } = await api.put<ApiResponse<PropertyImportDraft>>(`/property-imports/drafts/${draftId}`, input);
  return normalizePropertyImportDraft(data.data);
}

export interface PublishPropertyImportDraftResult {
  property: PropertyImportProperty;
  properties?: Array<{ id: string; name: string }>;
  draft: PropertyImportDraft;
  alreadyPublished: boolean;
  knowledge_indexed?: boolean;
  knowledge_chunk_count?: number;
  properties_published?: number;
}

export async function publishPropertyImportDraft(draftId: string, input: PublishPropertyImportDraftInput = {}) {
  const { data } = await api.post<ApiResponse<PublishPropertyImportDraftResult>>(
    `/property-imports/drafts/${draftId}/publish`,
    input,
  );
  const result = data.data;
  return {
    ...result,
    draft: normalizePropertyImportDraft(result.draft),
  };
}

export async function retryPropertyImportDraft(draftId: string, input: RetryPropertyImportDraftInput = {}) {
  const { data } = await api.post<ApiResponse<{ retry_count: number; queued_jobs: number }>>(
    `/property-imports/drafts/${draftId}/retry`,
    input,
  );
  return data.data;
}

export async function cancelPropertyImportDraft(draftId: string, input: CancelPropertyImportDraftInput = {}) {
  const { data } = await api.post<ApiResponse<PropertyImportDraft>>(
    `/property-imports/drafts/${draftId}/cancel`,
    input,
  );
  return data.data;
}

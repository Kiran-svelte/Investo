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
] as const;

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

export async function createPropertyImportDraft(input: CreatePropertyImportDraftInput) {
  const { data } = await api.post<ApiResponse<PropertyImportDraft>>('/property-imports/drafts', input);
  return data.data;
}

export async function getPropertyImportDraft(draftId: string) {
  const { data } = await api.get<ApiResponse<PropertyImportDraft>>(`/property-imports/drafts/${draftId}`);
  return data.data;
}

export async function registerPropertyImportUpload(draftId: string, input: RegisterPropertyImportUploadInput) {
  const { data } = await api.post<ApiResponse<RegisterPropertyImportUploadResult>>(
    `/property-imports/drafts/${draftId}/uploads`,
    input,
  );
  return data.data;
}

export async function uploadPropertyImportFile(
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

export async function confirmPropertyImportUpload(draftId: string, uploadToken: string) {
  const { data } = await api.post<ApiResponse<{ media: PropertyImportMedia; draft: PropertyImportDraft; job: PropertyImportJob; queued: boolean }>>(
    `/property-imports/drafts/${draftId}/uploads/confirm`,
    { upload_token: uploadToken },
  );
  return data.data;
}

export async function savePropertyImportDraft(draftId: string, input: SavePropertyImportDraftInput) {
  const { data } = await api.put<ApiResponse<PropertyImportDraft>>(`/property-imports/drafts/${draftId}`, input);
  return data.data;
}

export async function publishPropertyImportDraft(draftId: string, input: PublishPropertyImportDraftInput = {}) {
  const { data } = await api.post<ApiResponse<{ property: PropertyImportProperty; draft: PropertyImportDraft; alreadyPublished: boolean }>>(
    `/property-imports/drafts/${draftId}/publish`,
    input,
  );
  return data.data;
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

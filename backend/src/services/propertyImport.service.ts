import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { storageService } from './storage.service';
import { propertyImportQueueService } from './propertyImportQueue.service';
import {
  isPropertyImportReviewPending,
  normalizePropertyImportDraftData,
  normalizePropertyImportMappingProfile,
} from './propertyImport.metadata';

interface CreateDraftInput {
  draftData?: Record<string, unknown>;
  maxRetries?: number;
}

interface RegisterUploadInput {
  fileName: string;
  mimeType: string;
  fileSize: number;
  assetType: 'image' | 'brochure' | 'video';
}

interface SaveDraftInput {
  draftData: Record<string, unknown>;
  reviewNotes?: string | null;
  markPublishReady?: boolean;
}

interface RetryDraftInput {
  reason?: string | null;
}

interface CancelDraftInput {
  reason?: string | null;
}

class PropertyImportError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

function isTerminalStatus(status: string): boolean {
  return status === 'published' || status === 'cancelled';
}

function normalizeDraftData(input: Record<string, unknown>): Prisma.InputJsonValue {
  return normalizePropertyImportDraftData(input) as Prisma.InputJsonValue;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asNullableInt(value: unknown): number | null {
  const numeric = asNullableNumber(value);
  if (numeric === null) {
    return null;
  }
  const rounded = Math.floor(numeric);
  return rounded >= 0 ? rounded : null;
}

function pickAllowed(value: string | null, allowed: string[], fallback: string): string {
  if (!value) {
    return fallback;
  }
  return allowed.includes(value) ? value : fallback;
}

function readDraftValue(
  draftData: Record<string, unknown>,
  mappingProfile: ReturnType<typeof normalizePropertyImportMappingProfile>,
  targetFieldNames: string[],
): unknown {
  if (mappingProfile?.source_record) {
    const mappedField = mappingProfile.field_mappings.find((item) => targetFieldNames.includes(item.target_field));
    if (mappedField) {
      const sourceValue = mappingProfile.source_record[mappedField.source_field];
      if (sourceValue !== undefined && sourceValue !== null && sourceValue !== '') {
        return sourceValue;
      }
    }
  }

  for (const fieldName of targetFieldNames) {
    const value = draftData[fieldName];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return null;
}

function mapDraftToPropertyData(
  draftData: Record<string, unknown>,
  mediaUrls: { images: string[]; brochureUrl: string | null },
): Record<string, unknown> {
  const mappingProfile = normalizePropertyImportMappingProfile(draftData.import_mapping || draftData.importMapping);
  const propertyType = pickAllowed(
    asNullableString(readDraftValue(draftData, mappingProfile, ['property_type', 'propertyType'])),
    ['villa', 'apartment', 'plot', 'commercial', 'other'],
    'apartment',
  );
  const status = pickAllowed(asNullableString(readDraftValue(draftData, mappingProfile, ['status'])), ['available', 'sold', 'upcoming'], 'available');

  return {
    name: asNullableString(readDraftValue(draftData, mappingProfile, ['name'])) || 'Untitled property',
    builder: asNullableString(readDraftValue(draftData, mappingProfile, ['builder'])),
    locationCity: asNullableString(readDraftValue(draftData, mappingProfile, ['location_city', 'locationCity'])),
    locationArea: asNullableString(readDraftValue(draftData, mappingProfile, ['location_area', 'locationArea'])),
    locationPincode: asNullableString(readDraftValue(draftData, mappingProfile, ['location_pincode', 'locationPincode'])),
    priceMin: asNullableNumber(readDraftValue(draftData, mappingProfile, ['price_min', 'priceMin'])),
    priceMax: asNullableNumber(readDraftValue(draftData, mappingProfile, ['price_max', 'priceMax'])),
    bedrooms: asNullableInt(readDraftValue(draftData, mappingProfile, ['bedrooms'])),
    propertyType,
    amenities: Array.isArray(readDraftValue(draftData, mappingProfile, ['amenities']))
      ? readDraftValue(draftData, mappingProfile, ['amenities']) as unknown[]
      : [],
    description: asNullableString(readDraftValue(draftData, mappingProfile, ['description'])),
    reraNumber: asNullableString(readDraftValue(draftData, mappingProfile, ['rera_number', 'reraNumber'])),
    status,
    images: mediaUrls.images,
    brochureUrl: mediaUrls.brochureUrl,
  };
}

export class PropertyImportService {
  async createDraft(companyId: string, userId: string, input: CreateDraftInput) {
    return prisma.propertyImportDraft.create({
      data: {
        companyId,
        createdByUserId: userId,
        maxRetries: input.maxRetries ?? 3,
        draftData: normalizeDraftData(input.draftData || {}),
      },
      include: {
        mediaAssets: true,
        extractionJobs: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
  }

  async getDraft(companyId: string, draftId: string) {
    const draft = await prisma.propertyImportDraft.findFirst({
      where: { id: draftId, companyId },
      include: {
        mediaAssets: {
          orderBy: { createdAt: 'asc' },
        },
        extractionJobs: {
          orderBy: { createdAt: 'desc' },
          take: 25,
        },
        publishedProperty: true,
      },
    });

    if (!draft) {
      throw new PropertyImportError('Draft not found', 404);
    }

    return draft;
  }

  async registerUpload(companyId: string, draftId: string, input: RegisterUploadInput, options?: { baseUrl?: string }) {
    const draft = await prisma.propertyImportDraft.findFirst({
      where: { id: draftId, companyId },
      select: { id: true, status: true },
    });

    if (!draft) {
      throw new PropertyImportError('Draft not found', 404);
    }

    if (isTerminalStatus(draft.status)) {
      throw new PropertyImportError(`Draft is ${draft.status} and cannot accept new uploads`, 409);
    }

    const uploadToken = crypto.randomBytes(24).toString('hex');

    let mediaId: string | undefined;
    let upload: {
      key: string;
      uploadUrl: string;
      publicUrl: string;
      expiresInSeconds: number;
      contentType: string;
    };

    try {
      upload = await storageService.createPropertyUploadUrl({
        companyId,
        propertyId: `draft-${draftId}`,
        fileName: input.fileName,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        assetType: input.assetType === 'video' ? 'image' : input.assetType,
      });
    } catch (err: any) {
      const message = err instanceof Error ? err.message : '';
      if (message.startsWith('R2 storage is not configured')) {
        const baseUrl = options?.baseUrl;
        if (!baseUrl) {
          throw err;
        }

        mediaId = crypto.randomUUID();
        const storageKey = `db/property-import-media/${mediaId}`;
        const endpointUrl = new URL(`/api/property-imports/uploads/${uploadToken}`, baseUrl).toString();

        upload = {
          key: storageKey,
          uploadUrl: endpointUrl,
          publicUrl: endpointUrl,
          expiresInSeconds: 15 * 60,
          contentType: input.mimeType,
        };
      } else {
        throw err;
      }
    }

    const media = await prisma.propertyImportMedia.create({
      data: {
        ...(mediaId ? { id: mediaId } : {}),
        companyId,
        draftId,
        assetType: input.assetType,
        status: 'upload_requested',
        fileName: input.fileName,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        storageKey: upload.key,
        publicUrl: upload.publicUrl,
        uploadToken,
      },
    });

    return {
      media,
      upload: {
        key: upload.key,
        upload_url: upload.uploadUrl,
        public_url: upload.publicUrl,
        expires_in_seconds: upload.expiresInSeconds,
        content_type: upload.contentType,
        upload_token: uploadToken,
      },
    };
  }

  async confirmUpload(companyId: string, draftId: string, uploadToken: string) {
    const media = await prisma.propertyImportMedia.findFirst({
      where: {
        draftId,
        companyId,
        uploadToken,
      },
      include: {
        draft: true,
      },
    });

    if (!media) {
      throw new PropertyImportError('Upload token not found', 404);
    }

    if (isTerminalStatus(media.draft.status)) {
      throw new PropertyImportError(`Draft is ${media.draft.status} and upload cannot be confirmed`, 409);
    }

    if (media.status === 'extracted' || media.status === 'queued_for_extraction' || media.status === 'verified') {
      return {
        media,
        queued: media.status === 'queued_for_extraction' || media.status === 'extracted',
      };
    }

    const verification = await storageService.verifyUploadedObject(media.storageKey, {
      mimeType: media.mimeType,
      fileSize: media.fileSize,
    });

    if (!verification.exists) {
      throw new PropertyImportError('Uploaded object was not found in storage', 409);
    }

    const idempotencyKey = `${draftId}:${media.id}:extract:v${media.draft.retryCount + 1}`;

    const result = await prisma.$transaction(async (tx) => {
      const verifiedMedia = await tx.propertyImportMedia.update({
        where: { id: media.id },
        data: {
          status: 'queued_for_extraction',
          uploadedAt: new Date(),
          verifiedAt: new Date(),
          eTag: verification.eTag || null,
          failureReason: null,
        },
      });

      const draftUpdate = await tx.propertyImportDraft.update({
        where: { id: draftId },
        data: {
          status: 'extracting',
          extractionStatus: 'queued',
          extractionRequestedAt: new Date(),
          failureReason: null,
        },
      });

      const job = await tx.propertyImportJob.upsert({
        where: {
          companyId_idempotencyKey: {
            companyId,
            idempotencyKey,
          },
        },
        update: {
          status: 'queued',
          payload: {
            draftId,
            mediaId: media.id,
            companyId,
          },
          failureReason: null,
          queuedAt: new Date(),
          nextRetryAt: null,
        },
        create: {
          draftId,
          companyId,
          mediaId: media.id,
          jobType: 'extract_media',
          status: 'queued',
          queueName: 'property_media_extraction',
          idempotencyKey,
          payload: {
            draftId,
            mediaId: media.id,
            companyId,
          },
          attempt: media.draft.retryCount,
          maxAttempts: media.draft.maxRetries,
        },
      });

      return {
        verifiedMedia,
        draftUpdate,
        job,
      };
    });

    const enqueued = await propertyImportQueueService.enqueueExtraction(idempotencyKey, {
      jobId: result.job.id,
      companyId,
      draftId,
      mediaId: media.id,
      attempt: result.job.attempt,
      maxAttempts: result.job.maxAttempts,
    });

    if (!enqueued) {
      logger.info('Property import extraction queue enqueue deduplicated', {
        draftId,
        mediaId: media.id,
        idempotencyKey,
      });
    }

    return {
      media: result.verifiedMedia,
      draft: result.draftUpdate,
      job: result.job,
      queued: true,
    };
  }

  async saveDraft(companyId: string, draftId: string, userId: string, input: SaveDraftInput) {
    const draft = await prisma.propertyImportDraft.findFirst({
      where: { id: draftId, companyId },
      select: { id: true, status: true, draftData: true },
    });

    if (!draft) {
      throw new PropertyImportError('Draft not found', 404);
    }

    if (isTerminalStatus(draft.status)) {
      throw new PropertyImportError(`Draft is ${draft.status} and cannot be modified`, 409);
    }

    const mergedDraftData = normalizePropertyImportDraftData(
      input.draftData,
      (draft.draftData as Record<string, unknown>) || {},
    );

    if (input.markPublishReady) {
      mergedDraftData.import_review = {
        ...(mergedDraftData.import_review || {
          status: 'approved',
          confidence_hints: [],
          review_notes: null,
          reviewed_by_user_id: null,
          reviewed_at: null,
          approved_at: null,
        }),
        status: 'approved',
        reviewed_by_user_id: userId,
        reviewed_at: new Date().toISOString(),
        approved_at: new Date().toISOString(),
      };
    } else if (draft.status === 'publish_ready') {
      mergedDraftData.import_review = {
        ...(mergedDraftData.import_review || {
          status: 'needs_review',
          confidence_hints: [],
          review_notes: null,
          reviewed_by_user_id: null,
          reviewed_at: null,
          approved_at: null,
        }),
        status: 'needs_review',
        reviewed_by_user_id: userId,
        reviewed_at: new Date().toISOString(),
        approved_at: null,
      };
    }

    return prisma.propertyImportDraft.update({
      where: { id: draftId },
      data: {
        draftData: normalizeDraftData(mergedDraftData),
        reviewNotes: input.reviewNotes ?? null,
        reviewedByUserId: userId,
        reviewedAt: new Date(),
        ...(input.markPublishReady ? { status: 'publish_ready' } : draft.status === 'publish_ready' ? { status: 'review_ready' } : {}),
      },
      include: {
        mediaAssets: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  async publishDraft(companyId: string, draftId: string, userId: string, forceRepublish: boolean) {
    const draft = await prisma.propertyImportDraft.findFirst({
      where: { id: draftId, companyId },
      include: {
        mediaAssets: true,
      },
    });

    if (!draft) {
      throw new PropertyImportError('Draft not found', 404);
    }

    if (draft.status === 'cancelled') {
      throw new PropertyImportError('Cancelled drafts cannot be published', 409);
    }

    if (isPropertyImportReviewPending(draft.draftData as Record<string, unknown>)) {
      throw new PropertyImportError('Draft requires review before publishing', 409);
    }

    const isExtractionComplete = draft.extractionStatus === 'extracted';
    const canPublishNow = draft.status === 'publish_ready' && isExtractionComplete;
    const canRepublish = draft.status === 'published' && isExtractionComplete;

    if (!canPublishNow && !canRepublish) {
      throw new PropertyImportError('Draft is not ready for publishing', 409);
    }

    const successfulMedia = draft.mediaAssets.filter((item) => item.status === 'extracted' || item.status === 'verified');
    const images = successfulMedia.filter((item) => item.assetType === 'image').map((item) => item.publicUrl);
    const brochure = successfulMedia.find((item) => item.assetType === 'brochure');

    const propertyData = mapDraftToPropertyData(draft.draftData as Record<string, unknown>, {
      images,
      brochureUrl: brochure?.publicUrl || null,
    });

    const published = await prisma.$transaction(async (tx) => {
      let propertyId = draft.publishedPropertyId;

      if (propertyId) {
        if (!forceRepublish && draft.status === 'published') {
          const already = await tx.property.findFirst({ where: { id: propertyId, companyId } });
          if (!already) {
            throw new PropertyImportError('Previously published property not found', 404);
          }
          return { property: already, alreadyPublished: true };
        }

        const updated = await tx.property.update({
          where: { id: propertyId },
          data: propertyData,
        });

        const updatedDraft = await tx.propertyImportDraft.update({
          where: { id: draftId },
          data: {
            status: 'published',
            extractionStatus: 'extracted',
            publishedAt: new Date(),
            reviewedAt: new Date(),
            reviewedByUserId: userId,
            failureReason: null,
          },
        });

        return { property: updated, draft: updatedDraft, alreadyPublished: false };
      }

      const created = await tx.property.create({
        data: {
          companyId,
          ...(propertyData as any),
        },
      });

      const updatedDraft = await tx.propertyImportDraft.update({
        where: { id: draftId },
        data: {
          status: 'published',
          extractionStatus: 'extracted',
          publishedPropertyId: created.id,
          publishedAt: new Date(),
          reviewedAt: new Date(),
          reviewedByUserId: userId,
          failureReason: null,
        },
      });

      return { property: created, draft: updatedDraft, alreadyPublished: false };
    });

    return published;
  }

  async retryExtraction(companyId: string, draftId: string, input: RetryDraftInput) {
    const draft = await prisma.propertyImportDraft.findFirst({
      where: { id: draftId, companyId },
      include: {
        mediaAssets: true,
      },
    });

    if (!draft) {
      throw new PropertyImportError('Draft not found', 404);
    }

    if (isTerminalStatus(draft.status)) {
      throw new PropertyImportError(`Draft is ${draft.status} and cannot be retried`, 409);
    }

    if (draft.retryCount >= draft.maxRetries) {
      throw new PropertyImportError('Retry limit reached for this draft', 409);
    }

    const failedMedia = draft.mediaAssets.filter((item) => item.status === 'failed' || item.status === 'verified');
    if (failedMedia.length === 0) {
      throw new PropertyImportError('No retryable media found on this draft', 409);
    }

    const nextRetryCount = draft.retryCount + 1;

    const queuedJobs = await prisma.$transaction(async (tx) => {
      await tx.propertyImportDraft.update({
        where: { id: draftId },
        data: {
          status: 'extracting',
          extractionStatus: 'queued',
          retryCount: nextRetryCount,
          extractionRequestedAt: new Date(),
          failureReason: input.reason || null,
        },
      });

      const jobs = [] as Array<{ id: string; idempotencyKey: string; mediaId: string; attempt: number; maxAttempts: number }>;

      for (const media of failedMedia) {
        await tx.propertyImportMedia.update({
          where: { id: media.id },
          data: {
            status: 'queued_for_extraction',
            failureReason: null,
          },
        });

        const idempotencyKey = `${draftId}:${media.id}:extract:v${nextRetryCount}`;
        const job = await tx.propertyImportJob.upsert({
          where: {
            companyId_idempotencyKey: {
              companyId,
              idempotencyKey,
            },
          },
          update: {
            status: 'queued',
            failureReason: null,
            nextRetryAt: null,
            queuedAt: new Date(),
            payload: {
              draftId,
              mediaId: media.id,
              companyId,
            },
            attempt: nextRetryCount,
          },
          create: {
            draftId,
            companyId,
            mediaId: media.id,
            jobType: 'extract_media',
            status: 'queued',
            queueName: 'property_media_extraction',
            idempotencyKey,
            payload: {
              draftId,
              mediaId: media.id,
              companyId,
            },
            attempt: nextRetryCount,
            maxAttempts: draft.maxRetries,
          },
          select: {
            id: true,
            idempotencyKey: true,
            mediaId: true,
            attempt: true,
            maxAttempts: true,
          },
        });

        if (!job.mediaId) {
          continue;
        }

        jobs.push({
          id: job.id,
          idempotencyKey: job.idempotencyKey,
          mediaId: job.mediaId,
          attempt: job.attempt,
          maxAttempts: job.maxAttempts,
        });
      }

      return jobs;
    });

    for (const job of queuedJobs) {
      await propertyImportQueueService.enqueueExtraction(job.idempotencyKey, {
        jobId: job.id,
        companyId,
        draftId,
        mediaId: job.mediaId,
        attempt: job.attempt,
        maxAttempts: job.maxAttempts,
      });
    }

    return {
      retry_count: nextRetryCount,
      queued_jobs: queuedJobs.length,
    };
  }

  async cancelDraft(companyId: string, draftId: string, input: CancelDraftInput) {
    const draft = await prisma.propertyImportDraft.findFirst({
      where: { id: draftId, companyId },
      select: { id: true, status: true },
    });

    if (!draft) {
      throw new PropertyImportError('Draft not found', 404);
    }

    if (draft.status === 'published') {
      throw new PropertyImportError('Published drafts cannot be cancelled', 409);
    }

    if (draft.status === 'cancelled') {
      return prisma.propertyImportDraft.findFirst({
        where: { id: draftId, companyId },
        include: { mediaAssets: true },
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.propertyImportDraft.update({
        where: { id: draftId },
        data: {
          status: 'cancelled',
          extractionStatus: 'cancelled',
          cancelledAt: new Date(),
          failureReason: input.reason || null,
        },
      });

      await tx.propertyImportMedia.updateMany({
        where: {
          draftId,
          status: {
            in: ['upload_requested', 'uploaded', 'verified', 'queued_for_extraction', 'failed'],
          },
        },
        data: {
          status: 'cancelled',
          failureReason: input.reason || null,
        },
      });

      await tx.propertyImportJob.updateMany({
        where: {
          draftId,
          status: {
            in: ['queued', 'processing', 'failed'],
          },
        },
        data: {
          status: 'cancelled',
          finishedAt: new Date(),
          failureReason: input.reason || null,
        },
      });
    });

    return this.getDraft(companyId, draftId);
  }
}

export const propertyImportService = new PropertyImportService();
export { PropertyImportError };

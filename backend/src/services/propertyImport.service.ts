import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { storageService } from './storage.service';
import { propertyImportQueueService } from './propertyImportQueue.service';

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
  return { ...input } as Prisma.InputJsonValue;
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

function mapDraftToPropertyData(
  draftData: Record<string, unknown>,
  mediaUrls: { images: string[]; brochureUrl: string | null },
): Record<string, unknown> {
  const propertyType = pickAllowed(
    asNullableString(draftData.property_type) || asNullableString(draftData.propertyType),
    ['villa', 'apartment', 'plot', 'commercial', 'other'],
    'apartment',
  );
  const status = pickAllowed(asNullableString(draftData.status), ['available', 'sold', 'upcoming'], 'available');

  return {
    name: asNullableString(draftData.name) || 'Untitled property',
    builder: asNullableString(draftData.builder),
    locationCity: asNullableString(draftData.location_city) || asNullableString(draftData.locationCity),
    locationArea: asNullableString(draftData.location_area) || asNullableString(draftData.locationArea),
    locationPincode: asNullableString(draftData.location_pincode) || asNullableString(draftData.locationPincode),
    priceMin: asNullableNumber(draftData.price_min) || asNullableNumber(draftData.priceMin),
    priceMax: asNullableNumber(draftData.price_max) || asNullableNumber(draftData.priceMax),
    bedrooms: asNullableInt(draftData.bedrooms),
    propertyType,
    amenities: Array.isArray(draftData.amenities) ? draftData.amenities : [],
    description: asNullableString(draftData.description),
    reraNumber: asNullableString(draftData.rera_number) || asNullableString(draftData.reraNumber),
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

  async registerUpload(companyId: string, draftId: string, input: RegisterUploadInput) {
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

    const upload = await storageService.createPropertyUploadUrl({
      companyId,
      propertyId: `draft-${draftId}`,
      fileName: input.fileName,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      assetType: input.assetType === 'video' ? 'image' : input.assetType,
    });

    const uploadToken = crypto.randomBytes(24).toString('hex');

    const media = await prisma.propertyImportMedia.create({
      data: {
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
      select: { id: true, status: true },
    });

    if (!draft) {
      throw new PropertyImportError('Draft not found', 404);
    }

    if (isTerminalStatus(draft.status)) {
      throw new PropertyImportError(`Draft is ${draft.status} and cannot be modified`, 409);
    }

    const status = input.markPublishReady ? 'publish_ready' : undefined;

    return prisma.propertyImportDraft.update({
      where: { id: draftId },
      data: {
        draftData: normalizeDraftData(input.draftData),
        reviewNotes: input.reviewNotes ?? null,
        reviewedByUserId: userId,
        reviewedAt: new Date(),
        ...(status ? { status } : {}),
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

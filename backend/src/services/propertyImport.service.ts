import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import config from '../config';
import prisma from '../config/prisma';
import logger from '../config/logger';
import {
  isAwsStorageConfigured,
  isR2StorageConfigured,
  storageService,
} from './storage.service';
import { isSupabaseStorageConfigured } from './supabaseStorage.service';
import { propertyImportQueueService } from './propertyImportQueue.service';
import {
  assertPropertyKnowledgeReady,
  assertPublishStorageReady,
  indexPropertyKnowledge,
} from './propertyKnowledge.service';
import {
  normalizePropertyImportDraftData,
  normalizePropertyImportMappingProfile,
} from './propertyImport.metadata';
import {
  countMissingKnowledgeFields,
  isPropertyKnowledgeComplete,
} from './propertyTypeKnowledge.service';
import { csvImportService, type ColumnMapping } from './csv-import.service';
import {
  buildBatchProgress,
  listPropertyImportUnits,
  syncPropertyImportUnits,
  type PropertyImportUnitInput,
} from './propertyImportUnit.service';
import { isPropertyImportReviewPending } from './propertyImport.metadata';

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

  async listInProgressDrafts(companyId: string) {
    const statuses = ['draft', 'review_ready', 'publish_ready', 'extracting'] as const;

    const rows = await prisma.propertyImportDraft.findMany({
      where: {
        companyId,
        status: { in: [...statuses] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        status: true,
        extractionStatus: true,
        updatedAt: true,
        createdAt: true,
        draftData: true,
        _count: { select: { mediaAssets: true, units: true } },
      },
    });

    return rows.map((row) => {
      const draftData = (row.draftData || {}) as Record<string, unknown>;
      const name = asTrimmedString(draftData.name) || 'Untitled import';
      const propertyType = asTrimmedString(draftData.property_type ?? draftData.propertyType) || null;
      const knowledgeDeferred =
        draftData.knowledge_gate_deferred === true || draftData.knowledgeGateDeferred === true;
      const { gapCount } = countMissingKnowledgeFields(draftData);

      return {
        id: row.id,
        status: row.status,
        extractionStatus: row.extractionStatus,
        name,
        property_type: propertyType,
        knowledge_deferred: knowledgeDeferred,
        knowledge_gap_count: gapCount,
        media_count: row._count.mediaAssets,
        units_count: row._count.units,
        updated_at: row.updatedAt.toISOString(),
        created_at: row.createdAt.toISOString(),
      };
    });
  }

  async importSpreadsheet(
    companyId: string,
    draftId: string,
    input: {
      fileBuffer: Buffer;
      mimeType: string;
      columnMapping: ColumnMapping;
      rawRows: Array<Record<string, string>>;
      propertyType: string;
      projectName: string;
    },
  ) {
    const draft = await prisma.propertyImportDraft.findFirst({
      where: { id: draftId, companyId },
      select: { id: true, status: true, draftData: true },
    });

    if (!draft) {
      throw new PropertyImportError('Draft not found', 404);
    }

    if (isTerminalStatus(draft.status)) {
      throw new PropertyImportError(`Draft is ${draft.status} and cannot accept spreadsheet import`, 409);
    }

    csvImportService.validateMapping(input.columnMapping, Object.keys(input.columnMapping));
    const { candidates, validCount, invalidCount } = csvImportService.applyMappingToRows(
      input.rawRows,
      input.columnMapping,
      input.propertyType,
    );

    const mappedUnits = candidates
      .filter((row) => row.isValid)
      .map((row, index) => ({
        label: row.data.name || `Row ${row.rowNumber}`,
        unitData: row.data as unknown as Record<string, unknown>,
        sortOrder: index,
      }));

    if (mappedUnits.length === 0) {
      throw new PropertyImportError('No valid rows found in spreadsheet', 400);
    }

    await syncPropertyImportUnits(companyId, draftId, mappedUnits);

    const projectDefaults = {
      ...((draft.draftData || {}) as Record<string, unknown>),
      name: input.projectName,
      property_type: input.propertyType,
    };

    const mergedDraftData = normalizePropertyImportDraftData({
      ...projectDefaults,
      import_mode: 'bulk_csv',
      import_mapping: {
        source_type: 'spreadsheet',
        profile_name: 'CRM / builder export',
        field_mappings: Object.entries(input.columnMapping)
          .filter(([, target]) => target && target !== 'skip')
          .map(([source, target]) => ({
            source_field: source,
            target_field: target,
            confidence: 0.9,
            required: false,
            label: target,
            notes: 'Mapped from spreadsheet column',
          })),
        review_settings: {
          confidence_threshold: 0.75,
          low_confidence_threshold: 0.55,
          require_human_review: true,
        },
        source_record: mappedUnits[0]?.unitData ?? null,
      },
      import_review: {
        status: 'needs_review',
        confidence_hints: [],
        review_notes: `Imported ${mappedUnits.length} valid row(s), ${invalidCount} invalid`,
        reviewed_by_user_id: null,
        reviewed_at: null,
        approved_at: null,
      },
      batch_progress: buildBatchProgress(mappedUnits.length, 'spreadsheet_imported'),
      csv_rows: candidates,
      valid_count: validCount,
      invalid_count: invalidCount,
      ai_knowledge_context: csvImportService.buildAiKnowledgeContext(candidates, input.projectName),
    }, (draft.draftData || {}) as Record<string, unknown>);

    const updated = await prisma.propertyImportDraft.update({
      where: { id: draftId },
      data: {
        draftData: normalizeDraftData(mergedDraftData),
        status: 'review_ready',
        extractionStatus: 'extracted',
        failureReason: null,
      },
      include: {
        mediaAssets: { orderBy: { createdAt: 'asc' } },
        units: { orderBy: { sortOrder: 'asc' } },
        extractionJobs: { orderBy: { createdAt: 'desc' }, take: 25 },
      },
    });

    return {
      draft: updated,
      units_count: mappedUnits.length,
      valid_count: validCount,
      invalid_count: invalidCount,
    };
  }

  async replaceSpreadsheetUnits(
    companyId: string,
    draftId: string,
    units: PropertyImportUnitInput[],
  ) {
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

    await syncPropertyImportUnits(companyId, draftId, units);
    return this.getDraft(companyId, draftId);
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
        units: {
          orderBy: { sortOrder: 'asc' },
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
    const baseUrl = options?.baseUrl;

    let mediaId: string | undefined;
    let upload: {
      key: string;
      uploadUrl: string;
      publicUrl: string;
      expiresInSeconds: number;
      contentType: string;
    };

    const buildDbBackedUpload = () => {
      const resolvedBase = config.storage.publicApiBaseUrl || baseUrl || '';
      if (!resolvedBase) {
        throw new PropertyImportError('Server base URL is required for property media upload', 500);
      }
      mediaId = crypto.randomUUID();
      const storageKey = `db/property-import-media/${mediaId}`;
      const endpointUrl = new URL(`/api/property-imports/uploads/${uploadToken}`, resolvedBase).toString();
      return {
        key: storageKey,
        uploadUrl: endpointUrl,
        publicUrl: endpointUrl,
        expiresInSeconds: 15 * 60,
        contentType: input.mimeType,
      };
    };

    const forceDbUpload = config.storage.propertyImportUseDbUpload === true;
    const apiBase =
      config.storage.publicApiBaseUrl
      || baseUrl
      || '';

    const buildSupabaseBackedUpload = () => {
      if (!apiBase) {
        throw new PropertyImportError('Server base URL is required for Supabase fallback upload', 500);
      }
      mediaId = crypto.randomUUID();
      const bucket = config.storage.supabasePropertyBucket;
      const extension = input.mimeType === 'application/pdf' ? '.pdf' : '';
      const objectPath = [
        'companies',
        companyId,
        'property-imports',
        draftId,
        `${mediaId}${extension}`,
      ].join('/');
      const storageKey = `supabase://${bucket}/${objectPath}`;
      const endpointUrl = new URL(`/api/property-imports/uploads/${uploadToken}`, apiBase).toString();
      return {
        key: storageKey,
        uploadUrl: endpointUrl,
        publicUrl: endpointUrl,
        expiresInSeconds: 15 * 60,
        contentType: input.mimeType,
      };
    };

    const tryDbUpload = () => {
      if (!apiBase) {
        throw new PropertyImportError('Server base URL is required for fallback property upload', 500);
      }
      return buildDbBackedUpload();
    };

    let fallbackUploadUrl: string | null = null;

    const uploadInput = {
      companyId,
      propertyId: `draft-${draftId}`,
      fileName: input.fileName,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      assetType: (input.assetType === 'video' ? 'image' : input.assetType) as 'image' | 'brochure',
    };

    const tryCloudPresignedUpload = async () => {
      if (isAwsStorageConfigured()) {
        try {
          return await storageService.createAwsPropertyUploadUrl(uploadInput);
        } catch (awsErr: any) {
          logger.warn('AWS S3 presigned upload unavailable; trying R2', {
            companyId,
            draftId,
            error: awsErr instanceof Error ? awsErr.message : String(awsErr),
          });
        }
      }

      if (isR2StorageConfigured()) {
        return storageService.createR2PropertyUploadUrl(uploadInput);
      }

      throw new Error('AWS S3 and R2 storage are not configured');
    };

    if (forceDbUpload) {
      upload = tryDbUpload();
    } else {
      try {
        upload = await tryCloudPresignedUpload();
        if (apiBase) {
          fallbackUploadUrl = new URL(`/api/property-imports/uploads/${uploadToken}`, apiBase).toString();
        }
      } catch (cloudErr: any) {
        const message = cloudErr instanceof Error ? cloudErr.message : String(cloudErr);
        logger.warn('Cloud presigned upload unavailable; trying Supabase/API fallback', {
          companyId,
          draftId,
          error: message,
        });
        if (isSupabaseStorageConfigured()) {
          try {
            upload = buildSupabaseBackedUpload();
          } catch (supabaseErr: any) {
            logger.warn('Supabase fallback upload registration failed; using DB fallback', {
              companyId,
              draftId,
              error: supabaseErr instanceof Error ? supabaseErr.message : String(supabaseErr),
            });
            upload = tryDbUpload();
          }
        } else {
          upload = tryDbUpload();
        }
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
        fallback_upload_url: fallbackUploadUrl,
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
      const draft = await this.getDraft(companyId, draftId);
      return {
        media,
        draft,
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

    const draft = await this.getDraft(companyId, draftId);

    return {
      media: result.verifiedMedia,
      draft,
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

    const isExtractionComplete = draft.extractionStatus === 'extracted';
    const canPublishNow = draft.status === 'publish_ready' && isExtractionComplete;
    const canRepublish = draft.status === 'published' && isExtractionComplete;

    if (!canPublishNow && !canRepublish) {
      throw new PropertyImportError('Draft is not ready for publishing', 409);
    }

    const draftData = (draft.draftData || {}) as Record<string, unknown>;
    const priceMin = asNullableNumber(draftData.price_min ?? draftData.priceMin);
    const priceMax = asNullableNumber(draftData.price_max ?? draftData.priceMax);
    if (priceMin !== null && priceMax !== null && priceMin > priceMax) {
      throw new PropertyImportError('Price min cannot be greater than price max', 400);
    }

    const pendingUploads = draft.mediaAssets.filter(
      (item) => item.status === 'upload_requested' || item.status === 'uploaded',
    );
    if (pendingUploads.length > 0) {
      throw new PropertyImportError(
        'All media uploads must be confirmed and verified before publishing.',
        409,
      );
    }

    const failedMedia = draft.mediaAssets.filter((item) => item.status === 'failed');
    if (failedMedia.length > 0) {
      throw new PropertyImportError(
        'One or more uploads or extractions failed. Retry failed assets before publishing.',
        409,
      );
    }

    if (draft.mediaAssets.length > 0) {
      assertPublishStorageReady(draft.mediaAssets.map((item) => item.storageKey));
    }

    const successfulMedia = draft.mediaAssets.filter((item) => item.status === 'extracted' || item.status === 'verified');
    const images = successfulMedia.filter((item) => item.assetType === 'image').map((item) => item.publicUrl);
    const brochure = successfulMedia.find((item) => item.assetType === 'brochure');

    const propertyType = draftData.property_type ?? draftData.propertyType;
    if (!propertyType || String(propertyType).trim() === '') {
      throw new PropertyImportError(
        'Property type is required (apartment, villa, plot, or commercial) before publishing.',
        400,
      );
    }

    if (!isPropertyKnowledgeComplete(draftData)) {
      const { gapCount } = countMissingKnowledgeFields(draftData);
      throw new PropertyImportError(
        `Complete AI knowledge Q&A before publishing (${gapCount} question(s) remaining).`,
        409,
      );
    }

    if (isPropertyImportReviewPending(draftData)) {
      throw new PropertyImportError(
        'Confirm extracted field mapping before publishing.',
        409,
      );
    }

    const importUnits = await listPropertyImportUnits(companyId, draftId);
    if (importUnits.length > 0) {
      return this.publishDraftUnits(
        companyId,
        draftId,
        userId,
        forceRepublish,
        draft,
        draftData,
        importUnits,
        { images, brochureUrl: brochure?.publicUrl || null },
        successfulMedia,
      );
    }

    const propertyData = mapDraftToPropertyData(draftData, {
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

    const property = published.property;
    const knowledge = await indexPropertyKnowledge({
      companyId,
      property: {
        id: property.id,
        name: property.name,
        builder: property.builder,
        locationCity: property.locationCity,
        locationArea: property.locationArea,
        locationPincode: property.locationPincode,
        priceMin: property.priceMin,
        priceMax: property.priceMax,
        bedrooms: property.bedrooms,
        propertyType: property.propertyType,
        amenities: property.amenities,
        description: property.description,
        reraNumber: property.reraNumber,
        brochureUrl: property.brochureUrl,
        status: property.status,
      },
      draftData: draftData as Record<string, unknown>,
      mediaExtractions: successfulMedia.map((item) => ({
        assetType: item.assetType,
        fileName: item.fileName,
        extractedMetadata: (item.extractedMetadata || {}) as Record<string, unknown>,
      })),
    });

    try {
      await assertPropertyKnowledgeReady(knowledge);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      await prisma.$transaction(async (tx) => {
        if (!published.alreadyPublished) {
          await tx.property.delete({ where: { id: property.id } }).catch(() => undefined);
        }
        await tx.propertyImportDraft.update({
          where: { id: draftId },
          data: {
            status: 'publish_ready',
            publishedPropertyId: published.alreadyPublished ? draft.publishedPropertyId : null,
            publishedAt: published.alreadyPublished ? draft.publishedAt : null,
            failureReason: `AI knowledge indexing failed: ${message}`,
          },
        });
      });

      throw new PropertyImportError(message, 503);
    }

    return {
      ...published,
      knowledge_indexed: knowledge.ok,
      knowledge_chunk_count: knowledge.chunkCount,
      properties_published: 1,
    };
  }

  private async publishDraftUnits(
    companyId: string,
    draftId: string,
    userId: string,
    forceRepublish: boolean,
    draft: {
      id: string;
      status: string;
      publishedPropertyId: string | null;
      publishedAt: Date | null;
    },
    projectDraftData: Record<string, unknown>,
    importUnits: Array<{
      id: string;
      label: string | null;
      unitData: unknown;
      publishedPropertyId: string | null;
      status: string;
    }>,
    mediaUrls: { images: string[]; brochureUrl: string | null },
    successfulMedia: Array<{
      assetType: string;
      fileName: string;
      extractedMetadata: unknown;
    }>,
  ) {
    const publishedProperties: Array<{ id: string; name: string }> = [];
    let totalChunks = 0;
    let knowledgeOk = true;

    for (let index = 0; index < importUnits.length; index += 1) {
      const unit = importUnits[index];
      const unitData = {
        ...projectDraftData,
        ...((unit.unitData || {}) as Record<string, unknown>),
      };
      if (unit.label && !unitData.name) {
        unitData.name = unit.label;
      }

      const propertyData = mapDraftToPropertyData(unitData, mediaUrls);

      const property = await prisma.$transaction(async (tx) => {
        if (unit.publishedPropertyId && unit.status === 'published' && !forceRepublish) {
          const existing = await tx.property.findFirst({
            where: { id: unit.publishedPropertyId, companyId },
          });
          if (existing) {
            return existing;
          }
        }

        let propertyId = unit.publishedPropertyId;
        if (propertyId && forceRepublish) {
          return tx.property.update({
            where: { id: propertyId },
            data: propertyData,
          });
        }

        const created = await tx.property.create({
          data: {
            companyId,
            ...(propertyData as any),
          },
        });
        propertyId = created.id;

        await tx.propertyImportUnit.update({
          where: { id: unit.id },
          data: {
            status: 'published',
            publishedPropertyId: propertyId,
          },
        });

        return created;
      });

      publishedProperties.push({ id: property.id, name: property.name });

      const knowledge = await indexPropertyKnowledge({
        companyId,
        property: {
          id: property.id,
          name: property.name,
          builder: property.builder,
          locationCity: property.locationCity,
          locationArea: property.locationArea,
          locationPincode: property.locationPincode,
          priceMin: property.priceMin,
          priceMax: property.priceMax,
          bedrooms: property.bedrooms,
          propertyType: property.propertyType,
          amenities: property.amenities,
          description: property.description,
          reraNumber: property.reraNumber,
          brochureUrl: property.brochureUrl,
          status: property.status,
        },
        draftData: unitData,
        mediaExtractions: successfulMedia.map((item) => ({
          assetType: item.assetType,
          fileName: item.fileName,
          extractedMetadata: (item.extractedMetadata || {}) as Record<string, unknown>,
        })),
      });

      try {
        await assertPropertyKnowledgeReady(knowledge);
      } catch (err: unknown) {
        knowledgeOk = false;
        const message = err instanceof Error ? err.message : String(err);
        await prisma.property.delete({ where: { id: property.id } }).catch(() => undefined);
        await prisma.propertyImportUnit.update({
          where: { id: unit.id },
          data: { status: 'failed' },
        });
        throw new PropertyImportError(`AI knowledge indexing failed for ${unit.label || property.name}: ${message}`, 503);
      }

      totalChunks += knowledge.chunkCount;
    }

    const primaryPropertyId = publishedProperties[0]?.id ?? null;
    const updatedDraft = await prisma.propertyImportDraft.update({
      where: { id: draftId },
      data: {
        status: 'published',
        extractionStatus: 'extracted',
        publishedPropertyId: primaryPropertyId,
        publishedAt: new Date(),
        reviewedAt: new Date(),
        reviewedByUserId: userId,
        failureReason: null,
        draftData: normalizeDraftData({
          ...projectDraftData,
          batch_progress: {
            phase: 'published',
            units_total: importUnits.length,
            units_ready: importUnits.length,
            units_published: publishedProperties.length,
            message: `${publishedProperties.length} properties published`,
            updated_at: new Date().toISOString(),
          },
        }),
      },
      include: {
        mediaAssets: { orderBy: { createdAt: 'asc' } },
        units: { orderBy: { sortOrder: 'asc' } },
        extractionJobs: { orderBy: { createdAt: 'desc' }, take: 25 },
      },
    });

    return {
      property: publishedProperties[0] ? await prisma.property.findFirst({ where: { id: publishedProperties[0].id, companyId } }) : null,
      properties: publishedProperties,
      draft: updatedDraft,
      alreadyPublished: draft.status === 'published' && !forceRepublish,
      knowledge_indexed: knowledgeOk,
      knowledge_chunk_count: totalChunks,
      properties_published: publishedProperties.length,
    };
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

  async deferKnowledgeGate(companyId: string, draftId: string, userId: string) {
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

    const draftData = { ...((draft.draftData as Record<string, unknown>) || {}) };
    draftData.knowledge_gate_deferred = true;
    draftData.knowledge_gate_deferred_at = new Date().toISOString();
    draftData.knowledge_gate_deferred_by = userId;

    await prisma.propertyImportDraft.update({
      where: { id: draftId },
      data: { draftData: draftData as Prisma.InputJsonValue },
    });

    return this.getDraft(companyId, draftId);
  }

  async getKnowledgeGate(companyId: string): Promise<{
    blocked: boolean;
    draftId: string | null;
    gapCount: number;
    propertyType: string | null;
    reason: string | null;
  }> {
    const blockingStatuses = ['review_ready', 'publish_ready', 'extracting', 'draft'] as const;

    const drafts = await prisma.propertyImportDraft.findMany({
      where: {
        companyId,
        status: { in: [...blockingStatuses] },
        extractionStatus: 'extracted',
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        draftData: true,
        status: true,
      },
    });

    for (const candidate of drafts) {
      const draftData = (candidate.draftData || {}) as Record<string, unknown>;
      if (draftData.knowledge_gate_deferred === true || draftData.knowledgeGateDeferred === true) {
        continue;
      }
      const name = asTrimmedString(draftData.name);
      const propertyType = asTrimmedString(draftData.property_type ?? draftData.propertyType);
      if (!propertyType) {
        continue;
      }

      const { gapCount } = countMissingKnowledgeFields(draftData);
      if (gapCount === 0) {
        continue;
      }

      return {
        blocked: true,
        draftId: candidate.id,
        gapCount,
        propertyType,
        reason: name
          ? `Finish AI knowledge for "${name}" (${gapCount} questions left).`
          : `Finish AI knowledge for this ${propertyType} import (${gapCount} questions left).`,
      };
    }

    return {
      blocked: false,
      draftId: null,
      gapCount: 0,
      propertyType: null,
      reason: null,
    };
  }
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const propertyImportService = new PropertyImportService();
export { PropertyImportError };

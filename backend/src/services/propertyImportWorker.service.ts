import logger from '../config/logger';
import prisma from '../config/prisma';
import { storageService } from './storage.service';
import {
  propertyImportQueueService,
  PropertyImportQueueProcessResult,
  StoredPropertyImportJob,
} from './propertyImportQueue.service';

type PropertyImportWorkerJobStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
type PropertyImportWorkerDraftStatus = 'draft' | 'extracting' | 'review_ready' | 'publish_ready' | 'published' | 'failed' | 'cancelled';
type PropertyImportWorkerExtractionStatus = 'pending_upload' | 'upload_completed' | 'queued' | 'processing' | 'extracted' | 'failed' | 'cancelled';
type PropertyImportWorkerMediaStatus = 'upload_requested' | 'uploaded' | 'verified' | 'queued_for_extraction' | 'extracted' | 'failed' | 'cancelled';

type PropertyImportWorkerJobRecord = {
  id: string;
  companyId: string;
  draftId: string;
  mediaId: string | null;
  status: PropertyImportWorkerJobStatus;
  attempt: number;
  maxAttempts: number;
  idempotencyKey: string;
  nextRetryAt: Date | null;
  draft: {
    id: string;
    status: PropertyImportWorkerDraftStatus;
  };
  media: {
    id: string;
    status: PropertyImportWorkerMediaStatus;
    assetType: 'image' | 'brochure' | 'video';
    storageKey: string;
    mimeType: string;
    fileSize: number;
    publicUrl: string;
    extractedMetadata: Record<string, unknown>;
  } | null;
};

type PropertyImportWorkerDb = {
  propertyImportJob: {
    findUnique(args: any): Promise<PropertyImportWorkerJobRecord | null>;
    update(args: any): Promise<unknown>;
  };
  propertyImportMedia: {
    update(args: any): Promise<unknown>;
    findMany(args: any): Promise<Array<{ status: PropertyImportWorkerMediaStatus }>>;
  };
  propertyImportDraft: {
    update(args: any): Promise<unknown>;
    findUnique(args: any): Promise<{ id: string; status: PropertyImportWorkerDraftStatus } | null>;
  };
  $transaction<T>(callback: (tx: PropertyImportWorkerDb) => Promise<T>): Promise<T>;
};

type PropertyImportWorkerQueue = {
  processDueJobs(
    processor: (job: StoredPropertyImportJob) => Promise<PropertyImportQueueProcessResult | void>,
  ): Promise<number>;
};

type PropertyImportWorkerStorage = {
  verifyUploadedObject(
    key: string,
    expected: { mimeType?: string; fileSize?: number },
  ): Promise<{ exists: boolean; contentType?: string; contentLength?: number; eTag?: string }>;
};

interface PropertyImportWorkerOptions {
  pollIntervalMs?: number;
}

interface PropertyImportWorkerDeps {
  db: PropertyImportWorkerDb;
  queue: PropertyImportWorkerQueue;
  storage: PropertyImportWorkerStorage;
  now: () => Date;
}

const DEFAULT_POLL_INTERVAL_MS = 5000;

export class PropertyImportWorkerService {
  private readonly pollIntervalMs: number;
  private readonly deps: PropertyImportWorkerDeps;
  private workerTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(options?: PropertyImportWorkerOptions, deps?: Partial<PropertyImportWorkerDeps>) {
    this.pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.deps = {
      db: deps?.db ?? (prisma as unknown as PropertyImportWorkerDb),
      queue: deps?.queue ?? propertyImportQueueService,
      storage: deps?.storage ?? storageService,
      now: deps?.now ?? (() => new Date()),
    };
  }

  start(): void {
    if (this.workerTimer) {
      return;
    }

    logger.info('Property import worker started', {
      pollIntervalMs: this.pollIntervalMs,
    });

    this.workerTimer = setInterval(() => {
      void this.runOnce();
    }, this.pollIntervalMs);

    void this.runOnce();
  }

  stop(): void {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
    }

    logger.info('Property import worker stopped');
  }

  async runOnce(): Promise<number> {
    if (this.running) {
      return 0;
    }

    this.running = true;

    try {
      const processed = await this.deps.queue.processDueJobs(async (job) => this.handleQueuedJob(job));
      if (processed > 0) {
        logger.info('Property import worker processed queued jobs', { processed });
      }
      return processed;
    } catch (err: any) {
      logger.error('Property import worker run failed', {
        error: err.message,
      });
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async handleQueuedJob(job: StoredPropertyImportJob): Promise<PropertyImportQueueProcessResult> {
    const jobRecord = await this.deps.db.propertyImportJob.findUnique({
      where: { id: job.payload.jobId },
      include: {
        draft: {
          select: {
            id: true,
            status: true,
          },
        },
        media: {
          select: {
            id: true,
            status: true,
            assetType: true,
            storageKey: true,
            mimeType: true,
            fileSize: true,
            publicUrl: true,
            extractedMetadata: true,
          },
        },
      },
    });

    if (!jobRecord) {
      logger.warn('Property import worker skipping missing job', {
        jobId: job.payload.jobId,
      });
      return 'completed';
    }

    if (jobRecord.status === 'succeeded' || jobRecord.status === 'cancelled') {
      return 'completed';
    }

    if (jobRecord.draft.status === 'cancelled') {
      await this.markJobCancelled(jobRecord, 'Draft was cancelled before extraction');
      return 'completed';
    }

    if (jobRecord.draft.status === 'published') {
      await this.markJobCancelled(jobRecord, 'Draft already published before extraction job execution');
      return 'completed';
    }

    if (!jobRecord.mediaId || !jobRecord.media) {
      await this.markJobAsFailedWithoutRetry(jobRecord, 'Media record is missing for extraction job');
      return 'completed';
    }

    if (jobRecord.media.status === 'cancelled') {
      await this.markJobCancelled(jobRecord, 'Media was cancelled before extraction');
      return 'completed';
    }

    if (jobRecord.nextRetryAt && jobRecord.nextRetryAt.getTime() > this.deps.now().getTime()) {
      return 'retry';
    }

    if (jobRecord.media.status === 'extracted') {
      await this.deps.db.propertyImportJob.update({
        where: { id: jobRecord.id },
        data: {
          status: 'succeeded',
          failureReason: null,
          startedAt: jobRecord.status === 'processing' ? undefined : this.deps.now(),
          finishedAt: this.deps.now(),
          nextRetryAt: null,
          result: {
            idempotent: true,
            reason: 'media_already_extracted',
            mediaId: jobRecord.media.id,
          },
        },
      });

      await this.reconcileDraftStatus(jobRecord.draft.id);
      return 'completed';
    }

    await this.deps.db.propertyImportJob.update({
      where: { id: jobRecord.id },
      data: {
        status: 'processing',
        startedAt: this.deps.now(),
        failureReason: null,
      },
    });

    await this.updateDraftToProcessing(jobRecord.draft.id);

    logger.info('Property import extraction job started', {
      jobId: jobRecord.id,
      draftId: jobRecord.draftId,
      mediaId: jobRecord.media.id,
      attempt: jobRecord.attempt,
      maxAttempts: jobRecord.maxAttempts,
    });

    try {
      const verification = await this.deps.storage.verifyUploadedObject(jobRecord.media.storageKey, {
        mimeType: jobRecord.media.mimeType,
        fileSize: jobRecord.media.fileSize,
      });

      if (!verification.exists) {
        throw new Error('Uploaded media object was not found in storage');
      }

      const extractionMetadata = {
        ...(jobRecord.media.extractedMetadata || {}),
        storageKey: jobRecord.media.storageKey,
        publicUrl: jobRecord.media.publicUrl,
        assetType: jobRecord.media.assetType,
        mimeType: verification.contentType || jobRecord.media.mimeType,
        fileSize: verification.contentLength || jobRecord.media.fileSize,
        eTag: verification.eTag || null,
        extractedAt: this.deps.now().toISOString(),
      };

      await this.deps.db.$transaction(async (tx) => {
        await tx.propertyImportMedia.update({
          where: { id: jobRecord.media!.id },
          data: {
            status: 'extracted',
            extractedAt: this.deps.now(),
            failureReason: null,
            extractedMetadata: extractionMetadata,
            ...(verification.eTag ? { eTag: verification.eTag } : {}),
          },
        });

        await tx.propertyImportJob.update({
          where: { id: jobRecord.id },
          data: {
            status: 'succeeded',
            result: extractionMetadata,
            failureReason: null,
            finishedAt: this.deps.now(),
            nextRetryAt: null,
          },
        });
      });

      await this.reconcileDraftStatus(jobRecord.draft.id);

      logger.info('Property import extraction job succeeded', {
        jobId: jobRecord.id,
        draftId: jobRecord.draftId,
        mediaId: jobRecord.media.id,
      });

      return 'completed';
    } catch (err: any) {
      return this.handleFailure(jobRecord, err);
    }
  }

  private async handleFailure(
    jobRecord: PropertyImportWorkerJobRecord,
    error: Error,
  ): Promise<PropertyImportQueueProcessResult> {
    const nextAttempt = jobRecord.attempt + 1;
    const canRetry = nextAttempt < jobRecord.maxAttempts;
    const failureReason = error.message || 'Property media extraction failed';

    if (canRetry && jobRecord.mediaId) {
      const backoffSeconds = Math.min(300, Math.pow(2, nextAttempt) * 10);
      const nextRetryAt = new Date(this.deps.now().getTime() + (backoffSeconds * 1000));

      await this.deps.db.$transaction(async (tx) => {
        await tx.propertyImportJob.update({
          where: { id: jobRecord.id },
          data: {
            status: 'queued',
            attempt: nextAttempt,
            failureReason,
            nextRetryAt,
            startedAt: this.deps.now(),
            finishedAt: null,
          },
        });

        await tx.propertyImportMedia.update({
          where: { id: jobRecord.mediaId },
          data: {
            status: 'queued_for_extraction',
            failureReason,
          },
        });

        if (jobRecord.draft.status !== 'published' && jobRecord.draft.status !== 'cancelled') {
          await tx.propertyImportDraft.update({
            where: { id: jobRecord.draftId },
            data: {
              status: jobRecord.draft.status === 'publish_ready' ? 'publish_ready' : 'extracting',
              extractionStatus: 'queued',
              failureReason,
            },
          });
        }
      });

      logger.warn('Property import extraction job failed and scheduled for retry', {
        jobId: jobRecord.id,
        draftId: jobRecord.draftId,
        mediaId: jobRecord.mediaId,
        attempt: nextAttempt,
        maxAttempts: jobRecord.maxAttempts,
        nextRetryAt: nextRetryAt.toISOString(),
        error: failureReason,
      });

      return 'retry';
    }

    await this.markJobAsFailedWithoutRetry(jobRecord, failureReason);
    return 'completed';
  }

  private async markJobAsFailedWithoutRetry(jobRecord: PropertyImportWorkerJobRecord, failureReason: string): Promise<void> {
    await this.deps.db.$transaction(async (tx) => {
      await tx.propertyImportJob.update({
        where: { id: jobRecord.id },
        data: {
          status: 'failed',
          failureReason,
          finishedAt: this.deps.now(),
          nextRetryAt: null,
        },
      });

      if (jobRecord.mediaId) {
        await tx.propertyImportMedia.update({
          where: { id: jobRecord.mediaId },
          data: {
            status: 'failed',
            failureReason,
          },
        });
      }

      if (jobRecord.draft.status !== 'published' && jobRecord.draft.status !== 'cancelled') {
        await tx.propertyImportDraft.update({
          where: { id: jobRecord.draftId },
          data: {
            status: 'failed',
            extractionStatus: 'failed',
            failureReason,
          },
        });
      }
    });

    logger.error('Property import extraction job failed permanently', {
      jobId: jobRecord.id,
      draftId: jobRecord.draftId,
      mediaId: jobRecord.mediaId,
      attempt: jobRecord.attempt,
      maxAttempts: jobRecord.maxAttempts,
      error: failureReason,
    });
  }

  private async markJobCancelled(jobRecord: PropertyImportWorkerJobRecord, reason: string): Promise<void> {
    await this.deps.db.propertyImportJob.update({
      where: { id: jobRecord.id },
      data: {
        status: 'cancelled',
        failureReason: reason,
        finishedAt: this.deps.now(),
        nextRetryAt: null,
      },
    });

    logger.info('Property import extraction job cancelled', {
      jobId: jobRecord.id,
      draftId: jobRecord.draftId,
      mediaId: jobRecord.mediaId,
      reason,
    });
  }

  private async updateDraftToProcessing(draftId: string): Promise<void> {
    const draft = await this.deps.db.propertyImportDraft.findUnique({
      where: { id: draftId },
      select: {
        id: true,
        status: true,
      },
    });

    if (!draft) {
      return;
    }

    if (draft.status === 'cancelled' || draft.status === 'published') {
      return;
    }

    await this.deps.db.propertyImportDraft.update({
      where: { id: draftId },
      data: {
        status: draft.status === 'publish_ready' ? 'publish_ready' : 'extracting',
        extractionStatus: 'processing',
      },
    });
  }

  private async reconcileDraftStatus(draftId: string): Promise<void> {
    const draft = await this.deps.db.propertyImportDraft.findUnique({
      where: { id: draftId },
      select: {
        id: true,
        status: true,
      },
    });

    if (!draft || draft.status === 'cancelled' || draft.status === 'published') {
      return;
    }

    const media = await this.deps.db.propertyImportMedia.findMany({
      where: { draftId },
      select: {
        status: true,
      },
    });

    if (media.length === 0) {
      return;
    }

    const hasFailed = media.some((item) => item.status === 'failed');
    const hasPending = media.some((item) => item.status === 'upload_requested'
      || item.status === 'uploaded'
      || item.status === 'verified'
      || item.status === 'queued_for_extraction');

    if (hasFailed) {
      await this.deps.db.propertyImportDraft.update({
        where: { id: draftId },
        data: {
          status: 'failed',
          extractionStatus: 'failed',
        },
      });
      return;
    }

    if (hasPending) {
      await this.deps.db.propertyImportDraft.update({
        where: { id: draftId },
        data: {
          status: draft.status === 'publish_ready' ? 'publish_ready' : 'extracting',
          extractionStatus: 'processing',
        },
      });
      return;
    }

    const nextStatus = draft.status === 'publish_ready' ? 'publish_ready' : 'review_ready';

    await this.deps.db.propertyImportDraft.update({
      where: { id: draftId },
      data: {
        status: nextStatus,
        extractionStatus: 'extracted',
        failureReason: null,
      },
    });
  }
}

export const propertyImportWorkerService = new PropertyImportWorkerService({
  pollIntervalMs: Number(process.env.PROPERTY_IMPORT_WORKER_POLL_MS || DEFAULT_POLL_INTERVAL_MS),
});

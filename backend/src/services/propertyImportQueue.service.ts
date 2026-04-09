import { getRedis } from '../config/redis';
import logger from '../config/logger';

export type PropertyImportQueueJobType = 'extract_media';

export interface PropertyImportQueuePayload {
  jobId: string;
  companyId: string;
  draftId: string;
  mediaId: string;
  attempt: number;
  maxAttempts: number;
}

export interface StoredPropertyImportJob {
  type: PropertyImportQueueJobType;
  idempotencyKey: string;
  payload: PropertyImportQueuePayload;
  enqueuedAt: string;
}

export type PropertyImportQueueProcessResult = 'completed' | 'retry';

const JOB_PREFIX = 'property-import:job:';
const PROCESSING_PREFIX = 'property-import:processing:';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

const memoryJobs = new Map<string, StoredPropertyImportJob>();
const memoryProcessing = new Set<string>();

function isProductionRuntime(): boolean {
  const env = (process.env.NODE_ENV || '').toLowerCase();
  return env === 'production' && !Boolean(process.env.JEST_WORKER_ID);
}

function throwRedisRequiredError(operation: string, metadata?: Record<string, unknown>): never {
  logger.error('Property import queue requires Redis in production', {
    operation,
    ...metadata,
  });
  throw new Error('Property import queue requires Redis in production. Configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
}

function buildQueueKey(type: PropertyImportQueueJobType, idempotencyKey: string): string {
  return `${JOB_PREFIX}${type}:${idempotencyKey}`;
}

function buildProcessingKey(queueKey: string): string {
  return `${PROCESSING_PREFIX}${queueKey}`;
}

function parseStoredJob(raw: string | StoredPropertyImportJob): StoredPropertyImportJob {
  return typeof raw === 'string' ? JSON.parse(raw) as StoredPropertyImportJob : raw;
}

export class PropertyImportQueueService {
  async enqueueExtraction(
    idempotencyKey: string,
    payload: PropertyImportQueuePayload,
    ttlSeconds = DEFAULT_TTL_SECONDS,
  ): Promise<boolean> {
    const queueKey = buildQueueKey('extract_media', idempotencyKey);
    const job: StoredPropertyImportJob = {
      type: 'extract_media',
      idempotencyKey,
      payload,
      enqueuedAt: new Date().toISOString(),
    };

    const redis = getRedis();
    if (!redis && isProductionRuntime()) {
      throwRedisRequiredError('enqueueExtraction', { queueKey });
    }

    if (redis) {
      try {
        const result = await redis.set(queueKey, JSON.stringify(job), {
          nx: true,
          ex: ttlSeconds,
        });

        if (result === null) {
          return false;
        }

        logger.info('Property import queue transition', {
          queue: 'property_import',
          transition: 'queued',
          storage: 'redis',
          queueKey,
          draftId: payload.draftId,
          mediaId: payload.mediaId,
          attempt: payload.attempt,
          maxAttempts: payload.maxAttempts,
        });
        return true;
      } catch (err: any) {
        if (isProductionRuntime()) {
          throwRedisRequiredError('enqueueExtraction', {
            queueKey,
            error: err.message,
          });
        }
        logger.warn('Property import queue Redis enqueue failed, falling back to memory', {
          queueKey,
          error: err.message,
        });
      }
    }

    if (memoryJobs.has(queueKey)) {
      return false;
    }

    memoryJobs.set(queueKey, job);
    logger.info('Property import queue transition', {
      queue: 'property_import',
      transition: 'queued',
      storage: 'memory',
      queueKey,
      draftId: payload.draftId,
      mediaId: payload.mediaId,
      attempt: payload.attempt,
      maxAttempts: payload.maxAttempts,
    });
    return true;
  }

  async clearAll(): Promise<void> {
    const redis = getRedis();
    if (!redis && isProductionRuntime()) {
      throwRedisRequiredError('clearAll');
    }

    if (redis) {
      try {
        const queueKeys = await redis.keys(`${JOB_PREFIX}*`);
        if (queueKeys.length > 0) {
          await redis.del(...queueKeys);
        }

        const processingKeys = await redis.keys(`${PROCESSING_PREFIX}*`);
        if (processingKeys.length > 0) {
          await redis.del(...processingKeys);
        }
        return;
      } catch (err: any) {
        if (isProductionRuntime()) {
          throwRedisRequiredError('clearAll', { error: err.message });
        }
        logger.warn('Failed to clear property import queue in Redis', { error: err.message });
      }
    }

    memoryJobs.clear();
    memoryProcessing.clear();
  }

  async processDueJobs(
    processor: (job: StoredPropertyImportJob) => Promise<PropertyImportQueueProcessResult | void>,
  ): Promise<number> {
    const jobs = await this.getAllJobs();
    let processed = 0;

    for (const { key, job } of jobs.slice(0, 25)) {
      const claimed = await this.claimJob(key);
      if (!claimed) {
        logger.debug('Property import queue transition', {
          queue: 'property_import',
          transition: 'claim_skipped',
          reason: 'already_processing',
          queueKey: key,
          draftId: job.payload.draftId,
          mediaId: job.payload.mediaId,
          attempt: job.payload.attempt,
          maxAttempts: job.payload.maxAttempts,
        });
        continue;
      }

      logger.info('Property import queue transition', {
        queue: 'property_import',
        transition: 'processing',
        queueKey: key,
        draftId: job.payload.draftId,
        mediaId: job.payload.mediaId,
        attempt: job.payload.attempt,
        maxAttempts: job.payload.maxAttempts,
      });

      try {
        const result = await processor(job);

        if (result === 'retry') {
          logger.warn('Property import queue transition', {
            queue: 'property_import',
            transition: 'retry_scheduled',
            queueKey: key,
            draftId: job.payload.draftId,
            mediaId: job.payload.mediaId,
            attempt: job.payload.attempt,
            maxAttempts: job.payload.maxAttempts,
          });
          await this.releaseJob(key);
          continue;
        }

        await this.deleteJob(key);
        logger.info('Property import queue transition', {
          queue: 'property_import',
          transition: 'succeeded',
          queueKey: key,
          draftId: job.payload.draftId,
          mediaId: job.payload.mediaId,
          attempt: job.payload.attempt,
          maxAttempts: job.payload.maxAttempts,
        });
        processed += 1;
      } catch (err: any) {
        logger.error('Property import queue transition', {
          queue: 'property_import',
          transition: 'processing_error_released',
          queueKey: key,
          error: err.message,
          draftId: job.payload.draftId,
          mediaId: job.payload.mediaId,
          attempt: job.payload.attempt,
          maxAttempts: job.payload.maxAttempts,
        });
        await this.releaseJob(key);
      }
    }

    return processed;
  }

  private async getAllJobs(): Promise<Array<{ key: string; job: StoredPropertyImportJob }>> {
    const redis = getRedis();
    if (!redis && isProductionRuntime()) {
      throwRedisRequiredError('getAllJobs');
    }

    if (redis) {
      try {
        const keys = await redis.keys(`${JOB_PREFIX}*`);
        const entries = await Promise.all(
          keys.map(async (key) => {
            const raw = await redis.get<string>(key);
            if (!raw) {
              return null;
            }

            try {
              return { key, job: parseStoredJob(raw) };
            } catch {
              logger.warn('Discarding malformed property import queue payload', { key });
              return null;
            }
          }),
        );

        return entries.filter((entry): entry is { key: string; job: StoredPropertyImportJob } => Boolean(entry));
      } catch (err: any) {
        if (isProductionRuntime()) {
          throwRedisRequiredError('getAllJobs', { error: err.message });
        }
        logger.warn('Failed to list property import jobs in Redis, falling back to memory', {
          error: err.message,
        });
      }
    }

    return Array.from(memoryJobs.entries()).map(([key, job]) => ({ key, job }));
  }

  private async claimJob(queueKey: string): Promise<boolean> {
    const redis = getRedis();
    const processingKey = buildProcessingKey(queueKey);

    if (!redis && isProductionRuntime()) {
      throwRedisRequiredError('claimJob', { queueKey });
    }

    if (redis) {
      try {
        const result = await redis.set(processingKey, '1', { nx: true, ex: 300 });
        return result !== null;
      } catch (err: any) {
        if (isProductionRuntime()) {
          throwRedisRequiredError('claimJob', {
            queueKey,
            error: err.message,
          });
        }
        logger.warn('Failed to claim property import job in Redis, falling back to memory', {
          queueKey,
          error: err.message,
        });
      }
    }

    if (memoryProcessing.has(queueKey)) {
      return false;
    }

    memoryProcessing.add(queueKey);
    return true;
  }

  private async releaseJob(queueKey: string): Promise<void> {
    const redis = getRedis();
    const processingKey = buildProcessingKey(queueKey);

    if (!redis && isProductionRuntime()) {
      throwRedisRequiredError('releaseJob', { queueKey });
    }

    if (redis) {
      try {
        await redis.del(processingKey);
      } catch {
        if (isProductionRuntime()) {
          throwRedisRequiredError('releaseJob', { queueKey });
        }
        // best effort
      }
      return;
    }

    memoryProcessing.delete(queueKey);
  }

  private async deleteJob(queueKey: string): Promise<void> {
    const redis = getRedis();
    const processingKey = buildProcessingKey(queueKey);

    if (!redis && isProductionRuntime()) {
      throwRedisRequiredError('deleteJob', { queueKey });
    }

    if (redis) {
      try {
        await redis.del(queueKey, processingKey);
        return;
      } catch (err: any) {
        if (isProductionRuntime()) {
          throwRedisRequiredError('deleteJob', {
            queueKey,
            error: err.message,
          });
        }
        logger.warn('Failed to delete property import queue key in Redis', {
          queueKey,
          error: err.message,
        });
      }
    }

    memoryJobs.delete(queueKey);
    memoryProcessing.delete(queueKey);
  }
}

export const propertyImportQueueService = new PropertyImportQueueService();

import { getRedis } from '../config/redis';
import logger from '../config/logger';

export type AutomationJobType =
  | 'visit_reminder_24h'
  | 'visit_reminder_1h'
  | 'visit_agent_notification_15m'
  | 'lead_follow_up_48h'
  | 'lead_follow_up_7d'
  | 'conversation_timeout_24h';

export interface AutomationJobPayload {
  type: AutomationJobType;
  uniqueKey: string;
  executeAt: string;
  data: Record<string, unknown>;
}

interface StoredAutomationJob extends AutomationJobPayload {
  createdAt: string;
  attempt: number;
  maxAttempts: number;
  lastError?: string | null;
}

interface DeadLetterAutomationJob extends StoredAutomationJob {
  failedAt: string;
  failureReason: string;
}

const JOB_PREFIX = 'automation:job:';
const PROCESSING_PREFIX = 'automation:processing:';
const DEAD_LETTER_PREFIX = 'automation:dead-letter:';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_MAX_ATTEMPTS = 3;

const memoryJobs = new Map<string, StoredAutomationJob>();
const memoryProcessing = new Set<string>();
const memoryDeadLetters = new Map<string, DeadLetterAutomationJob>();

function buildJobKey(type: AutomationJobType, uniqueKey: string): string {
  return `${JOB_PREFIX}${type}:${uniqueKey}`;
}

function buildProcessingKey(jobKey: string): string {
  return `${PROCESSING_PREFIX}${jobKey}`;
}

function parseStoredJob(raw: string | StoredAutomationJob): StoredAutomationJob {
  return typeof raw === 'string' ? JSON.parse(raw) as StoredAutomationJob : raw;
}

function buildDeadLetterKey(jobKey: string): string {
  return `${DEAD_LETTER_PREFIX}${jobKey}`;
}

function calculateRetryDelayMs(nextAttempt: number): number {
  const backoffSeconds = Math.min(300, Math.pow(2, nextAttempt) * 10);
  return backoffSeconds * 1000;
}

export class AutomationQueueService {
  async schedule(
    type: AutomationJobType,
    uniqueKey: string,
    executeAt: Date,
    data: Record<string, unknown>,
    ttlSeconds = DEFAULT_TTL_SECONDS,
  ): Promise<boolean> {
    const jobKey = buildJobKey(type, uniqueKey);
    const payload: StoredAutomationJob = {
      type,
      uniqueKey,
      executeAt: executeAt.toISOString(),
      data,
      createdAt: new Date().toISOString(),
      attempt: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      lastError: null,
    };

    const redis = getRedis();
    if (redis) {
      try {
        const result = await redis.set(jobKey, JSON.stringify(payload), {
          nx: true,
          ex: ttlSeconds,
        });

        if (result === null) {
          return false;
        }

        logger.info('Automation queue transition', {
          queue: 'automation',
          transition: 'queued',
          jobKey,
          type: payload.type,
          uniqueKey: payload.uniqueKey,
          attempt: payload.attempt,
          maxAttempts: payload.maxAttempts,
          executeAt: payload.executeAt,
        });
        return true;
      } catch (err: any) {
        logger.warn('Failed to schedule automation job in Redis, falling back to memory', {
          jobKey,
          error: err.message,
        });
      }
    }

    if (memoryJobs.has(jobKey)) {
      return false;
    }

    memoryJobs.set(jobKey, payload);
    logger.info('Automation queue transition', {
      queue: 'automation',
      transition: 'queued',
      storage: 'memory',
      jobKey,
      type: payload.type,
      uniqueKey: payload.uniqueKey,
      attempt: payload.attempt,
      maxAttempts: payload.maxAttempts,
      executeAt: payload.executeAt,
    });
    return true;
  }

  async processDueJobs(processor: (job: StoredAutomationJob) => Promise<void>): Promise<number> {
    const now = Date.now();
    let processed = 0;

    const jobs = await this.getAllJobs();
    const dueJobs = jobs
      .filter((entry) => new Date(entry.job.executeAt).getTime() <= now)
      .sort((left, right) => new Date(left.job.executeAt).getTime() - new Date(right.job.executeAt).getTime())
      .slice(0, 25);

    for (const { key, job } of dueJobs) {
      const claimed = await this.claimJob(key);
      if (!claimed) {
        logger.debug('Automation queue transition', {
          queue: 'automation',
          transition: 'claim_skipped',
          reason: 'already_processing',
          jobKey: key,
          type: job.type,
          uniqueKey: job.uniqueKey,
          attempt: job.attempt,
          maxAttempts: job.maxAttempts,
        });
        continue;
      }

      logger.info('Automation queue transition', {
        queue: 'automation',
        transition: 'processing',
        jobKey: key,
        type: job.type,
        uniqueKey: job.uniqueKey,
        attempt: job.attempt,
        maxAttempts: job.maxAttempts,
      });

      try {
        await processor(job);
        await this.deleteJob(key);
        logger.info('Automation queue transition', {
          queue: 'automation',
          transition: 'succeeded',
          jobKey: key,
          type: job.type,
          uniqueKey: job.uniqueKey,
          attempt: job.attempt,
          maxAttempts: job.maxAttempts,
        });
        processed += 1;
      } catch (err: any) {
        await this.handleProcessingFailure(key, job, err);
      }
    }

    return processed;
  }

  async clearAll(): Promise<void> {
    const redis = getRedis();
    if (redis) {
      try {
        const keys = await redis.keys(`${JOB_PREFIX}*`);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
        const processingKeys = await redis.keys(`${PROCESSING_PREFIX}*`);
        if (processingKeys.length > 0) {
          await redis.del(...processingKeys);
        }
        const deadLetterKeys = await redis.keys(`${DEAD_LETTER_PREFIX}*`);
        if (deadLetterKeys.length > 0) {
          await redis.del(...deadLetterKeys);
        }
        return;
      } catch (err: any) {
        logger.warn('Failed to clear automation jobs in Redis', { error: err.message });
      }
    }

    memoryJobs.clear();
    memoryProcessing.clear();
    memoryDeadLetters.clear();
  }

  private async getAllJobs(): Promise<Array<{ key: string; job: StoredAutomationJob }>> {
    const redis = getRedis();
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
              logger.warn('Discarding malformed automation job', { key });
              return null;
            }
          })
        );

        return entries.filter((entry): entry is { key: string; job: StoredAutomationJob } => Boolean(entry));
      } catch (err: any) {
        logger.warn('Failed to list automation jobs from Redis, falling back to memory', { error: err.message });
      }
    }

    return Array.from(memoryJobs.entries()).map(([key, job]) => ({ key, job }));
  }

  private async claimJob(jobKey: string): Promise<boolean> {
    const redis = getRedis();
    const processingKey = buildProcessingKey(jobKey);

    if (redis) {
      try {
        const result = await redis.set(processingKey, '1', { nx: true, ex: 300 });
        return result !== null;
      } catch (err: any) {
        logger.warn('Failed to claim automation job in Redis, falling back to memory', {
          jobKey,
          error: err.message,
        });
      }
    }

    if (memoryProcessing.has(jobKey)) {
      return false;
    }

    memoryProcessing.add(jobKey);
    return true;
  }

  private async releaseJob(jobKey: string): Promise<void> {
    const redis = getRedis();
    const processingKey = buildProcessingKey(jobKey);

    if (redis) {
      try {
        await redis.del(processingKey);
      } catch {
        // ignore release failures
      }
      return;
    }

    memoryProcessing.delete(jobKey);
  }

  private async deleteJob(jobKey: string): Promise<void> {
    const redis = getRedis();
    const processingKey = buildProcessingKey(jobKey);

    if (redis) {
      try {
        await redis.del(jobKey, processingKey);
        return;
      } catch (err: any) {
        logger.warn('Failed to delete automation job from Redis', { jobKey, error: err.message });
      }
    }

    memoryJobs.delete(jobKey);
    memoryProcessing.delete(jobKey);
  }

  private async handleProcessingFailure(jobKey: string, job: StoredAutomationJob, error: Error): Promise<void> {
    const failureReason = error.message || 'Automation job processor failed';
    const nextAttempt = job.attempt + 1;
    const canRetry = nextAttempt < job.maxAttempts;

    if (canRetry) {
      const nextExecuteAt = new Date(Date.now() + calculateRetryDelayMs(nextAttempt)).toISOString();
      const updatedJob: StoredAutomationJob = {
        ...job,
        attempt: nextAttempt,
        executeAt: nextExecuteAt,
        lastError: failureReason,
      };

      await this.upsertJob(jobKey, updatedJob);
      await this.releaseJob(jobKey);

      logger.warn('Automation queue transition', {
        queue: 'automation',
        transition: 'retry_scheduled',
        jobKey,
        type: job.type,
        uniqueKey: job.uniqueKey,
        attempt: nextAttempt,
        maxAttempts: job.maxAttempts,
        nextExecuteAt,
        failureReason,
      });
      return;
    }

    const deadLetter: DeadLetterAutomationJob = {
      ...job,
      attempt: nextAttempt,
      lastError: failureReason,
      failedAt: new Date().toISOString(),
      failureReason,
    };

    await this.saveDeadLetter(jobKey, deadLetter);
    await this.deleteJob(jobKey);

    logger.error('Automation queue transition', {
      queue: 'automation',
      transition: 'dead_lettered',
      jobKey,
      deadLetterKey: buildDeadLetterKey(jobKey),
      type: job.type,
      uniqueKey: job.uniqueKey,
      attempt: deadLetter.attempt,
      maxAttempts: deadLetter.maxAttempts,
      failureReason,
    });
  }

  private async upsertJob(jobKey: string, job: StoredAutomationJob): Promise<void> {
    const redis = getRedis();
    if (redis) {
      try {
        await redis.set(jobKey, JSON.stringify(job), { ex: DEFAULT_TTL_SECONDS });
        return;
      } catch (err: any) {
        logger.warn('Failed to update automation job in Redis, falling back to memory', {
          jobKey,
          error: err.message,
        });
      }
    }

    memoryJobs.set(jobKey, job);
  }

  private async saveDeadLetter(jobKey: string, job: DeadLetterAutomationJob): Promise<void> {
    const deadLetterKey = buildDeadLetterKey(jobKey);
    const redis = getRedis();
    if (redis) {
      try {
        await redis.set(deadLetterKey, JSON.stringify(job), { ex: DEFAULT_TTL_SECONDS });
        return;
      } catch (err: any) {
        logger.warn('Failed to store automation dead-letter job in Redis, falling back to memory', {
          deadLetterKey,
          error: err.message,
        });
      }
    }

    memoryDeadLetters.set(deadLetterKey, job);
  }
}

export const automationQueueService = new AutomationQueueService();
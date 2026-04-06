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
}

const JOB_PREFIX = 'automation:job:';
const PROCESSING_PREFIX = 'automation:processing:';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

const memoryJobs = new Map<string, StoredAutomationJob>();
const memoryProcessing = new Set<string>();

function buildJobKey(type: AutomationJobType, uniqueKey: string): string {
  return `${JOB_PREFIX}${type}:${uniqueKey}`;
}

function buildProcessingKey(jobKey: string): string {
  return `${PROCESSING_PREFIX}${jobKey}`;
}

function parseStoredJob(raw: string | StoredAutomationJob): StoredAutomationJob {
  return typeof raw === 'string' ? JSON.parse(raw) as StoredAutomationJob : raw;
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

        logger.debug('Automation job scheduled', { jobKey, executeAt: payload.executeAt });
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
    logger.debug('Automation job scheduled in memory', { jobKey, executeAt: payload.executeAt });
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
        continue;
      }

      try {
        await processor(job);
        await this.deleteJob(key);
        processed += 1;
      } catch (err: any) {
        logger.error('Automation job failed', {
          jobKey: key,
          type: job.type,
          error: err.message,
        });
        await this.releaseJob(key);
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
        return;
      } catch (err: any) {
        logger.warn('Failed to clear automation jobs in Redis', { error: err.message });
      }
    }

    memoryJobs.clear();
    memoryProcessing.clear();
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
}

export const automationQueueService = new AutomationQueueService();
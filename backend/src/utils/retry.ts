import logger from '../config/logger';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

const DEFAULT_OPTS: Required<Omit<RetryOptions, 'shouldRetry' | 'label'>> = {
  maxAttempts: 3,
  baseDelayMs: 400,
  maxDelayMs: 8_000,
};

function isRetryableError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (/401|403|invalid.*key|insufficient_quota|billing/.test(msg)) return false;
  if (/429|rate.?limit|timeout|econnreset|etimedout|503|502|network|fetch failed/.test(msg)) {
    return true;
  }
  return err instanceof TypeError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry async work with exponential backoff. Safe for outbound HTTP and LLM calls.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_OPTS.maxAttempts;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_OPTS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_OPTS.maxDelayMs;
  const label = options.label ?? 'operation';
  const shouldRetry = options.shouldRetry ?? ((err) => isRetryableError(err));

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      if (attempt >= maxAttempts || !shouldRetry(err, attempt)) {
        throw err;
      }
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * 200);
      logger.warn('Retrying after failure', {
        label,
        attempt,
        maxAttempts,
        waitMs: backoff + jitter,
        error: err instanceof Error ? err.message : String(err),
      });
      await delay(backoff + jitter);
    }
  }
  throw lastError;
}

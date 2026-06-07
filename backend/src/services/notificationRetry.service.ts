/**
 * @file notificationRetry.service.ts
 * @description Exponential-backoff retry helper for outbound notification operations.
 *
 * Shared by `notification.engine.ts`, `automation.service.ts`, and any other
 * service that needs resilient, retryable I/O calls.
 *
 * Retry policy (rule §37):
 *  - Max 3 attempts (configurable via `maxAttempts`).
 *  - Exponential backoff: baseDelayMs * 2^attempt + jitter[0..jitterMs].
 *  - Retries on: HTTP 429, 502, 503, 504, and timeout errors.
 *  - Never retries on: HTTP 400, 401, 403, 404, 422.
 *  - On final failure, throws the last caught error — caller decides alerting.
 */

import logger from '../config/logger';

/** Status codes that should never be retried (client-side / auth errors). */
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404, 422]);

/** Status codes that warrant a retry (transient server/rate-limit errors). */
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

export interface RetryOptions {
  /** Maximum number of total attempts (first try + retries). Default: 3. */
  maxAttempts?: number;
  /** Base delay in milliseconds before the first retry. Default: 1000. */
  baseDelayMs?: number;
  /** Maximum random jitter added to each delay. Default: 200. */
  jitterMs?: number;
  /**
   * Optional label for structured log context (e.g. 'visit_reminder_send').
   * Never include PII or secrets.
   */
  label?: string;
}

/** Represents an HTTP-like error with an optional numeric status code. */
export interface RetryableError extends Error {
  statusCode?: number;
  status?: number;
}

/**
 * Returns true when the error is transient and a retry is appropriate.
 * Checks both `statusCode` and `status` properties for compatibility with
 * different HTTP client libraries (node-fetch, axios, got).
 *
 * @param err - The caught error value.
 */
function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  const httpErr = err as RetryableError;
  const code = httpErr.statusCode ?? httpErr.status;

  if (typeof code === 'number') {
    if (NON_RETRYABLE_STATUS_CODES.has(code)) return false;
    if (RETRYABLE_STATUS_CODES.has(code)) return true;
  }

  // Network/timeout errors (no status code) are always transient.
  const message = (err.message ?? '').toLowerCase();
  const isTimeout =
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('enotfound') ||
    message.includes('fetch failed') ||
    message.includes('network');

  return isTimeout;
}

/**
 * Sleeps for `ms` milliseconds.
 *
 * @param ms - Duration in milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Computes the delay before the next retry attempt using exponential backoff
 * with uniform random jitter to avoid thundering-herd when multiple workers
 * retry simultaneously.
 *
 * Formula: `baseDelayMs * 2^attempt + rand(0..jitterMs)`
 *
 * @param attempt - Zero-indexed retry attempt number.
 * @param baseDelayMs - Base delay in milliseconds.
 * @param jitterMs - Maximum random jitter to add.
 */
function computeBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  jitterMs: number,
): number {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * jitterMs);
  return exponential + jitter;
}

/**
 * Executes an async operation with exponential-backoff retries.
 *
 * Only retries on transient errors (429, 502, 503, 504, timeouts).
 * Fails fast on non-retryable errors (400, 401, 403, 404, 422).
 * Throws the last caught error after all attempts are exhausted.
 *
 * @param operation - The async function to retry.
 * @param options - Retry configuration (maxAttempts, delays, label).
 * @returns Resolved value of the operation on success.
 * @throws The last error from the operation after all attempts are exhausted.
 *
 * @example
 * ```typescript
 * await withRetry(
 *   () => sendWhatsApp(phone, message),
 *   { label: 'visit_reminder_whatsapp', maxAttempts: 3 },
 * );
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    jitterMs = 200,
    label = 'operation',
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err: unknown) {
      lastError = err;

      const isLast = attempt === maxAttempts - 1;

      if (isLast) {
        logger.error('withRetry: all attempts exhausted', {
          label,
          attempts: maxAttempts,
          error: err instanceof Error ? err.message : String(err),
        });
        break;
      }

      if (!isTransientError(err)) {
        logger.warn('withRetry: non-transient error, aborting retries', {
          label,
          attempt: attempt + 1,
          error: err instanceof Error ? err.message : String(err),
        });
        break;
      }

      const delay = computeBackoffDelay(attempt, baseDelayMs, jitterMs);
      logger.warn('withRetry: transient error, will retry', {
        label,
        attempt: attempt + 1,
        maxAttempts,
        retryInMs: delay,
        error: err instanceof Error ? err.message : String(err),
      });

      // Track retry activity in ops dashboard — fire-and-forget to avoid
      // circular dependency and to never block the retry itself.
      void import('./opsMetrics.service').then(({ incrementOpsMetric }) => {
        incrementOpsMetric('notification_retry');
      }).catch(() => undefined);

      await sleep(delay);
    }
  }

  throw lastError;
}

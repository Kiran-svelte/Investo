/**
 * OpenAI availability: treat billing/auth as hard down; rate limits and blips are retryable.
 */

import config from '../config';
import logger from '../config/logger';
import { getCircuitBreaker } from '../utils/circuit-breaker';
import { fetchWithTimeout } from '../utils/fetch-with-timeout';

export type OpenAiFailureKind =
  | 'ok'
  | 'missing_key'
  | 'invalid_key'
  | 'insufficient_quota'
  | 'rate_limited'
  | 'server_error'
  | 'network'
  | 'unknown';

export interface OpenAiErrorInfo {
  kind: OpenAiFailureKind;
  status: number;
  message: string;
  retryable: boolean;
}

export interface OpenAiServiceHealth {
  status: 'ok' | 'degraded' | 'down';
  configured: boolean;
  detail: string;
  failureKind?: OpenAiFailureKind;
}

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';

export function openAiApiKey(): string {
  return config.ai.openaiApiKey.trim();
}

export function openAiKeyProblem(): string | null {
  const key = openAiApiKey();
  if (!key) {
    return 'OPENAI_API_KEY is not set on the server.';
  }
  if (!key.startsWith('sk-')) {
    return 'OPENAI_API_KEY format looks invalid.';
  }
  return null;
}

export function parseOpenAiError(status: number, bodyText: string): OpenAiErrorInfo {
  const lower = bodyText.toLowerCase();
  let apiMessage = bodyText;
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string; type?: string; code?: string } };
    apiMessage = parsed.error?.message || bodyText;
    const code = (parsed.error?.code || parsed.error?.type || '').toLowerCase();
    if (
      status === 401
      || code === 'invalid_api_key'
      || /invalid_api_key|incorrect api key/i.test(apiMessage)
    ) {
      return {
        kind: 'invalid_key',
        status,
        message: 'OpenAI API key is invalid or expired.',
        retryable: false,
      };
    }
    if (
      status === 402
      || code === 'insufficient_quota'
      || /insufficient_quota|billing|exceeded your current quota|payment required|out of credits/i.test(apiMessage)
    ) {
      return {
        kind: 'insufficient_quota',
        status,
        message: 'OpenAI credits or billing limit reached. Add credits in OpenAI billing.',
        retryable: false,
      };
    }
  } catch {
    // non-JSON body
  }

  if (status === 401 || /invalid_api_key|incorrect api key/i.test(lower)) {
    return { kind: 'invalid_key', status, message: 'OpenAI API key is invalid or expired.', retryable: false };
  }

  if (
    status === 402
    || status === 403 && /quota|billing|credit/i.test(lower)
    || /insufficient_quota|exceeded your current quota|billing hard limit/i.test(lower)
  ) {
    return {
      kind: 'insufficient_quota',
      status,
      message: 'OpenAI credits or billing limit reached.',
      retryable: false,
    };
  }

  if (status === 429 || /rate limit/i.test(lower)) {
    return {
      kind: 'rate_limited',
      status,
      message: 'OpenAI rate limit — retrying shortly.',
      retryable: true,
    };
  }

  if (status >= 500) {
    return {
      kind: 'server_error',
      status,
      message: `OpenAI server error (${status}).`,
      retryable: true,
    };
  }

  return {
    kind: 'unknown',
    status,
    message: apiMessage.slice(0, 240) || `OpenAI HTTP ${status}`,
    retryable: status >= 500,
  };
}

export function isOpenAiHardDown(kind: OpenAiFailureKind): boolean {
  return kind === 'missing_key' || kind === 'invalid_key' || kind === 'insufficient_quota';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const openAiCircuit = getCircuitBreaker({
  name: 'openai',
  failureThreshold: 5,
  recoveryTimeoutMs: 30_000,
});

export async function fetchOpenAi(
  url: string,
  init: RequestInit,
  options?: { retries?: number; label?: string; timeoutMs?: number },
): Promise<Response> {
  const retries = options?.retries ?? 2;
  const timeoutMs = options?.timeoutMs ?? 30_000;

  return openAiCircuit.execute(async () => {
    let lastError: OpenAiErrorInfo | null = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetchWithTimeout(url, { ...init, timeoutMs });
        if (response.ok) {
          return response;
        }

        const bodyText = await response.text();
        const info = parseOpenAiError(response.status, bodyText);
        lastError = info;

        if (!info.retryable || attempt >= retries || isOpenAiHardDown(info.kind)) {
          throw new Error(info.message);
        }

        const backoffMs = info.kind === 'rate_limited' ? 1500 * (attempt + 1) : 800 * (attempt + 1);
        logger.warn('OpenAI request retry', {
          label: options?.label,
          attempt: attempt + 1,
          status: response.status,
          kind: info.kind,
          backoffMs,
        });
        await sleep(backoffMs);
      } catch (err: unknown) {
        if (err instanceof Error && lastError && isOpenAiHardDown(lastError.kind)) {
          throw err;
        }
        if (attempt >= retries) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(message);
        }
        logger.warn('OpenAI network retry', {
          label: options?.label,
          attempt: attempt + 1,
          error: String(err),
        });
        await sleep(1000 * (attempt + 1));
      }
    }

    throw new Error(lastError?.message || 'OpenAI request failed');
  });
}

export async function getOpenAiServiceHealth(): Promise<OpenAiServiceHealth> {
  const keyProblem = openAiKeyProblem();
  if (keyProblem) {
    return {
      status: 'down',
      configured: false,
      detail: keyProblem,
      failureKind: 'missing_key',
    };
  }

  try {
    const response = await fetchOpenAi(
      OPENAI_EMBEDDINGS_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openAiApiKey()}`,
        },
        body: JSON.stringify({
          model: config.ai.embeddingModel || process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
          input: 'health',
        }),
      },
      { retries: 1, label: 'health_embeddings' },
    );

    if (response.ok) {
      return {
        status: 'ok',
        configured: true,
        detail: 'OpenAI API key valid and embeddings reachable.',
        failureKind: 'ok',
      };
    }

    const bodyText = await response.text();
    const info = parseOpenAiError(response.status, bodyText);
    return {
      status: isOpenAiHardDown(info.kind) ? 'down' : 'degraded',
      configured: true,
      detail: info.message,
      failureKind: info.kind,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const kind: OpenAiFailureKind = /credit|quota|billing/i.test(message)
      ? 'insufficient_quota'
      : /invalid|expired|api key/i.test(message)
        ? 'invalid_key'
        : /rate limit/i.test(message)
          ? 'rate_limited'
          : 'network';

    return {
      status: isOpenAiHardDown(kind) ? 'down' : 'degraded',
      configured: true,
      detail: message,
      failureKind: kind,
    };
  }
}

export { OPENAI_CHAT_URL, OPENAI_EMBEDDINGS_URL };

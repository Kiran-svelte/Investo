import axios from 'axios';

type ApiErrorPayload = {
  error?: string | { message?: string; code?: string };
  message?: string;
};

/**
 * Extracts a user-facing error string from an API or network failure.
 * Handles nested `{ error: { message } }` (bulk import) and flat `{ error: string }`.
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const payload = err.response?.data as ApiErrorPayload | undefined;

    if (payload?.error && typeof payload.error === 'object' && payload.error.message) {
      return payload.error.message;
    }

    if (typeof payload?.error === 'string' && payload.error.trim()) {
      return payload.error;
    }

    if (payload?.message?.trim()) {
      return payload.message;
    }

    const rawMessage = err.message?.trim();
    if (rawMessage) {
      if (/^Request failed with status code \d+$/.test(rawMessage)) {
        if (err.response?.status === 400) {
          return fallback;
        }
      }
      return rawMessage;
    }
  }

  if (err instanceof Error && err.message.trim()) {
    const trimmed = err.message.trim();
    if (trimmed.startsWith('[') && trimmed.includes('"code"')) {
      return 'Some rows have extra columns or malformed cells (often a trailing comma after the last value). Fix the spreadsheet and re-upload.';
    }
    return trimmed;
  }

  return fallback;
}

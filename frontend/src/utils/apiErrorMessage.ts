import axios from 'axios';

type ApiErrorPayload = {
  error?: string | { message?: string; code?: string };
  message?: string;
};

function extractFromPayload(payload: ApiErrorPayload | undefined): string | null {
  if (!payload) return null;

  if (payload.error && typeof payload.error === 'object' && payload.error.message) {
    return payload.error.message;
  }

  if (typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error;
  }

  if (payload.message?.trim()) {
    return payload.message;
  }

  return null;
}

/**
 * Extracts a user-facing error string from an API or network failure.
 * Handles nested `{ error: { message } }` (bulk import) and flat `{ error: string }`.
 *
 * Works for real AxiosErrors and for any error-shaped object carrying
 * `response.data` (e.g. wrapped/re-thrown errors), so the UI never silently
 * falls back to a generic message when the server provided a reason.
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const fromPayload = extractFromPayload(err.response?.data as ApiErrorPayload | undefined);
    if (fromPayload) return fromPayload;

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

  if (err && typeof err === 'object' && 'response' in err) {
    const response = (err as { response?: { data?: ApiErrorPayload } }).response;
    const fromPayload = extractFromPayload(response?.data);
    if (fromPayload) return fromPayload;
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

import { Request, Response, NextFunction } from 'express';
import sanitizeHtml from 'sanitize-html';

const SKIP_PATH_PREFIXES = ['/api/webhook', '/api/greenapi/webhook'];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: 'discard',
};

function shouldSkipSanitization(path: string): boolean {
  return SKIP_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function sanitizeStringValue(value: string): string {
  return sanitizeHtml(value, SANITIZE_OPTIONS).trim();
}

export function sanitizeRequestBody(value: unknown, depth = 0): unknown {
  if (depth > 12 || value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return sanitizeStringValue(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRequestBody(item, depth + 1));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      result[key] = sanitizeRequestBody(nested, depth + 1);
    }
    return result;
  }

  return value;
}

/**
 * Recursively strip HTML/script content from JSON body string fields.
 * Skips webhook routes that may carry provider-formatted payloads.
 */
export function sanitizeInput(req: Request, _res: Response, next: NextFunction): void {
  if (!req.body || typeof req.body !== 'object') {
    next();
    return;
  }

  const path = req.originalUrl.split('?')[0];
  if (shouldSkipSanitization(path)) {
    next();
    return;
  }

  req.body = sanitizeRequestBody(req.body);
  next();
}

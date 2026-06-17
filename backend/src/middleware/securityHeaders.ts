import type { RequestHandler } from 'express';
import helmet from 'helmet';

import config from '../config';

export function buildSecurityHeadersMiddleware(): RequestHandler {
  const strict = config.features.securityHeadersStrict !== false;

  return helmet({
    contentSecurityPolicy: strict
      ? {
          useDefaults: true,
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'", 'https:'],
            frameAncestors: ["'none'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: strict ? { policy: 'require-corp' } : false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: strict
      ? {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true,
        }
      : false,
  });
}

export const securityHeadersMiddleware = buildSecurityHeadersMiddleware();

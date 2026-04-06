/**
 * Rate Limiting Middleware
 * README Section 14.4: Rate limiting: 100 requests/minute per user, 1000/minute per company
 */

import { Request, Response, NextFunction } from 'express';
import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import config from '../config';

// In-memory store for company-level rate limiting
// In production, use Redis for distributed rate limiting
const companyRequestCounts: Map<string, { count: number; resetTime: number }> = new Map();

const WINDOW_MS = 60 * 1000; // 1 minute

/**
 * Per-user rate limiter (100 requests/minute)
 */
export const userRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: WINDOW_MS,
  max: config.rateLimit.perUser,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    // Use user ID if authenticated, otherwise IP
    const user = (req as any).user;
    if (user?.id) {
      return `user:${user.id}`;
    }
    return `ip:${req.ip || 'unknown'}`;
  },
  message: { 
    error: 'Too many requests. Limit: 100 requests per minute per user.',
    retryAfter: 60
  },
});

/**
 * Per-company rate limiter (1000 requests/minute)
 * Middleware that tracks requests per company_id
 */
export const companyRateLimiter = (req: Request, res: Response, next: NextFunction): void => {
  const user = (req as any).user;
  
  // Skip if no authenticated user or no company
  if (!user?.company_id) {
    return next();
  }

  const companyId = user.company_id;
  const now = Date.now();
  const companyLimit = config.rateLimit.perCompany;

  // Get or initialize company tracking
  let tracking = companyRequestCounts.get(companyId);
  
  if (!tracking || now > tracking.resetTime) {
    // Reset window
    tracking = { count: 0, resetTime: now + WINDOW_MS };
    companyRequestCounts.set(companyId, tracking);
  }

  tracking.count++;

  // Set rate limit headers
  res.setHeader('X-RateLimit-Company-Limit', companyLimit);
  res.setHeader('X-RateLimit-Company-Remaining', Math.max(0, companyLimit - tracking.count));
  res.setHeader('X-RateLimit-Company-Reset', Math.ceil(tracking.resetTime / 1000));

  if (tracking.count > companyLimit) {
    res.status(429).json({
      error: 'Company rate limit exceeded. Limit: 1000 requests per minute per company.',
      retryAfter: Math.ceil((tracking.resetTime - now) / 1000)
    });
    return;
  }

  next();
};

/**
 * Strict rate limiter for sensitive endpoints (login, password reset)
 * 5 requests per minute per IP
 */
export const sensitiveRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: WINDOW_MS,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { 
    error: 'Too many attempts. Please try again in a minute.',
    retryAfter: 60
  },
});

/**
 * Export endpoints rate limiter (prevents bulk data exfiltration)
 * 10 exports per hour per user
 */
export const exportRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  keyGenerator: (req: Request): string => {
    const user = (req as any).user;
    return user?.id ? `export:${user.id}` : `export:ip:${req.ip || 'unknown'}`;
  },
  message: { 
    error: 'Export limit reached. Maximum 10 exports per hour.',
    retryAfter: 3600
  },
});

// Cleanup old entries periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of companyRequestCounts.entries()) {
    if (now > value.resetTime) {
      companyRequestCounts.delete(key);
    }
  }
}, 5 * 60 * 1000);

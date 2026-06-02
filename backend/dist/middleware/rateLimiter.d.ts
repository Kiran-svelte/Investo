/**
 * Rate Limiting Middleware
 * README Section 14.4: Rate limiting: 100 requests/minute per user, 1000/minute per company
 */
import { Request, Response, NextFunction } from 'express';
import { RateLimitRequestHandler } from 'express-rate-limit';
/**
 * Per-user rate limiter (100 requests/minute)
 */
export declare const userRateLimiter: RateLimitRequestHandler;
/**
 * Per-company rate limiter (1000 requests/minute)
 * Middleware that tracks requests per company_id
 */
export declare const companyRateLimiter: (req: Request, res: Response, next: NextFunction) => void;
/**
 * Strict rate limiter for sensitive endpoints (login, password reset)
 * 5 requests per minute per IP
 */
export declare const sensitiveRateLimiter: RateLimitRequestHandler;
/**
 * Export endpoints rate limiter (prevents bulk data exfiltration)
 * 10 exports per hour per user
 */
export declare const exportRateLimiter: RateLimitRequestHandler;
//# sourceMappingURL=rateLimiter.d.ts.map
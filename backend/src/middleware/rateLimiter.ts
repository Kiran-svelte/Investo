/**

 * Rate Limiting Middleware

 * README Section 14.4: Rate limiting: 100 requests/minute per user, 1000/minute per company

 */



import { Request, Response, NextFunction } from 'express';

import rateLimit, { RateLimitRequestHandler, Options } from 'express-rate-limit';

import config from '../config';

import { cacheIncr } from '../config/redis';



// In-memory fallback when Redis is unavailable

const companyRequestCounts: Map<string, { count: number; resetTime: number }> = new Map();

const companyAiRequestCounts: Map<string, { count: number; resetTime: number }> = new Map();

const whatsappAiRequestCounts: Map<string, { count: number; resetTime: number }> = new Map();



const WINDOW_MS = 60 * 1000; // 1 minute

const WINDOW_SEC = 60;



export function buildLimitMessage(limit: number, scope: string): { error: string; retryAfter: number } {

  return {

    error: `Too many requests. Limit: ${limit} requests per minute ${scope}.`,

    retryAfter: 60,

  };

}



function sendRateLimitResponse(

  res: Response,

  statusCode: number,

  body: { error: string; retryAfter: number },

): void {

  res.setHeader('Retry-After', String(body.retryAfter));

  res.status(statusCode).json(body);

}



function rateLimitHandler(

  req: Request,

  res: Response,

  _next: NextFunction,

  options: Options,

): void {

  const retryAfter =

    typeof options.message === 'object' && options.message && 'retryAfter' in options.message

      ? Number((options.message as { retryAfter: number }).retryAfter)

      : 60;

  const error =

    typeof options.message === 'object' && options.message && 'error' in options.message

      ? String((options.message as { error: string }).error)

      : 'Too many requests.';

  sendRateLimitResponse(res, 429, { error, retryAfter });

}



/**

 * Per-user rate limiter (default 100 requests/minute)

 */

export const userRateLimiter: RateLimitRequestHandler = rateLimit({

  windowMs: WINDOW_MS,

  max: config.rateLimit.perUser,

  standardHeaders: true,

  legacyHeaders: false,

  handler: rateLimitHandler,

  keyGenerator: (req: Request): string => {

    const user = (req as any).user;

    if (user?.id) {

      return `user:${user.id}`;

    }

    return `ip:${req.ip || 'unknown'}`;

  },

  message: () => buildLimitMessage(config.rateLimit.perUser, 'per user'),

});



async function incrementCompanyLimit(

  companyId: string,

  map: Map<string, { count: number; resetTime: number }>,

  redisKeyPrefix: string,

): Promise<{ count: number; resetTime: number }> {

  const redisKey = `${redisKeyPrefix}:${companyId}`;

  try {

    const count = await cacheIncr(redisKey, WINDOW_SEC);

    return { count, resetTime: Date.now() + WINDOW_MS };

  } catch {

    const now = Date.now();

    let tracking = map.get(companyId);

    if (!tracking || now > tracking.resetTime) {

      tracking = { count: 0, resetTime: now + WINDOW_MS };

      map.set(companyId, tracking);

    }

    tracking.count++;

    return tracking;

  }

}



/**

 * Per-company rate limiter (default 1000 requests/minute). Uses Redis when configured.

 */

export const companyRateLimiter = async (

  req: Request,

  res: Response,

  next: NextFunction,

): Promise<void> => {

  const user = (req as any).user;



  if (!user?.company_id) {

    next();

    return;

  }



  const companyId = user.company_id;

  const companyLimit = config.rateLimit.perCompany;

  const tracking = await incrementCompanyLimit(companyId, companyRequestCounts, 'rl:company');



  res.setHeader('X-RateLimit-Company-Limit', companyLimit);

  res.setHeader('X-RateLimit-Company-Remaining', Math.max(0, companyLimit - tracking.count));

  res.setHeader('X-RateLimit-Company-Reset', Math.ceil(tracking.resetTime / 1000));



  if (tracking.count > companyLimit) {

    sendRateLimitResponse(res, 429, buildLimitMessage(companyLimit, 'per company'));

    return;

  }



  next();

};



/**

 * Limits OpenAI-heavy routes (property import publish, bulk AI) per company.

 */

export const companyAiRateLimiter = async (

  req: Request,

  res: Response,

  next: NextFunction,

): Promise<void> => {

  const user = (req as any).user;



  if (!user?.company_id) {

    next();

    return;

  }



  const companyId = user.company_id;

  const limit = config.rateLimit.perCompanyAi;

  const tracking = await incrementCompanyLimit(companyId, companyAiRequestCounts, 'rl:company:ai');



  res.setHeader('X-RateLimit-AI-Company-Limit', limit);

  res.setHeader('X-RateLimit-AI-Company-Remaining', Math.max(0, limit - tracking.count));



  if (tracking.count > limit) {

    sendRateLimitResponse(res, 429, buildLimitMessage(limit, 'per company for AI operations'));

    return;

  }



  next();

};



/**

 * Per-user cap on AI-heavy endpoints (publish, re-extract).

 */

export const userAiRateLimiter: RateLimitRequestHandler = rateLimit({

  windowMs: WINDOW_MS,

  max: config.rateLimit.perUserAi,

  standardHeaders: true,

  legacyHeaders: false,

  handler: rateLimitHandler,

  keyGenerator: (req: Request): string => {

    const user = (req as any).user;

    return user?.id ? `ai:user:${user.id}` : `ai:ip:${req.ip || 'unknown'}`;

  },

  message: () => buildLimitMessage(config.rateLimit.perUserAi, 'per user for AI operations'),

});



/**

 * Strict rate limiter for sensitive endpoints (login, password reset)

 */

export const sensitiveRateLimiter: RateLimitRequestHandler = rateLimit({

  windowMs: WINDOW_MS,

  max: config.rateLimit.sensitivePerMinute,

  standardHeaders: true,

  legacyHeaders: false,

  handler: rateLimitHandler,

  message: {

    error: 'Too many attempts. Please try again in a minute.',

    retryAfter: 60,

  },

});



/**

 * WhatsApp webhook ingress (Meta retries if slow; allow higher throughput)

 */

export const webhookRateLimiter: RateLimitRequestHandler = rateLimit({

  windowMs: WINDOW_MS,

  max: config.rateLimit.webhookPerMinute,

  standardHeaders: true,

  legacyHeaders: false,

  handler: rateLimitHandler,

  keyGenerator: (req: Request): string => `webhook:${req.ip || 'unknown'}`,

  message: {

    error: 'Webhook rate limit exceeded.',

    retryAfter: 60,

  },

});



/**

 * WhatsApp AI copilot / buyer AI — per sender phone + company (from webhook body when available).

 */

export const whatsappAiRateLimiter = async (

  req: Request,

  res: Response,

  next: NextFunction,

): Promise<void> => {

  const body = req.body as Record<string, unknown> | undefined;

  const companyId =

    (typeof body?.companyId === 'string' && body.companyId)

    || (req.headers['x-company-id'] as string)

    || 'unknown';

  const sender =

    extractWebhookSenderPhone(body)

    || req.ip

    || 'unknown';

  const key = `${companyId}:${sender}`;

  const limit = config.rateLimit.whatsappAiPerMinute;



  const tracking = await incrementCompanyLimit(key, whatsappAiRequestCounts, 'rl:whatsapp:ai');



  if (tracking.count > limit) {

    sendRateLimitResponse(res, 429, buildLimitMessage(limit, 'per WhatsApp sender for AI'));

    return;

  }



  next();

};



function extractWebhookSenderPhone(body: Record<string, unknown> | undefined): string | null {

  if (!body || typeof body !== 'object') return null;

  const entry = Array.isArray((body as any).entry) ? (body as any).entry[0] : null;

  const change = entry?.changes?.[0];

  const from = change?.value?.messages?.[0]?.from;

  if (typeof from === 'string' && from) return from;

  const sender = (body as any).senderData?.sender ?? (body as any).sender;

  if (typeof sender === 'string' && sender) return sender.replace(/\D/g, '');

  return null;

}



/**

 * Export endpoints rate limiter (prevents bulk data exfiltration)

 * 10 exports per hour per user

 */

export const exportRateLimiter: RateLimitRequestHandler = rateLimit({

  windowMs: 60 * 60 * 1000,

  max: 10,

  handler: rateLimitHandler,

  keyGenerator: (req: Request): string => {

    const user = (req as any).user;

    return user?.id ? `export:${user.id}` : `export:ip:${req.ip || 'unknown'}`;

  },

  message: {

    error: 'Export limit reached. Maximum 10 exports per hour.',

    retryAfter: 3600,

  },

});



function cleanupMap(map: Map<string, { count: number; resetTime: number }>, now: number): void {

  for (const [key, value] of map.entries()) {

    if (now > value.resetTime) {

      map.delete(key);

    }

  }

}



const cleanupInterval = setInterval(() => {

  const now = Date.now();

  cleanupMap(companyRequestCounts, now);

  cleanupMap(companyAiRequestCounts, now);

  cleanupMap(whatsappAiRequestCounts, now);

}, 5 * 60 * 1000);



cleanupInterval.unref?.();



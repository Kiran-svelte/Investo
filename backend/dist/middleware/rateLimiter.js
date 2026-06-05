"use strict";
/**

 * Rate Limiting Middleware

 * README Section 14.4: Rate limiting: 100 requests/minute per user, 1000/minute per company

 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportRateLimiter = exports.whatsappAiRateLimiter = exports.webhookRateLimiter = exports.sensitiveRateLimiter = exports.userAiRateLimiter = exports.companyAiRateLimiter = exports.companyRateLimiter = exports.userRateLimiter = void 0;
exports.buildLimitMessage = buildLimitMessage;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const config_1 = __importDefault(require("../config"));
const redis_1 = require("../config/redis");
// In-memory fallback when Redis is unavailable
const companyRequestCounts = new Map();
const companyAiRequestCounts = new Map();
const whatsappAiRequestCounts = new Map();
const WINDOW_MS = 60 * 1000; // 1 minute
const WINDOW_SEC = 60;
function buildLimitMessage(limit, scope) {
    return {
        error: `Too many requests. Limit: ${limit} requests per minute ${scope}.`,
        retryAfter: 60,
    };
}
function sendRateLimitResponse(res, statusCode, body) {
    res.setHeader('Retry-After', String(body.retryAfter));
    res.status(statusCode).json(body);
}
function rateLimitHandler(req, res, _next, options) {
    const retryAfter = typeof options.message === 'object' && options.message && 'retryAfter' in options.message
        ? Number(options.message.retryAfter)
        : 60;
    const error = typeof options.message === 'object' && options.message && 'error' in options.message
        ? String(options.message.error)
        : 'Too many requests.';
    sendRateLimitResponse(res, 429, { error, retryAfter });
}
/**

 * Per-user rate limiter (default 100 requests/minute)

 */
exports.userRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: WINDOW_MS,
    max: config_1.default.rateLimit.perUser,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    keyGenerator: (req) => {
        const user = req.user;
        if (user?.id) {
            return `user:${user.id}`;
        }
        return `ip:${req.ip || 'unknown'}`;
    },
    message: () => buildLimitMessage(config_1.default.rateLimit.perUser, 'per user'),
});
async function incrementCompanyLimit(companyId, map, redisKeyPrefix) {
    const redisKey = `${redisKeyPrefix}:${companyId}`;
    try {
        const count = await (0, redis_1.cacheIncr)(redisKey, WINDOW_SEC);
        return { count, resetTime: Date.now() + WINDOW_MS };
    }
    catch {
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
const companyRateLimiter = async (req, res, next) => {
    const user = req.user;
    if (!user?.company_id) {
        next();
        return;
    }
    const companyId = user.company_id;
    const companyLimit = config_1.default.rateLimit.perCompany;
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
exports.companyRateLimiter = companyRateLimiter;
/**

 * Limits OpenAI-heavy routes (property import publish, bulk AI) per company.

 */
const companyAiRateLimiter = async (req, res, next) => {
    const user = req.user;
    if (!user?.company_id) {
        next();
        return;
    }
    const companyId = user.company_id;
    const limit = config_1.default.rateLimit.perCompanyAi;
    const tracking = await incrementCompanyLimit(companyId, companyAiRequestCounts, 'rl:company:ai');
    res.setHeader('X-RateLimit-AI-Company-Limit', limit);
    res.setHeader('X-RateLimit-AI-Company-Remaining', Math.max(0, limit - tracking.count));
    if (tracking.count > limit) {
        sendRateLimitResponse(res, 429, buildLimitMessage(limit, 'per company for AI operations'));
        return;
    }
    next();
};
exports.companyAiRateLimiter = companyAiRateLimiter;
/**

 * Per-user cap on AI-heavy endpoints (publish, re-extract).

 */
exports.userAiRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: WINDOW_MS,
    max: config_1.default.rateLimit.perUserAi,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    keyGenerator: (req) => {
        const user = req.user;
        return user?.id ? `ai:user:${user.id}` : `ai:ip:${req.ip || 'unknown'}`;
    },
    message: () => buildLimitMessage(config_1.default.rateLimit.perUserAi, 'per user for AI operations'),
});
/**

 * Strict rate limiter for sensitive endpoints (login, password reset)

 */
exports.sensitiveRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: WINDOW_MS,
    max: config_1.default.rateLimit.sensitivePerMinute,
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
exports.webhookRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: WINDOW_MS,
    max: config_1.default.rateLimit.webhookPerMinute,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    keyGenerator: (req) => `webhook:${req.ip || 'unknown'}`,
    message: {
        error: 'Webhook rate limit exceeded.',
        retryAfter: 60,
    },
});
/**

 * WhatsApp AI copilot / buyer AI — per sender phone + company (from webhook body when available).

 */
const whatsappAiRateLimiter = async (req, res, next) => {
    const body = req.body;
    const companyId = (typeof body?.companyId === 'string' && body.companyId)
        || req.headers['x-company-id']
        || 'unknown';
    const sender = extractWebhookSenderPhone(body)
        || req.ip
        || 'unknown';
    const key = `${companyId}:${sender}`;
    const limit = config_1.default.rateLimit.whatsappAiPerMinute;
    const tracking = await incrementCompanyLimit(key, whatsappAiRequestCounts, 'rl:whatsapp:ai');
    if (tracking.count > limit) {
        sendRateLimitResponse(res, 429, buildLimitMessage(limit, 'per WhatsApp sender for AI'));
        return;
    }
    next();
};
exports.whatsappAiRateLimiter = whatsappAiRateLimiter;
function extractWebhookSenderPhone(body) {
    if (!body || typeof body !== 'object')
        return null;
    const entry = Array.isArray(body.entry) ? body.entry[0] : null;
    const change = entry?.changes?.[0];
    const from = change?.value?.messages?.[0]?.from;
    if (typeof from === 'string' && from)
        return from;
    const sender = body.senderData?.sender ?? body.sender;
    if (typeof sender === 'string' && sender)
        return sender.replace(/\D/g, '');
    return null;
}
/**

 * Export endpoints rate limiter (prevents bulk data exfiltration)

 * 10 exports per hour per user

 */
exports.exportRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000,
    max: 10,
    handler: rateLimitHandler,
    keyGenerator: (req) => {
        const user = req.user;
        return user?.id ? `export:${user.id}` : `export:ip:${req.ip || 'unknown'}`;
    },
    message: {
        error: 'Export limit reached. Maximum 10 exports per hour.',
        retryAfter: 3600,
    },
});
function cleanupMap(map, now) {
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

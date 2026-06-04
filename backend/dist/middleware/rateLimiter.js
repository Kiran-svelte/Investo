"use strict";
/**
 * Rate Limiting Middleware
 * README Section 14.4: Rate limiting: 100 requests/minute per user, 1000/minute per company
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportRateLimiter = exports.webhookRateLimiter = exports.sensitiveRateLimiter = exports.userAiRateLimiter = exports.companyAiRateLimiter = exports.companyRateLimiter = exports.userRateLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const config_1 = __importDefault(require("../config"));
// In-memory store for company-level rate limiting
// In production, use Redis for distributed rate limiting
const companyRequestCounts = new Map();
const companyAiRequestCounts = new Map();
const WINDOW_MS = 60 * 1000; // 1 minute
function buildLimitMessage(limit, scope) {
    return {
        error: `Too many requests. Limit: ${limit} requests per minute ${scope}.`,
        retryAfter: 60,
    };
}
/**
 * Per-user rate limiter (default 100 requests/minute)
 */
exports.userRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: WINDOW_MS,
    max: config_1.default.rateLimit.perUser,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const user = req.user;
        if (user?.id) {
            return `user:${user.id}`;
        }
        return `ip:${req.ip || 'unknown'}`;
    },
    message: () => buildLimitMessage(config_1.default.rateLimit.perUser, 'per user'),
});
/**
 * Per-company rate limiter (default 1000 requests/minute)
 */
const companyRateLimiter = (req, res, next) => {
    const user = req.user;
    if (!user?.company_id) {
        return next();
    }
    const companyId = user.company_id;
    const now = Date.now();
    const companyLimit = config_1.default.rateLimit.perCompany;
    let tracking = companyRequestCounts.get(companyId);
    if (!tracking || now > tracking.resetTime) {
        tracking = { count: 0, resetTime: now + WINDOW_MS };
        companyRequestCounts.set(companyId, tracking);
    }
    tracking.count++;
    res.setHeader('X-RateLimit-Company-Limit', companyLimit);
    res.setHeader('X-RateLimit-Company-Remaining', Math.max(0, companyLimit - tracking.count));
    res.setHeader('X-RateLimit-Company-Reset', Math.ceil(tracking.resetTime / 1000));
    if (tracking.count > companyLimit) {
        res.status(429).json(buildLimitMessage(companyLimit, 'per company'));
        return;
    }
    next();
};
exports.companyRateLimiter = companyRateLimiter;
/**
 * Limits OpenAI-heavy routes (property import publish, bulk AI) per company.
 */
const companyAiRateLimiter = (req, res, next) => {
    const user = req.user;
    if (!user?.company_id) {
        return next();
    }
    const companyId = user.company_id;
    const now = Date.now();
    const limit = config_1.default.rateLimit.perCompanyAi;
    let tracking = companyAiRequestCounts.get(companyId);
    if (!tracking || now > tracking.resetTime) {
        tracking = { count: 0, resetTime: now + WINDOW_MS };
        companyAiRequestCounts.set(companyId, tracking);
    }
    tracking.count++;
    res.setHeader('X-RateLimit-AI-Company-Limit', limit);
    res.setHeader('X-RateLimit-AI-Company-Remaining', Math.max(0, limit - tracking.count));
    if (tracking.count > limit) {
        res.status(429).json(buildLimitMessage(limit, 'per company for AI operations'));
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
    keyGenerator: (req) => `webhook:${req.ip || 'unknown'}`,
    message: {
        error: 'Webhook rate limit exceeded.',
        retryAfter: 60,
    },
});
/**
 * Export endpoints rate limiter (prevents bulk data exfiltration)
 * 10 exports per hour per user
 */
exports.exportRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000,
    max: 10,
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
}, 5 * 60 * 1000);
cleanupInterval.unref?.();

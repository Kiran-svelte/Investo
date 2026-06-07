"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsappIpWhitelist = whatsappIpWhitelist;
exports.isMetaIp = isMetaIp;
exports.getMetaIpRanges = getMetaIpRanges;
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../config/logger"));
/**
 * Meta's official webhook IP ranges as documented by Facebook/Meta.
 * Source: https://developers.facebook.com/docs/whatsapp/webhooks/setup
 */
const META_IP_RANGES = [
    '173.252.96.0/19',
    '66.220.144.0/20',
    '69.63.176.0/20',
    '69.171.224.0/19',
    '74.119.76.0/22',
    '103.4.96.0/22',
    '157.240.0.0/16',
    '173.252.64.0/18',
    '179.60.192.0/22',
    '185.60.216.0/22',
    '204.15.20.0/22',
    '31.13.24.0/21',
    '31.13.64.0/18',
    '45.64.40.0/22',
];
/**
 * Convert IP address to a 32-bit number (IPv4 only)
 */
function ipToLong(ip) {
    const parts = ip.split('.');
    if (parts.length !== 4)
        return -1;
    let result = 0;
    for (let i = 0; i < 4; i++) {
        result = (result << 8) + parseInt(parts[i], 10);
    }
    return result >>> 0;
}
/**
 * Normalize incoming IP values from proxy headers/Express.
 */
function normalizeIp(rawIp) {
    if (!rawIp)
        return 'unknown';
    let ip = rawIp.trim();
    // IPv6 mapped IPv4, e.g. ::ffff:127.0.0.1
    if (ip.startsWith('::ffff:')) {
        ip = ip.substring(7);
    }
    if (ip === '::1') {
        return '127.0.0.1';
    }
    // Strip IPv4 port if present, e.g. 127.0.0.1:54321
    if (ip.includes('.') && ip.includes(':')) {
        const maybeIpv4 = ip.split(':')[0];
        if (maybeIpv4.split('.').length === 4) {
            ip = maybeIpv4;
        }
    }
    return ip;
}
function isPrivateOrLocalIpv4(ip) {
    const parts = ip.split('.').map((part) => parseInt(part, 10));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
        return false;
    }
    const [a, b] = parts;
    return (a === 10 ||
        a === 127 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168));
}
/**
 * Check if an IP is within a CIDR range
 */
function isIpInCidr(ip, cidr) {
    const [range, bits] = cidr.split('/');
    if (!bits)
        return ip === range;
    const mask = ~(2 ** (32 - parseInt(bits, 10)) - 1);
    const ipLong = ipToLong(ip);
    const rangeLong = ipToLong(range);
    return (ipLong & mask) === (rangeLong & mask);
}
/**
 * Check if IP is in any of the Meta ranges
 */
function checkIpInRanges(ip, ranges) {
    for (const range of ranges) {
        if (isIpInCidr(ip, range)) {
            return true;
        }
    }
    return false;
}
/**
 * Check if IP whitelist is enabled
 */
function isWhitelistEnabled() {
    // Skip in development mode unless explicitly enabled
    if (config_1.default.env === 'development' && !config_1.default.whatsapp.ipWhitelistEnabled) {
        return false;
    }
    // Bypass must never be used in production.
    if (config_1.default.whatsapp.skipIpWhitelist === true) {
        if (config_1.default.env === 'production') {
            logger_1.default.error('SKIP_IP_WHITELIST=true is forbidden in production — IP whitelist will be enforced');
            return true; // enforce whitelist despite the env var
        }
        logger_1.default.warn('IP whitelist bypassed via SKIP_IP_WHITELIST=true (non-production only)');
        return false;
    }
    return config_1.default.whatsapp.ipWhitelistEnabled ?? true;
}
function shouldAllowNonProdLocalIp(clientIp) {
    if (config_1.default.env === 'production') {
        return false;
    }
    return clientIp === '127.0.0.1' || isPrivateOrLocalIpv4(clientIp);
}
/**
 * Extract client IP from request (handles proxies)
 */
function getClientIp(req) {
    // Check X-Forwarded-For header first (common with reverse proxies)
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
        // Take the first IP in the chain (original client)
        const ips = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)
            .split(',')
            .map((ip) => ip.trim());
        return normalizeIp(ips[0]);
    }
    // Fall back to req.ip (Express's default)
    return normalizeIp(req.ip || req.socket.remoteAddress || 'unknown');
}
/**
 * IP Whitelist Middleware for Meta Webhooks
 *
 * Validates that incoming requests originate from Meta's documented IP ranges.
 * This prevents spoofing attacks where malicious actors try to fake WhatsApp webhooks.
 */
function whatsappIpWhitelist(req, res, next) {
    if (!isWhitelistEnabled()) {
        next();
        return;
    }
    const clientIp = getClientIp(req);
    if (shouldAllowNonProdLocalIp(clientIp)) {
        logger_1.default.info('Allowing WhatsApp webhook from local/private IP in non-production', {
            clientIp,
            env: config_1.default.env,
            path: req.path,
            method: req.method,
        });
        next();
        return;
    }
    const isAllowed = checkIpInRanges(clientIp, META_IP_RANGES);
    if (!isAllowed) {
        logger_1.default.warn('Blocked non-Meta IP from accessing WhatsApp webhook', {
            clientIp,
            userAgent: req.headers['user-agent'],
            path: req.path,
            method: req.method,
            forwardedFor: req.headers['x-forwarded-for'],
        });
        res.status(403).json({
            error: 'Access denied',
            message: `Request blocked: Invalid source IP (${clientIp}) for WhatsApp webhook`,
        });
        return;
    }
    logger_1.default.debug('WhatsApp webhook request from Meta IP', { clientIp });
    next();
}
/**
 * Check if a specific IP is in Meta's whitelist
 */
function isMetaIp(ip) {
    return checkIpInRanges(ip, META_IP_RANGES);
}
/**
 * Get all Meta IP ranges (for documentation/display)
 */
function getMetaIpRanges() {
    return [...META_IP_RANGES];
}

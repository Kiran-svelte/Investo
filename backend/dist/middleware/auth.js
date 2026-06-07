"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const jwks_rsa_1 = __importDefault(require("jwks-rsa"));
const config_1 = __importDefault(require("../config"));
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const redis_1 = require("../config/redis");
const AUTH_CACHE_TTL_SECONDS = 300; // 5 minutes
const neonJwksUri = config_1.default.neonAuth.url ? `${config_1.default.neonAuth.url}/.well-known/jwks.json` : '';
const neonJwksClient = neonJwksUri
    ? (0, jwks_rsa_1.default)({
        jwksUri: neonJwksUri,
        cache: true,
        rateLimit: true,
    })
    : null;
function getKey(header, callback) {
    if (!neonJwksClient) {
        callback(new Error('Neon Auth URL not configured'));
        return;
    }
    if (!header.kid) {
        callback(new Error('Missing key id in JWT header'));
        return;
    }
    neonJwksClient.getSigningKey(header.kid, (err, key) => {
        if (err || !key) {
            callback(err || new Error('No key found'));
            return;
        }
        callback(null, key.getPublicKey());
    });
}
function verifyLegacyToken(token) {
    try {
        return jsonwebtoken_1.default.verify(token, config_1.default.jwt.secret);
    }
    catch {
        return null;
    }
}
async function verifyNeonToken(token) {
    if (!neonJwksClient) {
        return null;
    }
    return await new Promise((resolve) => {
        jsonwebtoken_1.default.verify(token, getKey, (err, decodedPayload) => {
            if (err) {
                resolve(null);
                return;
            }
            resolve((decodedPayload || null));
        });
    });
}
async function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    const token = authHeader.split(' ')[1];
    // Use a short hash of the token as the cache key (tokens are large and sensitive)
    const tokenCacheKey = `auth:user:${Buffer.from(token).toString('base64').slice(-40)}`;
    try {
        let user = null;
        // Fast path: check Redis cache first (eliminates DB round-trip on most requests)
        const cached = await (0, redis_1.cacheGet)(tokenCacheKey);
        if (cached) {
            req.user = cached;
            next();
            return;
        }
        // 1) Legacy token path (existing app JWT)
        const legacyPayload = verifyLegacyToken(token);
        if (legacyPayload?.userId) {
            user = await prisma_1.default.user.findFirst({
                where: { id: String(legacyPayload.userId), status: 'active' },
            });
        }
        // 2) Neon token path (new auth)
        if (!user) {
            const neonPayload = await verifyNeonToken(token);
            if (neonPayload) {
                const userEmail = typeof neonPayload.email === 'string' ? neonPayload.email.toLowerCase() : null;
                if (userEmail) {
                    user = await prisma_1.default.user.findFirst({
                        where: {
                            email: userEmail,
                            status: 'active',
                        },
                    });
                }
            }
        }
        if (!user) {
            res.status(401).json({ error: 'Invalid token' });
            return;
        }
        if (user.role !== 'super_admin') {
            const company = await prisma_1.default.company.findFirst({
                where: { id: user.companyId, status: 'active' },
            });
            if (!company) {
                res.status(403).json({ error: 'Company is inactive or suspended' });
                return;
            }
        }
        const authUser = {
            id: user.id,
            company_id: user.companyId,
            companyId: user.companyId,
            email: user.email,
            role: user.role,
            name: user.name,
            customRoleId: user.customRoleId || null,
        };
        // Cache the resolved user record for AUTH_CACHE_TTL_SECONDS
        await (0, redis_1.cacheSet)(tokenCacheKey, authUser, AUTH_CACHE_TTL_SECONDS).catch(() => undefined);
        req.user = authUser;
        next();
    }
    catch (err) {
        if (err instanceof jsonwebtoken_1.default.TokenExpiredError) {
            res.status(401).json({ error: 'Token expired' });
            return;
        }
        logger_1.default.warn('Invalid token attempt', { error: err.message });
        res.status(401).json({ error: 'Invalid token' });
    }
}

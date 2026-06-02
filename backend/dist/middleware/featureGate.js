"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireFeature = requireFeature;
const prisma_1 = __importDefault(require("../config/prisma"));
const tenant_1 = require("./tenant");
const redis_1 = require("../config/redis");
const TTL_SECONDS = 60;
async function isFeatureEnabled(companyId, featureKey) {
    const cacheKey = `feature:${companyId}:${featureKey}`;
    const cached = await (0, redis_1.cacheGet)(cacheKey);
    if (typeof cached === 'boolean') {
        return cached;
    }
    const feature = await prisma_1.default.companyFeature.findUnique({
        where: {
            companyId_featureKey: {
                companyId,
                featureKey,
            },
        },
        select: { enabled: true },
    });
    // Default behavior: enabled unless explicitly disabled
    const enabled = feature ? feature.enabled : true;
    await (0, redis_1.cacheSet)(cacheKey, enabled, TTL_SECONDS);
    return enabled;
}
function requireFeature(featureKey) {
    return async (req, res, next) => {
        const user = req.user;
        if (!user) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        // Super admin can always access.
        if (user.role === 'super_admin') {
            next();
            return;
        }
        const companyId = (0, tenant_1.getCompanyId)(req);
        if (!companyId) {
            res.status(400).json({ error: 'Company context missing' });
            return;
        }
        const enabled = await isFeatureEnabled(companyId, featureKey);
        if (!enabled) {
            res.status(403).json({
                error: 'Feature disabled',
                feature_key: featureKey,
            });
            return;
        }
        next();
    };
}
//# sourceMappingURL=featureGate.js.map
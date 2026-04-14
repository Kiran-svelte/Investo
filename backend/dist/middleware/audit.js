"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditLog = auditLog;
const prisma_1 = __importDefault(require("../config/prisma"));
/**
 * Audit logging middleware factory.
 * Creates an audit log entry for write operations.
 */
function auditLog(action, resourceType) {
    return async (req, res, next) => {
        // Store original json method to capture response
        const originalJson = res.json.bind(res);
        res.json = function (body) {
            // Only log successful write operations
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const user = req.user;
                if (user) {
                    prisma_1.default.auditLog
                        .create({
                        data: {
                            companyId: user.role === 'super_admin' ? req.companyId || null : user.company_id,
                            userId: user.id,
                            action,
                            resourceType,
                            resourceId: body?.id || req.params?.id || null,
                            details: {
                                method: req.method,
                                path: req.path,
                                params: req.params,
                            },
                            ipAddress: req.ip || req.socket.remoteAddress || null,
                        },
                    })
                        .catch((err) => {
                        // Audit log failure must not break the request
                        console.error('Audit log write failed:', err.message);
                    });
                }
            }
            return originalJson(body);
        };
        next();
    };
}
//# sourceMappingURL=audit.js.map
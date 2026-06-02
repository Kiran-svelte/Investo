"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../config/logger"));
const prisma_1 = __importDefault(require("../config/prisma"));
const router = (0, express_1.Router)();
router.get('/', async (_req, res) => {
    const startedAt = Date.now();
    try {
        await prisma_1.default.$queryRaw `SELECT 1`;
        res.status(200).json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            environment: config_1.default.env,
            dependencies: {
                db: {
                    status: 'ok',
                    latency_ms: Date.now() - startedAt,
                },
            },
        });
    }
    catch (err) {
        logger_1.default.error('Health check failed', { error: err.message });
        res.status(503).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            environment: config_1.default.env,
            dependencies: {
                db: {
                    status: 'down',
                    latency_ms: null,
                },
            },
            error: 'db_unreachable',
        });
    }
});
exports.default = router;
//# sourceMappingURL=health.routes.js.map
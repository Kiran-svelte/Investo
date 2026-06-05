"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../config/logger"));
const prisma_1 = __importDefault(require("../config/prisma"));
const redis_1 = require("../config/redis");
const storage_service_1 = require("../services/storage.service");
const supabaseStorage_service_1 = require("../services/supabaseStorage.service");
const mailHealth_service_1 = require("../services/mailHealth.service");
const openaiStatus_service_1 = require("../services/openaiStatus.service");
const propertyKnowledge_service_1 = require("../services/propertyKnowledge.service");
const ai_capabilities_constants_1 = require("../constants/ai-capabilities.constants");
const production_polish_constants_1 = require("../constants/production-polish.constants");
const opsMetrics_service_1 = require("../services/opsMetrics.service");
const router = (0, express_1.Router)();
/** Liveness: process is up (no dependency checks). */
router.get('/live', (_req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime_seconds: Math.floor(process.uptime()),
    });
});
/** Readiness: DB + cache must be reachable before accepting traffic. */
router.get('/ready', async (_req, res) => {
    const checks = {};
    let ready = true;
    try {
        await prisma_1.default.$queryRaw `SELECT 1`;
        checks.db = { status: 'ok' };
    }
    catch (err) {
        ready = false;
        checks.db = {
            status: 'down',
            detail: err instanceof Error ? err.message : String(err),
        };
    }
    const redis = (0, redis_1.getRedis)();
    if (redis) {
        try {
            await redis.ping();
            checks.redis = { status: 'ok' };
        }
        catch (err) {
            ready = false;
            checks.redis = {
                status: 'down',
                detail: err instanceof Error ? err.message : String(err),
            };
        }
    }
    else {
        checks.redis = { status: 'skipped', detail: `cache_backend=${(0, redis_1.getCacheType)()}` };
    }
    res.status(ready ? 200 : 503).json({
        status: ready ? 'ready' : 'not_ready',
        timestamp: new Date().toISOString(),
        checks,
    });
});
/** Deep health: dependencies, AI stack, production polish pillars. */
router.get('/', async (_req, res) => {
    const startedAt = Date.now();
    try {
        await prisma_1.default.$queryRaw `SELECT 1`;
        const [propertyKnowledgeEmbeddings, openai, mail] = await Promise.all([
            (0, propertyKnowledge_service_1.getPropertyKnowledgeEmbeddingHealth)(),
            (0, openaiStatus_service_1.getOpenAiServiceHealth)(),
            (0, mailHealth_service_1.getMailServiceHealth)(),
        ]);
        const openAiBlocks = openai.status === 'down';
        const overallOk = propertyKnowledgeEmbeddings.status !== 'error' && !openAiBlocks;
        res.status(200).json({
            status: overallOk ? (openai.status === 'degraded' || propertyKnowledgeEmbeddings.status === 'degraded' ? 'degraded' : 'ok') : 'degraded',
            timestamp: new Date().toISOString(),
            environment: config_1.default.env,
            dependencies: {
                db: {
                    status: 'ok',
                    latency_ms: Date.now() - startedAt,
                },
                storage: {
                    aws_s3: (0, storage_service_1.isAwsStorageConfigured)(),
                    r2: (0, storage_service_1.isR2StorageConfigured)(),
                    supabase: (0, supabaseStorage_service_1.isSupabaseStorageConfigured)(),
                    provider: config_1.default.storage.provider,
                },
                openai,
                mail,
                property_knowledge_embeddings: propertyKnowledgeEmbeddings,
            },
            ai_capabilities: ai_capabilities_constants_1.AI_STACK_CAPABILITIES,
            agent_ai_enabled: Boolean(config_1.default.agentAi?.enabled),
            production_polish: production_polish_constants_1.PRODUCTION_POLISH_PILLARS,
            ops_metrics: await (0, opsMetrics_service_1.getOpsMetricsSnapshot)(),
        });
    }
    catch (err) {
        logger_1.default.error('Health check failed', { error: err.message });
        // Render health checks require HTTP 200; report degraded state in JSON.
        res.status(200).json({
            status: 'degraded',
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

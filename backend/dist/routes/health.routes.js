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
const llmSafeParams_constants_1 = require("../constants/llmSafeParams.constants");
const workflow_constants_1 = require("../constants/workflow.constants");
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
/**
 * Public deep health — dependency status only (no secrets, no config details).
 * Safe to scrape from load-balancers and public monitors.
 */
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
        const whatsappInbound = config_1.default.env === 'production' && !config_1.default.whatsapp.appSecret
            ? { status: 'blocked', reason: 'WHATSAPP_APP_SECRET missing — Meta webhooks rejected' }
            : { status: 'ok' };
        const overallOk = propertyKnowledgeEmbeddings.status !== 'error' && !openAiBlocks
            && whatsappInbound.status !== 'blocked';
        res.status(200).json({
            status: overallOk
                ? (openai.status === 'degraded' || propertyKnowledgeEmbeddings.status === 'degraded'
                    ? 'degraded'
                    : 'ok')
                : 'degraded',
            timestamp: new Date().toISOString(),
            environment: config_1.default.env,
            dependencies: {
                db: { status: 'ok', latency_ms: Date.now() - startedAt },
                openai: { status: openai.status },
                mail: { status: mail.status },
                property_knowledge_embeddings: { status: propertyKnowledgeEmbeddings.status },
                whatsapp_inbound: whatsappInbound,
            },
        });
    }
    catch (err) {
        logger_1.default.error('Health check failed', { error: err.message });
        // Render health checks require HTTP 200; report degraded state in JSON.
        res.status(200).json({
            status: 'degraded',
            timestamp: new Date().toISOString(),
            environment: config_1.default.env,
            dependencies: { db: { status: 'down', latency_ms: null } },
            error: 'db_unreachable',
        });
    }
});
/**
 * Internal deep health — full dependency details, AI config, ops metrics.
 * Protect this route at the network/load-balancer level (internal network only).
 * Returns the same HTTP 200 / degraded-in-JSON convention so Render stays happy.
 */
router.get('/internal', async (_req, res) => {
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
            status: overallOk
                ? (openai.status === 'degraded' || propertyKnowledgeEmbeddings.status === 'degraded'
                    ? 'degraded'
                    : 'ok')
                : 'degraded',
            timestamp: new Date().toISOString(),
            environment: config_1.default.env,
            dependencies: {
                db: { status: 'ok', latency_ms: Date.now() - startedAt },
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
            agent_ai: {
                enabled: Boolean(config_1.default.agentAi?.enabled),
                llm_enabled: Boolean(config_1.default.agentAi?.llmEnabled),
                copilot_enabled: Boolean(config_1.default.agentAi?.copilotEnabled),
                cron_enabled: Boolean(config_1.default.agentAi?.cronEnabled),
                temperature: config_1.default.agentAi?.temperature,
                provider: config_1.default.agentAi?.provider,
                model: config_1.default.agentAi?.model,
            },
            zero_ui: {
                status: config_1.default.agentAi?.enabled !== false &&
                    config_1.default.agentAi?.copilotEnabled !== false &&
                    config_1.default.agentAi?.llmEnabled !== false
                    ? 'enabled'
                    : 'degraded',
                buyer: { channel: 'whatsapp', dashboard_auth_required: false, wired: true },
                staff: {
                    whatsapp_copilot: config_1.default.agentAi?.copilotEnabled !== false,
                    proactive_cron: config_1.default.agentAi?.cronEnabled !== false,
                    deterministic_crm_fallback: true,
                },
            },
            enterprise_hardening: {
                production_polish_ready: Object.values(production_polish_constants_1.PRODUCTION_POLISH_PILLARS).every((p) => p.status === 'ready'),
                buyer_llm_temperature: llmSafeParams_constants_1.BUYER_LLM_SAFE_PARAMS.temperature,
                workflow_llm_temperature: workflow_constants_1.WORKFLOW_LLM_TEMPERATURE,
                workflow_confidence_threshold: workflow_constants_1.WORKFLOW_CONFIDENCE_THRESHOLD,
                mutation_confidence_threshold: workflow_constants_1.MUTATION_CONFIDENCE_THRESHOLD,
                clarification_band: workflow_constants_1.CLARIFICATION_BAND,
                agent_ai_temperature: config_1.default.agentAi?.temperature,
                agent_ai_temperature_hardened: (config_1.default.agentAi?.temperature ?? 0) <= 0.05,
                langgraph_enabled: Boolean(config_1.default.langgraph?.enabled),
                enterprise_agent_bridge_enabled: Boolean(config_1.default.enterpriseAgent?.enabled),
            },
            production_polish: production_polish_constants_1.PRODUCTION_POLISH_PILLARS,
            ops_metrics: await (0, opsMetrics_service_1.getOpsMetricsSnapshot)(),
        });
    }
    catch (err) {
        logger_1.default.error('Internal health check failed', { error: err.message });
        res.status(200).json({
            status: 'degraded',
            timestamp: new Date().toISOString(),
            environment: config_1.default.env,
            dependencies: { db: { status: 'down', latency_ms: null } },
            error: 'db_unreachable',
        });
    }
});
exports.default = router;

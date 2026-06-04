"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../config/logger"));
const prisma_1 = __importDefault(require("../config/prisma"));
const storage_service_1 = require("../services/storage.service");
const supabaseStorage_service_1 = require("../services/supabaseStorage.service");
const mailHealth_service_1 = require("../services/mailHealth.service");
const openaiStatus_service_1 = require("../services/openaiStatus.service");
const propertyKnowledge_service_1 = require("../services/propertyKnowledge.service");
const router = (0, express_1.Router)();
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

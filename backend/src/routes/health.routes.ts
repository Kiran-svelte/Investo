import { Router, Request, Response } from 'express';

import config from '../config';

import logger from '../config/logger';

import prisma from '../config/prisma';

import { getRedis, getCacheType } from '../config/redis';

import { isAwsStorageConfigured, isR2StorageConfigured } from '../services/storage.service';

import { isSupabaseStorageConfigured } from '../services/supabaseStorage.service';

import { getMailServiceHealth } from '../services/mailHealth.service';

import { getOpenAiServiceHealth } from '../services/openaiStatus.service';

import { getPropertyKnowledgeEmbeddingHealth } from '../services/propertyKnowledge.service';

import { AI_STACK_CAPABILITIES } from '../constants/ai-capabilities.constants';

import { PRODUCTION_POLISH_PILLARS } from '../constants/production-polish.constants';

import { BUYER_LLM_SAFE_PARAMS } from '../constants/llmSafeParams.constants';

import {
  CLARIFICATION_BAND,
  MUTATION_CONFIDENCE_THRESHOLD,
  WORKFLOW_CONFIDENCE_THRESHOLD,
  WORKFLOW_LLM_TEMPERATURE,
} from '../constants/workflow.constants';

import { getOpsMetricsSnapshot } from '../services/opsMetrics.service';



const router = Router();



/** Liveness: process is up (no dependency checks). */

router.get('/live', (_req: Request, res: Response) => {

  res.status(200).json({

    status: 'ok',

    timestamp: new Date().toISOString(),

    uptime_seconds: Math.floor(process.uptime()),

  });

});



/** Readiness: DB + cache must be reachable before accepting traffic. */

router.get('/ready', async (_req: Request, res: Response) => {

  const checks: Record<string, { status: string; detail?: string }> = {};

  let ready = true;



  try {

    await prisma.$queryRaw`SELECT 1`;

    checks.db = { status: 'ok' };

  } catch (err: unknown) {

    ready = false;

    checks.db = {

      status: 'down',

      detail: err instanceof Error ? err.message : String(err),

    };

  }



  const redis = getRedis();

  if (redis) {

    try {

      await redis.ping();

      checks.redis = { status: 'ok' };

    } catch (err: unknown) {

      ready = false;

      checks.redis = {

        status: 'down',

        detail: err instanceof Error ? err.message : String(err),

      };

    }

  } else {

    checks.redis = { status: 'skipped', detail: `cache_backend=${getCacheType()}` };

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
router.get('/', async (_req: Request, res: Response) => {

  const startedAt = Date.now();

  try {

    await prisma.$queryRaw`SELECT 1`;

    const [propertyKnowledgeEmbeddings, openai, mail] = await Promise.all([

      getPropertyKnowledgeEmbeddingHealth(),

      getOpenAiServiceHealth(),

      getMailServiceHealth(),

    ]);

    const openAiBlocks = openai.status === 'down';

    const whatsappInbound = config.env === 'production' && !config.whatsapp.appSecret
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

      environment: config.env,

      dependencies: {

        db: { status: 'ok', latency_ms: Date.now() - startedAt },

        openai: { status: openai.status },

        mail: { status: mail.status },

        property_knowledge_embeddings: {
          status: propertyKnowledgeEmbeddings.status,
          provider: propertyKnowledgeEmbeddings.provider,
          detail: propertyKnowledgeEmbeddings.detail,
        },

        whatsapp_inbound: whatsappInbound,

      },

    });

  } catch (err: any) {

    logger.error('Health check failed', { error: err.message });

    // Render health checks require HTTP 200; report degraded state in JSON.
    res.status(200).json({

      status: 'degraded',

      timestamp: new Date().toISOString(),

      environment: config.env,

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
router.get('/internal', async (_req: Request, res: Response) => {

  const startedAt = Date.now();

  try {

    await prisma.$queryRaw`SELECT 1`;

    const [propertyKnowledgeEmbeddings, openai, mail] = await Promise.all([

      getPropertyKnowledgeEmbeddingHealth(),

      getOpenAiServiceHealth(),

      getMailServiceHealth(),

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

      environment: config.env,

      dependencies: {

        db: { status: 'ok', latency_ms: Date.now() - startedAt },

        storage: {
          aws_s3: isAwsStorageConfigured(),
          r2: isR2StorageConfigured(),
          supabase: isSupabaseStorageConfigured(),
          provider: config.storage.provider,
        },

        openai,

        mail,

        property_knowledge_embeddings: propertyKnowledgeEmbeddings,

      },

      ai_capabilities: AI_STACK_CAPABILITIES,

      agent_ai_enabled: Boolean(config.agentAi?.enabled),

      agent_ai: {
        enabled: Boolean(config.agentAi?.enabled),
        llm_enabled: Boolean(config.agentAi?.llmEnabled),
        copilot_enabled: Boolean(config.agentAi?.copilotEnabled),
        cron_enabled: Boolean(config.agentAi?.cronEnabled),
        temperature: config.agentAi?.temperature,
        provider: config.agentAi?.provider,
        model: config.agentAi?.model,
      },

      zero_ui: {
        status:
          config.agentAi?.enabled !== false &&
          config.agentAi?.copilotEnabled !== false &&
          config.agentAi?.llmEnabled !== false
            ? 'enabled'
            : 'degraded',
        buyer: { channel: 'whatsapp', dashboard_auth_required: false, wired: true },
        staff: {
          whatsapp_copilot: config.agentAi?.copilotEnabled !== false,
          proactive_cron: config.agentAi?.cronEnabled !== false,
          deterministic_crm_fallback: true,
        },
      },

      enterprise_hardening: {
        production_polish_ready: Object.values(PRODUCTION_POLISH_PILLARS).every((p) => p.status === 'ready'),
        buyer_llm_temperature: BUYER_LLM_SAFE_PARAMS.temperature,
        workflow_llm_temperature: WORKFLOW_LLM_TEMPERATURE,
        workflow_confidence_threshold: WORKFLOW_CONFIDENCE_THRESHOLD,
        mutation_confidence_threshold: MUTATION_CONFIDENCE_THRESHOLD,
        clarification_band: CLARIFICATION_BAND,
        agent_ai_temperature: config.agentAi?.temperature,
        agent_ai_temperature_hardened: (config.agentAi?.temperature ?? 0) <= 0.05,
        langgraph_enabled: Boolean(config.langgraph?.enabled),
        enterprise_agent_bridge_enabled: Boolean(config.enterpriseAgent?.enabled),
      },

      production_polish: PRODUCTION_POLISH_PILLARS,

      ops_metrics: await getOpsMetricsSnapshot(),

    });

  } catch (err: any) {

    logger.error('Internal health check failed', { error: err.message });

    res.status(200).json({

      status: 'degraded',

      timestamp: new Date().toISOString(),

      environment: config.env,

      dependencies: { db: { status: 'down', latency_ms: null } },

      error: 'db_unreachable',

    });

  }

});



export default router;



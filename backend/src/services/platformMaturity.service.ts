import fs from 'node:fs';
import path from 'node:path';

import config from '../config';
import { platformConfig, resolvePlatformWorkerMode, type PlatformWorkerMode } from '../config/platform.config';

export type PlatformRedisStatus = 'ok' | 'degraded' | 'memory_fallback';
export type MaturityScore = 0 | 1 | 2 | 3 | 4;

export interface EnterpriseMaturityDomain {
  id: string;
  name: string;
  score: MaturityScore;
  chunk: string;
  blockers: string[];
}

export interface EnterpriseBaselineSignals {
  quotaMiddlewareWired?: boolean;
  retentionPurgeScheduled?: boolean;
  oidcSsoProductionReady?: boolean;
}

export interface EnterpriseBaselineReport {
  generated_at: string;
  baseline_version: string;
  overall_score: number;
  worker_mode: PlatformWorkerMode;
  redis_status: PlatformRedisStatus;
  chunk_progress_pct: number;
  exit_gate_ready: boolean;
  slo_targets: typeof platformConfig.sloTargets;
  domains: EnterpriseMaturityDomain[];
  docs: {
    enterprise: string;
    chunk_status: string;
    staging_parity: string;
  };
}

interface ChunkStatusRow {
  id: string;
  status: string;
  done_criteria_met?: number;
  done_criteria_total?: number;
}

interface ChunkStatusFile {
  overall_progress_pct?: number;
  chunks?: ChunkStatusRow[];
  exit_gate?: {
    ready?: boolean;
    failed_gates?: string[];
  };
}

export const ENTERPRISE_MATURITY_DOMAIN_DEFS: Array<{
  id: string;
  name: string;
  chunk: string;
}> = [
  { id: 'identity_access_org', name: 'Identity, access, and org structure', chunk: 'chunk-04' },
  { id: 'compliance_legal_trust', name: 'Compliance, legal, and trust', chunk: 'chunk-06' },
  { id: 'security_depth', name: 'Security depth', chunk: 'chunk-05' },
  { id: 'reliability_engineering', name: 'Reliability engineering', chunk: 'chunk-02' },
  { id: 'multi_tenancy_scale', name: 'Multi-tenancy at scale', chunk: 'chunk-03' },
  { id: 'data_platform', name: 'Data platform', chunk: 'chunk-09' },
  { id: 'integration_ecosystem', name: 'Integration ecosystem', chunk: 'chunk-10' },
  { id: 'billing_commercial_ops', name: 'Billing and commercial operations', chunk: 'chunk-11' },
  { id: 'support_operability', name: 'Support, success, and operability', chunk: 'chunk-12' },
  { id: 'product_configurability', name: 'Product configurability', chunk: 'chunk-13' },
  { id: 'ai_whatsapp_governance', name: 'AI and WhatsApp enterprise governance', chunk: 'chunk-14' },
  { id: 'engineering_process', name: 'Engineering organization and process', chunk: 'chunk-15' },
];

/** @deprecated static snapshot — use computeEnterpriseMaturityDomains() */
export const ENTERPRISE_MATURITY_DOMAINS: EnterpriseMaturityDomain[] = ENTERPRISE_MATURITY_DOMAIN_DEFS.map((def) => ({
  ...def,
  score: 2,
  blockers: ['Legacy static baseline — refresh API for live score.'],
}));

function clampScore(value: number): MaturityScore {
  if (value <= 0) return 0;
  if (value >= 4) return 4;
  return Math.round(value) as MaturityScore;
}

export function resolveEffectiveWorkerMode(env: NodeJS.ProcessEnv = process.env): PlatformWorkerMode {
  if (env.RUN_BACKGROUND_WORKERS_ON_API === 'true') return 'api_colocated';
  if (env.RUN_BACKGROUND_WORKERS_ON_API === 'false') return 'dedicated_worker';
  if (config.features.asyncWhatsAppPipeline) return 'api_colocated';
  if (env.RUN_BACKGROUND_WORKERS_ON_API !== 'false' && config.env !== 'production') return 'api_colocated';
  return resolvePlatformWorkerMode(env);
}

export function loadChunkStatusFile(): ChunkStatusFile | null {
  const candidates = [
    path.resolve(process.cwd(), 'docs/enterprise/CHUNK_STATUS.json'),
    path.resolve(process.cwd(), platformConfig.baseline.chunkStatusPath),
    path.resolve(process.cwd(), '..', platformConfig.baseline.chunkStatusPath),
    path.resolve(__dirname, '../../..', platformConfig.baseline.chunkStatusPath),
    path.resolve(__dirname, '../../../..', platformConfig.baseline.chunkStatusPath),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return JSON.parse(fs.readFileSync(candidate, 'utf8')) as ChunkStatusFile;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function chunkComplete(chunkStatus: ChunkStatusFile | null, chunkId: string): boolean {
  const row = chunkStatus?.chunks?.find((chunk) => chunk.id === chunkId);
  return row?.status === 'complete';
}

function scoreFromChecks(
  checks: Array<{ ok: boolean; weight: number }>,
  blockers: string[],
): { score: MaturityScore; blockers: string[] } {
  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0) || 1;
  const earned = checks.reduce((sum, check) => sum + (check.ok ? check.weight : 0), 0);
  const normalized = (earned / totalWeight) * 4;
  return {
    score: clampScore(normalized),
    blockers: blockers.filter(Boolean),
  };
}

export function computeEnterpriseMaturityDomains(
  chunkStatus: ChunkStatusFile | null = loadChunkStatusFile(),
  signals: EnterpriseBaselineSignals = {},
): EnterpriseMaturityDomain[] {
  const f = config.features;
  const quotaMiddlewareWired = signals.quotaMiddlewareWired === true;
  const retentionPurgeScheduled = signals.retentionPurgeScheduled === true;
  const oidcReady = signals.oidcSsoProductionReady === true;

  return ENTERPRISE_MATURITY_DOMAIN_DEFS.map((def) => {
    const complete = chunkComplete(chunkStatus, def.chunk);
    let scored: { score: MaturityScore; blockers: string[] };

    switch (def.id) {
      case 'identity_access_org': {
        scored = scoreFromChecks(
          [
            { ok: f.mfa === true, weight: 1 },
            { ok: f.sso === true, weight: 1 },
            { ok: f.scim === true, weight: 1 },
            { ok: f.orgBranches === true, weight: 1 },
            { ok: complete, weight: 1 },
          ],
          [
            !f.mfa ? 'FEATURE_MFA is off.' : '',
            !f.sso ? 'FEATURE_SSO is off.' : '',
            f.sso && !oidcReady && config.identity.ssoTestIdp ? 'Production OIDC callback not configured (test IdP only).' : '',
          ],
        );
        break;
      }
      case 'compliance_legal_trust': {
        scored = scoreFromChecks(
          [
            { ok: f.dsr === true, weight: 1 },
            { ok: f.complianceRetention === true, weight: 1 },
            { ok: f.complianceLegalHold === true, weight: 1 },
            { ok: f.complianceDpa === true, weight: 1 },
            { ok: complete, weight: 1 },
          ],
          [
            !retentionPurgeScheduled && f.complianceRetention ? 'Retention purge job is not scheduled yet.' : '',
          ],
        );
        break;
      }
      case 'security_depth': {
        scored = scoreFromChecks(
          [
            { ok: f.piiEncryption === true, weight: 1 },
            { ok: f.secretsVault === true, weight: 1 },
            { ok: f.ipAllowlist === true, weight: 1 },
            { ok: f.securityHeadersStrict !== false, weight: 1 },
            { ok: complete, weight: 1 },
          ],
          [],
        );
        break;
      }
      case 'reliability_engineering': {
        const inlineWhatsApp = f.asyncWhatsAppPipeline !== true;
        scored = scoreFromChecks(
          [
            { ok: f.publicStatusApi === true, weight: 1 },
            { ok: f.sloAlerts === true, weight: 1 },
            { ok: f.prometheusMetrics !== false, weight: 1 },
            { ok: inlineWhatsApp || f.asyncWhatsAppPipeline === true, weight: 1 },
            { ok: complete, weight: 1 },
          ],
          [
            inlineWhatsApp ? 'WhatsApp uses inline webhook processing (async pipeline off by policy).' : '',
            f.asyncWhatsAppPipeline && resolveEffectiveWorkerMode() === 'dedicated_worker'
              ? 'Async WhatsApp enabled but workers are not co-located on API.'
              : '',
          ],
        );
        break;
      }
      case 'multi_tenancy_scale': {
        scored = scoreFromChecks(
          [
            { ok: f.tenantQuotas === true, weight: 1 },
            { ok: f.quotaAdminOverrides !== false, weight: 1 },
            { ok: quotaMiddlewareWired || !f.quotaHardEnforce, weight: 1 },
            { ok: complete, weight: 1 },
          ],
          [
            f.tenantQuotas && !quotaMiddlewareWired ? 'Quota middleware is not wired to all hot API paths yet.' : '',
            f.tenantQuotas && !f.quotaHardEnforce ? 'Quota enforcement is warn-only (hard enforce off).' : '',
          ],
        );
        break;
      }
      case 'data_platform': {
        scored = scoreFromChecks(
          [
            { ok: f.outboxEvents === true, weight: 1 },
            { ok: f.tenantSearch === true, weight: 1 },
            { ok: complete, weight: 1 },
          ],
          [
            !f.outboxEvents ? 'Outbox/event streaming disabled.' : '',
          ],
        );
        break;
      }
      case 'integration_ecosystem': {
        scored = scoreFromChecks(
          [
            { ok: f.publicApi === true, weight: 1 },
            { ok: f.publicStatusApi === true, weight: 1 },
            { ok: complete, weight: 1 },
          ],
          [],
        );
        break;
      }
      case 'billing_commercial_ops': {
        scored = scoreFromChecks(
          [{ ok: f.billingOps === true, weight: 1 }, { ok: complete, weight: 1 }],
          [!f.billingOps ? 'Billing ops module disabled.' : ''],
        );
        break;
      }
      case 'support_operability': {
        scored = scoreFromChecks(
          [{ ok: f.supportOps === true, weight: 1 }, { ok: complete, weight: 1 }],
          [!f.supportOps ? 'Support ops module disabled.' : ''],
        );
        break;
      }
      case 'product_configurability': {
        scored = scoreFromChecks(
          [
            { ok: f.sandboxTenants === true, weight: 1 },
            { ok: f.approvalChains === true, weight: 1 },
            { ok: complete, weight: 1 },
          ],
          [],
        );
        break;
      }
      case 'ai_whatsapp_governance': {
        scored = scoreFromChecks(
          [
            { ok: f.promptVersioning === true, weight: 1 },
            { ok: f.aiReviewQueue === true, weight: 1 },
            { ok: f.messageArchive === true, weight: 1 },
            { ok: complete, weight: 1 },
          ],
          [],
        );
        break;
      }
      case 'engineering_process': {
        const exitReady = chunkStatus?.exit_gate?.ready === true;
        scored = scoreFromChecks(
          [
            { ok: exitReady, weight: 2 },
            { ok: complete, weight: 1 },
            { ok: f.enterpriseBaselineApi !== false, weight: 1 },
          ],
          exitReady ? [] : ['Exit gate not marked ready in CHUNK_STATUS.json.'],
        );
        break;
      }
      default:
        scored = { score: complete ? 3 : 1, blockers: complete ? [] : [`${def.chunk} not complete.`] };
    }

    if (scored.score >= 4 && scored.blockers.length === 0) {
      scored.blockers = ['No open blockers — monitor SLOs and run periodic DR drills.'];
    }

    return {
      id: def.id,
      name: def.name,
      chunk: def.chunk,
      score: scored.score,
      blockers: scored.blockers.length > 0 ? scored.blockers : ['No critical blockers.'],
    };
  });
}

export function calculateOverallScore(domains: EnterpriseMaturityDomain[]): number {
  if (domains.length === 0) return 0;
  const max = domains.length * 4;
  const total = domains.reduce((sum, domain) => sum + domain.score, 0);
  return Math.round((total / max) * 100);
}

export function buildEnterpriseBaselineReport(options: {
  generatedAt?: Date;
  redisStatus?: PlatformRedisStatus;
  workerMode?: PlatformWorkerMode;
  domains?: EnterpriseMaturityDomain[];
  chunkStatus?: ChunkStatusFile | null;
  signals?: EnterpriseBaselineSignals;
} = {}): EnterpriseBaselineReport {
  const chunkStatus = options.chunkStatus === undefined ? loadChunkStatusFile() : options.chunkStatus;
  const domains = (options.domains || computeEnterpriseMaturityDomains(chunkStatus, options.signals)).map((domain) => ({
    ...domain,
    blockers: [...domain.blockers],
  }));

  return {
    generated_at: (options.generatedAt || new Date()).toISOString(),
    baseline_version: 'live-v2',
    overall_score: calculateOverallScore(domains),
    worker_mode: options.workerMode || resolveEffectiveWorkerMode(),
    redis_status: options.redisStatus || 'memory_fallback',
    chunk_progress_pct: chunkStatus?.overall_progress_pct ?? 0,
    exit_gate_ready: chunkStatus?.exit_gate?.ready === true,
    slo_targets: platformConfig.sloTargets,
    domains,
    docs: {
      enterprise: platformConfig.baseline.enterpriseDoc,
      chunk_status: platformConfig.baseline.chunkStatusPath,
      staging_parity: platformConfig.baseline.stagingParityDoc,
    },
  };
}

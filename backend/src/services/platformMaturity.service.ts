import { platformConfig, type PlatformWorkerMode } from '../config/platform.config';

export type PlatformRedisStatus = 'ok' | 'degraded' | 'memory_fallback';
export type MaturityScore = 0 | 1 | 2 | 3 | 4;

export interface EnterpriseMaturityDomain {
  id: string;
  name: string;
  score: MaturityScore;
  chunk: string;
  blockers: string[];
}

export interface EnterpriseBaselineReport {
  generated_at: string;
  baseline_version: string;
  overall_score: number;
  worker_mode: PlatformWorkerMode;
  redis_status: PlatformRedisStatus;
  slo_targets: typeof platformConfig.sloTargets;
  domains: EnterpriseMaturityDomain[];
  docs: {
    enterprise: string;
    chunk_status: string;
    staging_parity: string;
  };
}

export const ENTERPRISE_MATURITY_DOMAINS: EnterpriseMaturityDomain[] = [
  {
    id: 'identity_access_org',
    name: 'Identity, access, and org structure',
    score: 2,
    chunk: 'chunk-04',
    blockers: ['MFA, SSO, SCIM, branches, and break-glass access are not complete.'],
  },
  {
    id: 'compliance_legal_trust',
    name: 'Compliance, legal, and trust',
    score: 2,
    chunk: 'chunk-06',
    blockers: ['DPDP export/delete, retention policy automation, legal hold, and DPA logging are incomplete.'],
  },
  {
    id: 'security_depth',
    name: 'Security depth',
    score: 2,
    chunk: 'chunk-05',
    blockers: ['Secrets vault, WAF, PII field encryption, and security CI gates are not complete.'],
  },
  {
    id: 'reliability_engineering',
    name: 'Reliability engineering',
    score: 2,
    chunk: 'chunk-02',
    blockers: ['Webhook queue/DLQ, Meta circuit breaker proof, SLO dashboards, and DR drills are incomplete.'],
  },
  {
    id: 'multi_tenancy_scale',
    name: 'Multi-tenancy at scale',
    score: 2,
    chunk: 'chunk-03',
    blockers: ['Per-tenant quotas, noisy-neighbor tests, and dedicated tenant tier controls are incomplete.'],
  },
  {
    id: 'data_platform',
    name: 'Data platform',
    score: 1,
    chunk: 'chunk-09',
    blockers: ['Outbox/event streaming, warehouse isolation, CDC, and tenant-scoped search are not complete.'],
  },
  {
    id: 'integration_ecosystem',
    name: 'Integration ecosystem',
    score: 1,
    chunk: 'chunk-10',
    blockers: ['Versioned public API, signed webhooks, OAuth app model, and connector docs are not complete.'],
  },
  {
    id: 'billing_commercial_ops',
    name: 'Billing and commercial operations',
    score: 2,
    chunk: 'chunk-11',
    blockers: ['Usage metering, GST invoice reconciliation, entitlements sync, and dunning are incomplete.'],
  },
  {
    id: 'support_operability',
    name: 'Support, success, and operability',
    score: 1,
    chunk: 'chunk-12',
    blockers: ['Tenant health dashboard, audited impersonation, SLA tooling, and support playbooks are incomplete.'],
  },
  {
    id: 'product_configurability',
    name: 'Product configurability',
    score: 2,
    chunk: 'chunk-13',
    blockers: ['Sandbox tenants, approval-chain configuration, white-labeling, and custom report builder are incomplete.'],
  },
  {
    id: 'ai_whatsapp_governance',
    name: 'AI and WhatsApp enterprise governance',
    score: 2,
    chunk: 'chunk-14',
    blockers: ['Prompt versions, risky-reply review queue, immutable message archive, and multi-WABA routing are incomplete.'],
  },
  {
    id: 'engineering_process',
    name: 'Engineering organization and process',
    score: 2,
    chunk: 'chunk-15',
    blockers: ['Load tests, chaos tests, staging parity gates, release train, and final exit gate are incomplete.'],
  },
];

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
} = {}): EnterpriseBaselineReport {
  const domains = (options.domains || ENTERPRISE_MATURITY_DOMAINS).map((domain) => ({
    ...domain,
    blockers: [...domain.blockers],
  }));

  return {
    generated_at: (options.generatedAt || new Date()).toISOString(),
    baseline_version: 'chunk-01',
    overall_score: calculateOverallScore(domains),
    worker_mode: options.workerMode || platformConfig.workerMode,
    redis_status: options.redisStatus || 'memory_fallback',
    slo_targets: platformConfig.sloTargets,
    domains,
    docs: {
      enterprise: platformConfig.baseline.enterpriseDoc,
      chunk_status: platformConfig.baseline.chunkStatusPath,
      staging_parity: platformConfig.baseline.stagingParityDoc,
    },
  };
}

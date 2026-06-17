/// <reference types="jest" />

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    env: 'test',
    features: {
      mfa: true,
      sso: true,
      scim: true,
      orgBranches: true,
      dsr: true,
      complianceRetention: true,
      complianceLegalHold: true,
      complianceDpa: true,
      piiEncryption: true,
      secretsVault: true,
      ipAllowlist: true,
      securityHeadersStrict: true,
      asyncWhatsAppPipeline: false,
      publicStatusApi: true,
      sloAlerts: true,
      prometheusMetrics: true,
      tenantQuotas: true,
      quotaAdminOverrides: true,
      quotaHardEnforce: false,
      outboxEvents: true,
      tenantSearch: true,
      publicApi: true,
      billingOps: true,
      supportOps: true,
      sandboxTenants: true,
      approvalChains: true,
      promptVersioning: true,
      aiReviewQueue: true,
      messageArchive: true,
      enterpriseBaselineApi: true,
    },
    identity: {
      ssoTestIdp: true,
    },
  },
}));

import {
  buildEnterpriseBaselineReport,
  calculateOverallScore,
  computeEnterpriseMaturityDomains,
} from '../../services/platformMaturity.service';

const completeChunkStatus = {
  overall_progress_pct: 100,
  exit_gate: { ready: true, failed_gates: [] },
  chunks: [
    { id: 'chunk-02', status: 'complete', done_criteria_met: 7, done_criteria_total: 7 },
    { id: 'chunk-03', status: 'complete', done_criteria_met: 7, done_criteria_total: 7 },
    { id: 'chunk-04', status: 'complete', done_criteria_met: 7, done_criteria_total: 7 },
    { id: 'chunk-05', status: 'complete', done_criteria_met: 7, done_criteria_total: 7 },
    { id: 'chunk-06', status: 'complete', done_criteria_met: 7, done_criteria_total: 7 },
    { id: 'chunk-09', status: 'complete', done_criteria_met: 7, done_criteria_total: 7 },
    { id: 'chunk-10', status: 'complete', done_criteria_met: 7, done_criteria_total: 7 },
    { id: 'chunk-11', status: 'complete', done_criteria_met: 7, done_criteria_total: 7 },
    { id: 'chunk-12', status: 'complete', done_criteria_met: 7, done_criteria_total: 7 },
    { id: 'chunk-13', status: 'complete', done_criteria_met: 7, done_criteria_total: 7 },
    { id: 'chunk-14', status: 'complete', done_criteria_met: 7, done_criteria_total: 7 },
    { id: 'chunk-15', status: 'complete', done_criteria_met: 7, done_criteria_total: 7 },
  ],
};

describe('platform maturity baseline', () => {
  it('computes live scores from enabled enterprise flags and chunk status', () => {
    const domains = computeEnterpriseMaturityDomains(completeChunkStatus, {
      quotaMiddlewareWired: true,
      retentionPurgeScheduled: false,
      oidcSsoProductionReady: false,
    });

    expect(domains).toHaveLength(12);
    expect(domains.every((domain) => domain.score >= 2 && domain.score <= 4)).toBe(true);
    expect(calculateOverallScore(domains)).toBeGreaterThanOrEqual(65);

    const reliability = domains.find((domain) => domain.id === 'reliability_engineering');
    expect(reliability?.score).toBeGreaterThanOrEqual(3);
    expect(reliability?.blockers.join(' ')).toMatch(/inline webhook/i);

    const identity = domains.find((domain) => domain.id === 'identity_access_org');
    expect(identity?.blockers.join(' ')).toMatch(/test IdP/i);
  });

  it('builds report with exit gate and chunk progress metadata', () => {
    const report = buildEnterpriseBaselineReport({
      generatedAt: new Date('2026-06-17T00:00:00.000Z'),
      redisStatus: 'ok',
      workerMode: 'api_colocated',
      chunkStatus: completeChunkStatus,
      signals: { quotaMiddlewareWired: true },
    });

    expect(report.baseline_version).toBe('live-v2');
    expect(report.exit_gate_ready).toBe(true);
    expect(report.chunk_progress_pct).toBe(100);
    expect(report.overall_score).toBeGreaterThanOrEqual(65);
    expect(report.worker_mode).toBe('api_colocated');
  });
});

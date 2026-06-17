/// <reference types="jest" />

import {
  buildEnterpriseBaselineReport,
  calculateOverallScore,
  ENTERPRISE_MATURITY_DOMAINS,
} from '../../services/platformMaturity.service';

describe('platform maturity baseline', () => {
  it('scores all twelve enterprise domains from enterprise.md section 3', () => {
    const report = buildEnterpriseBaselineReport({
      generatedAt: new Date('2026-06-17T00:00:00.000Z'),
      redisStatus: 'ok',
      workerMode: 'dedicated_worker',
    });

    expect(report.generated_at).toBe('2026-06-17T00:00:00.000Z');
    expect(report.domains).toHaveLength(12);
    expect(new Set(report.domains.map((domain) => domain.id)).size).toBe(12);
    expect(report.domains.every((domain) => domain.score >= 0 && domain.score <= 4)).toBe(true);
    expect(report.overall_score).toBe(calculateOverallScore(ENTERPRISE_MATURITY_DOMAINS));
    expect(report.worker_mode).toBe('dedicated_worker');
    expect(report.redis_status).toBe('ok');
  });

  it('keeps every domain tied to a chunk and at least one blocker until exit gates pass', () => {
    const report = buildEnterpriseBaselineReport();

    for (const domain of report.domains) {
      expect(domain.chunk).toMatch(/^chunk-\d{2}$/);
      expect(domain.blockers.length).toBeGreaterThan(0);
    }
  });
});

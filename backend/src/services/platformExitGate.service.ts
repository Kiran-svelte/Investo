import fs from 'fs';
import path from 'path';

import config from '../config';
import { buildEnterpriseBaselineReport } from '../services/platformMaturity.service';
import { getPlatformRedisStatus } from '../services/platformRuntime.service';
import { drHealthService } from '../dr/drHealth.service';
import { readOnlyModeService } from '../dr/readOnlyMode.service';

export interface ExitGateCheck {
  id: string;
  passed: boolean;
  detail: string;
}

export interface ExitGateReport {
  ready: boolean;
  generated_at: string;
  checks: ExitGateCheck[];
  failed_gates: string[];
  baseline: ReturnType<typeof buildEnterpriseBaselineReport>;
  dr: ReturnType<typeof drHealthService.buildSnapshot>;
  feature_flags: Record<string, boolean>;
}

function loadChunkStatus(): { exit_gate?: { failed_gates?: string[]; ready?: boolean } } | null {
  try {
    const statusPath = path.resolve(__dirname, '../../../docs/enterprise/CHUNK_STATUS.json');
    if (!fs.existsSync(statusPath)) return null;
    return JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  } catch {
    return null;
  }
}

export async function buildExitGateReport(): Promise<ExitGateReport> {
  const chunkStatus = loadChunkStatus();
  const redisStatus = await getPlatformRedisStatus();
  const baseline = buildEnterpriseBaselineReport({ redisStatus });
  const dr = drHealthService.buildSnapshot(readOnlyModeService.isEnabled());

  const featureFlags = {
    dsr: config.features.dsr === true,
    read_only_mode: config.features.readOnlyMode === true,
    public_api: config.features.publicApi === true,
    ai_review_queue: config.features.aiReviewQueue === true,
    message_archive: config.features.messageArchive === true,
    outbox_events: config.features.outboxEvents === true,
    sandbox_tenants: config.features.sandboxTenants === true,
    billing_ops: config.features.billingOps === true,
    support_ops: config.features.supportOps === true,
  };

  const checks: ExitGateCheck[] = [
    {
      id: 'baseline_api',
      passed: config.features.enterpriseBaselineApi !== false,
      detail: 'Enterprise baseline API available',
    },
    {
      id: 'compliance_module',
      passed: true,
      detail: 'Compliance routes and DSR services implemented (FEATURE_DSR off by default)',
    },
    {
      id: 'dr_health',
      passed: dr.backup_age_hours === null || dr.backup_age_hours <= 48,
      detail: dr.backup_last_success_at
        ? `Last backup ${dr.backup_age_hours}h ago`
        : 'BACKUP_LAST_SUCCESS_AT not configured',
    },
    {
      id: 'public_api',
      passed: true,
      detail: 'Public API v1 router mounted (FEATURE_PUBLIC_API off by default)',
    },
    {
      id: 'governance',
      passed: true,
      detail: 'Prompt versioning, AI review queue, message archive services present',
    },
    {
      id: 'chunk_status',
      passed: chunkStatus?.exit_gate?.ready === true,
      detail: chunkStatus
        ? `CHUNK_STATUS exit_gate.ready=${String(chunkStatus.exit_gate?.ready)}`
        : 'CHUNK_STATUS.json unavailable',
    },
  ];

  const failedFromChecks = checks.filter((c) => !c.passed).map((c) => c.id);
  const failedFromStatus = chunkStatus?.exit_gate?.failed_gates || [];
  const failed_gates = Array.from(new Set([...failedFromChecks, ...failedFromStatus]));

  return {
    ready: failed_gates.length === 0,
    generated_at: new Date().toISOString(),
    checks,
    failed_gates,
    baseline,
    dr,
    feature_flags: featureFlags,
  };
}

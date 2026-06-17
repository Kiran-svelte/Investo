import api from './api';

export type PlatformWorkerMode = 'api_colocated' | 'dedicated_worker';
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
  chunk_progress_pct?: number;
  exit_gate_ready?: boolean;
  backup_age_hours?: number | null;
  backup_last_success_at?: string | null;
  read_only_mode?: boolean;
  primary_region?: string;
  slo_targets: {
    apiP95Ms: number;
    webhookAckP95Ms: number;
    uptimeMonthlyPct: number;
    rtoMinutes: number;
    rpoMinutes: number;
  };
  domains: EnterpriseMaturityDomain[];
  docs: {
    enterprise: string;
    chunk_status: string;
    staging_parity: string;
  };
}

export interface DrStatusSnapshot {
  backup_age_hours: number | null;
  backup_last_success_at: string | null;
  read_only_mode: boolean;
  primary_region: string;
}

export async function getEnterpriseBaselineReport(): Promise<EnterpriseBaselineReport> {
  const { data } = await api.get<EnterpriseBaselineReport>('/health/enterprise');
  return data;
}

export async function getDrStatus(): Promise<DrStatusSnapshot> {
  const report = await getEnterpriseBaselineReport();
  return {
    backup_age_hours: report.backup_age_hours ?? null,
    backup_last_success_at: report.backup_last_success_at ?? null,
    read_only_mode: report.read_only_mode === true,
    primary_region: report.primary_region ?? 'ap-south-1',
  };
}

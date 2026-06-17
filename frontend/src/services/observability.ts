import api from './api';

export type SloStatus = 'ok' | 'warning' | 'breached' | 'unknown';

export interface SloIndicator {
  id: string;
  name: string;
  target: number;
  value: number | null;
  unit: string;
  status: SloStatus;
  burn_rate: number;
  sample_count?: number;
}

export interface StatusComponent {
  id: string;
  name: string;
  status: 'operational' | 'degraded' | 'down' | 'unknown';
  detail: string;
}

export interface ObservabilitySnapshot {
  generated_at: string;
  overall_status: 'operational' | 'degraded' | 'down';
  indicators: SloIndicator[];
  components: StatusComponent[];
  alerting: {
    enabled: boolean;
    webhook_configured: boolean;
    rules: Array<{ id: string; severity: 'p1' | 'p2'; enabled: boolean; status: SloStatus }>;
  };
  external_links: {
    grafana_url: string | null;
    status_page_url: string | null;
  };
  telemetry: {
    metrics_enabled: boolean;
    cache_backend: string;
    siem_log_drain_configured: boolean;
  };
}

export interface ObservabilityReport {
  snapshot: ObservabilitySnapshot;
  dashboards: string[];
}

export async function getObservabilityReport(): Promise<ObservabilityReport> {
  const { data } = await api.get<ObservabilityReport>('/platform/observability');
  return data;
}

export async function sendTestSloAlert(): Promise<{ ok: boolean; detail: string }> {
  const { data } = await api.post<{ ok: boolean; detail: string }>('/platform/observability/test-alert');
  return data;
}

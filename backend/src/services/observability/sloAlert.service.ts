import config from '../../config';
import logger from '../../config/logger';
import type { SloSnapshot } from './slo.service';

export interface SloAlertPayload {
  event: 'slo_alert';
  severity: 'p1' | 'p2';
  rule_id: string;
  generated_at: string;
  overall_status: SloSnapshot['overall_status'];
  indicator?: {
    id: string;
    name: string;
    status: string;
    value: number | null;
    target: number;
    burn_rate: number;
  };
  components?: Array<{ id: string; status: string; detail: string }>;
}

export async function dispatchSloAlerts(snapshot: SloSnapshot): Promise<{ sent: number; skipped: string | null }> {
  if (!config.features.sloAlerts) {
    return { sent: 0, skipped: 'FEATURE_SLO_ALERTS=false' };
  }

  const webhook = config.observability.sloAlertWebhook;
  if (!webhook) {
    return { sent: 0, skipped: 'SLO_ALERT_WEBHOOK not configured' };
  }

  const alerts: SloAlertPayload[] = [];

  const errorIndicator = snapshot.indicators.find((indicator) => indicator.id === 'error_rate_5xx');
  if (errorIndicator && (errorIndicator.status === 'breached' || errorIndicator.burn_rate >= 2)) {
    alerts.push({
      event: 'slo_alert',
      severity: 'p2',
      rule_id: 'api_error_budget_burn_2x',
      generated_at: snapshot.generated_at,
      overall_status: snapshot.overall_status,
      indicator: {
        id: errorIndicator.id,
        name: errorIndicator.name,
        status: errorIndicator.status,
        value: errorIndicator.value,
        target: errorIndicator.target,
        burn_rate: errorIndicator.burn_rate,
      },
    });
  }

  const workerIndicator = snapshot.indicators.find((indicator) => indicator.id === 'worker_lag_p95_ms');
  const whatsappComponent = snapshot.components.find((component) => component.id === 'whatsapp_pipeline');
  if (
    (workerIndicator && workerIndicator.status === 'breached')
    || (whatsappComponent && whatsappComponent.status === 'degraded' && whatsappComponent.detail.includes('dlq='))
  ) {
    alerts.push({
      event: 'slo_alert',
      severity: 'p1',
      rule_id: 'worker_lag_or_dlq_p1',
      generated_at: snapshot.generated_at,
      overall_status: snapshot.overall_status,
      indicator: workerIndicator
        ? {
            id: workerIndicator.id,
            name: workerIndicator.name,
            status: workerIndicator.status,
            value: workerIndicator.value,
            target: workerIndicator.target,
            burn_rate: workerIndicator.burn_rate,
          }
        : undefined,
      components: whatsappComponent ? [whatsappComponent] : undefined,
    });
  }

  let sent = 0;
  for (const alert of alerts) {
    try {
      const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alert),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        logger.error('SLO alert webhook failed', {
          rule_id: alert.rule_id,
          status: response.status,
        });
        continue;
      }
      sent += 1;
      logger.info('SLO alert dispatched', {
        rule_id: alert.rule_id,
        severity: alert.severity,
      });
    } catch (err) {
      logger.error('SLO alert dispatch error', {
        rule_id: alert.rule_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { sent, skipped: null };
}

export async function sendTestAlert(): Promise<{ ok: boolean; detail: string }> {
  const webhook = config.observability.sloAlertWebhook;
  if (!webhook) {
    return { ok: false, detail: 'SLO_ALERT_WEBHOOK not configured' };
  }

  const payload: SloAlertPayload = {
    event: 'slo_alert',
    severity: 'p2',
    rule_id: 'test_alert',
    generated_at: new Date().toISOString(),
    overall_status: 'operational',
    indicator: {
      id: 'test',
      name: 'Synthetic test alert',
      status: 'ok',
      value: 0,
      target: 1,
      burn_rate: 0,
    },
  };

  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { ok: false, detail: `webhook HTTP ${response.status}` };
    }
    return { ok: true, detail: 'test alert sent' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

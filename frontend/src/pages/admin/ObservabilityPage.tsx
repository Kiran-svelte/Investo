import React from 'react';
import { Activity, AlertTriangle, BellRing, ExternalLink, Gauge, RefreshCw } from 'lucide-react';
import {
  getObservabilityReport,
  sendTestSloAlert,
  type ObservabilityReport,
  type SloIndicator,
} from '../../services/observability';

function indicatorTone(status: SloIndicator['status']): string {
  if (status === 'ok') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (status === 'warning') return 'bg-amber-50 text-amber-800 ring-amber-200';
  if (status === 'breached') return 'bg-rose-50 text-rose-700 ring-rose-200';
  return 'bg-slate-50 text-slate-700 ring-slate-200';
}

function componentTone(status: string): string {
  if (status === 'operational') return 'text-emerald-700';
  if (status === 'degraded') return 'text-amber-700';
  if (status === 'down') return 'text-rose-700';
  return 'text-slate-600';
}

const ObservabilityPage: React.FC = () => {
  const [report, setReport] = React.useState<ObservabilityReport | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [alertMessage, setAlertMessage] = React.useState<string | null>(null);

  const loadReport = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await getObservabilityReport());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load observability report');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const handleTestAlert = async () => {
    setAlertMessage(null);
    try {
      const result = await sendTestSloAlert();
      setAlertMessage(result.detail);
    } catch (err) {
      setAlertMessage(err instanceof Error ? err.message : 'Test alert failed');
    }
  };

  if (loading && !report) {
    return <div className="p-6"><div className="h-32 animate-pulse rounded-lg bg-white" /></div>;
  }

  if (error && !report) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-800">
          <p className="font-semibold">Observability unavailable</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!report) return null;

  const { snapshot, dashboards } = report;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">Observability</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Overall status: <span className={`font-semibold ${componentTone(snapshot.overall_status)}`}>{snapshot.overall_status}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadReport()}
            className="inline-flex items-center gap-2 rounded-lg border border-surface-border bg-white px-3 py-2 text-sm font-semibold text-ink-secondary"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void handleTestAlert()}
            className="inline-flex items-center gap-2 rounded-lg bg-ink-primary px-3 py-2 text-sm font-semibold text-white"
          >
            <BellRing className="h-4 w-4" />
            Test alert
          </button>
        </div>
      </div>

      {alertMessage && (
        <div className="rounded-lg border border-surface-border bg-white p-3 text-sm text-ink-secondary">{alertMessage}</div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-surface-border bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Metrics</p>
          <p className="mt-2 text-lg font-semibold text-ink-primary">
            {snapshot.telemetry.metrics_enabled ? 'Enabled' : 'Disabled'}
          </p>
          <p className="mt-1 text-sm text-ink-muted">cache={snapshot.telemetry.cache_backend}</p>
        </div>
        <div className="rounded-xl border border-surface-border bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Alerting</p>
          <p className="mt-2 text-lg font-semibold text-ink-primary">
            {snapshot.alerting.enabled && snapshot.alerting.webhook_configured ? 'Armed' : 'Not armed'}
          </p>
          <p className="mt-1 text-sm text-ink-muted">{snapshot.alerting.rules.length} rules configured</p>
        </div>
        <div className="rounded-xl border border-surface-border bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">External</p>
          <div className="mt-2 space-y-1 text-sm">
            {snapshot.external_links.grafana_url && (
              <a href={snapshot.external_links.grafana_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600">
                Grafana <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            {snapshot.external_links.status_page_url && (
              <a href={snapshot.external_links.status_page_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600">
                Status page <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            {!snapshot.external_links.grafana_url && !snapshot.external_links.status_page_url && (
              <span className="text-ink-muted">Set GRAFANA_BASE_URL / STATUS_PAGE_URL</span>
            )}
          </div>
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink-primary">SLO indicators</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {snapshot.indicators.map((indicator) => (
            <div key={indicator.id} className={`rounded-xl p-4 ring-1 ${indicatorTone(indicator.status)}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{indicator.name}</p>
                  <p className="mt-1 text-sm">
                    value={indicator.value ?? 'n/a'} target={indicator.target} burn={indicator.burn_rate}
                  </p>
                </div>
                <Gauge className="h-5 w-5 shrink-0 opacity-70" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink-primary">Components</h2>
        <div className="overflow-hidden rounded-xl border border-surface-border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-subtle text-left text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Component</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Detail</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.components.map((component) => (
                <tr key={component.id} className="border-t border-surface-border">
                  <td className="px-4 py-3 font-medium text-ink-primary">{component.name}</td>
                  <td className={`px-4 py-3 font-semibold ${componentTone(component.status)}`}>{component.status}</td>
                  <td className="px-4 py-3 text-ink-secondary">{component.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink-primary">Grafana dashboards (as code)</h2>
        <div className="flex flex-wrap gap-2">
          {dashboards.map((dashboard) => (
            <span key={dashboard} className="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-3 py-1 text-xs font-semibold text-ink-secondary">
              <Activity className="h-3.5 w-3.5" />
              infra/grafana/{dashboard}.json
            </span>
          ))}
        </div>
        <p className="mt-3 flex items-start gap-2 text-sm text-ink-muted">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Import JSON files into Grafana and set GRAFANA_BASE_URL for the external link above.
        </p>
      </section>
    </div>
  );
};

export default ObservabilityPage;

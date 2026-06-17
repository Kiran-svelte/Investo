import React from 'react';
import { AlertTriangle, Gauge, RefreshCw } from 'lucide-react';
import { getTenantQuotaUsage, type QuotaDimension, type TenantQuotaUsageResponse } from '../../services/quota';

function usageTone(used: number, limit: number): string {
  const ratio = limit > 0 ? used / limit : 0;
  if (ratio >= 1) return 'bg-rose-500';
  if (ratio >= 0.8) return 'bg-amber-500';
  return 'bg-emerald-500';
}

const UsageQuotaPage: React.FC = () => {
  const [snapshot, setSnapshot] = React.useState<TenantQuotaUsageResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const loadUsage = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await getTenantQuotaUsage());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load usage');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  if (loading && !snapshot) {
    return <div className="p-6"><div className="h-32 animate-pulse rounded-lg bg-white" /></div>;
  }

  if (error && !snapshot) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-800">
          <p className="font-semibold">Usage unavailable</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!snapshot) return null;

  const dimensions = Object.keys(snapshot.usage) as QuotaDimension[];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">Usage & Limits</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Plan tier: <span className="font-semibold uppercase">{snapshot.tier}</span>
            {snapshot.enforcement.hard ? ' - hard limits active' : ' - warn-only mode'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadUsage()}
          className="inline-flex items-center gap-2 rounded-lg border border-surface-border bg-white px-3 py-2 text-sm font-semibold text-ink-secondary"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {!snapshot.enforcement.enabled && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Quota enforcement is not enabled on this environment</p>
            <p className="mt-1 text-sm">Limits below reflect plan defaults for visibility only.</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {dimensions.map((dimension) => {
          const entry = snapshot.usage[dimension];
          const pct = entry.limit > 0 ? Math.min(100, Math.round((entry.used / entry.limit) * 100)) : 0;
          return (
            <div key={dimension} className="rounded-xl border border-surface-border bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink-primary">{snapshot.labels[dimension]}</p>
                  <p className="mt-1 text-xs text-ink-muted">{entry.used.toLocaleString()} / {entry.limit.toLocaleString()}</p>
                </div>
                <Gauge className="h-5 w-5 text-ink-muted" />
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-subtle">
                <div className={`h-full ${usageTone(entry.used, entry.limit)}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default UsageQuotaPage;

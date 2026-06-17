import React from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import {
  computeTenantHealth,
  getTenantHealth,
  listAdminCompanies,
  type AdminCompanyRow,
  type TenantHealthScore,
} from '../../services/supportOps';

interface TenantHealthRow extends AdminCompanyRow {
  score: number | null;
  computedAt: string | null;
  signals: TenantHealthScore['signals'] | null;
}

function scoreTone(score: number | null): string {
  if (score === null) return 'text-slate-600 bg-slate-50';
  if (score >= 80) return 'text-emerald-700 bg-emerald-50';
  if (score >= 60) return 'text-amber-800 bg-amber-50';
  return 'text-rose-700 bg-rose-50';
}

const TenantHealthPage: React.FC = () => {
  const [rows, setRows] = React.useState<TenantHealthRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const companies = await listAdminCompanies();
      const enriched = await Promise.all(
        companies.map(async (company) => {
          try {
            const res = await getTenantHealth(company.id);
            return {
              ...company,
              score: res.health?.score ?? null,
              computedAt: res.health?.computedAt ?? null,
              signals: res.health?.signals ?? null,
            };
          } catch {
            return { ...company, score: null, computedAt: null, signals: null };
          }
        }),
      );
      enriched.sort((a, b) => (a.score ?? -1) - (b.score ?? -1));
      setRows(enriched);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tenant health');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleCompute = async (companyId: string) => {
    setBusyId(companyId);
    try {
      await computeTenantHealth(companyId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compute health score');
    } finally {
      setBusyId(null);
    }
  };

  if (loading && rows.length === 0) {
    return <div className="p-6"><div className="h-32 animate-pulse rounded-lg bg-white" /></div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">Tenant Health</h1>
          <p className="mt-1 text-sm text-ink-muted">Support view of tenant health scores and risk signals.</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-lg border border-surface-border bg-white px-3 py-2 text-sm font-semibold text-ink-secondary"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-surface-border bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-subtle/40 text-left text-xs uppercase text-ink-muted">
              <th className="px-4 py-3">Tenant</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Signals</th>
              <th className="px-4 py-3">Computed</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-surface-border/60">
                <td className="px-4 py-3">
                  <p className="font-semibold text-ink-primary">{row.name}</p>
                  <p className="text-xs text-ink-muted">{row.slug}</p>
                </td>
                <td className="px-4 py-3 capitalize">{row.status}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${scoreTone(row.score)}`}>
                    {row.score ?? '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-ink-muted">
                  {row.signals
                    ? `DSR ${row.signals.open_dsr} · AI ${row.signals.pending_ai_reviews} · WH ${row.signals.failed_webhooks}`
                    : '—'}
                </td>
                <td className="px-4 py-3 text-xs text-ink-muted">
                  {row.computedAt ? new Date(row.computedAt).toLocaleString() : 'Never'}
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void handleCompute(row.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-2 py-1 text-xs font-semibold"
                  >
                    <Activity className="h-3.5 w-3.5" />
                    Compute
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TenantHealthPage;

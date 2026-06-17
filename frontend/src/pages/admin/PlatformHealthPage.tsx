import React from 'react';
import { Activity, AlertTriangle, CheckCircle2, Gauge, RefreshCw, ServerCog, ShieldCheck } from 'lucide-react';
import { getEnterpriseBaselineReport, type EnterpriseBaselineReport } from '../../services/platformHealth';

function scoreTone(score: number): string {
  if (score >= 4) return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (score >= 3) return 'bg-teal-50 text-teal-800 ring-teal-200';
  if (score >= 2) return 'bg-amber-50 text-amber-800 ring-amber-200';
  return 'bg-rose-50 text-rose-700 ring-rose-200';
}

const PlatformHealthPage: React.FC = () => {
  const [report, setReport] = React.useState<EnterpriseBaselineReport | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const loadReport = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await getEnterpriseBaselineReport());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load platform health');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadReport();
  }, [loadReport]);

  if (loading && !report) {
    return (
      <div className="p-6">
        <div className="h-32 animate-pulse rounded-lg bg-white" />
      </div>
    );
  }

  if (error && !report) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-800">
          <p className="font-semibold">Platform health unavailable</p>
          <p className="mt-1 text-sm">{error}</p>
          <button
            type="button"
            onClick={() => void loadReport()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!report) return null;

  const generatedAt = new Date(report.generated_at).toLocaleString();
  const gapDomains = report.domains.filter((domain) => domain.score < 3);
  const healthyDomains = report.domains.filter((domain) => domain.score >= 3);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">Platform Health</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Live enterprise baseline · {generatedAt}
          </p>
          {report.exit_gate_ready ? (
            <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
              <ShieldCheck className="h-3.5 w-3.5" />
              Exit gate ready
            </p>
          ) : (
            <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
              <AlertTriangle className="h-3.5 w-3.5" />
              Exit gate not ready
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void loadReport()}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-surface-border bg-white px-3 py-2 text-sm font-semibold text-ink-secondary shadow-sm transition-colors hover:bg-surface-subtle"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <div className="rounded-lg border border-surface-border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-medium text-ink-muted">
            <Gauge className="h-4 w-4" />
            Overall
          </div>
          <p className="mt-3 text-3xl font-semibold text-ink-primary">{report.overall_score}%</p>
        </div>
        <div className="rounded-lg border border-surface-border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-medium text-ink-muted">
            <ServerCog className="h-4 w-4" />
            Worker
          </div>
          <p className="mt-3 text-base font-semibold text-ink-primary">{report.worker_mode}</p>
        </div>
        <div className="rounded-lg border border-surface-border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-medium text-ink-muted">
            <Activity className="h-4 w-4" />
            Redis
          </div>
          <p className="mt-3 text-base font-semibold text-ink-primary">{report.redis_status}</p>
        </div>
        <div className="rounded-lg border border-surface-border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-medium text-ink-muted">
            <CheckCircle2 className="h-4 w-4" />
            Chunks
          </div>
          <p className="mt-3 text-base font-semibold text-ink-primary">{report.chunk_progress_pct}%</p>
        </div>
        <div className="rounded-lg border border-surface-border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-medium text-ink-muted">
            <CheckCircle2 className="h-4 w-4" />
            Healthy domains
          </div>
          <p className="mt-3 text-base font-semibold text-ink-primary">
            {healthyDomains.length}/{report.domains.length}
          </p>
        </div>
      </div>

      {gapDomains.length > 0 ? (
        <section className="rounded-lg border border-surface-border bg-white shadow-sm">
          <div className="border-b border-surface-border px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Open gaps (score below 3/4)</h2>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {gapDomains.map((domain) => (
              <div key={domain.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {domain.name}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${scoreTone(domain.score)}`}>
                    {domain.score}/4
                  </span>
                </div>
                <p className="mt-2 text-xs text-amber-900">{domain.blockers[0]}</p>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-5 w-5" />
            All maturity domains are at or above target (3/4).
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-lg border border-surface-border bg-white shadow-sm">
        <div className="border-b border-surface-border px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Maturity domains</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-surface-border text-sm">
            <thead className="bg-surface-subtle text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Domain</th>
                <th className="px-4 py-3 font-semibold">Score</th>
                <th className="px-4 py-3 font-semibold">Chunk</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {report.domains.map((domain) => (
                <tr key={domain.id}>
                  <td className="px-4 py-3 font-medium text-ink-primary">{domain.name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex min-w-12 justify-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${scoreTone(domain.score)}`}>
                      {domain.score}/4
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-secondary">{domain.chunk}</td>
                  <td className="max-w-xl px-4 py-3 text-ink-secondary">{domain.blockers[0]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default PlatformHealthPage;

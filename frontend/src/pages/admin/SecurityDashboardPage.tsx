import React from 'react';
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  getSecretRotations,
  getSecurityScanReport,
  recordSecretRotation,
  type SecretRotationRow,
  type SecurityScanReport,
} from '../../services/security';

function statusTone(status: string): string {
  if (status === 'pass') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (status === 'fail') return 'text-rose-700 bg-rose-50 border-rose-200';
  return 'text-amber-800 bg-amber-50 border-amber-200';
}

const SecurityDashboardPage: React.FC = () => {
  const [report, setReport] = React.useState<SecurityScanReport | null>(null);
  const [rotations, setRotations] = React.useState<SecretRotationRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [scan, rows] = await Promise.all([getSecurityScanReport(), getSecretRotations()]);
      setReport(scan);
      setRotations(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load security dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleRecordRotation = async (secretName: string) => {
    await recordSecretRotation(secretName);
    await load();
  };

  if (loading && !report) {
    return <div className="p-6"><div className="h-32 animate-pulse rounded-lg bg-white" /></div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">Security Dashboard</h1>
          <p className="mt-1 text-sm text-ink-muted">Platform self-checks, secret rotation audit, and WAF runbook status.</p>
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

      <section className="rounded-xl border border-surface-border bg-white p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-brand-700" />
          <h2 className="text-lg font-semibold text-ink-primary">Runtime security scan</h2>
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          Generated {report ? new Date(report.generated_at).toLocaleString() : '—'}
        </p>
        <ul className="mt-4 space-y-2">
          {(report?.checks || []).map((check) => (
            <li key={check.id} className={`rounded-lg border px-3 py-2 text-sm ${statusTone(check.status)}`}>
              <span className="font-semibold uppercase">{check.status}</span>
              <span className="mx-2">·</span>
              <span className="font-medium">{check.id}</span>
              <span className="mx-2">—</span>
              {check.detail}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-surface-border bg-white p-5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-brand-700" />
          <h2 className="text-lg font-semibold text-ink-primary">Secret rotation log</h2>
        </div>
        {rotations.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">No rotations recorded yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-surface-border">
            {rotations.map((row) => (
              <li key={`${row.secret_name}-${row.rotated_at}`} className="py-2 text-sm text-ink-secondary">
                <span className="font-semibold">{row.secret_name}</span>
                <span className="mx-2">·</span>
                {new Date(row.rotated_at).toLocaleString()}
                <span className="mx-2">·</span>
                by {row.rotated_by}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {['JWT_SECRET', 'PII_ENCRYPTION_KEY', 'MFA_ENCRYPTION_KEY'].map((name) => (
            <button
              key={name}
              type="button"
              className="rounded-lg border border-surface-border px-3 py-1.5 text-xs font-semibold text-ink-secondary"
              onClick={() => void handleRecordRotation(name)}
            >
              Record rotation: {name}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        WAF edge configuration is documented in <code className="font-mono">docs/enterprise/WAF_RUNBOOK.md</code>.
        Enable Cloudflare proxy + Meta webhook allowlist before claiming production WAF proof.
      </section>
    </div>
  );
};

export default SecurityDashboardPage;

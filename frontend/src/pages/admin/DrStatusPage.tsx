import React from 'react';
import { AlertTriangle, DatabaseBackup, RefreshCw, ShieldOff } from 'lucide-react';
import { getDrStatus, type DrStatusSnapshot } from '../../services/platformHealth';

function backupTone(ageHours: number | null): string {
  if (ageHours === null) return 'border-amber-200 bg-amber-50 text-amber-900';
  if (ageHours <= 24) return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  if (ageHours <= 48) return 'border-amber-200 bg-amber-50 text-amber-900';
  return 'border-rose-200 bg-rose-50 text-rose-900';
}

const DrStatusPage: React.FC = () => {
  const [snapshot, setSnapshot] = React.useState<DrStatusSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await getDrStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load DR status');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (loading && !snapshot) {
    return <div className="p-6"><div className="h-32 animate-pulse rounded-lg bg-white" /></div>;
  }

  if (error && !snapshot) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-800">
          <p className="font-semibold">DR status unavailable</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!snapshot) return null;

  return (
    <div className="space-y-6 p-6">
      {snapshot.read_only_mode ? (
        <div className="flex items-start gap-3 rounded-xl border border-rose-300 bg-rose-600 px-4 py-4 text-white shadow-sm">
          <ShieldOff className="mt-0.5 h-6 w-6 shrink-0" />
          <div>
            <p className="text-lg font-semibold">Read-only mode active</p>
            <p className="mt-1 text-sm text-rose-100">
              Mutating API requests are blocked while disaster recovery procedures are in progress.
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">Disaster Recovery Status</h1>
          <p className="mt-1 text-sm text-ink-muted">Backup freshness and platform read-only state.</p>
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

      <div className="grid gap-4 md:grid-cols-2">
        <div className={`rounded-xl border p-5 ${backupTone(snapshot.backup_age_hours)}`}>
          <div className="flex items-center gap-2">
            <DatabaseBackup className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Last successful backup</h2>
          </div>
          <p className="mt-3 text-2xl font-semibold">
            {snapshot.backup_last_success_at
              ? new Date(snapshot.backup_last_success_at).toLocaleString()
              : 'Not reported'}
          </p>
          <p className="mt-1 text-sm opacity-90">
            {snapshot.backup_age_hours !== null
              ? `${snapshot.backup_age_hours} hours ago`
              : 'Set BACKUP_LAST_SUCCESS_AT on the server for live backup age tracking.'}
          </p>
        </div>

        <div className="rounded-xl border border-surface-border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-ink-muted" />
            <h2 className="text-lg font-semibold text-ink-primary">Platform mode</h2>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Read-only mode</dt>
              <dd className="font-semibold">{snapshot.read_only_mode ? 'ON' : 'OFF'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Primary region</dt>
              <dd className="font-semibold">{snapshot.primary_region}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">RPO target</dt>
              <dd className="font-semibold">&lt; 15 minutes</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">RTO target</dt>
              <dd className="font-semibold">&lt; 1 hour</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
};

export default DrStatusPage;

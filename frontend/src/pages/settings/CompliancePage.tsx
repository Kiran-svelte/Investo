import React from 'react';
import { FileCheck, Plus, RefreshCw, Shield } from 'lucide-react';
import {
  acceptDpa,
  createDsrRequest,
  getComplianceStatus,
  getDpaStatus,
  getRetentionPolicy,
  listDsrRequests,
  processDsrRequest,
  updateRetentionPolicy,
  type ComplianceFeatureStatus,
  type DpaStatus,
  type DsrRequest,
  type DsrRequestType,
  type RetentionPolicy,
} from '../../services/compliance';

function dsrStatusTone(status: string): string {
  if (status === 'completed') return 'text-emerald-700 bg-emerald-50';
  if (status === 'failed') return 'text-rose-700 bg-rose-50';
  if (status === 'processing') return 'text-amber-800 bg-amber-50';
  return 'text-slate-700 bg-slate-50';
}

const CompliancePage: React.FC = () => {
  const [features, setFeatures] = React.useState<ComplianceFeatureStatus | null>(null);
  const [requests, setRequests] = React.useState<DsrRequest[]>([]);
  const [retention, setRetention] = React.useState<RetentionPolicy>({ messageDays: 365, leadInactiveDays: 730, auditDays: 2555 });
  const [dpa, setDpa] = React.useState<DpaStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [newType, setNewType] = React.useState<DsrRequestType>('export');
  const [subjectPhone, setSubjectPhone] = React.useState('');
  const [subjectEmail, setSubjectEmail] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [status, dsrRows, policy, dpaStatus] = await Promise.all([
        getComplianceStatus(),
        listDsrRequests().catch(() => []),
        getRetentionPolicy().catch(() => null),
        getDpaStatus().catch(() => null),
      ]);
      setFeatures(status);
      setRequests(dsrRows);
      if (policy) setRetention(policy);
      setDpa(dpaStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load compliance settings');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleCreateDsr = async () => {
    setBusy(true);
    setError(null);
    try {
      await createDsrRequest({
        request_type: newType,
        subject_phone: subjectPhone || undefined,
        subject_email: subjectEmail || undefined,
      });
      setSubjectPhone('');
      setSubjectEmail('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create DSR');
    } finally {
      setBusy(false);
    }
  };

  const handleProcess = async (id: string) => {
    setBusy(true);
    try {
      await processDsrRequest(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process DSR');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveRetention = async () => {
    setBusy(true);
    try {
      await updateRetentionPolicy(retention);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save retention policy');
    } finally {
      setBusy(false);
    }
  };

  const handleAcceptDpa = async () => {
    setBusy(true);
    try {
      await acceptDpa();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept DPA');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !features) {
    return <div className="p-6"><div className="h-32 animate-pulse rounded-lg bg-white" /></div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">Compliance & Privacy</h1>
          <p className="mt-1 text-sm text-ink-muted">Data subject requests, retention policy, and DPA acceptance.</p>
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

      {features ? (
        <div className="flex flex-wrap gap-2 text-xs">
          {(['dsr', 'retention', 'legal_hold', 'dpa'] as const).map((key) => (
            <span
              key={key}
              className={`rounded-full px-2.5 py-1 font-semibold ring-1 ${
                features[key] ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-slate-50 text-slate-600 ring-slate-200'
              }`}
            >
              {key.replace('_', ' ')}: {features[key] ? 'enabled' : 'disabled'}
            </span>
          ))}
        </div>
      ) : null}

      <section className="rounded-xl border border-surface-border bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <FileCheck className="h-5 w-5 text-brand-700" />
          <h2 className="text-lg font-semibold text-ink-primary">Data subject requests</h2>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as DsrRequestType)}
            className="rounded-lg border border-surface-border px-3 py-2 text-sm"
          >
            <option value="export">Export</option>
            <option value="access">Access</option>
            <option value="delete">Delete</option>
          </select>
          <input
            type="tel"
            placeholder="Subject phone (optional)"
            value={subjectPhone}
            onChange={(e) => setSubjectPhone(e.target.value)}
            className="rounded-lg border border-surface-border px-3 py-2 text-sm"
          />
          <input
            type="email"
            placeholder="Subject email (optional)"
            value={subjectEmail}
            onChange={(e) => setSubjectEmail(e.target.value)}
            className="rounded-lg border border-surface-border px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy || !features?.dsr}
            onClick={() => void handleCreateDsr()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Create request
          </button>
        </div>
        <ul className="mt-4 divide-y divide-surface-border">
          {requests.length === 0 ? (
            <li className="py-4 text-sm text-ink-muted">No DSR requests yet.</li>
          ) : (
            requests.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-semibold text-ink-primary">
                    {row.requestType.toUpperCase()} — {row.subjectPhone || row.subjectEmail || 'tenant-wide'}
                  </p>
                  <p className="text-xs text-ink-muted">{new Date(row.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${dsrStatusTone(row.status)}`}>
                    {row.status}
                  </span>
                  {row.status === 'pending' && features?.dsr ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleProcess(row.id)}
                      className="rounded-lg border border-surface-border px-2 py-1 text-xs font-semibold"
                    >
                      Process
                    </button>
                  ) : null}
                </div>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="rounded-xl border border-surface-border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-ink-primary">Retention policy</h2>
        <p className="mt-1 text-sm text-ink-muted">Configure how long messages, inactive leads, and audit logs are kept.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {([
            ['messageDays', 'Message retention (days)'],
            ['leadInactiveDays', 'Inactive lead archive (days)'],
            ['auditDays', 'Audit log retention (days)'],
          ] as const).map(([key, label]) => (
            <label key={key} className="block text-sm">
              <span className="font-medium text-ink-secondary">{label}</span>
              <input
                type="number"
                min={1}
                value={retention[key] ?? ''}
                onChange={(e) => setRetention((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                className="mt-1 w-full rounded-lg border border-surface-border px-3 py-2"
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={busy || !features?.retention}
          onClick={() => void handleSaveRetention()}
          className="mt-4 rounded-lg bg-ink-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Save retention policy
        </button>
      </section>

      <section className="rounded-xl border border-surface-border bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-brand-700" />
          <h2 className="text-lg font-semibold text-ink-primary">Data Processing Agreement</h2>
        </div>
        <p className="mt-2 text-sm text-ink-muted">
          {dpa?.current_version_accepted
            ? 'Current DPA version accepted for this tenant.'
            : 'Accept the current DPA to enable enterprise compliance workflows.'}
        </p>
        {dpa?.latest ? (
          <p className="mt-1 text-xs text-ink-muted">
            Last accepted v{dpa.latest.version} on {new Date(dpa.latest.acceptedAt).toLocaleString()}
          </p>
        ) : null}
        {!dpa?.current_version_accepted ? (
          <button
            type="button"
            disabled={busy || !features?.dpa}
            onClick={() => void handleAcceptDpa()}
            className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Accept DPA
          </button>
        ) : null}
      </section>
    </div>
  );
};

export default CompliancePage;

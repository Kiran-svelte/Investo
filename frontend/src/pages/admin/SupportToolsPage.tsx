import React from 'react';
import { LifeBuoy, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  listAdminCompanies,
  revokeImpersonation,
  startImpersonation,
  type AdminCompanyRow,
  type ImpersonationSession,
} from '../../services/supportOps';

const SupportToolsPage: React.FC = () => {
  const [companies, setCompanies] = React.useState<AdminCompanyRow[]>([]);
  const [companyId, setCompanyId] = React.useState('');
  const [targetUserId, setTargetUserId] = React.useState('');
  const [ticketId, setTicketId] = React.useState('');
  const [session, setSession] = React.useState<ImpersonationSession | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listAdminCompanies();
      setCompanies(rows);
      setCompanyId((prev) => prev || rows[0]?.id || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load companies');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleStart = async () => {
    if (!companyId || !targetUserId.trim() || !ticketId.trim()) {
      setError('Company, target user ID, and ticket ID are required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await startImpersonation({
        company_id: companyId,
        target_user_id: targetUserId.trim(),
        ticket_id: ticketId.trim(),
        ttl_minutes: 60,
      });
      setSession(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start impersonation');
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    if (!session) return;
    setBusy(true);
    try {
      await revokeImpersonation(session.id, session.companyId);
      setSession(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke session');
    } finally {
      setBusy(false);
    }
  };

  if (loading && companies.length === 0) {
    return <div className="p-6"><div className="h-32 animate-pulse rounded-lg bg-white" /></div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">Support Tools</h1>
          <p className="mt-1 text-sm text-ink-muted">Audited support impersonation for tenant troubleshooting.</p>
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

      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
        <p className="text-sm">
          Impersonation requires a support ticket ID and is fully audited. Use only for approved support cases.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
      ) : null}

      {session ? (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
          <p className="font-semibold text-orange-950">Active impersonation session</p>
          <p className="mt-1 text-sm text-orange-900">
            Session {session.id} · company {session.companyId} · expires {new Date(session.expiresAt).toLocaleString()}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleRevoke()}
            className="mt-3 rounded-lg bg-orange-800 px-3 py-2 text-sm font-semibold text-white"
          >
            End session
          </button>
        </div>
      ) : null}

      <section className="rounded-xl border border-surface-border bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <LifeBuoy className="h-5 w-5 text-brand-700" />
          <h2 className="text-lg font-semibold text-ink-primary">Start impersonation</h2>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-ink-secondary">Tenant</span>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-surface-border px-3 py-2"
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-ink-secondary">Target user ID</span>
            <input
              type="text"
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-surface-border px-3 py-2"
              placeholder="UUID of company_admin user"
            />
          </label>
          <label className="block text-sm md:col-span-2">
            <span className="font-medium text-ink-secondary">Support ticket ID</span>
            <input
              type="text"
              value={ticketId}
              onChange={(e) => setTicketId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-surface-border px-3 py-2"
              placeholder="e.g. ZENDESK-12345"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleStart()}
          className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Start impersonation
        </button>
      </section>
    </div>
  );
};

export default SupportToolsPage;

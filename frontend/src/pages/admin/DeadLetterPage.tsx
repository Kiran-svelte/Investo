import React from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import {
  listWhatsAppDeadLetters,
  replayWhatsAppDeadLetter,
  type WhatsAppDeadLetter,
} from '../../services/deadLetter';

const DeadLetterPage: React.FC = () => {
  const [items, setItems] = React.useState<WhatsAppDeadLetter[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [replayingId, setReplayingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listWhatsAppDeadLetters());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load message failures');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const replay = async (id: string) => {
    setReplayingId(id);
    setError(null);
    try {
      await replayWhatsAppDeadLetter(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to replay message failure');
    } finally {
      setReplayingId(null);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">Message Failures</h1>
          <p className="mt-1 text-sm text-ink-muted">WhatsApp jobs that exhausted retries and need replay or investigation.</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-surface-border bg-white px-3 py-2 text-sm font-semibold text-ink-secondary shadow-sm transition-colors hover:bg-surface-subtle"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-surface-border bg-white shadow-sm">
        <div className="border-b border-surface-border px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">WhatsApp DLQ</h2>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-ink-muted">Loading...</div>
        ) : items.length === 0 ? (
          <div className="flex items-center gap-3 p-6 text-sm text-ink-muted">
            <AlertTriangle className="h-5 w-5" />
            No failed WhatsApp jobs.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-surface-border text-sm">
              <thead className="bg-surface-subtle text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Created</th>
                  <th className="px-4 py-3 font-semibold">Company</th>
                  <th className="px-4 py-3 font-semibold">Job</th>
                  <th className="px-4 py-3 font-semibold">Error</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-secondary">
                      {new Date(item.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-secondary">{item.companyId}</td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-secondary">{item.jobId}</td>
                    <td className="max-w-lg px-4 py-3 text-ink-primary">{item.error}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => void replay(item.id)}
                        disabled={replayingId === item.id}
                        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
                      >
                        <RotateCcw className={`h-3.5 w-3.5 ${replayingId === item.id ? 'animate-spin' : ''}`} />
                        Replay
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default DeadLetterPage;

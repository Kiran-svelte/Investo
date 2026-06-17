import React from 'react';
import { Bot, Check, RefreshCw, X } from 'lucide-react';
import {
  listAiReviewQueue,
  listPromptVersions,
  reviewAiQueueItem,
  type AiReviewQueueItem,
  type PromptVersion,
} from '../../services/governance';

function scoreTone(score: number, threshold: number): string {
  if (score >= threshold) return 'text-rose-700 bg-rose-50';
  if (score >= threshold * 0.7) return 'text-amber-800 bg-amber-50';
  return 'text-emerald-700 bg-emerald-50';
}

const AiGovernancePage: React.FC = () => {
  const [queue, setQueue] = React.useState<AiReviewQueueItem[]>([]);
  const [prompts, setPrompts] = React.useState<PromptVersion[]>([]);
  const [threshold, setThreshold] = React.useState(0.7);
  const [queueEnabled, setQueueEnabled] = React.useState(false);
  const [promptsEnabled, setPromptsEnabled] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [queueRes, promptRes] = await Promise.all([listAiReviewQueue(), listPromptVersions()]);
      setQueue(queueRes.items);
      setThreshold(queueRes.threshold);
      setQueueEnabled(queueRes.enabled);
      setPrompts(promptRes.versions);
      setPromptsEnabled(promptRes.enabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AI governance data');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleReview = async (id: string, status: 'approved' | 'rejected') => {
    setBusyId(id);
    try {
      await reviewAiQueueItem(id, status);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review action failed');
    } finally {
      setBusyId(null);
    }
  };

  if (loading && queue.length === 0 && prompts.length === 0) {
    return <div className="p-6"><div className="h-32 animate-pulse rounded-lg bg-white" /></div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">AI Governance</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Review high-risk AI replies and inspect prompt versions.
            {!queueEnabled ? ' Review queue feature flag is off in this environment.' : ''}
          </p>
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

      <section className="rounded-xl border border-surface-border bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-brand-700" />
          <h2 className="text-lg font-semibold text-ink-primary">Review queue</h2>
          <span className="text-xs text-ink-muted">Risk threshold: {threshold}</span>
        </div>
        <ul className="mt-4 divide-y divide-surface-border">
          {queue.filter((item) => item.status === 'pending').length === 0 ? (
            <li className="py-4 text-sm text-ink-muted">No pending reviews.</li>
          ) : (
            queue
              .filter((item) => item.status === 'pending')
              .map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-semibold text-ink-primary">
                      Message {item.messageId || item.id}
                    </p>
                    <p className="text-xs text-ink-muted">{item.reason || 'High risk score'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${scoreTone(item.riskScore, threshold)}`}>
                      risk {item.riskScore.toFixed(2)}
                    </span>
                    {queueEnabled ? (
                      <>
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => void handleReview(item.id, 'approved')}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => void handleReview(item.id, 'rejected')}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-800"
                        >
                          <X className="h-3.5 w-3.5" />
                          Reject
                        </button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))
          )}
        </ul>
      </section>

      <section className="rounded-xl border border-surface-border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-ink-primary">Prompt versions</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {promptsEnabled ? 'Read-only list of registered prompt versions.' : 'Prompt versioning is disabled in this environment.'}
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-xs uppercase text-ink-muted">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Version</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Active</th>
              </tr>
            </thead>
            <tbody>
              {prompts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-4 text-ink-muted">No prompt versions registered.</td>
                </tr>
              ) : (
                prompts.map((row) => (
                  <tr key={row.id} className="border-b border-surface-border/60">
                    <td className="py-2 pr-4 font-medium">{row.name}</td>
                    <td className="py-2 pr-4">{row.version}</td>
                    <td className="py-2 pr-4">{row.status}</td>
                    <td className="py-2">{row.active ? 'Yes' : 'No'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default AiGovernancePage;

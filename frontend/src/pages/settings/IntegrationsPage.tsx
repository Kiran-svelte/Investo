import React from 'react';
import { Copy, KeyRound, Plug, Plus, RefreshCw, Webhook } from 'lucide-react';
import {
  createApiKey,
  createWebhook,
  getPublicApiHealth,
  listApiKeys,
  listWebhooks,
  revokeApiKey,
  testWebhook,
  type ApiKeyRow,
  type WebhookSubscription,
} from '../../services/publicApi';

const DEFAULT_SCOPES = ['leads:read'];

const IntegrationsPage: React.FC = () => {
  const [keys, setKeys] = React.useState<ApiKeyRow[]>([]);
  const [webhooks, setWebhooks] = React.useState<WebhookSubscription[]>([]);
  const [apiEnabled, setApiEnabled] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [rawKey, setRawKey] = React.useState<string | null>(null);
  const [webhookSecret, setWebhookSecret] = React.useState<string | null>(null);
  const [keyName, setKeyName] = React.useState('');
  const [webhookUrl, setWebhookUrl] = React.useState('');
  const [webhookEvents, setWebhookEvents] = React.useState('lead.created,lead.updated');
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [health, keyRows, hookRows] = await Promise.all([
        getPublicApiHealth(),
        listApiKeys().catch(() => []),
        listWebhooks().catch(() => []),
      ]);
      setApiEnabled(health.public_api_enabled);
      setKeys(keyRows);
      setWebhooks(hookRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load integrations');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleCreateKey = async () => {
    if (!keyName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createApiKey({ name: keyName.trim(), scopes: DEFAULT_SCOPES });
      setRawKey(created.raw_key);
      setKeyName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key');
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setBusy(true);
    try {
      await revokeApiKey(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke key');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateWebhook = async () => {
    if (!webhookUrl.trim()) return;
    setBusy(true);
    try {
      const events = webhookEvents.split(',').map((e) => e.trim()).filter(Boolean);
      const created = await createWebhook({ url: webhookUrl.trim(), events });
      setWebhookSecret(created.secret);
      setWebhookUrl('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create webhook');
    } finally {
      setBusy(false);
    }
  };

  const handleTestWebhook = async () => {
    setBusy(true);
    try {
      await testWebhook(webhookSecret || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Webhook test failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading && keys.length === 0) {
    return <div className="p-6"><div className="h-32 animate-pulse rounded-lg bg-white" /></div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">Integrations</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Public API keys and signed outbound webhooks.
            {!apiEnabled ? ' Public API is disabled in this environment.' : ''}
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

      {rawKey ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Copy your new API key now — it will not be shown again.</p>
          <code className="mt-2 block break-all rounded bg-white/80 p-2 text-xs">{rawKey}</code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(rawKey);
            }}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </button>
        </div>
      ) : null}

      <section className="rounded-xl border border-surface-border bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-brand-700" />
          <h2 className="text-lg font-semibold text-ink-primary">API keys</h2>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Key name (e.g. Zoho sync)"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            className="min-w-[220px] flex-1 rounded-lg border border-surface-border px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy || !apiEnabled}
            onClick={() => void handleCreateKey()}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Create key
          </button>
        </div>
        <ul className="mt-4 divide-y divide-surface-border">
          {keys.length === 0 ? (
            <li className="py-3 text-sm text-ink-muted">No API keys yet.</li>
          ) : (
            keys.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="text-sm font-semibold">{row.name}</p>
                  <p className="text-xs text-ink-muted">
                    {row.prefix}… · {row.scopes.join(', ')}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy || !!row.revokedAt}
                  onClick={() => void handleRevoke(row.id)}
                  className="rounded-lg border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 disabled:opacity-50"
                >
                  Revoke
                </button>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="rounded-xl border border-surface-border bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Webhook className="h-5 w-5 text-brand-700" />
          <h2 className="text-lg font-semibold text-ink-primary">Webhooks</h2>
        </div>
        {webhookSecret ? (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Webhook signing secret (store securely): <code className="break-all">{webhookSecret}</code>
          </p>
        ) : null}
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          <input
            type="url"
            placeholder="https://example.com/investo/webhook"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            className="rounded-lg border border-surface-border px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Events (comma-separated)"
            value={webhookEvents}
            onChange={(e) => setWebhookEvents(e.target.value)}
            className="rounded-lg border border-surface-border px-3 py-2 text-sm"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !apiEnabled}
            onClick={() => void handleCreateWebhook()}
            className="inline-flex items-center gap-2 rounded-lg bg-ink-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Plug className="h-4 w-4" />
            Add webhook
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleTestWebhook()}
            className="rounded-lg border border-surface-border px-3 py-2 text-sm font-semibold"
          >
            Send test ping
          </button>
        </div>
        <ul className="mt-4 divide-y divide-surface-border">
          {webhooks.length === 0 ? (
            <li className="py-3 text-sm text-ink-muted">No webhook subscriptions.</li>
          ) : (
            webhooks.map((row) => (
              <li key={row.id} className="py-3">
                <p className="text-sm font-semibold break-all">{row.url}</p>
                <p className="text-xs text-ink-muted">{row.events.join(', ')}</p>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
};

export default IntegrationsPage;

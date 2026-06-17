import React from 'react';
import { AlertTriangle, KeyRound, RefreshCw, Shield, Users } from 'lucide-react';
import {
  getIdentitySettings,
  updateIdentitySettings,
  type CompanyIdentityConfig,
} from '../../services/identity';

const SecuritySettingsPage: React.FC = () => {
  const [config, setConfig] = React.useState<CompanyIdentityConfig | null>(null);
  const [allowedDomainsInput, setAllowedDomainsInput] = React.useState('');
  const [ipAllowlistInput, setIpAllowlistInput] = React.useState('');
  const [ipAllowlistEnabled, setIpAllowlistEnabled] = React.useState(false);
  const [scimTokenPlain, setScimTokenPlain] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getIdentitySettings();
      setConfig(data);
      setAllowedDomainsInput(data.allowed_domains.join(', '));
      setIpAllowlistInput(data.ip_allowlist.join(', '));
      setIpAllowlistEnabled(data.ip_allowlist_enabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load security settings');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const allowed_domains = allowedDomainsInput
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      const ip_allowlist = ipAllowlistInput
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const result = await updateIdentitySettings({
        sso_enabled: config.sso_enabled,
        sso_provider: config.sso_provider,
        scim_enabled: config.scim_enabled,
        mfa_required: config.mfa_required,
        mfa_methods: config.mfa_methods,
        allowed_domains,
        ip_allowlist_enabled: ipAllowlistEnabled,
        ip_allowlist,
      });
      setConfig(result.config);
      setAllowedDomainsInput(result.config.allowed_domains.join(', '));
      setIpAllowlistInput(result.config.ip_allowlist.join(', '));
      setIpAllowlistEnabled(result.config.ip_allowlist_enabled);
      setMessage('Security settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleRotateScimToken = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await updateIdentitySettings({ rotate_scim_token: true, scim_enabled: true });
      setConfig(result.config);
      setScimTokenPlain(result.scim_token_plain);
      setMessage('New SCIM token generated. Copy it now — it will not be shown again.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rotate SCIM token');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !config) {
    return <div className="p-6"><div className="h-32 animate-pulse rounded-lg bg-white" /></div>;
  }

  if (error && !config) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-800">{error}</div>
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-primary">Security & Identity</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Configure SSO, MFA policy, SCIM provisioning, and allowed email domains.
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

      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <p className="text-sm">
          Enterprise IAM features require platform flags (`FEATURE_SSO`, `FEATURE_MFA`, `FEATURE_SCIM`) on the backend.
          Settings below take effect once those flags are enabled in your environment.
        </p>
      </div>

      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
      ) : null}

      <section className="rounded-xl border border-surface-border bg-white p-5">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-brand-700" />
          <h2 className="text-lg font-semibold text-ink-primary">Multi-factor authentication</h2>
        </div>
        <label className="mt-4 flex items-center gap-3 text-sm text-ink-secondary">
          <input
            type="checkbox"
            checked={config.mfa_required}
            onChange={(event) => setConfig({ ...config, mfa_required: event.target.checked })}
          />
          Require TOTP MFA for all users in this company
        </label>
      </section>

      <section className="rounded-xl border border-surface-border bg-white p-5">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-brand-700" />
          <h2 className="text-lg font-semibold text-ink-primary">Single sign-on</h2>
        </div>
        <label className="mt-4 flex items-center gap-3 text-sm text-ink-secondary">
          <input
            type="checkbox"
            checked={config.sso_enabled}
            onChange={(event) => setConfig({ ...config, sso_enabled: event.target.checked })}
          />
          Enable company SSO
        </label>
        <div className="mt-4">
          <label htmlFor="allowed-domains" className="block text-sm font-medium text-ink-secondary">
            Allowed email domains (comma-separated)
          </label>
          <input
            id="allowed-domains"
            value={allowedDomainsInput}
            onChange={(event) => setAllowedDomainsInput(event.target.value)}
            className="investo-input mt-1.5"
            placeholder="acme.com, acme.in"
          />
        </div>
      </section>

      <section className="rounded-xl border border-surface-border bg-white p-5">
        <h2 className="text-lg font-semibold text-ink-primary">Office IP allowlist</h2>
        <label className="mt-4 flex items-center gap-3 text-sm text-ink-secondary">
          <input
            type="checkbox"
            checked={ipAllowlistEnabled}
            onChange={(event) => setIpAllowlistEnabled(event.target.checked)}
          />
          Restrict dashboard API access to approved office networks
        </label>
        <div className="mt-4">
          <label htmlFor="ip-allowlist" className="block text-sm font-medium text-ink-secondary">
            Allowed IPs or CIDR ranges (comma-separated)
          </label>
          <input
            id="ip-allowlist"
            value={ipAllowlistInput}
            onChange={(event) => setIpAllowlistInput(event.target.value)}
            className="investo-input mt-1.5"
            placeholder="203.0.113.10, 203.0.113.0/24"
          />
        </div>
      </section>

      <section className="rounded-xl border border-surface-border bg-white p-5">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-brand-700" />
          <h2 className="text-lg font-semibold text-ink-primary">SCIM provisioning</h2>
        </div>
        <label className="mt-4 flex items-center gap-3 text-sm text-ink-secondary">
          <input
            type="checkbox"
            checked={config.scim_enabled}
            onChange={(event) => setConfig({ ...config, scim_enabled: event.target.checked })}
          />
          Enable SCIM 2.0 user provisioning
        </label>
        <p className="mt-2 text-sm text-ink-muted">
          Endpoint: <span className="font-mono">/scim/v2/Users</span>
          {config.has_scim_token ? ' · token configured' : ' · no token yet'}
        </p>
        <button
          type="button"
          onClick={() => void handleRotateScimToken()}
          disabled={saving}
          className="mt-4 rounded-lg border border-surface-border px-3 py-2 text-sm font-semibold text-ink-secondary"
        >
          Generate / rotate SCIM token
        </button>
        {scimTokenPlain ? (
          <div className="mt-4 rounded-lg border border-surface-border bg-surface-muted p-3 font-mono text-xs break-all">
            {scimTokenPlain}
          </div>
        ) : null}
      </section>

      <div className="flex justify-end">
        <button type="button" onClick={() => void handleSave()} disabled={saving} className="investo-btn-primary px-6 py-2.5">
          {saving ? 'Saving…' : 'Save security settings'}
        </button>
      </div>
    </div>
  );
};

export default SecuritySettingsPage;

import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { Save, Loader2 } from 'lucide-react';

type RoutingMethod = 'least_loaded' | 'round_robin' | 'by_location' | 'by_project';

interface Agent {
  id: string;
  name: string;
}

const LeadRoutingSettings: React.FC = () => {
  const [method, setMethod] = useState<RoutingMethod>('least_loaded');
  const [preferHot, setPreferHot] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sheetsNote, setSheetsNote] = useState('');

  useEffect(() => {
    api.get('/assignment-settings')
      .then((res) => {
        const r = res.data.data?.routing;
        setMethod(r?.method || 'least_loaded');
        setPreferHot(r?.prefer_hot_agents_for_score === true);
        setWebhookUrl(res.data.data?.export_webhook_url || '');
        setAgents(res.data.data?.agents || []);
        setSheetsNote(res.data.data?.google_sheets_export?.message || '');
      })
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/assignment-settings', {
        routing: { method, prefer_hot_agents_for_score: preferHot },
        export_webhook_url: webhookUrl,
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-ink-muted">Loading routing settings…</p>;

  return (
    <div className="space-y-4 rounded-xl border border-surface-border bg-surface-elevated p-4">
      <h3 className="font-semibold text-ink">Lead assignment & routing</h3>
      <label className="block text-sm">
        <span className="text-ink-muted">Method</span>
        <select className="investo-select mt-1 w-full" value={method} onChange={(e) => setMethod(e.target.value as RoutingMethod)}>
          <option value="least_loaded">Least loaded (default)</option>
          <option value="round_robin">Round robin</option>
          <option value="by_location">By location (map in API)</option>
          <option value="by_project">By project / campaign</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={preferHot} onChange={(e) => setPreferHot(e.target.checked)} />
        Prefer hot-lead agent pool for HOT scores
      </label>
      <p className="text-xs text-ink-muted">{agents.length} active sales agents in pool</p>
      <label className="block text-sm">
        <span className="text-ink-muted">Export webhook URL (optional)</span>
        <input
          className="investo-input mt-1 w-full"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://hooks.zapier.com/..."
        />
      </label>
      {sheetsNote && <p className="text-xs text-ink-muted rounded-lg bg-surface-muted p-3">{sheetsNote}</p>}
      <button type="button" onClick={save} disabled={saving} className="investo-btn-primary">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save routing
      </button>
    </div>
  );
};

export default LeadRoutingSettings;

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import { AlertTriangle, Download, CheckCircle, Loader2 } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import PageLoader from '../../components/ui/PageLoader';

interface ErrorLogRow {
  id: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
  resolved: boolean;
}

const ErrorLogsPage: React.FC = () => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<ErrorLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [resolvedFilter, setResolvedFilter] = useState<'all' | 'open' | 'resolved'>('open');
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (resolvedFilter === 'open') params.append('resolved', 'false');
      if (resolvedFilter === 'resolved') params.append('resolved', 'true');
      const res = await api.get(`/error-logs?${params}`);
      setLogs(res.data.data || []);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [days, resolvedFilter]);

  const handleResolve = async (id: string) => {
    setResolvingId(id);
    try {
      await api.patch(`/error-logs/${id}/resolve`);
      await load();
    } finally {
      setResolvingId(null);
    }
  };

  const handleDownload = async () => {
    const res = await api.get(`/error-logs/export?days=${days}`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `error_logs_${days}d.json`);
    link.click();
    link.remove();
  };

  return (
    <PageLoader loading={loading} skeleton="table-row" count={6}>
      <div className="investo-page space-y-6">
        <PageHeader
          title={t('error_logs.title', { defaultValue: 'Error Log' })}
          description={t('error_logs.subtitle', { defaultValue: 'Customer WRONG reports and system errors (last 7 days)' })}
          actions={
            <div className="flex flex-wrap gap-2">
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="investo-select w-auto">
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
              </select>
              <select
                value={resolvedFilter}
                onChange={(e) => setResolvedFilter(e.target.value as typeof resolvedFilter)}
                className="investo-select w-auto"
              >
                <option value="all">All</option>
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
              </select>
              <button type="button" onClick={handleDownload} className="investo-btn-secondary">
                <Download className="h-4 w-4" />
                Download JSON
              </button>
            </div>
          }
        />

        <div className="investo-card overflow-hidden">
          {logs.length === 0 ? (
            <p className="p-8 text-center text-sm text-ink-muted">No errors in this period.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {logs.map((log) => (
                <li key={log.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600" />
                      <span className="font-medium text-ink">{log.action}</span>
                      {log.resolved && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">Resolved</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-ink-muted">
                      {new Date(log.created_at).toLocaleString('en-IN')} · {log.resource_type || 'system'}
                    </p>
                    {log.details?.message != null && (
                      <p className="mt-2 text-sm text-ink-secondary">{String(log.details.message)}</p>
                    )}
                  </div>
                  {!log.resolved && (
                    <button
                      type="button"
                      disabled={resolvingId === log.id}
                      onClick={() => handleResolve(log.id)}
                      className="investo-btn-secondary shrink-0"
                    >
                      {resolvingId === log.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle className="h-4 w-4" />
                      )}
                      Mark resolved
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </PageLoader>
  );
};

export default ErrorLogsPage;

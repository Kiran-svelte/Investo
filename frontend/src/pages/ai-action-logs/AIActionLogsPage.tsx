import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import {
  Bot, Search, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
} from 'lucide-react';

interface AgentActionLog {
  id: string;
  companyId: string;
  triggeredBy: string;
  action: string;
  actorId: string | null;
  actorRole: string | null;
  resourceType: string | null;
  resourceId: string | null;
  inputs: Record<string, unknown> | null;
  result: string | null;
  status: string;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
}

type DateRangeKey = '24h' | '7d' | '30d' | 'all';

function rangeToFrom(key: DateRangeKey): string | undefined {
  if (key === 'all') return undefined;
  const hours = key === '24h' ? 24 : key === '7d' ? 24 * 7 : 24 * 30;
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

const STATUS_COLORS: Record<string, string> = {
  success: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-surface-subtle text-ink-secondary',
};

const AIActionLogsPage: React.FC = () => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<AgentActionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionSearch, setActionSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateRange, setDateRange] = useState<DateRangeKey>('7d');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadLogs = async () => {
    setLoading(true);
    try {
      setLoadError(null);
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('limit', '25');
      if (actionSearch.trim()) params.append('action', actionSearch.trim());
      if (statusFilter) params.append('status', statusFilter);
      const from = rangeToFrom(dateRange);
      if (from) params.append('from', from);

      const res = await api.get(`/agent-action-logs?${params.toString()}`);
      setLogs(res.data.data || []);
      setTotalPages(res.data.totalPages || 1);
      setTotal(res.data.total ?? 0);
    } catch {
      setLogs([]);
      setLoadError(t('ai_action_logs.load_error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [page, statusFilter, dateRange]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadLogs();
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  if (loading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  return (
    <div className="investo-page space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-primary flex items-center gap-2">
          <Bot className="h-7 w-7 text-brand-600" />
          {t('ai_action_logs.title')}
        </h1>
        <p className="text-ink-muted text-sm">{t('ai_action_logs.subtitle')}</p>
      </div>

      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {loadError}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4">
        <form onSubmit={handleSearch} className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
          <input
            type="text"
            value={actionSearch}
            onChange={(e) => setActionSearch(e.target.value)}
            placeholder={t('ai_action_logs.search_placeholder')}
            className="w-full pl-10 pr-4 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500"
          />
        </form>

        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-surface-border-strong rounded-lg"
        >
          <option value="">{t('ai_action_logs.all_statuses')}</option>
          <option value="success">{t('ai_action_logs.status_success')}</option>
          <option value="failed">{t('ai_action_logs.status_failed')}</option>
          <option value="skipped">{t('ai_action_logs.status_skipped')}</option>
        </select>

        <select
          value={dateRange}
          onChange={(e) => { setDateRange(e.target.value as DateRangeKey); setPage(1); }}
          className="px-3 py-2 border border-surface-border-strong rounded-lg"
        >
          <option value="24h">{t('ai_action_logs.range_24h')}</option>
          <option value="7d">{t('ai_action_logs.range_7d')}</option>
          <option value="30d">{t('ai_action_logs.range_30d')}</option>
          <option value="all">{t('ai_action_logs.range_all')}</option>
        </select>
      </div>

      <p className="text-sm text-ink-muted">
        {t('ai_action_logs.total', { count: total })}
      </p>

      <div className="bg-surface-card border border-surface-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle text-ink-secondary text-left">
              <tr>
                <th className="px-4 py-3">{t('ai_action_logs.col_time')}</th>
                <th className="px-4 py-3">{t('ai_action_logs.col_action')}</th>
                <th className="px-4 py-3">{t('ai_action_logs.col_trigger')}</th>
                <th className="px-4 py-3">{t('ai_action_logs.col_status')}</th>
                <th className="px-4 py-3">{t('ai_action_logs.col_resource')}</th>
                <th className="px-4 py-3">{t('ai_action_logs.col_result')}</th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {logs.map((log) => (
                <React.Fragment key={log.id}>
                  <tr className="hover:bg-surface-subtle/50">
                    <td className="px-4 py-3 whitespace-nowrap text-ink-muted">
                      {formatDate(log.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{log.action}</td>
                    <td className="px-4 py-3">{log.triggeredBy}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[log.status] ?? 'bg-surface-subtle'}`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      {log.resourceType ? `${log.resourceType}${log.resourceId ? ` · ${log.resourceId.slice(0, 8)}…` : ''}` : '—'}
                    </td>
                    <td className="px-4 py-3 max-w-xs truncate text-ink-secondary">
                      {log.result?.slice(0, 80) ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                        className="text-brand-600 hover:text-brand-800"
                        aria-label={t('ai_action_logs.expand')}
                      >
                        {expandedId === log.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </td>
                  </tr>
                  {expandedId === log.id && (
                    <tr>
                      <td colSpan={7} className="px-4 py-3 bg-surface-subtle/30">
                        <pre className="text-xs overflow-x-auto p-3 rounded-lg bg-surface-card border border-surface-border">
                          {JSON.stringify(log.inputs ?? {}, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {!logs.length && !loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-ink-muted">
                    {t('ai_action_logs.empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-surface-border disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
            {t('ai_action_logs.prev')}
          </button>
          <span className="text-sm text-ink-muted">
            {t('ai_action_logs.page_of', { page, totalPages })}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-surface-border disabled:opacity-40"
          >
            {t('ai_action_logs.next')}
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
};

export default AIActionLogsPage;

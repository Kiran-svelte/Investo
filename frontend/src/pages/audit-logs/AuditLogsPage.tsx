import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import {
  ClipboardList, Search, Calendar, User,
  FileText, Globe, ChevronLeft, ChevronRight
} from 'lucide-react';

interface AuditLog {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string;
  action: string;
  resource: string;
  resourceId: string | null;
  details: Record<string, any> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-green-100 text-green-700',
  update: 'bg-brand-100 text-brand-800',
  delete: 'bg-red-100 text-red-700',
  deactivate: 'bg-orange-100 text-orange-700',
  activate: 'bg-emerald-100 text-emerald-700',
  login: 'bg-purple-100 text-purple-700',
  logout: 'bg-surface-subtle text-ink-secondary',
};

const AuditLogsPage: React.FC = () => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('limit', '20');
      if (search) params.append('search', search);
      if (actionFilter) params.append('action', actionFilter);
      if (resourceFilter) params.append('resource', resourceFilter);

      const res = await api.get(`/audit?${params.toString()}`);
      setLogs(res.data.data || []);
      setTotalPages(res.data.totalPages || 1);
    } catch (err) {
      console.error('Failed to load audit logs', err);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [page, actionFilter, resourceFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadLogs();
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const actions = ['create', 'update', 'delete', 'deactivate', 'activate', 'login', 'logout'];
  const resources = [
    'users',
    'companies',
    'leads',
    'properties',
    'visits',
    'conversations',
    'ai_settings',
  ];

  if (loading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"></div>
      </div>
    );
  }

  return (
    <div className="investo-page space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-ink-primary">{t('audit.title')}</h1>
        <p className="text-ink-muted text-sm">
          Track all system activities and changes
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <form onSubmit={handleSearch} className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by user or resource..."
            className="w-full pl-10 pr-4 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
        </form>

        <select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
        >
          <option value="">All Actions</option>
          {actions.map((action) => (
            <option key={action} value={action}>
              {action.charAt(0).toUpperCase() + action.slice(1)}
            </option>
          ))}
        </select>

        <select
          value={resourceFilter}
          onChange={(e) => {
            setResourceFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
        >
          <option value="">All Resources</option>
          {resources.map((resource) => (
            <option key={resource} value={resource}>
              {resource.charAt(0).toUpperCase() + resource.slice(1).replace('_', ' ')}
            </option>
          ))}
        </select>
      </div>

      {/* Logs Table */}
      <div className="investo-table-wrap">
        {logs.length === 0 ? (
          <div className="p-12 text-center text-ink-muted">
            <ClipboardList className="h-12 w-12 mx-auto text-ink-faint mb-4" />
            <p>No audit logs found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="investo-table-head border-b border-surface-border">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-ink-secondary uppercase tracking-wider">
                      {t('audit.timestamp')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-ink-secondary uppercase tracking-wider">
                      {t('audit.user')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-ink-secondary uppercase tracking-wider">
                      {t('audit.action')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-ink-secondary uppercase tracking-wider">
                      {t('audit.resource')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-ink-secondary uppercase tracking-wider">
                      {t('audit.ip_address')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-ink-secondary uppercase tracking-wider">
                      {t('audit.details')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {logs.map((log) => (
                    <React.Fragment key={log.id}>
                      <tr className="hover:bg-surface-muted">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2 text-sm text-ink-secondary">
                            <Calendar className="h-4 w-4 text-ink-faint" />
                            {formatDate(log.createdAt)}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-surface-subtle flex items-center justify-center">
                              <User className="h-4 w-4 text-ink-muted" />
                            </div>
                            <div>
                              <p className="font-medium text-ink-primary text-sm">
                                {log.userName || 'Unknown'}
                              </p>
                              <p className="text-xs text-ink-muted">{log.userEmail}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`px-2 py-1 text-xs font-medium rounded-full ${
                              ACTION_COLORS[log.action] || 'bg-surface-subtle text-ink-secondary'
                            }`}
                          >
                            {log.action}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 text-sm text-ink-secondary">
                            <FileText className="h-4 w-4 text-ink-faint" />
                            <span>{log.resource}</span>
                            {log.resourceId && (
                              <span className="text-xs text-ink-faint">
                                ({log.resourceId.slice(0, 8)}...)
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 text-sm text-ink-secondary">
                            <Globe className="h-4 w-4 text-ink-faint" />
                            {log.ipAddress || '-'}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {log.details && Object.keys(log.details).length > 0 ? (
                            <button
                              onClick={() =>
                                setExpandedLog(expandedLog === log.id ? null : log.id)
                              }
                              className="text-sm text-brand-700 hover:text-brand-800"
                            >
                              {expandedLog === log.id ? 'Hide' : 'View'}
                            </button>
                          ) : (
                            <span className="text-ink-faint text-sm">-</span>
                          )}
                        </td>
                      </tr>
                      {expandedLog === log.id && log.details && (
                        <tr>
                          <td colSpan={6} className="px-6 py-4 bg-surface-muted">
                            <pre className="text-xs text-ink-secondary overflow-x-auto">
                              {JSON.stringify(log.details, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-surface-border">
              <p className="text-sm text-ink-secondary">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-2 rounded-lg border border-surface-border-strong hover:bg-surface-muted disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-2 rounded-lg border border-surface-border-strong hover:bg-surface-muted disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AuditLogsPage;

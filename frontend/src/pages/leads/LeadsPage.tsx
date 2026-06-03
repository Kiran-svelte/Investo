import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getRoleCapabilities } from '../../config/navigation.config';
import api from '../../services/api';
import {
  Search, Plus, Phone, MapPin, User, ChevronLeft, ChevronRight,
  X, Loader2, Download, Sparkles,
} from 'lucide-react';
import LeadStatusBadge from '../../components/leads/LeadStatusBadge';
import LeadStatusSelect from '../../components/leads/LeadStatusSelect';
import {
  LEAD_STATUS_ORDER,
  LEAD_STATUS_BAR,
  LEAD_STATUS_LABELS,
  formatLeadStatus,
  type LeadStatusValue,
} from '../../config/leadStatus.config';

interface Lead {
  id: string;
  customer_name: string | null;
  phone: string;
  email: string | null;
  budget_min: number | null;
  budget_max: number | null;
  location_preference: string | null;
  property_type: string | null;
  status: string;
  source: string;
  agent_name: string | null;
  created_at: string;
}

interface Agent {
  id: string;
  name: string;
}

const PROPERTY_TYPES = ['apartment', 'villa', 'plot', 'commercial'];
const LEAD_SOURCES = ['whatsapp', 'manual', 'website', 'referral'];

const LeadsPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const capabilities = getRoleCapabilities(user?.role);
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);

  const canForceAnyStatus = user?.role === 'company_admin' || user?.role === 'super_admin';
  const canEditLeadStatus = (capabilities.canCreateLeads || capabilities.canAssignLeads) && !capabilities.isReadOnly;

  const loadLeads = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (statusFilter) params.append('status', statusFilter);
      params.append('page', String(page));
      params.append('limit', '25');
      const res = await api.get(`/leads?${params.toString()}`);
      setLeads(res.data.data);
      setTotalPages(res.data.pagination?.pages || 1);
      setTotal(res.data.pagination?.total || 0);
    } catch (err) {
      console.error('Failed to load leads', err);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, page]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  useEffect(() => {
    api.get('/analytics/leads?days=365')
      .then((res) => {
        const rows = res.data?.data?.by_status as Array<{ status: string; count: number }> | undefined;
        if (!rows) {
          return;
        }
        const map: Record<string, number> = {};
        for (const row of rows) {
          map[row.status] = Number(row.count) || 0;
        }
        setStatusCounts(map);
      })
      .catch(() => {});
  }, []);

  const updateLeadStatus = async (leadId: string, newStatus: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setStatusUpdatingId(leadId);
    try {
      await api.patch(`/leads/${leadId}/status`, {
        status: newStatus,
        ...(canForceAnyStatus ? { force: true } : {}),
      });
      await loadLeads();
    } catch (err) {
      console.error('Status update failed', err);
    } finally {
      setStatusUpdatingId(null);
    }
  };

  useEffect(() => {
    if (capabilities.canAssignLeads) {
      api.get('/users?role=sales_agent').then(res => {
        setAgents(res.data.data || []);
      }).catch(() => {});
    }
  }, [capabilities.canAssignLeads]);

  const handleExportCSV = async () => {
    try {
      const res = await api.get('/leads/export/csv', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'leads_export.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error('Export failed', err);
    }
  };

  const formatBudget = (min: number | null, max: number | null) => {
    if (!min && !max) return '-';
    const formatNum = (n: number) => {
      if (n >= 10000000) return `${(n / 10000000).toFixed(1)}Cr`;
      if (n >= 100000) return `${(n / 100000).toFixed(1)}L`;
      return `${(n / 1000).toFixed(0)}K`;
    };
    if (min && max) return `₹${formatNum(min)} - ₹${formatNum(max)}`;
    if (min) return `₹${formatNum(min)}+`;
    return `Up to ₹${formatNum(max!)}`;
  };

  const formatDate = (d: string) => {
    if (!d) return '-';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric'
    });
  };

  return (
    <div className="investo-page space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink-primary">{t('leads.title')}</h1>
          <p className="text-sm text-ink-muted">{total} total leads</p>
        </div>
        <div className="flex gap-2">
          {capabilities.canExportLeads && (
            <button
              onClick={handleExportCSV}
              className="inline-flex items-center gap-2 px-4 py-2 border border-surface-border-strong text-ink-secondary rounded-lg hover:bg-surface-muted transition-colors"
            >
              <Download className="h-4 w-4" />
              {t('common.export')}
            </button>
          )}
          {capabilities.canCreateLeads && !capabilities.isReadOnly && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 investo-btn-primary transition-colors"
            >
              <Plus className="h-4 w-4" />
              {t('leads.new_lead')}
            </button>
          )}
        </div>
      </div>

      {/* AI hybrid + pipeline */}
      <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-sky-50 p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <Sparkles className="h-5 w-5 text-violet-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-violet-900">AI + human hybrid (ready)</p>
            <p className="mt-1 text-xs text-violet-800/90">
              WhatsApp AI handles FAQs, availability, and visit booking 24/7. After repeated price questions,
              a specialist takes over (set name &amp; phone in AI Settings).
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {LEAD_STATUS_ORDER.map((status) => {
            const count = statusCounts[status] ?? 0;
            const active = statusFilter === status;
            return (
              <button
                key={status}
                type="button"
                onClick={() => {
                  setStatusFilter(active ? '' : status);
                  setPage(1);
                }}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? `${LEAD_STATUS_BAR[status as LeadStatusValue]} text-white border-transparent`
                    : 'bg-surface-elevated border-surface-border text-ink-secondary hover:border-surface-border-strong'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${LEAD_STATUS_BAR[status as LeadStatusValue]}`} />
                {LEAD_STATUS_LABELS[status as LeadStatusValue]}
                <span className={active ? 'text-white/90' : 'text-ink-muted'}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
          <input
            type="text"
            placeholder={t('common.search')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-4 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
        >
          <option value="">{t('common.all_statuses')}</option>
          {LEAD_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>{formatLeadStatus(s)}</option>
          ))}
        </select>
      </div>

      {/* Table - Desktop */}
      <div className="hidden md:block investo-table-wrap">
        <table className="w-full">
          <thead className="investo-table-head border-b border-surface-border">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-ink-muted uppercase">{t('leads.customer_name')}</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-ink-muted uppercase">{t('leads.phone')}</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-ink-muted uppercase">{t('leads.budget')}</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-ink-muted uppercase">{t('leads.location')}</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-ink-muted uppercase">{t('leads.status')}</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-ink-muted uppercase">{t('leads.assigned_agent')}</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-ink-muted uppercase">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border/60">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-muted">
                  <Loader2 className="h-5 w-5 animate-spin inline mr-2" />{t('common.loading')}
                </td>
              </tr>
            ) : leads.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-muted">{t('common.no_data')}</td>
              </tr>
            ) : (
              leads.map((lead) => (
                <tr
                  key={lead.id}
                  onClick={() => navigate(`/leads/${lead.id}`)}
                  className="hover:bg-surface-muted cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                        <User className="h-4 w-4 text-brand-700" />
                      </div>
                      <div>
                        <p className="font-medium text-ink-primary">{lead.customer_name || 'Unknown'}</p>
                        <p className="text-xs text-ink-muted">{lead.source}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-secondary">{lead.phone}</td>
                  <td className="px-4 py-3 text-sm text-ink-secondary">{formatBudget(lead.budget_min, lead.budget_max)}</td>
                  <td className="px-4 py-3 text-sm text-ink-secondary">{lead.location_preference || '-'}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {canEditLeadStatus ? (
                      <LeadStatusSelect
                        value={lead.status}
                        loading={statusUpdatingId === lead.id}
                        canForceAnyStatus={canForceAnyStatus}
                        onChange={(s) => void updateLeadStatus(lead.id, s)}
                      />
                    ) : (
                      <LeadStatusBadge status={lead.status} />
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-secondary">{lead.agent_name || '-'}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted">{formatDate(lead.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-surface-border">
            <p className="text-sm text-ink-muted">
              Page {page} of {totalPages} ({total} leads)
            </p>
            <div className="flex gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="p-2 rounded-lg hover:bg-surface-subtle disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                className="p-2 rounded-lg hover:bg-surface-subtle disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Cards - Mobile */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="text-center py-8 text-ink-muted"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />{t('common.loading')}</div>
        ) : leads.length === 0 ? (
          <div className="text-center py-8 text-ink-muted">{t('common.no_data')}</div>
        ) : (
          leads.map((lead) => (
            <div
              key={lead.id}
              onClick={() => navigate(`/leads/${lead.id}`)}
              className="investo-card p-4 cursor-pointer hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center">
                    <User className="h-5 w-5 text-brand-700" />
                  </div>
                  <div>
                    <p className="font-medium text-ink-primary">{lead.customer_name || 'Unknown'}</p>
                    <p className="text-xs text-ink-muted">{lead.source} &middot; {formatDate(lead.created_at)}</p>
                  </div>
                </div>
                {canEditLeadStatus ? (
                  <LeadStatusSelect
                    value={lead.status}
                    loading={statusUpdatingId === lead.id}
                    canForceAnyStatus={canForceAnyStatus}
                    onChange={(s) => void updateLeadStatus(lead.id, s)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <LeadStatusBadge status={lead.status} />
                )}
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-ink-secondary"><Phone className="h-4 w-4" />{lead.phone}</div>
                {lead.location_preference && <div className="flex items-center gap-2 text-ink-secondary"><MapPin className="h-4 w-4" />{lead.location_preference}</div>}
                <div className="text-ink-secondary font-medium">{formatBudget(lead.budget_min, lead.budget_max)}</div>
                {lead.agent_name && <div className="text-xs text-ink-faint">Agent: {lead.agent_name}</div>}
              </div>
            </div>
          ))
        )}
        {/* Mobile pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 py-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-4 py-2 border rounded-lg disabled:opacity-40">Previous</button>
            <span className="text-sm text-ink-muted">{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-4 py-2 border rounded-lg disabled:opacity-40">Next</button>
          </div>
        )}
      </div>

      {/* Create Lead Modal */}
      {showCreateModal && (
        <CreateLeadModal
          agents={agents}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => { setShowCreateModal(false); loadLeads(); }}
        />
      )}
    </div>
  );
};

/* ───── Create Lead Modal ───── */
interface CreateLeadModalProps {
  agents: Agent[];
  onClose: () => void;
  onCreated: () => void;
}

const CreateLeadModal: React.FC<CreateLeadModalProps> = ({ agents, onClose, onCreated }) => {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    customer_name: '',
    phone: '',
    email: '',
    budget_min: '',
    budget_max: '',
    location_preference: '',
    property_type: '',
    source: 'manual',
    assigned_agent_id: '',
    notes: '',
    language: 'en',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.phone.trim()) { setError('Phone number is required'); return; }

    setSaving(true);
    setError('');
    try {
      await api.post('/leads', {
        customer_name: form.customer_name || null,
        phone: form.phone.trim(),
        email: form.email || null,
        budget_min: form.budget_min ? Number(form.budget_min) : null,
        budget_max: form.budget_max ? Number(form.budget_max) : null,
        location_preference: form.location_preference || null,
        property_type: form.property_type || null,
        source: form.source,
        assigned_agent_id: form.assigned_agent_id || null,
        notes: form.notes || null,
        language: form.language,
      });
      onCreated();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create lead');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-surface-elevated rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">{t('leads.new_lead')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-surface-subtle rounded"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">Name</label>
              <input name="customer_name" value={form.customer_name} onChange={handleChange}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent" placeholder="Customer name" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">Phone *</label>
              <input name="phone" value={form.phone} onChange={handleChange} required
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent" placeholder="+91XXXXXXXXXX" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">Email</label>
              <input name="email" type="email" value={form.email} onChange={handleChange}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent" placeholder="email@example.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">Source</label>
              <select name="source" value={form.source} onChange={handleChange}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent">
                {LEAD_SOURCES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">Budget Min (₹)</label>
              <input name="budget_min" type="number" value={form.budget_min} onChange={handleChange}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent" placeholder="e.g. 5000000" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">Budget Max (₹)</label>
              <input name="budget_max" type="number" value={form.budget_max} onChange={handleChange}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent" placeholder="e.g. 15000000" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">Location</label>
              <input name="location_preference" value={form.location_preference} onChange={handleChange}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent" placeholder="e.g. Whitefield, Bangalore" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">Property Type</label>
              <select name="property_type" value={form.property_type} onChange={handleChange}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent">
                <option value="">Any</option>
                {PROPERTY_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            {agents.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1">Assign Agent</label>
                <select name="assigned_agent_id" value={form.assigned_agent_id} onChange={handleChange}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent">
                  <option value="">Auto-assign (round robin)</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">Language</label>
              <select name="language" value={form.language} onChange={handleChange}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent">
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="kn">Kannada</option>
                <option value="te">Telugu</option>
                <option value="ta">Tamil</option>
                <option value="ml">Malayalam</option>
                <option value="mr">Marathi</option>
                <option value="bn">Bengali</option>
                <option value="gu">Gujarati</option>
                <option value="pa">Punjabi</option>
                <option value="or">Odia</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-secondary mb-1">Notes</label>
            <textarea name="notes" value={form.notes} onChange={handleChange} rows={3}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent" placeholder="Any additional notes..." />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-surface-border-strong rounded-lg hover:bg-surface-muted">{t('common.cancel')}</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 investo-btn-primary disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('leads.new_lead')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LeadsPage;

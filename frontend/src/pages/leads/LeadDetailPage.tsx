import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { dashboardPath, getRoleCapabilities } from '../../config/navigation.config';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import {
  ArrowLeft, Phone, Mail, MapPin, Building2, IndianRupee,
  User, Calendar, Clock, Edit3, Save, X, Loader2,
  AlertTriangle, MessageSquare, CheckCircle, Trash2, Bot,
} from 'lucide-react';
import { deleteLead } from '../../services/resourceDelete';
import LeadStatusBadge from '../../components/leads/LeadStatusBadge';
import LeadStatusSelect from '../../components/leads/LeadStatusSelect';
import useConfirmDialog from '../../hooks/useConfirmDialog';

interface LeadDetail {
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
  assigned_agent_id: string | null;
  agent_name: string | null;
  notes: string | null;
  language: string;
  created_at: string;
  updated_at: string;
  last_contact_at: string | null;
  timeline: TimelineEntry[];
  conversation_id: string | null;
  lead_memory: Record<string, unknown> | null;
}

interface TimelineEntry {
  id: string;
  action: string;
  resource_type: string;
  details: string | null;
  performed_by: string;
  created_at: string;
}

interface Agent {
  id: string;
  name: string;
}

const PROPERTY_TYPES = ['apartment', 'villa', 'plot', 'commercial'];

function stringifyDetails(details: unknown): string | null {
  if (details === null || details === undefined) return null;
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function normalizeLeadDetail(raw: any): LeadDetail {
  const timelineRaw = Array.isArray(raw?.timeline) ? raw.timeline : [];

  return {
    id: String(raw?.id ?? ''),
    customer_name: raw?.customer_name ?? raw?.customerName ?? null,
    phone: String(raw?.phone ?? ''),
    email: raw?.email ?? null,
    budget_min: raw?.budget_min ?? raw?.budgetMin ?? null,
    budget_max: raw?.budget_max ?? raw?.budgetMax ?? null,
    location_preference: raw?.location_preference ?? raw?.locationPreference ?? null,
    property_type: raw?.property_type ?? raw?.propertyType ?? null,
    status: String(raw?.status ?? ''),
    source: String(raw?.source ?? ''),
    assigned_agent_id: raw?.assigned_agent_id ?? raw?.assignedAgentId ?? null,
    agent_name: raw?.agent_name ?? raw?.agentName ?? null,
    notes: raw?.notes ?? null,
    language: String(raw?.language ?? 'en'),
    created_at: String(raw?.created_at ?? raw?.createdAt ?? ''),
    updated_at: String(raw?.updated_at ?? raw?.updatedAt ?? ''),
    last_contact_at: raw?.last_contact_at ?? raw?.lastContactAt ?? null,
    timeline: timelineRaw.map((entry: any) => ({
      id: String(entry?.id ?? ''),
      action: String(entry?.action ?? ''),
      resource_type: String(entry?.resource_type ?? entry?.resourceType ?? ''),
      details: stringifyDetails(entry?.details),
      performed_by: String(entry?.performed_by ?? entry?.performedBy ?? entry?.userId ?? ''),
      created_at: String(entry?.created_at ?? entry?.createdAt ?? ''),
    })),
    conversation_id: raw?.conversation_id ?? raw?.conversationId ?? null,
    lead_memory: raw?.lead_memory ?? raw?.leadMemory ?? null,
  };
}

const LeadDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t: _t } = useTranslation();
  const { user } = useAuth();
  const { confirm, Dialog } = useConfirmDialog();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [editForm, setEditForm] = useState({
    customer_name: '',
    email: '',
    budget_min: '',
    budget_max: '',
    location_preference: '',
    property_type: '',
    assigned_agent_id: '',
    notes: '',
  });

  const loadLead = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get(`/leads/${id}`);
      setLead(normalizeLeadDetail(res.data.data));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load lead details.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadLead(); }, [loadLead]);

  useEffect(() => {
    api.get('/users?role=sales_agent').then(res => {
      setAgents(res.data.data || []);
    }).catch(() => {});
  }, []);

  const startEditing = () => {
    if (!lead) return;
    setEditForm({
      customer_name: lead.customer_name || '',
      email: lead.email || '',
      budget_min: lead.budget_min ? String(lead.budget_min) : '',
      budget_max: lead.budget_max ? String(lead.budget_max) : '',
      location_preference: lead.location_preference || '',
      property_type: lead.property_type || '',
      assigned_agent_id: lead.assigned_agent_id || '',
      notes: lead.notes || '',
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    const minBudget = editForm.budget_min ? Number(editForm.budget_min) : null;
    const maxBudget = editForm.budget_max ? Number(editForm.budget_max) : null;
    if ((minBudget !== null && Number.isNaN(minBudget)) || (maxBudget !== null && Number.isNaN(maxBudget))) {
      setError('Budget must be a valid number');
      return;
    }
    if (minBudget !== null && maxBudget !== null && minBudget > maxBudget) {
      setError('Budget Min cannot be greater than Budget Max');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.put(`/leads/${id}`, {
        customer_name: editForm.customer_name || null,
        email: editForm.email || null,
        budget_min: minBudget,
        budget_max: maxBudget,
        location_preference: editForm.location_preference || null,
        property_type: editForm.property_type || null,
        assigned_agent_id: editForm.assigned_agent_id || null,
        notes: editForm.notes || null,
      });
      setEditing(false);
      await loadLead();
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to update'));
    } finally {
      setSaving(false);
    }
  };

  const canForceAnyStatus = user?.role === 'company_admin' || user?.role === 'super_admin';

  const changeStatus = async (newStatus: string) => {
    if (newStatus === lead?.status) {
      return;
    }
    setStatusChanging(true);
    setError('');
    try {
      await api.patch(`/leads/${id}/status`, {
        status: newStatus,
        ...(canForceAnyStatus ? { force: true } : {}),
      });
      await loadLead();
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to update status'));
    } finally {
      setStatusChanging(false);
    }
  };

  const formatCurrency = (val: number | string | null) => {
    const num = val == null ? null : Number(val);
    if (num == null || Number.isNaN(num)) return '-';
    if (num >= 10000000) return `₹${(num / 10000000).toFixed(1)} Cr`;
    if (num >= 100000) return `₹${(num / 100000).toFixed(1)} L`;
    return `₹${num.toLocaleString('en-IN')}`;
  };

  const formatDate = (d?: string | null) => {
    if (!d) return '-';
    return new Date(d).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-brand-700" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="p-6 text-center">
        <p className="text-ink-muted">{error || 'Lead not found'}</p>
        <button onClick={() => navigate(dashboardPath('/leads'))} className="mt-4 text-brand-700 hover:underline">Back to Leads</button>
      </div>
    );
  }

  const canEdit = user?.role === 'company_admin' || user?.role === 'super_admin' ||
    (user?.role === 'sales_agent' && lead.assigned_agent_id === user?.id);

  const canChangeStatus = canEdit;
  const { canAccessConversations } = getRoleCapabilities(user?.role);
  const canDeleteLead =
    user?.role === 'company_admin' ||
    user?.role === 'super_admin' ||
    (user?.role === 'sales_agent' && lead.assigned_agent_id === user?.id);

  const handleDeleteLead = async () => {
    const confirmed = await confirm(
      'Delete lead?',
      'This lead, its conversations, messages, and visits will be permanently removed.',
      { confirmLabel: 'Delete' },
    );
    if (!confirmed) return;
    setDeleting(true);
    setError('');
    try {
      await deleteLead(lead.id);
      navigate(dashboardPath('/leads'));
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string } } };
      setError(getApiErrorMessage(ax, 'Failed to delete lead'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
    <div className="investo-page space-y-6 max-w-5xl">
      {/* Back + Header */}
      <div>
        <button onClick={() => navigate(dashboardPath('/leads'))} className="flex items-center gap-1 text-sm text-ink-muted hover:text-ink-secondary mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to Leads
        </button>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink-primary">{lead.customer_name || lead.phone}</h1>
            <p className="text-sm text-ink-muted">Created {formatDate(lead.created_at)}</p>
          </div>
          <div className="flex items-center gap-3">
            {lead.conversation_id && canAccessConversations && (
              <button 
                onClick={() => navigate(dashboardPath(`/conversations?id=${lead.conversation_id}`))}
                className="flex items-center gap-2 px-3 py-1.5 border rounded-lg bg-brand-50 text-brand-800 hover:bg-brand-100 text-sm font-medium"
              >
                <MessageSquare className="h-4 w-4" /> Go to Conversation
              </button>
            )}
            {canChangeStatus ? (
              <LeadStatusSelect
                value={lead.status}
                loading={statusChanging}
                canForceAnyStatus={canForceAnyStatus}
                onChange={(s) => void changeStatus(s)}
              />
            ) : (
              <LeadStatusBadge status={lead.status} size="md" />
            )}
            {canEdit && !editing && (
              <button onClick={startEditing} className="flex items-center gap-1 px-3 py-1.5 border rounded-lg hover:bg-surface-muted text-sm">
                <Edit3 className="h-4 w-4" /> Edit
              </button>
            )}
            {canDeleteLead && (
              <button
                type="button"
                onClick={() => void handleDeleteLead()}
                disabled={deleting}
                className="flex items-center gap-1 px-3 py-1.5 border border-red-200 text-red-700 rounded-lg hover:bg-red-50 text-sm disabled:opacity-50"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm" role="alert">{error}</div>}

      {canChangeStatus && (
        <div className="rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white p-4 text-sm text-slate-600">
          <p>
            <span className="font-semibold text-slate-800">Pipeline status</span>
            {' — '}
            {canForceAnyStatus
              ? 'You can set any stage manually. WhatsApp AI can also update status (e.g. contacted, visit scheduled, negotiation).'
              : 'Choose the next stage from the dropdown. Admins can jump to any stage.'}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lead Details */}
        <div className="lg:col-span-2 space-y-6">
          <div className="investo-card-pad">
            <h2 className="text-lg font-semibold mb-4">Lead Details</h2>
            {editing ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-ink-secondary mb-1">Name</label>
                    <input value={editForm.customer_name} onChange={e => setEditForm(f => ({ ...f, customer_name: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink-secondary mb-1">Email</label>
                    <input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink-secondary mb-1">Budget Min (₹)</label>
                    <input type="number" value={editForm.budget_min} onChange={e => setEditForm(f => ({ ...f, budget_min: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink-secondary mb-1">Budget Max (₹)</label>
                    <input type="number" value={editForm.budget_max} onChange={e => setEditForm(f => ({ ...f, budget_max: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink-secondary mb-1">Location</label>
                    <input value={editForm.location_preference} onChange={e => setEditForm(f => ({ ...f, location_preference: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink-secondary mb-1">Property Type</label>
                    <select value={editForm.property_type} onChange={e => setEditForm(f => ({ ...f, property_type: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500">
                      <option value="">Any</option>
                      {PROPERTY_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  {agents.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-ink-secondary mb-1">Assigned Agent</label>
                      <select value={editForm.assigned_agent_id} onChange={e => setEditForm(f => ({ ...f, assigned_agent_id: e.target.value }))}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500">
                        <option value="">Unassigned</option>
                        {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-secondary mb-1">Notes</label>
                  <textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} rows={4}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500" />
                </div>
                <div className="flex gap-3 justify-end">
                  <button onClick={() => setEditing(false)} className="px-4 py-2 border rounded-lg hover:bg-surface-muted flex items-center gap-1">
                    <X className="h-4 w-4" /> Cancel
                  </button>
                  <button onClick={saveEdit} disabled={saving} className="px-4 py-2 investo-btn-primary disabled:opacity-50 flex items-center gap-1">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-8">
                <InfoRow icon={<Phone className="h-4 w-4" />} label="Phone" value={lead.phone} />
                <InfoRow icon={<Mail className="h-4 w-4" />} label="Email" value={lead.email || '-'} />
                <InfoRow icon={<IndianRupee className="h-4 w-4" />} label="Budget Min" value={formatCurrency(lead.budget_min)} />
                <InfoRow icon={<IndianRupee className="h-4 w-4" />} label="Budget Max" value={formatCurrency(lead.budget_max)} />
                <InfoRow icon={<MapPin className="h-4 w-4" />} label="Location" value={lead.location_preference || '-'} />
                <InfoRow icon={<Building2 className="h-4 w-4" />} label="Property Type" value={lead.property_type || 'Any'} />
                <InfoRow icon={<User className="h-4 w-4" />} label="Agent" value={lead.agent_name || 'Unassigned'} />
                <InfoRow icon={<MessageSquare className="h-4 w-4" />} label="Source" value={lead.source} />
                <InfoRow icon={<Calendar className="h-4 w-4" />} label="Last Contact" value={lead.last_contact_at ? formatDate(lead.last_contact_at) : '-'} />
                <InfoRow icon={<Clock className="h-4 w-4" />} label="Language" value={lead.language?.toUpperCase() || 'EN'} />
                {lead.notes && (
                  <div className="col-span-2">
                    <p className="text-xs text-ink-muted mb-1">Notes</p>
                    <p className="text-sm text-ink-secondary bg-surface-muted p-3 rounded-lg whitespace-pre-wrap">{lead.notes}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar: AI memory + timeline */}
        <div className="space-y-6">
          <div className="investo-card-pad">
            <div className="mb-4 flex items-center gap-2">
              <Bot className="h-5 w-5 text-brand-600" />
              <h2 className="text-lg font-semibold">What AI Knows</h2>
            </div>
            {lead.lead_memory && Object.keys(lead.lead_memory).length > 0 ? (
              <pre className="max-h-64 overflow-auto rounded-lg bg-surface-subtle p-3 text-xs text-ink-secondary">
                {JSON.stringify(lead.lead_memory, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-ink-faint text-center py-4">
                No AI memory recorded yet — memory builds as the buyer chats on WhatsApp.
              </p>
            )}
          </div>
          <div className="investo-card-pad">
            <h2 className="text-lg font-semibold mb-4">Activity Timeline</h2>
            {(!lead.timeline || lead.timeline.length === 0) ? (
              <p className="text-sm text-ink-faint text-center py-4">No activity yet</p>
            ) : (
              <div className="space-y-4">
                {lead.timeline.map((entry) => (
                  <div key={entry.id} className="flex gap-3">
                    <div className="flex-shrink-0 mt-1">
                      {entry.action.includes('create') ? (
                        <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center">
                          <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                        </div>
                      ) : entry.action.includes('status') ? (
                        <div className="w-6 h-6 rounded-full bg-brand-100 flex items-center justify-center">
                          <AlertTriangle className="h-3.5 w-3.5 text-brand-700" />
                        </div>
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-surface-subtle flex items-center justify-center">
                          <Edit3 className="h-3.5 w-3.5 text-ink-muted" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-ink-primary font-medium">{entry.action.replace(/_/g, ' ')}</p>
                      {entry.details && <p className="text-xs text-ink-muted mt-0.5">{entry.details}</p>}
                      <p className="text-xs text-ink-faint mt-1">{formatDate(entry.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    {Dialog}
    </>
  );
};

const InfoRow: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="flex items-start gap-2">
    <span className="text-ink-faint mt-0.5">{icon}</span>
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="text-sm font-medium text-ink-primary">{value}</p>
    </div>
  </div>
);

export default LeadDetailPage;

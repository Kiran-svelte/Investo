import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import {
  ArrowLeft, Phone, Mail, MapPin, Building2, IndianRupee,
  User, Calendar, Clock, Edit3, Save, X, Loader2, CheckCircle,
  AlertTriangle, MessageSquare
} from 'lucide-react';

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

const LEAD_TRANSITIONS: Record<string, string[]> = {
  new: ['contacted'],
  contacted: ['visit_scheduled', 'closed_lost'],
  visit_scheduled: ['visited', 'contacted'],
  visited: ['negotiation', 'closed_lost'],
  negotiation: ['closed_won', 'closed_lost'],
  closed_won: [],
  closed_lost: [],
};

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700 border-blue-300',
  contacted: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  visit_scheduled: 'bg-purple-100 text-purple-700 border-purple-300',
  visited: 'bg-indigo-100 text-indigo-700 border-indigo-300',
  negotiation: 'bg-orange-100 text-orange-700 border-orange-300',
  closed_won: 'bg-green-100 text-green-700 border-green-300',
  closed_lost: 'bg-red-100 text-red-700 border-red-300',
};

const PROPERTY_TYPES = ['apartment', 'villa', 'plot', 'commercial', 'farmland'];

const LeadDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t: _t } = useTranslation();
  const { user } = useAuth();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
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
      setLead(res.data.data);
    } catch (err) {
      console.error('Failed to load lead', err);
      setError('Lead not found');
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
    setSaving(true);
    setError('');
    try {
      await api.put(`/leads/${id}`, {
        customer_name: editForm.customer_name || null,
        email: editForm.email || null,
        budget_min: editForm.budget_min ? Number(editForm.budget_min) : null,
        budget_max: editForm.budget_max ? Number(editForm.budget_max) : null,
        location_preference: editForm.location_preference || null,
        property_type: editForm.property_type || null,
        assigned_agent_id: editForm.assigned_agent_id || null,
        notes: editForm.notes || null,
      });
      setEditing(false);
      await loadLead();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (newStatus: string) => {
    setStatusChanging(true);
    setError('');
    try {
      await api.patch(`/leads/${id}/status`, { status: newStatus });
      await loadLead();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update status');
    } finally {
      setStatusChanging(false);
    }
  };

  const formatCurrency = (val: number | null) => {
    if (!val) return '-';
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(1)} Cr`;
    if (val >= 100000) return `₹${(val / 100000).toFixed(1)} L`;
    return `₹${val.toLocaleString('en-IN')}`;
  };

  const formatDate = (d: string) => new Date(d).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">{error || 'Lead not found'}</p>
        <button onClick={() => navigate('/leads')} className="mt-4 text-blue-600 hover:underline">Back to Leads</button>
      </div>
    );
  }

  const allowedTransitions = LEAD_TRANSITIONS[lead.status] || [];
  const canEdit = user?.role === 'company_admin' || user?.role === 'super_admin' ||
    (user?.role === 'sales_agent' && lead.assigned_agent_id === user?.id);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      {/* Back + Header */}
      <div>
        <button onClick={() => navigate('/leads')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to Leads
        </button>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{lead.customer_name || lead.phone}</h1>
            <p className="text-sm text-gray-500">Created {formatDate(lead.created_at)}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1.5 text-sm font-semibold rounded-full border ${STATUS_COLORS[lead.status]}`}>
              {lead.status.replace(/_/g, ' ')}
            </span>
            {canEdit && !editing && (
              <button onClick={startEditing} className="flex items-center gap-1 px-3 py-1.5 border rounded-lg hover:bg-gray-50 text-sm">
                <Edit3 className="h-4 w-4" /> Edit
              </button>
            )}
          </div>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

      {/* Status Transitions */}
      {allowedTransitions.length > 0 && canEdit && (
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <p className="text-sm font-medium text-gray-700 mb-3">Move to:</p>
          <div className="flex flex-wrap gap-2">
            {allowedTransitions.map(status => (
              <button
                key={status}
                onClick={() => changeStatus(status)}
                disabled={statusChanging}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 ${STATUS_COLORS[status]} hover:opacity-80`}
              >
                {statusChanging ? <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> : null}
                {status.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lead Details */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <h2 className="text-lg font-semibold mb-4">Lead Details</h2>
            {editing ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                    <input value={editForm.customer_name} onChange={e => setEditForm(f => ({ ...f, customer_name: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Budget Min (₹)</label>
                    <input type="number" value={editForm.budget_min} onChange={e => setEditForm(f => ({ ...f, budget_min: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Budget Max (₹)</label>
                    <input type="number" value={editForm.budget_max} onChange={e => setEditForm(f => ({ ...f, budget_max: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                    <input value={editForm.location_preference} onChange={e => setEditForm(f => ({ ...f, location_preference: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Property Type</label>
                    <select value={editForm.property_type} onChange={e => setEditForm(f => ({ ...f, property_type: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
                      <option value="">Any</option>
                      {PROPERTY_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  {agents.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Assigned Agent</label>
                      <select value={editForm.assigned_agent_id} onChange={e => setEditForm(f => ({ ...f, assigned_agent_id: e.target.value }))}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
                        <option value="">Unassigned</option>
                        {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} rows={4}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex gap-3 justify-end">
                  <button onClick={() => setEditing(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50 flex items-center gap-1">
                    <X className="h-4 w-4" /> Cancel
                  </button>
                  <button onClick={saveEdit} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
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
                    <p className="text-xs text-gray-500 mb-1">Notes</p>
                    <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-lg whitespace-pre-wrap">{lead.notes}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Timeline */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <h2 className="text-lg font-semibold mb-4">Activity Timeline</h2>
            {(!lead.timeline || lead.timeline.length === 0) ? (
              <p className="text-sm text-gray-400 text-center py-4">No activity yet</p>
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
                        <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center">
                          <AlertTriangle className="h-3.5 w-3.5 text-blue-600" />
                        </div>
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
                          <Edit3 className="h-3.5 w-3.5 text-gray-500" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-gray-900 font-medium">{entry.action.replace(/_/g, ' ')}</p>
                      {entry.details && <p className="text-xs text-gray-500 mt-0.5">{entry.details}</p>}
                      <p className="text-xs text-gray-400 mt-1">{formatDate(entry.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const InfoRow: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="flex items-start gap-2">
    <span className="text-gray-400 mt-0.5">{icon}</span>
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-medium text-gray-900">{value}</p>
    </div>
  </div>
);

export default LeadDetailPage;

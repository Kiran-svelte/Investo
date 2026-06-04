import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { Users, TrendingUp, Award, Phone, Mail, Loader2, Plus, X, Trash2 } from 'lucide-react';
import { deleteUser } from '../../services/resourceDelete';
import Pagination from '../../components/common/Pagination';
import useConfirmDialog from '../../hooks/useConfirmDialog';

interface AgentStats {
  agent_id: string;
  agent_name: string;
  active_leads: number;
  closed_won: number;
  closed_lost: number;
  visits_completed: number;
}

interface AgentUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  role: string;
  companyId: string;
  created_at: string;
}

interface Company {
  id: string;
  name: string;
  slug: string;
}

const AgentsPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { confirm, Dialog } = useConfirmDialog();
  const [agentStats, setAgentStats] = useState<AgentStats[]>([]);
  const [agentUsers, setAgentUsers] = useState<AgentUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [pageError, setPageError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    role: 'sales_agent',
    company_id: '',
    must_change_password: true,
  });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalUsers, setTotalUsers] = useState(0);

  useEffect(() => {
    loadData();
  }, [page]);

  const loadData = async () => {
    try {
      setLoading(true);
      setPageError(null);
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('limit', '25');

      try {
        const analyticsRes = await api.get('/analytics/agents');
        setAgentStats(analyticsRes.data.data || []);
      } catch {
        setAgentStats([]);
        setPageError('Team loaded, but performance metrics are unavailable.');
      }

      const usersRes = await api.get(`/users?${params.toString()}`);
      const allUsers = usersRes.data.data || [];
      setAgentUsers(allUsers.filter((u: AgentUser) => ['sales_agent', 'operations'].includes(u.role)));
      setTotalPages(usersRes.data.pagination?.pages || 1);
      setTotalUsers(usersRes.data.pagination?.total || 0);

      if (user?.role === 'super_admin') {
        try {
          const companiesRes = await api.get('/companies');
          setCompanies(companiesRes.data.data || []);
        } catch {
          setCompanies([]);
          setPageError('Team loaded, but company choices are unavailable.');
        }
      }
    } catch (err) {
      console.error('Failed to load agents', err);
      setPageError('Could not load team members.');
      setAgentUsers([]);
      setAgentStats([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const payload: Record<string, unknown> = {
        name: formData.name,
        email: formData.email,
        password: formData.password,
        phone: formData.phone || null,
        role: formData.role,
        must_change_password: formData.must_change_password,
      };
      if (user?.role === 'super_admin' && formData.company_id) {
        payload.target_company_id = formData.company_id;
      }

      await api.post('/users', payload);
      setShowModal(false);
      setFormData({ name: '', email: '', password: '', phone: '', role: 'sales_agent', company_id: '', must_change_password: true });
      loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create user');
    } finally {
      setSubmitting(false);
    }
  };

  const canCreateUsers = user?.role === 'super_admin' || user?.role === 'company_admin';
  const canDeleteUsers = canCreateUsers;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-brand-700" />
      </div>
    );
  }

  const getStatsForAgent = (agentId: string) => agentStats.find(s => s.agent_id === agentId);

  const totalWon = agentStats.reduce((s, a) => s + a.closed_won, 0);
  const totalActive = agentStats.reduce((s, a) => s + a.active_leads, 0);

  return (
    <div className="investo-page space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-ink-primary">{t('agents.title') || 'Team Members'}</h1>
        {canCreateUsers && (
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" /> Add Team Member
          </button>
        )}
      </div>

      {pageError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
          {pageError}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="investo-card-pad">
          <div className="flex items-center gap-3">
            <div className="bg-brand-100 p-3 rounded-lg"><Users className="h-5 w-5 text-brand-700" /></div>
            <div><p className="text-sm text-ink-muted">Total Agents</p><p className="text-2xl font-bold">{agentUsers.length}</p></div>
          </div>
        </div>
        <div className="investo-card-pad">
          <div className="flex items-center gap-3">
            <div className="bg-green-100 p-3 rounded-lg"><TrendingUp className="h-5 w-5 text-green-600" /></div>
            <div><p className="text-sm text-ink-muted">Active Leads</p><p className="text-2xl font-bold">{totalActive}</p></div>
          </div>
        </div>
        <div className="investo-card-pad">
          <div className="flex items-center gap-3">
            <div className="bg-purple-100 p-3 rounded-lg"><Award className="h-5 w-5 text-purple-600" /></div>
            <div><p className="text-sm text-ink-muted">Deals Closed</p><p className="text-2xl font-bold">{totalWon}</p></div>
          </div>
        </div>
      </div>

      {/* Agent Cards */}
      {agentUsers.length === 0 ? (
        <div className="text-center py-12 text-ink-muted">
          No team members found. Use Add Team Member to create sales or operations users.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agentUsers.map((agent) => {
            const stats = getStatsForAgent(agent.id);
            const conversionRate = stats && (stats.closed_won + stats.closed_lost > 0)
              ? Math.round((stats.closed_won / (stats.closed_won + stats.closed_lost)) * 100)
              : 0;

            return (
              <div key={agent.id} className="investo-card-pad hover:shadow-md transition-shadow relative">
                {canDeleteUsers && agent.id !== user?.id && (
                  <button
                    type="button"
                    title="Delete user permanently"
                    onClick={async () => {
                      const confirmed = await confirm(
                        'Delete team member?',
                        `Permanently delete ${agent.name}? Their visits as agent will be removed and leads will be unassigned.`,
                        { confirmLabel: 'Delete' },
                      );
                      if (!confirmed) return;
                      try {
                        await deleteUser(agent.id);
                        setAgentUsers((prev) => prev.filter((u) => u.id !== agent.id));
                      } catch (err: unknown) {
                        const ax = err as { response?: { data?: { error?: string } } };
                        setPageError(ax.response?.data?.error || 'Failed to delete user');
                      }
                    }}
                    className="absolute top-3 right-3 p-1.5 text-ink-faint hover:text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-full bg-brand-100 flex items-center justify-center">
                    <Users className="h-6 w-6 text-brand-700" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-ink-primary">{agent.name}</h3>
                    <div className="flex items-center gap-2 text-xs text-ink-muted">
                      <Mail className="h-3 w-3" />{agent.email}
                    </div>
                    {agent.phone && (
                      <div className="flex items-center gap-2 text-xs text-ink-muted">
                        <Phone className="h-3 w-3" />{agent.phone}
                      </div>
                    )}
                  </div>
                </div>

                {stats ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-brand-50 rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-brand-800">{stats.active_leads}</p>
                      <p className="text-xs text-brand-700">Active Leads</p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-green-700">{stats.closed_won}</p>
                      <p className="text-xs text-green-600">Won</p>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-orange-700">{stats.visits_completed}</p>
                      <p className="text-xs text-orange-600">Visits Done</p>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-purple-700">{conversionRate}%</p>
                      <p className="text-xs text-purple-600">Conversion</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-ink-faint text-center py-4">No data yet</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        total={totalUsers}
        onPageChange={setPage}
        label="team members"
        className="mt-6"
      />

      {/* Add Team Member Modal */}
      {showModal && (
        <div className="investo-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="investo-modal-panel sm:max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Add Team Member</h2>
              <button onClick={() => setShowModal(false)} className="text-ink-faint hover:text-ink-secondary">
                <X className="h-5 w-5" />
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Company selector - only for super_admin */}
              {user?.role === 'super_admin' && (
                <div>
                  <label className="block text-sm font-medium text-ink-secondary mb-1">Company *</label>
                  <select
                    required
                    value={formData.company_id}
                    onChange={(e) => setFormData({ ...formData, company_id: e.target.value })}
                    className="w-full px-3 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  >
                    <option value="">Select Company</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1">Name *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  placeholder="Asha Mehta"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1">Email *</label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  placeholder="asha@company.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1">Password *</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  placeholder="Min 8 characters"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="must-change-password"
                  type="checkbox"
                  checked={formData.must_change_password}
                  onChange={(e) => setFormData({ ...formData, must_change_password: e.target.checked })}
                  className="h-4 w-4 rounded border-surface-border-strong text-brand-700 focus:ring-brand-500"
                />
                <label htmlFor="must-change-password" className="text-sm text-ink-secondary">
                  Force password change on first login
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1">Phone</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  placeholder="+919876543210"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1">Role *</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-border-strong rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                >
                  <option value="sales_agent">Sales Agent</option>
                  <option value="operations">Operations</option>
                  <option value="viewer">Viewer</option>
                  {user?.role === 'super_admin' && <option value="company_admin">Company Admin</option>}
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 border border-surface-border-strong text-ink-secondary rounded-lg hover:bg-surface-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2 investo-btn-primary disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {Dialog}
    </div>
  );
};

export default AgentsPage;

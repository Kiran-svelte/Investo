import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { Users, TrendingUp, Award, Phone, Mail, Loader2, Plus, X } from 'lucide-react';

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
  const [agentStats, setAgentStats] = useState<AgentStats[]>([]);
  const [agentUsers, setAgentUsers] = useState<AgentUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    role: 'sales_agent',
    company_id: '',
    must_change_password: true,
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const requests: Promise<any>[] = [
        api.get('/analytics/agents'),
        api.get('/users'),
      ];
      
      // Super admin needs company list
      if (user?.role === 'super_admin') {
        requests.push(api.get('/companies'));
      }
      
      const results = await Promise.all(requests);
      setAgentStats(results[0].data.data || []);
      // Filter to show sales_agent and operations roles
      const allUsers = results[1].data.data || [];
      setAgentUsers(allUsers.filter((u: AgentUser) => ['sales_agent', 'operations'].includes(u.role)));
      
      if (user?.role === 'super_admin' && results[2]) {
        setCompanies(results[2].data.data || []);
      }
    } catch (err) {
      console.error('Failed to load agents', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      // Build URL with target_company_id for super_admin
      let url = '/users';
      if (user?.role === 'super_admin' && formData.company_id) {
        url = `/users?target_company_id=${formData.company_id}`;
      }
      
      await api.post(url, {
        name: formData.name,
        email: formData.email,
        password: formData.password,
        phone: formData.phone || null,
        role: formData.role,
        must_change_password: formData.must_change_password,
      });
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const getStatsForAgent = (agentId: string) => agentStats.find(s => s.agent_id === agentId);

  const totalWon = agentStats.reduce((s, a) => s + a.closed_won, 0);
  const totalActive = agentStats.reduce((s, a) => s + a.active_leads, 0);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">{t('agents.title') || 'Team Members'}</h1>
        {canCreateUsers && (
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Add Team Member
          </button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm border p-5">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-3 rounded-lg"><Users className="h-5 w-5 text-blue-600" /></div>
            <div><p className="text-sm text-gray-500">Total Agents</p><p className="text-2xl font-bold">{agentUsers.length}</p></div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-5">
          <div className="flex items-center gap-3">
            <div className="bg-green-100 p-3 rounded-lg"><TrendingUp className="h-5 w-5 text-green-600" /></div>
            <div><p className="text-sm text-gray-500">Active Leads</p><p className="text-2xl font-bold">{totalActive}</p></div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-5">
          <div className="flex items-center gap-3">
            <div className="bg-purple-100 p-3 rounded-lg"><Award className="h-5 w-5 text-purple-600" /></div>
            <div><p className="text-sm text-gray-500">Deals Closed</p><p className="text-2xl font-bold">{totalWon}</p></div>
          </div>
        </div>
      </div>

      {/* Agent Cards */}
      {agentUsers.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No agents found. Add sales agents from Settings.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agentUsers.map((agent) => {
            const stats = getStatsForAgent(agent.id);
            const conversionRate = stats && (stats.closed_won + stats.closed_lost > 0)
              ? Math.round((stats.closed_won / (stats.closed_won + stats.closed_lost)) * 100)
              : 0;

            return (
              <div key={agent.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                    <Users className="h-6 w-6 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{agent.name}</h3>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Mail className="h-3 w-3" />{agent.email}
                    </div>
                    {agent.phone && (
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Phone className="h-3 w-3" />{agent.phone}
                      </div>
                    )}
                  </div>
                </div>

                {stats ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-blue-50 rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-blue-700">{stats.active_leads}</p>
                      <p className="text-xs text-blue-600">Active Leads</p>
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
                  <p className="text-sm text-gray-400 text-center py-4">No data yet</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Team Member Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Add Team Member</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Company *</label>
                  <select
                    required
                    value={formData.company_id}
                    onChange={(e) => setFormData({ ...formData, company_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select Company</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="John Doe"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="john@company.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Min 8 characters"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="must-change-password"
                  type="checkbox"
                  checked={formData.must_change_password}
                  onChange={(e) => setFormData({ ...formData, must_change_password: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="must-change-password" className="text-sm text-gray-700">
                  Force password change on first login
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="+919876543210"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentsPage;

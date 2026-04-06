import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import { Loader2, TrendingUp, Users, Calendar, BarChart3 } from 'lucide-react';

interface LeadAnalytics {
  by_status: { status: string; count: number }[];
  by_source: { source: string; count: number }[];
  daily: { date: string; count: number }[];
}

interface AgentStat {
  agent_id: string;
  agent_name: string;
  active_leads: number;
  closed_won: number;
  closed_lost: number;
  visits_completed: number;
}

interface DashStats {
  leads_total: number;
  visits_scheduled: number;
  deals_closed: number;
  conversion_rate: number;
  revenue: number;
}

const STATUS_COLORS: Record<string, string> = {
  new: '#3B82F6', contacted: '#F59E0B', visit_scheduled: '#8B5CF6',
  visited: '#6366F1', negotiation: '#F97316', closed_won: '#10B981', closed_lost: '#EF4444',
};

const AnalyticsPage: React.FC = () => {
  const { t } = useTranslation();
  const [leadData, setLeadData] = useState<LeadAnalytics | null>(null);
  const [agentData, setAgentData] = useState<AgentStat[]>([]);
  const [dashStats, setDashStats] = useState<DashStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    loadAll();
  }, [days]);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [leadsRes, agentsRes, dashRes] = await Promise.all([
        api.get(`/analytics/leads?days=${days}`),
        api.get('/analytics/agents'),
        api.get('/analytics/dashboard'),
      ]);
      setLeadData(leadsRes.data.data);
      setAgentData(agentsRes.data.data || []);
      setDashStats(dashRes.data.data);
    } catch (err) {
      console.error('Failed to load analytics', err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (val: number) => {
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(1)}Cr`;
    if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
    if (val >= 1000) return `₹${(val / 1000).toFixed(0)}K`;
    return `₹${val}`;
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>;
  }

  const totalLeadsByStatus = leadData?.by_status?.reduce((s, b) => s + Number(b.count), 0) || 1;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('analytics.title') || 'Analytics'}</h1>
        <select value={days} onChange={e => setDays(Number(e.target.value))}
          className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
          <option value={7}>{t('analytics.last_7_days')}</option>
          <option value={30}>{t('analytics.last_30_days')}</option>
          <option value={90}>{t('analytics.last_90_days')}</option>
        </select>
      </div>

      {/* KPI Cards */}
      {dashStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KPICard icon={<Users className="h-5 w-5 text-blue-600" />} label={t('dashboard.leads_today')} value={dashStats.leads_total} bg="bg-blue-50" />
          <KPICard icon={<Calendar className="h-5 w-5 text-green-600" />} label={t('dashboard.visits_scheduled')} value={dashStats.visits_scheduled} bg="bg-green-50" />
          <KPICard icon={<TrendingUp className="h-5 w-5 text-purple-600" />} label={t('dashboard.conversion_rate')} value={`${dashStats.conversion_rate}%`} bg="bg-purple-50" />
          <KPICard icon={<BarChart3 className="h-5 w-5 text-emerald-600" />} label={t('dashboard.revenue')} value={formatCurrency(dashStats.revenue)} bg="bg-emerald-50" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lead Funnel */}
        <div className="bg-white rounded-xl shadow-sm border p-5">
          <h2 className="text-lg font-semibold mb-4">{t('analytics.lead_funnel')}</h2>
          {leadData?.by_status && leadData.by_status.length > 0 ? (
            <div className="space-y-3">
              {leadData.by_status
                .sort((a, b) => {
                  const order = ['new', 'contacted', 'visit_scheduled', 'visited', 'negotiation', 'closed_won', 'closed_lost'];
                  return order.indexOf(a.status) - order.indexOf(b.status);
                })
                .map(item => {
                  const pct = Math.round((Number(item.count) / totalLeadsByStatus) * 100);
                  return (
                    <div key={item.status}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-gray-700 capitalize">{item.status.replace(/_/g, ' ')}</span>
                        <span className="font-semibold">{item.count} ({pct}%)</span>
                      </div>
                      <div className="h-6 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: STATUS_COLORS[item.status] || '#9CA3AF' }} />
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : (
            <p className="text-center text-gray-400 py-8">{t('common.no_data')}</p>
          )}
        </div>

        {/* Lead Sources */}
        <div className="bg-white rounded-xl shadow-sm border p-5">
          <h2 className="text-lg font-semibold mb-4">{t('analytics.lead_sources')}</h2>
          {leadData?.by_source && leadData.by_source.length > 0 ? (
            <div className="space-y-3">
              {leadData.by_source.map(item => {
                const totalSources = leadData.by_source.reduce((s, b) => s + Number(b.count), 0) || 1;
                const pct = Math.round((Number(item.count) / totalSources) * 100);
                const colors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 'bg-cyan-500', 'bg-pink-500'];
                const idx = leadData.by_source.indexOf(item) % colors.length;
                return (
                  <div key={item.source}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-700 capitalize">{(item.source || 'unknown').replace(/_/g, ' ')}</span>
                      <span className="font-semibold">{item.count} ({pct}%)</span>
                    </div>
                    <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${colors[idx]}`} style={{ width: `${Math.max(pct, 2)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-center text-gray-400 py-8">{t('common.no_data')}</p>
          )}
        </div>

        {/* Daily Lead Trend */}
        <div className="bg-white rounded-xl shadow-sm border p-5">
          <h2 className="text-lg font-semibold mb-4">{t('analytics.daily_new_leads')}</h2>
          {leadData?.daily && leadData.daily.length > 0 ? (
            <div className="space-y-1">
              {(() => {
                const maxCount = Math.max(...leadData.daily.map(d => Number(d.count)), 1);
                return leadData.daily.map(item => (
                  <div key={item.date} className="flex items-center gap-2 text-xs">
                    <span className="w-16 text-gray-500 flex-shrink-0">{new Date(item.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                    <div className="flex-1 h-5 bg-gray-50 rounded overflow-hidden">
                      <div className="h-full bg-blue-500 rounded" style={{ width: `${(Number(item.count) / maxCount) * 100}%` }} />
                    </div>
                    <span className="w-6 text-right font-medium">{item.count}</span>
                  </div>
                ));
              })()}
            </div>
          ) : (
            <p className="text-center text-gray-400 py-8">{t('common.no_data')}</p>
          )}
        </div>

        {/* Agent Performance */}
        <div className="bg-white rounded-xl shadow-sm border p-5">
          <h2 className="text-lg font-semibold mb-4">{t('analytics.agent_performance')}</h2>
          {agentData.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 text-gray-500 font-medium">{t('analytics.agent')}</th>
                    <th className="text-center py-2 text-gray-500 font-medium">{t('analytics.active')}</th>
                    <th className="text-center py-2 text-gray-500 font-medium">{t('analytics.won')}</th>
                    <th className="text-center py-2 text-gray-500 font-medium">{t('analytics.lost')}</th>
                    <th className="text-center py-2 text-gray-500 font-medium">{t('analytics.visits')}</th>
                    <th className="text-center py-2 text-gray-500 font-medium">{t('analytics.conversion')}</th>
                  </tr>
                </thead>
                <tbody>
                  {agentData.map(agent => {
                    const total = agent.closed_won + agent.closed_lost;
                    const conv = total > 0 ? Math.round((agent.closed_won / total) * 100) : 0;
                    return (
                      <tr key={agent.agent_id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="py-2 font-medium">{agent.agent_name}</td>
                        <td className="py-2 text-center">{agent.active_leads}</td>
                        <td className="py-2 text-center text-green-600 font-medium">{agent.closed_won}</td>
                        <td className="py-2 text-center text-red-600">{agent.closed_lost}</td>
                        <td className="py-2 text-center">{agent.visits_completed}</td>
                        <td className="py-2 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${conv >= 50 ? 'bg-green-100 text-green-700' : conv >= 25 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                            {conv}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-center text-gray-400 py-8">{t('common.no_data')}</p>
          )}
        </div>
      </div>
    </div>
  );
};

const KPICard: React.FC<{ icon: React.ReactNode; label: string; value: string | number; bg: string }> = ({ icon, label, value, bg }) => (
  <div className="bg-white rounded-xl shadow-sm border p-4">
    <div className="flex items-center gap-3">
      <div className={`${bg} p-2.5 rounded-lg`}>{icon}</div>
      <div><p className="text-xs text-gray-500">{label}</p><p className="text-xl font-bold text-gray-900">{value}</p></div>
    </div>
  </div>
);

export default AnalyticsPage;

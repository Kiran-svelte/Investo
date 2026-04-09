import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import {
  Users, Building2, Calendar, TrendingUp, MessageSquare,
  IndianRupee, ArrowUpRight, ArrowDownRight, Phone, MapPin,
  Clock, Eye
} from 'lucide-react';

interface DashboardStats {
  leads_today: number;
  leads_total: number;
  visits_scheduled: number;
  visits_completed: number;
  deals_closed: number;
  conversion_rate: number;
  ai_conversations: number;
  revenue: number;
}

interface Trends {
  leads: number;
  visits: number;
  deals: number;
  conversations: number;
}

interface RecentLead {
  id: string;
  customer_name: string | null;
  phone: string;
  status: string;
  source: string;
  created_at: string;
  property_type: string | null;
  agent_name: string | null;
}

interface UpcomingVisit {
  id: string;
  scheduled_at: string;
  status: string;
  duration_minutes: number;
  customer_name: string | null;
  customer_phone: string;
  property_name: string | null;
  location_area: string | null;
  agent_name: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-yellow-100 text-yellow-700',
  visit_scheduled: 'bg-indigo-100 text-indigo-700',
  visited: 'bg-purple-100 text-purple-700',
  negotiation: 'bg-orange-100 text-orange-700',
  closed_won: 'bg-green-100 text-green-700',
  closed_lost: 'bg-red-100 text-red-700',
  scheduled: 'bg-blue-100 text-blue-700',
  confirmed: 'bg-green-100 text-green-700',
};

const DashboardPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [trends, setTrends] = useState<Trends | null>(null);
  const [recentLeads, setRecentLeads] = useState<RecentLead[]>([]);
  const [upcomingVisits, setUpcomingVisits] = useState<UpcomingVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<string>('week');

  const loadAll = useCallback(async () => {
    try {
      const [statsRes, trendsRes, leadsRes, visitsRes] = await Promise.all([
        api.get('/analytics/dashboard'),
        api.get(`/analytics/trends?period=${period}`),
        api.get('/analytics/recent-leads'),
        api.get('/analytics/upcoming-visits'),
      ]);
      setStats(statsRes.data.data);
      setTrends(trendsRes.data.data);
      setRecentLeads(leadsRes.data.data);
      setUpcomingVisits(visitsRes.data.data);
    } catch (err) {
      console.error('Failed to load dashboard', err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, 60000);
    return () => clearInterval(interval);
  }, [loadAll]);

  const handlePeriodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setPeriod(e.target.value);
    setLoading(true);
  };

  const formatTimeAgo = (dateStr: string): string => {
    if (!dateStr) return 'Unknown';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Unknown';
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const formatVisitTime = (dateStr: string): string => {
    const d = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
    if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`;
    return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const trendValue = (key: keyof Trends) => {
    if (!trends) return { text: '0%', up: true };
    const val = trends[key];
    return { text: `${val >= 0 ? '+' : ''}${val}%`, up: val >= 0 };
  };

  const statCards = [
    {
      label: t('dashboard.leads_today'),
      value: stats?.leads_today || 0,
      icon: Users,
      color: 'bg-blue-500',
      trend: trendValue('leads'),
    },
    {
      label: t('dashboard.visits_scheduled'),
      value: stats?.visits_scheduled || 0,
      icon: Calendar,
      color: 'bg-green-500',
      trend: trendValue('visits'),
    },
    {
      label: t('dashboard.deals_closed'),
      value: stats?.deals_closed || 0,
      icon: Building2,
      color: 'bg-purple-500',
      trend: trendValue('deals'),
    },
    {
      label: t('dashboard.conversion_rate'),
      value: `${stats?.conversion_rate || 0}%`,
      icon: TrendingUp,
      color: 'bg-orange-500',
      trend: trendValue('deals'),
    },
    {
      label: t('dashboard.ai_conversations'),
      value: stats?.ai_conversations || 0,
      icon: MessageSquare,
      color: 'bg-cyan-500',
      trend: trendValue('conversations'),
    },
    {
      label: t('dashboard.revenue'),
      value: formatCurrency(stats?.revenue || 0),
      icon: IndianRupee,
      color: 'bg-emerald-500',
      trend: trendValue('deals'),
    },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('dashboard.title')}</h1>
          <p className="text-gray-500 text-sm">
            {t('common.welcome')}, {user?.name}
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={period}
            onChange={handlePeriodChange}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="today">{t('common.today')}</option>
            <option value="week">{t('common.this_week')}</option>
            <option value="month">{t('common.this_month')}</option>
          </select>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map((card, idx) => (
          <div
            key={idx}
            className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-gray-500 text-sm font-medium">{card.label}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{card.value}</p>
              </div>
              <div className={`${card.color} p-3 rounded-lg`}>
                <card.icon className="h-5 w-5 text-white" />
              </div>
            </div>
            <div className="flex items-center mt-3 text-sm">
              {card.trend.up ? (
                <ArrowUpRight className="h-4 w-4 text-green-500 mr-1" />
              ) : (
                <ArrowDownRight className="h-4 w-4 text-red-500 mr-1" />
              )}
              <span className={card.trend.up ? 'text-green-600' : 'text-red-600'}>
                {card.trend.text}
              </span>
              <span className="text-gray-400 ml-1">{t('common.vs_last_period')}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Leads + Upcoming Visits */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Leads - Real Data */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              {t('dashboard.recent_leads')}
            </h2>
            <button
              onClick={() => navigate('/leads')}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              View all <Eye className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-1">
            {recentLeads.length === 0 ? (
              <p className="text-gray-400 text-sm py-8 text-center">{t('common.no_data')}</p>
            ) : (
              recentLeads.map((lead) => (
                <div
                  key={lead.id}
                  onClick={() => navigate(`/leads/${lead.id}`)}
                  className="flex items-center justify-between py-2.5 px-2 border-b border-gray-50 last:border-0 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                      <Users className="h-4 w-4 text-gray-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 text-sm truncate">
                        {lead.customer_name || lead.phone}
                      </p>
                      <p className="text-xs text-gray-500">
                        {lead.source} &middot; {formatTimeAgo(lead.created_at)}
                        {lead.agent_name && <span> &middot; {lead.agent_name}</span>}
                      </p>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full flex-shrink-0 ${STATUS_BADGE[lead.status] || 'bg-gray-100 text-gray-600'}`}>
                    {lead.status.replace('_', ' ')}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Upcoming Visits - Real Data */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              {t('dashboard.upcoming_visits')}
            </h2>
            <button
              onClick={() => navigate('/calendar')}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              View all <Eye className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-1">
            {upcomingVisits.length === 0 ? (
              <p className="text-gray-400 text-sm py-8 text-center">{t('common.no_data')}</p>
            ) : (
              upcomingVisits.map((visit) => (
                <div
                  key={visit.id}
                  className="flex items-center justify-between py-2.5 px-2 border-b border-gray-50 last:border-0 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-green-50 flex items-center justify-center flex-shrink-0">
                      <Calendar className="h-4 w-4 text-green-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 text-sm truncate">
                        {visit.customer_name || visit.customer_phone}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-3 w-3" />
                          {formatVisitTime(visit.scheduled_at)}
                        </span>
                        {visit.property_name && (
                          <span className="flex items-center gap-0.5">
                            <MapPin className="h-3 w-3" />
                            {visit.property_name}
                          </span>
                        )}
                      </div>
                      {visit.agent_name && (
                        <p className="text-xs text-gray-400 flex items-center gap-0.5">
                          <Phone className="h-3 w-3" /> {visit.agent_name}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full flex-shrink-0 ${STATUS_BADGE[visit.status] || 'bg-gray-100 text-gray-600'}`}>
                    {visit.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

function formatCurrency(value: number): string {
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(1)}Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  if (value >= 1000) return `₹${(value / 1000).toFixed(1)}K`;
  return `₹${value}`;
}

export default DashboardPage;

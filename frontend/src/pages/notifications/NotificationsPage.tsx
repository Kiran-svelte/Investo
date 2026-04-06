import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, UserPlus, Calendar, CheckCircle, AlertCircle, RefreshCw, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';

interface Notification {
  id: string;
  type:
    | 'lead_new'
    | 'lead_assigned'
    | 'lead_status_change'
    | 'lead_reassigned'
    | 'follow_up'
    | 'visit_reminder'
    | 'visit_scheduled'
    | 'visit_confirmed'
    | 'visit_completed'
    | 'visit_cancelled'
    | 'visit_rescheduled'
    | 'agent_takeover'
    | 'system'
    | 'system_alert';
  title: string;
  message: string;
  data: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

type FilterTab = 'all' | 'unread' | 'lead' | 'visit' | 'system';

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function getIcon(type: Notification['type']) {
  switch (type) {
    case 'lead_new':
    case 'lead_assigned':
    case 'lead_status_change':
    case 'lead_reassigned':
    case 'follow_up':
      return <UserPlus className="h-5 w-5 text-blue-600" />;
    case 'visit_reminder':
    case 'visit_scheduled':
    case 'visit_confirmed':
    case 'visit_cancelled':
    case 'visit_rescheduled':
      return <Calendar className="h-5 w-5 text-orange-500" />;
    case 'visit_completed':
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case 'system':
    case 'agent_takeover':
    case 'system_alert':
      return <AlertCircle className="h-5 w-5 text-red-500" />;
    default:
      return <Bell className="h-5 w-5 text-gray-500" />;
  }
}

const LIMIT = 20;

const FILTER_TABS: { key: FilterTab; labelKey: string }[] = [
  { key: 'all', labelKey: 'notifications.filter.all' },
  { key: 'unread', labelKey: 'notifications.filter.unread' },
  { key: 'lead', labelKey: 'notifications.filter.lead' },
  { key: 'visit', labelKey: 'notifications.filter.visit' },
  { key: 'system', labelKey: 'notifications.filter.system' },
];

export default function NotificationsPage() {
  const { t } = useTranslation();
  useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  const fetchNotifications = useCallback(async (pageNum: number, append = false) => {
    setLoading(true);
    try {
      const res = await api.get(`/notifications?page=${pageNum}&limit=${LIMIT}`);
      const { notifications: items, total: totalCount } = res.data.data ?? res.data;
      if (append) {
        setNotifications(prev => [...prev, ...items]);
      } else {
        setNotifications(items);
      }
      setTotal(totalCount);
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications(1);
  }, [fetchNotifications]);

  const handleMarkAsRead = async (id: string) => {
    try {
      await api.put(`/notifications/${id}/read`);
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, read: true } : n))
      );
    } catch {
      // silently handle
    }
  };

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    try {
      await api.put('/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch {
      // silently handle
    } finally {
      setMarkingAll(false);
    }
  };

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchNotifications(nextPage, true);
  };

  const filteredNotifications = notifications.filter(n => {
    switch (activeTab) {
      case 'unread':
        return !n.read;
      case 'lead':
        return (
          n.type === 'lead_new' ||
          n.type === 'lead_assigned' ||
          n.type === 'lead_status_change' ||
          n.type === 'lead_reassigned' ||
          n.type === 'follow_up'
        );
      case 'visit':
        return (
          n.type === 'visit_reminder' ||
          n.type === 'visit_scheduled' ||
          n.type === 'visit_confirmed' ||
          n.type === 'visit_completed' ||
          n.type === 'visit_cancelled' ||
          n.type === 'visit_rescheduled'
        );
      case 'system':
        return n.type === 'system' || n.type === 'system_alert' || n.type === 'agent_takeover';
      default:
        return true;
    }
  });

  const hasMore = notifications.length < total;
  const hasUnread = notifications.some(n => !n.read);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('notifications.title', 'Notifications')}</h1>
        {hasUnread && (
          <button
            onClick={handleMarkAllRead}
            disabled={markingAll}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 border border-blue-600 rounded-lg hover:bg-blue-50 disabled:opacity-50"
          >
            {markingAll ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4" />
            )}
            {t('notifications.markAllRead', 'Mark All Read')}
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6 border-b border-gray-200">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {/* Notification List */}
      {loading && notifications.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      ) : filteredNotifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Bell className="h-12 w-12 mb-4" />
          <p className="text-lg font-medium">{t('notifications.empty', 'No notifications')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredNotifications.map(notification => (
            <div
              key={notification.id}
              onClick={() => !notification.read && handleMarkAsRead(notification.id)}
              className={`flex items-start gap-4 p-4 rounded-lg cursor-pointer transition-colors ${
                notification.read
                  ? 'bg-white hover:bg-gray-50'
                  : 'bg-blue-50 border-l-4 border-l-blue-500 hover:bg-blue-100'
              }`}
            >
              <div className="flex-shrink-0 mt-0.5">
                {getIcon(notification.type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-gray-900 truncate">
                    {notification.title}
                  </p>
                  {!notification.read && (
                    <span className="flex-shrink-0 h-2 w-2 rounded-full bg-blue-500" />
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-1">{notification.message}</p>
                <p className="text-xs text-gray-400 mt-1">{timeAgo(notification.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Load More */}
      {hasMore && (
        <div className="flex justify-center mt-6">
          <button
            onClick={handleLoadMore}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t('notifications.loadMore', 'Load more')}
          </button>
        </div>
      )}
    </div>
  );
}

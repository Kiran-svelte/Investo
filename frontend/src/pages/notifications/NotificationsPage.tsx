import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Bell, UserPlus, Calendar, CheckCircle, AlertCircle, RefreshCw, Loader2, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { dashboardPath } from '../../config/navigation.config';
import api from '../../services/api';
import useConfirmDialog from '../../hooks/useConfirmDialog';
import {
  deleteAllNotificationsForCurrentUser,
  deleteNotificationById,
  formatNotificationTime,
  normalizeNotificationsPayload,
  type Notification,
} from '../../services/notifications';

type FilterTab = 'all' | 'unread' | 'lead' | 'visit' | 'system';

function getIcon(type: Notification['type']) {
  switch (type) {
    case 'lead_new':
    case 'lead_assigned':
    case 'lead_status_change':
    case 'lead_reassigned':
    case 'follow_up':
      return <UserPlus className="h-5 w-5 text-brand-700" />;
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
      return <Bell className="h-5 w-5 text-ink-muted" />;
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

const TAB_TYPES: Partial<Record<FilterTab, Notification['type'][]>> = {
  lead: ['lead_new', 'lead_assigned', 'lead_status_change', 'lead_reassigned', 'follow_up'],
  visit: [
    'visit_reminder',
    'visit_scheduled',
    'visit_confirmed',
    'visit_completed',
    'visit_cancelled',
    'visit_rescheduled',
  ],
  system: ['system', 'system_alert', 'agent_takeover'],
};

function pickString(data: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function getNotificationTarget(notification: Notification): string | null {
  const data = notification.data || {};
  const conversationId = pickString(data, 'conversationId', 'conversation_id');
  const leadId = pickString(data, 'leadId', 'lead_id');
  const visitId = pickString(data, 'visitId', 'visit_id');

  if (conversationId) return dashboardPath(`/conversations?id=${conversationId}`);
  if (leadId) return dashboardPath(`/leads/${leadId}`);
  if (visitId) return dashboardPath('/calendar');
  return null;
}

export default function NotificationsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useAuth();
  const { confirm, Dialog } = useConfirmDialog();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [pageError, setPageError] = useState<string | null>(null);

  const fetchNotifications = useCallback(async (pageNum: number, append = false) => {
    setLoading(true);
    setPageError(null);
    try {
      const params = new URLSearchParams({
        page: String(pageNum),
        limit: String(LIMIT),
      });
      if (activeTab === 'unread') {
        params.set('unread', 'true');
      }
      const types = TAB_TYPES[activeTab];
      if (types?.length) {
        params.set('types', types.join(','));
      }
      const res = await api.get(`/notifications?${params.toString()}`);
      const { notifications: items, total: totalCount } = normalizeNotificationsPayload(res.data);
      if (append) {
        setNotifications(prev => [...prev, ...items]);
      } else {
        setNotifications(items);
      }
      setTotal(totalCount);
    } catch {
      setPageError('Could not load notifications. Check your connection and try again.');
      if (!append) {
        setNotifications([]);
        setTotal(0);
      }
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    setPage(1);
    fetchNotifications(1);
  }, [activeTab, fetchNotifications]);

  const handleMarkAsRead = async (id: string) => {
    try {
      await api.put(`/notifications/${id}/read`);
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, read: true } : n))
      );
    } catch {
      setPageError('Could not mark that notification as read.');
    }
  };

  const handleDeleteNotification = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = await confirm(
      'Delete notification?',
      'This notification will be permanently removed from your workspace.',
      { confirmLabel: 'Delete' },
    );
    if (!confirmed) return;
    try {
      await deleteNotificationById(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      setTotal((t) => Math.max(0, t - 1));
    } catch {
      setPageError('Could not delete the notification.');
    }
  };

  const handleClearAll = async () => {
    const confirmed = await confirm(
      'Clear all notifications?',
      'Every notification visible to you will be permanently deleted. This cannot be undone.',
      { confirmLabel: 'Clear all' },
    );
    if (!confirmed) return;
    setClearingAll(true);
    try {
      await deleteAllNotificationsForCurrentUser();
      setNotifications([]);
      setTotal(0);
    } catch {
      setPageError('Could not clear notifications.');
    } finally {
      setClearingAll(false);
    }
  };

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    try {
      await api.put('/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch {
      setPageError('Could not mark notifications as read.');
    } finally {
      setMarkingAll(false);
    }
  };

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchNotifications(nextPage, true);
  };

  const hasMore = notifications.length < total;
  const hasUnread = notifications.some(n => !n.read);

  return (
    <div className="investo-page mx-auto max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('notifications.title', 'Notifications')}</h1>
        <div className="flex flex-wrap gap-2">
          {notifications.length > 0 && (
            <button
              type="button"
              onClick={() => void handleClearAll()}
              disabled={clearingAll}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-700 border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              {clearingAll ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {t('notifications.clearAll', 'Clear all')}
            </button>
          )}
          {hasUnread && (
            <button
              onClick={handleMarkAllRead}
              disabled={markingAll}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-brand-700 border border-brand-600 rounded-lg hover:bg-brand-50 disabled:opacity-50"
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
      </div>

      {pageError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {pageError}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6 border-b border-surface-border">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-ink-muted hover:text-ink-secondary'
            }`}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {/* Notification List */}
      {loading && notifications.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-ink-faint">
          <Bell className="h-12 w-12 mb-4" />
          <p className="text-lg font-medium">{t('notifications.empty', 'No notifications')}</p>
          {activeTab !== 'all' && (
            <p className="mt-1 text-sm text-ink-muted">No items match this tab.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map(notification => {
            const target = getNotificationTarget(notification);
            return (
            <div
              key={notification.id}
              onClick={() => {
                void handleMarkAsRead(notification.id);
                if (target) navigate(target);
              }}
              className={`flex items-start gap-4 p-4 rounded-lg cursor-pointer transition-colors ${
                notification.read
                  ? 'bg-surface-elevated hover:bg-surface-muted'
                  : 'bg-brand-50 border-l-4 border-l-brand-500 hover:bg-brand-100'
              }`}
            >
              <div className="flex-shrink-0 mt-0.5">
                {getIcon(notification.type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-ink-primary truncate">
                    {notification.title}
                  </p>
                  {!notification.read && (
                    <span className="flex-shrink-0 h-2 w-2 rounded-full bg-brand-500" />
                  )}
                </div>
                <p className="text-sm text-ink-muted mt-1">{notification.message}</p>
                <p className="text-xs text-ink-faint mt-1">
                  {formatNotificationTime(notification.createdAt)}
                  {target && <span className="ml-2 text-brand-700">Open related record</span>}
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => void handleDeleteNotification(notification.id, e)}
                className="flex-shrink-0 p-2 text-ink-faint hover:text-red-600 hover:bg-red-50 rounded-lg"
                aria-label="Delete notification"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            );
          })}
        </div>
      )}

      {/* Load More */}
      {hasMore && (
        <div className="flex justify-center mt-6">
          <button
            onClick={handleLoadMore}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2 text-sm font-medium text-ink-secondary bg-surface-elevated border border-surface-border-strong rounded-lg hover:bg-surface-muted disabled:opacity-50"
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
      {Dialog}
    </div>
  );
}

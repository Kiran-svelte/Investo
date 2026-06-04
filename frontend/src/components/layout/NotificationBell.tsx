import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell } from 'lucide-react';
import api from '../../services/api';
import {
  formatNotificationTime,
  normalizeNotificationsPayload,
  type Notification,
} from '../../services/notifications';
import { dashboardPath } from '../../config/navigation.config';
import useCompanyFeatures from '../../hooks/useCompanyFeatures';
import { useAuth } from '../../context/AuthContext';

export default function NotificationBell() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { isFeatureEnabled } = useCompanyFeatures();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const enabled =
    user?.role === 'super_admin' || isFeatureEnabled('notifications');

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await api.get('/notifications?page=1&limit=8');
      const { notifications, unreadCount: count } = normalizeNotificationsPayload(res.data);
      setItems(notifications);
      setUnreadCount(count);
    } catch {
      setItems([]);
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!enabled) return null;

  const markRead = async (id: string) => {
    try {
      await api.put(`/notifications/${id}/read`);
      void load();
    } catch {
      /* ignore */
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void load();
        }}
        aria-expanded={open}
        aria-label={t('notifications.title', { defaultValue: 'Notifications' })}
        className="investo-icon-btn relative"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="investo-dropdown-panel right-0 mt-2 w-[min(100vw-2rem,22rem)]">
          <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
            <p className="text-sm font-semibold text-ink-primary">
              {t('notifications.title', { defaultValue: 'Notifications' })}
            </p>
            {unreadCount > 0 && (
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-800">
                {unreadCount} {t('notifications.filter.unread', { defaultValue: 'unread' })}
              </span>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading && items.length === 0 ? (
              <div className="space-y-3 p-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="investo-skeleton-line h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-muted">
                {t('notifications.empty', { defaultValue: 'No notifications' })}
              </p>
            ) : (
              <ul className="divide-y divide-surface-border/80">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => void markRead(n.id)}
                      className={`w-full px-4 py-3 text-left transition-colors hover:bg-surface-subtle ${
                        !n.read ? 'bg-brand-50/40' : ''
                      }`}
                    >
                      <p className="text-sm font-medium text-ink-primary">{n.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{n.message}</p>
                      <p className="mt-1 text-[10px] text-ink-faint">
                        {formatNotificationTime(n.createdAt)}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-surface-border p-2">
            <Link
              to={dashboardPath('/notifications')}
              onClick={() => setOpen(false)}
              className="investo-btn-ghost w-full justify-center text-sm"
            >
              {t('notifications.viewAll', { defaultValue: 'View all notifications' })}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

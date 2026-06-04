/**
 * Normalizes notification payloads from the API (Prisma camelCase) and legacy snake_case.
 */

export type NotificationType =
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

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  data: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

type RawNotification = Record<string, unknown>;

function pickString(raw: RawNotification, ...keys: string[]): string {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}

function pickBoolean(raw: RawNotification, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'boolean') return value;
  }
  return false;
}

function pickData(raw: RawNotification): Record<string, unknown> {
  const value = raw.data;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function normalizeNotification(raw: unknown): Notification {
  const item = (raw && typeof raw === 'object' ? raw : {}) as RawNotification;

  return {
    id: pickString(item, 'id'),
    type: (pickString(item, 'type') || 'system') as NotificationType,
    title: pickString(item, 'title'),
    message: pickString(item, 'message'),
    data: pickData(item),
    read: pickBoolean(item, 'read', 'is_read', 'isRead'),
    createdAt: pickString(item, 'createdAt', 'created_at'),
  };
}

export function normalizeNotifications(raw: unknown): Notification[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeNotification);
}

export interface NotificationsListPayload {
  notifications: Notification[];
  total: number;
  unreadCount: number;
}

export function normalizeNotificationsPayload(payload: unknown): NotificationsListPayload {
  const data = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const nested = data.data && typeof data.data === 'object' ? (data.data as Record<string, unknown>) : data;

  const notifications = normalizeNotifications(nested.notifications);
  const total =
    typeof nested.total === 'number'
      ? nested.total
      : notifications.length;
  const unreadCount =
    typeof nested.unreadCount === 'number'
      ? nested.unreadCount
      : notifications.filter((n) => !n.read).length;

  return { notifications, total, unreadCount };
}

/** Safe relative time label — never throws on invalid/missing dates. */
export function formatNotificationTime(date: string | undefined): string {
  if (!date) return '';

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';

  const seconds = Math.floor((Date.now() - parsed.getTime()) / 1000);
  if (seconds < 0) return 'just now';
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

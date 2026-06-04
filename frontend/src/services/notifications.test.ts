import { describe, expect, it } from 'vitest';
import {
  formatNotificationTime,
  normalizeNotification,
  normalizeNotifications,
  normalizeNotificationsPayload,
} from './notifications';

describe('normalizeNotification', () => {
  it('maps Prisma camelCase fields', () => {
    const n = normalizeNotification({
      id: 'n1',
      type: 'system',
      title: 'Hello',
      message: 'World',
      data: { foo: 1 },
      read: false,
      createdAt: '2026-06-03T06:12:26.112Z',
    });

    expect(n).toEqual({
      id: 'n1',
      type: 'system',
      title: 'Hello',
      message: 'World',
      data: { foo: 1 },
      read: false,
      createdAt: '2026-06-03T06:12:26.112Z',
    });
  });

  it('maps legacy snake_case fields', () => {
    const n = normalizeNotification({
      id: 'n2',
      type: 'lead_new',
      title: 'Lead',
      message: 'New lead',
      read: true,
      is_read: true,
      created_at: '2026-01-01T00:00:00.000Z',
    });

    expect(n.read).toBe(true);
    expect(n.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('handles null/undefined safely', () => {
    const n = normalizeNotification(null);
    expect(n.id).toBe('');
    expect(n.createdAt).toBe('');
    expect(n.read).toBe(false);
    expect(n.data).toEqual({});
  });
});

describe('normalizeNotifications', () => {
  it('returns empty array for non-array input', () => {
    expect(normalizeNotifications(undefined)).toEqual([]);
    expect(normalizeNotifications({})).toEqual([]);
  });

  it('normalizes each item', () => {
    const list = normalizeNotifications([
      { id: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', created_at: '2026-01-02T00:00:00.000Z' },
    ]);
    expect(list).toHaveLength(2);
    expect(list[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(list[1].createdAt).toBe('2026-01-02T00:00:00.000Z');
  });
});

describe('normalizeNotificationsPayload', () => {
  it('extracts from nested data envelope', () => {
    const payload = normalizeNotificationsPayload({
      data: {
        notifications: [{ id: 'x', createdAt: '2026-06-01T00:00:00.000Z', read: false }],
        total: 5,
        unreadCount: 3,
      },
    });

    expect(payload.notifications).toHaveLength(1);
    expect(payload.total).toBe(5);
    expect(payload.unreadCount).toBe(3);
  });

  it('guards missing notifications array', () => {
    const payload = normalizeNotificationsPayload({ data: {} });
    expect(payload.notifications).toEqual([]);
    expect(payload.total).toBe(0);
    expect(payload.unreadCount).toBe(0);
  });
});

describe('formatNotificationTime', () => {
  it('returns empty string for invalid dates', () => {
    expect(formatNotificationTime(undefined)).toBe('');
    expect(formatNotificationTime('')).toBe('');
    expect(formatNotificationTime('not-a-date')).toBe('');
  });

  it('returns relative label for valid dates', () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatNotificationTime(recent)).toBe('5m ago');
  });
});

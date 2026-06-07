const mockNotificationCreate = jest.fn().mockResolvedValue({ id: 'notif-1' });
const mockUserFindUnique = jest.fn();
const mockLeadFindUnique = jest.fn();

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    notification: { create: (...args: unknown[]) => mockNotificationCreate(...args) },
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
    lead: { findUnique: (...args: unknown[]) => mockLeadFindUnique(...args) },
  },
}));

const mockEmitToCompany = jest.fn().mockReturnValue(true);
jest.mock('../../services/socket.service', () => ({
  socketService: { emitToCompany: (...args: unknown[]) => mockEmitToCompany(...args) },
  SOCKET_EVENTS: {
    NOTIFICATION_NEW: 'notification:new',
    LEAD_UPDATED: 'lead:updated',
  },
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: { whatsapp: {}, env: 'test' },
}));

import { notificationEngine } from '../../services/notification.engine';

describe('notificationEngine.notify()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates a DB notification and emits socket event', async () => {
    await notificationEngine.notify({
      companyId: 'company-1',
      userId: 'user-1',
      type: 'follow_up',
      title: 'Test notification',
      message: 'Test message',
    });

    expect(mockNotificationCreate).toHaveBeenCalledTimes(1);
    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          userId: 'user-1',
          type: 'follow_up',
          title: 'Test notification',
          message: 'Test message',
        }),
      }),
    );

    expect(mockEmitToCompany).toHaveBeenCalledTimes(1);
    expect(mockEmitToCompany).toHaveBeenCalledWith(
      'company-1',
      'notification:new',
      expect.objectContaining({
        userId: 'user-1',
        type: 'follow_up',
        title: 'Test notification',
      }),
    );
  });

  test('allows userId to be null (broadcast)', async () => {
    await notificationEngine.notify({
      companyId: 'company-1',
      userId: null,
      type: 'system_alert',
      title: 'System alert',
      message: 'Something happened',
    });

    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: null }),
      }),
    );
  });

  test('does not throw when prisma.notification.create fails', async () => {
    mockNotificationCreate.mockRejectedValueOnce(new Error('DB error'));

    await expect(
      notificationEngine.notify({
        companyId: 'company-1',
        userId: 'user-1',
        type: 'system',
        title: 'Test',
        message: 'Test',
      }),
    ).resolves.not.toThrow();
  });
});

describe('notificationEngine.onLeadAssigned()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates lead_assigned notification when agent exists', async () => {
    mockUserFindUnique.mockResolvedValueOnce({ id: 'agent-1', name: 'Alice' });

    await notificationEngine.onLeadAssigned(
      { id: 'lead-1', companyId: 'company-1', customerName: 'Bob', phone: '+91999' },
      'agent-1',
    );

    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'lead_assigned',
          userId: 'agent-1',
          companyId: 'company-1',
        }),
      }),
    );
  });

  test('skips notification when agent not found', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);

    await notificationEngine.onLeadAssigned(
      { id: 'lead-1', companyId: 'company-1', customerName: 'Bob', phone: '+91999' },
      'ghost-agent',
    );

    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });
});

const mockNotificationCreate = jest.fn().mockResolvedValue({ id: 'notif-1' });
const mockUserFindUnique = jest.fn();
const mockUserFindMany = jest.fn().mockResolvedValue([]);
const mockLeadFindUnique = jest.fn();
const mockSendCompanyTextMessage = jest.fn().mockResolvedValue(true);

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    notification: { create: (...args: unknown[]) => mockNotificationCreate(...args) },
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
    },
    lead: { findUnique: (...args: unknown[]) => mockLeadFindUnique(...args) },
  },
}));

jest.mock('../../services/whatsapp.service', () => ({
  whatsappService: {
    sendCompanyTextMessage: (...args: unknown[]) => mockSendCompanyTextMessage(...args),
    sendMessage: jest.fn().mockResolvedValue(true),
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

jest.mock('../../services/notificationRetry.service', () => ({
  withRetry: (fn: () => Promise<unknown>) => fn(),
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

describe('notificationEngine.onVisitStatusChange()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindUnique.mockResolvedValue({ phone: '+919888877777' });
  });

  test('formats confirmed visit time in IST for agent WhatsApp', async () => {
    const tenAmIst = new Date('2026-06-12T04:30:00.000Z');

    await notificationEngine.onVisitStatusChange(
      {
        id: 'visit-1',
        companyId: 'company-1',
        agentId: 'agent-1',
        scheduledAt: tenAmIst,
        property: { name: 'Sunset Heights' },
      },
      'scheduled',
      'confirmed',
      { customerName: 'Kannada media', phone: '+919999988888' },
      { settings: {} },
      true,
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(mockSendCompanyTextMessage).toHaveBeenCalledWith(
      '+919888877777',
      expect.stringMatching(/10:00\s*am/i),
      'company-1',
    );
  });
});

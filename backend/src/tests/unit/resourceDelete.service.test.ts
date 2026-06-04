import {
  ResourceDeleteError,
  deleteLeadPermanently,
  deleteNotificationPermanently,
} from '../../services/resourceDelete.service';

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    lead: { findFirst: jest.fn(), delete: jest.fn() },
    conversation: { findMany: jest.fn(), deleteMany: jest.fn() },
    message: { deleteMany: jest.fn() },
    visit: { deleteMany: jest.fn() },
    notification: { findFirst: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  },
}));

import prisma from '../../config/prisma';

describe('resourceDelete.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deleteLeadPermanently throws 404 when lead missing', async () => {
    (prisma.lead.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(deleteLeadPermanently('co-1', 'lead-1')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('deleteLeadPermanently cascades conversations and visits', async () => {
    (prisma.lead.findFirst as jest.Mock).mockResolvedValue({ id: 'lead-1', companyId: 'co-1' });
    (prisma.conversation.findMany as jest.Mock).mockResolvedValue([{ id: 'conv-1' }]);

    await deleteLeadPermanently('co-1', 'lead-1');

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.message.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: { in: ['conv-1'] } },
    });
    expect(prisma.lead.delete).toHaveBeenCalledWith({ where: { id: 'lead-1' } });
  });

  it('deleteNotificationPermanently throws when not visible to user', async () => {
    (prisma.notification.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(
      deleteNotificationPermanently('co-1', 'user-1', 'n-1'),
    ).rejects.toBeInstanceOf(ResourceDeleteError);
  });
});

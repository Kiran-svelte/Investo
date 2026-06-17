/// <reference types="jest" />

const mockPrisma = {
  outboxEvent: {
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: { features: { outboxEvents: true } },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../publicApi/webhookSubscription.service', () => ({
  webhookSubscriptionService: {
    dispatch: jest.fn().mockResolvedValue(undefined),
  },
}));

import { outboxService } from '../../dataPlatform/outbox.service';
import { webhookSubscriptionService } from '../../publicApi/webhookSubscription.service';

describe('OutboxService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.outboxEvent.create.mockResolvedValue({ id: 'evt-1', status: 'pending' });
    mockPrisma.outboxEvent.findMany.mockResolvedValue([
      { id: 'evt-1', companyId: 'co-1', eventType: 'lead.created', payload: {}, status: 'pending' },
    ]);
    mockPrisma.outboxEvent.update.mockResolvedValue({});
  });

  it('creates pending outbox events', async () => {
    const event = await outboxService.publish({
      companyId: 'co-1',
      eventType: 'lead.created',
      payload: { id: 'lead-1' },
    });
    expect(event.id).toBe('evt-1');
  });

  it('processes pending events and marks published', async () => {
    const processed = await outboxService.processPending();
    expect(processed).toBe(1);
    expect(webhookSubscriptionService.dispatch).toHaveBeenCalled();
    expect(mockPrisma.outboxEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'published' }) }),
    );
  });
});

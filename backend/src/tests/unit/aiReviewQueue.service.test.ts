/// <reference types="jest" />

const mockPrisma = {
  aiReviewQueueItem: {
    create: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: { features: { aiReviewQueue: true } },
}));

import { aiReviewQueueService } from '../../governance/aiReviewQueue.service';

describe('AiReviewQueueService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.aiReviewQueueItem.create.mockResolvedValue({ id: 'item-1', status: 'pending' });
    mockPrisma.aiReviewQueueItem.findMany.mockResolvedValue([]);
    mockPrisma.aiReviewQueueItem.updateMany.mockResolvedValue({ count: 1 });
  });

  it('skips enqueue for low risk scores', async () => {
    const result = await aiReviewQueueService.enqueue({
      companyId: 'co-1',
      messageId: 'msg-1',
      riskScore: 40,
    });
    expect(result).toBeNull();
    expect(mockPrisma.aiReviewQueueItem.create).not.toHaveBeenCalled();
  });

  it('enqueues high risk messages', async () => {
    const result = await aiReviewQueueService.enqueue({
      companyId: 'co-1',
      messageId: 'msg-1',
      riskScore: 85,
    });
    expect(result?.id).toBe('item-1');
  });

  it('reviews pending items', async () => {
    const result = await aiReviewQueueService.review('item-1', 'co-1', 'admin-1', 'approved');
    expect(result.count).toBe(1);
  });
});

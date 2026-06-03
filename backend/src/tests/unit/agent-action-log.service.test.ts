const mockCreate = jest.fn();
const mockDeleteMany = jest.fn();

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    agentActionLog: {
      create: (...args: unknown[]) => mockCreate(...args),
      deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import logger from '../../config/logger';
import { logAgentAction, purgeOldActionLogs } from '../../services/agent-action-log.service';

describe('agent-action-log.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logAgentAction never throws when DB create fails', async () => {
    mockCreate.mockRejectedValue(new Error('connection refused'));
    await expect(
      logAgentAction({
        companyId: 'company-1',
        triggeredBy: 'cron',
        action: 'testAction',
      }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('logAgentAction persists on success', async () => {
    mockCreate.mockResolvedValue({ id: 'log-1' });
    await logAgentAction({
      companyId: 'company-1',
      triggeredBy: 'agent_tool',
      action: 'addLeadNote',
      actorId: 'user-1',
      status: 'success',
    });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          action: 'addLeadNote',
        }),
      }),
    );
  });

  it('purgeOldActionLogs deletes entries older than retention window', async () => {
    mockDeleteMany.mockResolvedValue({ count: 12 });
    const deleted = await purgeOldActionLogs(90);
    expect(deleted).toBe(12);
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    });
  });
});

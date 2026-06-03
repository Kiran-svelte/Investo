const mockLogAgentAction = jest.fn();
const mockUserFindMany = jest.fn();
const mockSendCompanyTextMessage = jest.fn();

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
    },
  },
}));

jest.mock('../../services/agent-action-log.service', () => ({
  logAgentAction: (...args: unknown[]) => mockLogAgentAction(...args),
  purgeOldActionLogs: jest.fn(),
}));

jest.mock('../../services/whatsapp.service', () => ({
  whatsappService: {
    sendCompanyTextMessage: (...args: unknown[]) => mockSendCompanyTextMessage(...args),
  },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  alertCompanyAdminsCronFailure,
  logCronOutcome,
} from '../../services/agent/cron-scheduler.service';

describe('cron-scheduler scoped logging and alerts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindMany.mockResolvedValue([]);
    mockSendCompanyTextMessage.mockResolvedValue(true);
    mockLogAgentAction.mockResolvedValue(undefined);
  });

  describe('logCronOutcome', () => {
    it('skips logs when no affected companies (platform job success)', async () => {
      await logCronOutcome('purgeActionLog', 'success', 10);
      expect(mockLogAgentAction).not.toHaveBeenCalled();
    });

    it('logs once per affected company on success', async () => {
      await logCronOutcome('visitReminder', 'success', 42, undefined, ['c1', 'c2', 'c1']);
      expect(mockLogAgentAction).toHaveBeenCalledTimes(2);
      expect(mockLogAgentAction).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: 'c1', triggeredBy: 'cron', action: 'visitReminder', status: 'success' }),
      );
    });

    it('skips logs on failure when no affected companies', async () => {
      await logCronOutcome('purgeActionLog', 'failed', 5, new Error('disk full'));
      expect(mockLogAgentAction).not.toHaveBeenCalled();
    });
  });

  describe('alertCompanyAdminsCronFailure', () => {
    it('notifies only company_admin users for affected tenants', async () => {
      mockUserFindMany.mockResolvedValue([
        { phone: '+911', companyId: 'tenant-a' },
        { phone: '+912', companyId: 'tenant-b' },
      ]);

      await alertCompanyAdminsCronFailure('morningBriefing', new Error('SMTP down'), ['tenant-a', 'tenant-b']);

      expect(mockUserFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role: 'company_admin',
            companyId: { in: ['tenant-a', 'tenant-b'] },
          }),
        }),
      );
      expect(mockSendCompanyTextMessage).toHaveBeenCalledTimes(2);
    });

    it('notifies super_admin only when no tenant scope (platform job)', async () => {
      mockUserFindMany.mockResolvedValue([{ phone: '+900', companyId: 'platform-co' }]);

      await alertCompanyAdminsCronFailure('purgeActionLog', new Error('DB timeout'));

      expect(mockUserFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ role: 'super_admin' }),
        }),
      );
      expect(mockSendCompanyTextMessage).toHaveBeenCalledTimes(1);
    });
  });
});

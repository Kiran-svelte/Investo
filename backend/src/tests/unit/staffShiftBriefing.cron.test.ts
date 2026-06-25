const mockUserFindMany = jest.fn();
const mockAiSettingFindMany = jest.fn();
const mockAgentActionLogFindFirst = jest.fn();
const mockSendCompanyTextMessage = jest.fn();
const mockLogAgentAction = jest.fn();
const mockBuildMorning = jest.fn();
const mockBuildEod = jest.fn();

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    user: { findMany: (...args: unknown[]) => mockUserFindMany(...args) },
    aiSetting: { findMany: (...args: unknown[]) => mockAiSettingFindMany(...args) },
    agentActionLog: { findFirst: (...args: unknown[]) => mockAgentActionLogFindFirst(...args) },
  },
}));

jest.mock('../../services/agent/staffShiftBriefing.service', () => {
  const actual = jest.requireActual('../../services/agent/staffShiftBriefing.service');
  return {
    ...actual,
    buildAgentMorningBriefing: (...args: unknown[]) => mockBuildMorning(...args),
    buildAgentEndOfDaySummary: (...args: unknown[]) => mockBuildEod(...args),
  };
});

jest.mock('../../services/agent-action-log.service', () => ({
  logAgentAction: (...args: unknown[]) => mockLogAgentAction(...args),
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

import { processStaffShiftBriefings } from '../../services/agent/cron-scheduler.service';

describe('processStaffShiftBriefings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildMorning.mockResolvedValue("Good morning Ravi. You're checked in.");
    mockBuildEod.mockResolvedValue("Good evening Ravi. You're checked out.");
    mockSendCompanyTextMessage.mockResolvedValue(true);
    mockLogAgentAction.mockResolvedValue(undefined);
    mockAgentActionLogFindFirst.mockResolvedValue(null);
    mockUserFindMany.mockResolvedValue([
      {
        id: 'agent-1',
        name: 'Ravi',
        phone: '+919999999999',
        companyId: 'company-1',
      },
    ]);
    mockAiSettingFindMany.mockResolvedValue([
      { companyId: 'company-1', workingHours: { start: '09:00', end: '21:00' } },
    ]);
  });

  it('sends morning briefing when inside company start window and not yet sent today', async () => {
    const at = new Date('2026-06-23T09:20:00+05:30');
    const result = await processStaffShiftBriefings(at);

    expect(mockSendCompanyTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendCompanyTextMessage).toHaveBeenCalledWith(
      '+919999999999',
      expect.stringContaining("You're checked in"),
      'company-1',
    );
    expect(mockLogAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cron_morning_briefing', actorId: 'agent-1' }),
    );
    expect(result.affectedCompanyIds).toEqual(['company-1']);
  });

  it('skips morning briefing when already logged for today', async () => {
    mockAgentActionLogFindFirst.mockResolvedValue({ id: 'log-1' });
    const at = new Date('2026-06-23T09:20:00+05:30');
    await processStaffShiftBriefings(at);
    expect(mockSendCompanyTextMessage).not.toHaveBeenCalled();
  });

  it('sends EOD briefing inside company end window', async () => {
    const at = new Date('2026-06-23T21:05:00+05:30');
    await processStaffShiftBriefings(at);

    expect(mockSendCompanyTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendCompanyTextMessage).toHaveBeenCalledWith(
      '+919999999999',
      expect.stringContaining("You're checked out"),
      'company-1',
    );
    expect(mockLogAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cron_eod_summary', actorId: 'agent-1' }),
    );
  });

  it('does not send outside working-hour windows', async () => {
    const at = new Date('2026-06-23T14:00:00+05:30');
    await processStaffShiftBriefings(at);
    expect(mockSendCompanyTextMessage).not.toHaveBeenCalled();
  });
});

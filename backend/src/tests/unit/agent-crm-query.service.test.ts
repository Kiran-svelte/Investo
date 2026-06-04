const mockPrisma = {
  visit: { findMany: jest.fn() },
  lead: { findMany: jest.fn() },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../services/visitMutationFromChat.service', () => ({
  applyVisitMutationFromChat: jest.fn(),
}));

jest.mock('../../services/visitIntentFromMessage.service', () => ({
  isVisitCancelOrRescheduleMessage: (text: string) =>
    /cancel.*visit.*reschedule/i.test(text),
}));

import { applyVisitMutationFromChat } from '../../services/visitMutationFromChat.service';
import { tryDeterministicAgentCrmReply } from '../../services/agent/agent-crm-query.service';
import type { ToolContext } from '../../services/agent/agent-state';

const ctx: ToolContext = {
  userId: 'agent-1',
  companyId: 'company-1',
  userRole: 'sales_agent',
  userName: 'Agent',
};

describe('tryDeterministicAgentCrmReply', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns tomorrow visits for "for tomorrow"', async () => {
    mockPrisma.visit.findMany.mockResolvedValue([
      {
        id: 'v1',
        status: 'scheduled',
        scheduledAt: new Date(),
        lead: { customerName: 'Ravi', phone: '+919999999999' },
        property: { name: 'Lake Vista' },
        agent: { name: 'Agent' },
      },
    ]);
    const result = await tryDeterministicAgentCrmReply(ctx, 'For tomorrow');
    expect(result).toContain('Tomorrow');
    expect(result).toContain('Ravi');
    expect(mockPrisma.visit.findMany).toHaveBeenCalled();
  });

  it('returns new leads today', async () => {
    mockPrisma.lead.findMany.mockResolvedValue([
      {
        id: 'l1',
        status: 'new',
        customerName: 'Priya',
        phone: '+919888888888',
        source: 'whatsapp',
        assignedAgent: { name: 'Agent' },
      },
    ]);
    const result = await tryDeterministicAgentCrmReply(
      ctx,
      'Which are the new leads we got today',
    );
    expect(result).toContain('New leads today');
    expect(result).toContain('Priya');
  });

  it('returns null for unrelated chit-chat', async () => {
    const result = await tryDeterministicAgentCrmReply(ctx, 'Thanks!');
    expect(result).toBeNull();
  });

  it('returns deterministic visit mutation before LLM', async () => {
    (applyVisitMutationFromChat as jest.Mock).mockResolvedValue({
      handled: true,
      mode: 'rescheduled',
      reply: 'Visit rescheduled.\n\nSunset Heights\n07/06/2026, 01:00 pm',
    });
    const result = await tryDeterministicAgentCrmReply(
      ctx,
      'Cancel my visit tomorrow and reschedule to Saturday 1pm',
    );
    expect(result).toContain('Visit rescheduled');
    expect(applyVisitMutationFromChat).toHaveBeenCalled();
  });
});

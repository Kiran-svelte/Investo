const mockPrisma = {
  lead: { findUnique: jest.fn() },
  user: { findUnique: jest.fn(), findMany: jest.fn() },
  conversation: { findUnique: jest.fn(), update: jest.fn() },
  agentActionLog: { findMany: jest.fn() },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../services/notification.engine', () => ({
  notificationEngine: {
    notify: jest.fn().mockResolvedValue(undefined),
    notifyAgentByWhatsApp: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../services/agent-action-log.service', () => ({
  logAgentAction: jest.fn().mockResolvedValue(undefined),
}));

import { notifyBuyerAgentAssistNeeded, clearBuyerAutoEscalation } from '../../services/buyerAgentAssist.service';
import { notificationEngine } from '../../services/notification.engine';

describe('buyerAgentAssist.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.agentActionLog.findMany.mockResolvedValue([]);
    mockPrisma.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      customerName: 'Test Buyer',
      phone: '919000001234',
      assignedAgentId: 'agent-1',
      companyId: 'co-1',
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'agent-1',
      phone: '919900001111',
      status: 'active',
    });
  });

  it('notifyBuyerAgentAssistNeeded includes customer message and AI reply in WhatsApp alert', async () => {
    await notifyBuyerAgentAssistNeeded({
      companyId: 'co-1',
      leadId: 'lead-1',
      conversationId: 'conv-1',
      reason: 'ai_action_blocked',
      summary: 'Buyer AI could not respond',
      customerMessage: 'book visit tomorrow 4pm',
      aiReplyText: "I'm sorry, I'm temporarily unable to respond.",
    });

    expect(notificationEngine.notifyAgentByWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Customer wrote'),
      }),
    );
    expect(notificationEngine.notifyAgentByWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('book visit tomorrow 4pm'),
      }),
    );
    expect(notificationEngine.notifyAgentByWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/AI replied/i),
      }),
    );
  });

  it('notifyBuyerAgentAssistNeeded notifies assigned agent without changing conversation', async () => {
    await notifyBuyerAgentAssistNeeded({
      companyId: 'co-1',
      leadId: 'lead-1',
      conversationId: 'conv-1',
      reason: 'escalation_request',
      summary: 'Customer requested human help',
      customerMessage: 'talk to agent',
    });

    expect(notificationEngine.notify).toHaveBeenCalled();
    expect(notificationEngine.notifyAgentByWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'co-1',
        message: expect.stringContaining('AI needs your help'),
      }),
    );
  });

  it('clearBuyerAutoEscalation resets agent_active and human_escalated', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({
      id: 'conv-1',
      status: 'agent_active',
      stage: 'human_escalated',
      aiEnabled: false,
    });
    mockPrisma.conversation.update.mockResolvedValue({});

    await clearBuyerAutoEscalation('conv-1');

    expect(mockPrisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv-1' },
        data: expect.objectContaining({
          status: 'ai_active',
          aiEnabled: true,
          stage: 'rapport',
        }),
      }),
    );
  });
});

const mockPrisma = {
  agentSession: {
    findUnique: jest.fn(),
  },
  company: {
    findUnique: jest.fn(),
  },
};

const mockSendCompanyTextMessage = jest.fn();
const mockSendMessage = jest.fn();

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    config: {
      agentAi: { enabled: true, llmEnabled: true, copilotEnabled: true, model: 'gpt-4o' },
      whatsapp: { phoneNumberId: '', accessToken: '', verifyToken: '' },
    },
  },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../services/whatsapp.service', () => ({
  whatsappService: {
    sendCompanyTextMessage: mockSendCompanyTextMessage,
    sendMessage: mockSendMessage,
  },
}));

jest.mock('../../services/agent/agent-memory.service', () => ({
  getOrCreateThreadId: jest.fn(),
}));

jest.mock('../../services/agent/confirmation.service', () => ({
  checkAndResolvePendingConfirmation: jest.fn(),
  executePendingAction: jest.fn(),
}));

jest.mock('../../services/agent/agent-graph.service', () => ({
  invokeAgent: jest.fn(),
}));

jest.mock('../../services/clientMemory.service', () => ({
  getAgentSessionContext: jest.fn(),
  buildClientMemoryContextForAgent: jest.fn(),
  setAgentSessionClientContext: jest.fn(),
  syncLeadClientMemory: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/lead-memory.service', () => ({
  patchLeadMemory: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/agent/agent-session-messages.service', () => ({
  getRecentAgentSessionMessages: jest.fn(),
}));

jest.mock('../../services/agent/agent-crm-query.service', () => ({
  tryDeterministicAgentCrmReply: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/inboundMessageGuard.service', () => ({
  claimStaffInboundFingerprint: jest.fn().mockResolvedValue(true),
  claimStaffCopilotTurn: jest.fn().mockResolvedValue(true),
  releaseStaffCopilotTurn: jest.fn().mockResolvedValue(undefined),
  claimStaffCopilotOutboundReply: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../services/workflow/workflow-engine.service', () => ({
  classifyAndRunWorkflow: jest.fn(),
}));

jest.mock('../../services/agent/agent-intent-orchestrator.service', () => ({
  classifyAndExecuteAgentIntent: jest.fn(),
  recordAgentCopilotExchange: jest.fn(),
}));

import { routeIfInternalUserForCompany } from '../../services/agent/agent-router.service';
import { getOrCreateThreadId } from '../../services/agent/agent-memory.service';
import { checkAndResolvePendingConfirmation } from '../../services/agent/confirmation.service';
import { invokeAgent } from '../../services/agent/agent-graph.service';
import { getAgentSessionContext } from '../../services/clientMemory.service';
import { getRecentAgentSessionMessages } from '../../services/agent/agent-session-messages.service';
import { classifyAndRunWorkflow } from '../../services/workflow/workflow-engine.service';
import {
  classifyAndExecuteAgentIntent,
  recordAgentCopilotExchange,
} from '../../services/agent/agent-intent-orchestrator.service';

describe('agent-router workflow orchestration', () => {
  const user = {
    userId: 'agent-1',
    companyId: 'company-1',
    companyName: 'Demo Realty',
    userRole: 'sales_agent' as any,
    userName: 'Rajesh',
    phone: '+919999999999',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.agentSession.findUnique.mockResolvedValue({
      id: 'session-1',
      threadId: 'thread-1',
    });
    (getOrCreateThreadId as jest.Mock).mockResolvedValue('thread-1');
    (checkAndResolvePendingConfirmation as jest.Mock).mockResolvedValue({
      hasPending: false,
      isConfirmed: false,
      isRejected: false,
    });
    (getAgentSessionContext as jest.Mock).mockResolvedValue({
      lastLeadId: 'LD-123',
      lastVisitId: 'visit-1',
    });
    (getRecentAgentSessionMessages as jest.Mock).mockResolvedValue([
      { role: 'assistant', content: 'Last active lead is LD-123.' },
    ]);
    (classifyAndRunWorkflow as jest.Mock).mockResolvedValue(
      'Lead LD-123 status updated to visited',
    );
    (classifyAndExecuteAgentIntent as jest.Mock).mockResolvedValue('intent fallback');
    (invokeAgent as jest.Mock).mockResolvedValue('graph fallback');
  });

  it('runs the generic workflow engine before intent and graph fallbacks', async () => {
    const handled = await routeIfInternalUserForCompany(
      '+919999999999',
      'set lead status to visited',
      user,
    );

    expect(handled).toBe(true);
    expect(classifyAndRunWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        messageText: 'set lead status to visited',
        companyName: 'Demo Realty',
        sessionLeadId: 'LD-123',
        sessionVisitId: 'visit-1',
        staffPhone: '+919999999999',
        toolContext: expect.objectContaining({
          userId: 'agent-1',
          companyId: 'company-1',
          userRole: 'sales_agent',
          userName: 'Rajesh',
          sessionId: 'session-1',
        }),
      }),
    );
    expect(classifyAndExecuteAgentIntent).not.toHaveBeenCalled();
    expect(invokeAgent).not.toHaveBeenCalled();
    expect(recordAgentCopilotExchange).toHaveBeenCalledWith({
      sessionId: 'session-1',
      inboundText: 'set lead status to visited',
      outboundText: 'Lead LD-123 status updated to visited',
    });
    expect(mockSendCompanyTextMessage).toHaveBeenCalledWith(
      '+919999999999',
      'Lead LD-123 status updated to visited',
      'company-1',
    );
  });
});

/**
 * Unit tests for inboundWhatsAppRouting.service — viewer role copilot routing.
 *
 * Before Queue #13 (viewer routing fix), viewers received a static "use dashboard"
 * message instead of the read-only copilot. These tests verify:
 *   1. viewer role → routed to agent copilot pipeline (agent_copilot route kind)
 *   2. viewer route → classifyAndRunWorkflow is NOT called (mutation guard in agent-router)
 *   3. viewer route → CRM query reply IS returned (read access allowed)
 *   4. non-agent role (unknown) → still gets static "use dashboard" reply
 */

const mockPrisma = {
  user: { findMany: jest.fn() },
  company: { findUnique: jest.fn() },
  agentSession: { findUnique: jest.fn() },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    agentAi: { enabled: true, copilotEnabled: true, llmEnabled: false },
    whatsapp: { phoneNumberId: '', accessToken: '', verifyToken: '' },
  },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockSendCompanyTextMessage = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/whatsapp.service', () => ({
  whatsappService: {
    sendCompanyTextMessage: mockSendCompanyTextMessage,
    sendCompanyInteractiveButtons: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockClaimStaffTurn = jest.fn().mockResolvedValue(true);
const mockReleaseStaffTurn = jest.fn().mockResolvedValue(undefined);
const mockClaimFingerprint = jest.fn().mockResolvedValue(true);
const mockClaimOutboundReply = jest.fn().mockResolvedValue(true);

jest.mock('../../services/inboundMessageGuard.service', () => ({
  claimStaffCopilotTurn: (...args: unknown[]) => mockClaimStaffTurn(...args),
  releaseStaffCopilotTurn: (...args: unknown[]) => mockReleaseStaffTurn(...args),
  claimStaffInboundFingerprint: (...args: unknown[]) => mockClaimFingerprint(...args),
  claimStaffCopilotOutboundReply: (...args: unknown[]) => mockClaimOutboundReply(...args),
}));

jest.mock('../../services/agent/agent-memory.service', () => ({
  getOrCreateThreadId: jest.fn().mockResolvedValue('thread-viewer'),
}));

jest.mock('../../services/agent/confirmation.service', () => ({
  checkAndResolvePendingConfirmation: jest.fn().mockResolvedValue({ hasPending: false }),
}));

const mockCrmReply = jest.fn().mockResolvedValue('You have 3 visits today.');
jest.mock('../../services/agent/agent-crm-query.service', () => ({
  tryDeterministicAgentCrmReply: (...args: unknown[]) => mockCrmReply(...args),
}));

const mockWorkflow = jest.fn();
jest.mock('../../services/workflow/workflow-engine.service', () => ({
  classifyAndRunWorkflow: (...args: unknown[]) => mockWorkflow(...args),
}));

jest.mock('../../services/agent/agent-intent-orchestrator.service', () => ({
  classifyAndExecuteAgentIntent: jest.fn(),
  recordAgentCopilotExchange: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/clientMemory.service', () => ({
  getAgentSessionContext: jest.fn().mockResolvedValue({ lastLeadId: null, lastVisitId: null }),
  buildClientMemoryContextForAgent: jest.fn().mockResolvedValue({ block: '', leadId: null }),
  setAgentSessionClientContext: jest.fn().mockResolvedValue(undefined),
  syncLeadClientMemory: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/agent/agent-session-messages.service', () => ({
  getRecentAgentSessionMessages: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/visitPendingApproval.service', () => ({
  tryHandleAgentVisitApprovalReply: jest.fn().mockResolvedValue(false),
}));

import { routeCompanyScopedInbound } from '../../services/inboundWhatsAppRouting.service';

/** Shared viewer user fixture returned by prisma.user.findMany. */
const viewerDbRecord = {
  id: 'viewer-user-1',
  companyId: 'company-1',
  role: 'viewer' as const,
  name: 'View Only',
  phone: '+919111111111',
  company: { name: 'Demo Realty', status: 'active' },
};

describe('inboundWhatsAppRouting — viewer role', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Prisma returns the viewer user on phone lookup
    mockPrisma.user.findMany.mockResolvedValue([viewerDbRecord]);
    // No agent session by default
    mockPrisma.agentSession.findUnique.mockResolvedValue(null);
    // CRM returns a read-only response
    mockCrmReply.mockResolvedValue('You have 3 visits today.');
    // Workflow must NOT be called for viewer
    mockWorkflow.mockResolvedValue(null);
  });

  it('routes viewer phone to agent_copilot (not staff_non_copilot)', async () => {
    const result = await routeCompanyScopedInbound({
      senderPhone: '+919111111111',
      messageText: 'visits today',
      companyId: 'company-1',
    });

    expect(result.route.kind).toBe('agent_copilot');
    expect(result.handled).toBe(true);
  });

  it('returns a CRM read response for viewer without calling classifyAndRunWorkflow', async () => {
    await routeCompanyScopedInbound({
      senderPhone: '+919111111111',
      messageText: 'visits today',
      companyId: 'company-1',
    });

    // Viewer should get the CRM query reply
    expect(mockSendCompanyTextMessage).toHaveBeenCalledWith(
      '+919111111111',
      'You have 3 visits today.',
      'company-1',
    );
    // Mutation workflow must NEVER fire for viewer
    expect(mockWorkflow).not.toHaveBeenCalled();
  });

  it('does NOT send the "use dashboard" static message to a viewer', async () => {
    await routeCompanyScopedInbound({
      senderPhone: '+919111111111',
      messageText: 'show me leads',
      companyId: 'company-1',
    });

    const calls: string[] = mockSendCompanyTextMessage.mock.calls.map((c: unknown[]) => String(c[1]));
    const hadStaticWall = calls.some((text) => text.includes('staff account'));
    expect(hadStaticWall).toBe(false);
  });

  it('returns staff_non_copilot for a completely unknown role (future-proofing)', async () => {
    mockPrisma.user.findMany.mockResolvedValue([{
      ...viewerDbRecord,
      role: 'unknown_future_role' as any,
    }]);

    const result = await routeCompanyScopedInbound({
      senderPhone: '+919111111111',
      messageText: 'hello',
      companyId: 'company-1',
    });

    expect(result.route.kind).toBe('staff_non_copilot');
  });
});

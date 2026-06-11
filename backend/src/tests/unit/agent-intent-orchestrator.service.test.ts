const mockPrisma = {
  lead: {
    findFirst: jest.fn(),
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
  default: {
    agentAi: { enabled: true, model: 'gpt-4o' },
    ai: { openaiApiKey: 'sk-test', openaiModel: 'gpt-4o' },
  },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../services/openaiStatus.service', () => ({
  openAiKeyProblem: () => null,
  fetchOpenAi: jest.fn(),
  OPENAI_CHAT_URL: 'https://api.openai.com/v1/chat/completions',
}));

jest.mock('../../services/clientMemory.service', () => ({
  getAgentSessionContext: jest.fn().mockResolvedValue({ lastLeadId: null, lastVisitId: null }),
  setAgentSessionClientContext: jest.fn().mockResolvedValue(undefined),
  syncLeadClientMemory: jest.fn(),
  ensureClientMemorySchema: jest.fn(),
}));

jest.mock('../../services/agent-action-log.service', () => ({
  logAgentAction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/agent/confirmation.service', () => ({
  createPendingConfirmation: jest.fn(),
}));

jest.mock('../../services/agent/lead-status-actions', () => ({
  __esModule: true,
  updateLeadStatusById: jest.fn(),
}));

jest.mock('../../services/agent/agent-lead-resolution.service', () => ({
  __esModule: true,
  resolveLeadForIntent: jest.fn(),
  extractLeadIdsFromText: jest.fn(() => []),
  extractLeadNamesFromAssistantMessages: jest.fn(() => []),
}));

jest.mock('../../services/agent/tools', () => ({
  __esModule: true,
  getToolsForRole: jest.fn(),
}));

jest.mock('../../services/agent/agent-session-messages.service', () => ({
  appendAgentSessionMessage: jest.fn(),
  getRecentAgentSessionMessages: jest.fn().mockResolvedValue([]),
}));

import logger from '../../config/logger';
import {
  classifyAgentIntent,
  classifyAndExecuteAgentIntent,
  extractAgentIntentParameters,
  executeAgentIntent,
  buildRoleBlockedIntentReply,
} from '../../services/agent/agent-intent-orchestrator.service';
import { resolveLeadForIntent } from '../../services/agent/agent-lead-resolution.service';
import { updateLeadStatusById } from '../../services/agent/lead-status-actions';
import { getToolsForRole } from '../../services/agent/tools';
import type { ToolContext } from '../../services/agent/agent-state';

const ctx: ToolContext = {
  userId: 'agent-1',
  companyId: 'company-1',
  userRole: 'sales_agent',
  userName: 'Agent',
  sessionId: 'session-1',
};

describe('agent-intent-orchestrator.service', () => {
  const kannadaLeadId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  beforeEach(() => {
    jest.clearAllMocks();
    (getToolsForRole as jest.Mock).mockReturnValue([]);
  });

  it('executes update_lead_status deterministically', async () => {
    (resolveLeadForIntent as jest.Mock).mockResolvedValue({
      leadId: kannadaLeadId,
      customerName: 'Kannada media',
    });
    (updateLeadStatusById as jest.Mock).mockResolvedValue({
      handled: true,
      reply: '✅ Lead *Kannada media* status updated to *visited*.',
      leadId: kannadaLeadId,
    });

    const reply = await executeAgentIntent(
      ctx,
      { intent: 'update_lead_status', parameters: { leadName: 'kannada media', status: 'visited' } },
      [],
      null,
      { staffPhone: '+919999999999', actionTools: [] },
    );

    expect(logger.error).not.toHaveBeenCalled();
    expect(resolveLeadForIntent).toHaveBeenCalled();
    expect(updateLeadStatusById).toHaveBeenCalledWith(ctx, kannadaLeadId, 'visited');
    expect(reply).toBe('✅ Lead *Kannada media* status updated to *visited*.');
  });

  it('classifies update_lead_status via mocked LLM', async () => {
    const llm = jest
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({
          intent: 'update_lead_status',
          confidence: 0.92,
          parameters: { leadName: 'kannada media', status: 'visited' },
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          intent: 'update_lead_status',
          parameters: { leadName: 'kannada media', status: 'visited' },
          missingFields: [],
        }),
      );

    const classified = await classifyAgentIntent(
      'Update lead kannada media status to visited .actually they have visited today only',
      llm,
    );
    expect(classified.intent).toBe('update_lead_status');

    const extracted = await extractAgentIntentParameters(
      'Update lead kannada media status to visited .actually they have visited today only',
      classified,
      [],
      null,
      llm,
    );
    expect(extracted.parameters.status).toBe('visited');
    expect(extracted.intent).toBe('update_lead_status');
  });

  it('executes a generic role-scoped action handler selected by toolName', async () => {
    const listLeadsTool = {
      name: 'listLeads',
      description: 'List leads by status',
      schema: {
        safeParse: jest.fn((input) => ({ success: true, data: input })),
      },
      func: jest.fn().mockResolvedValue('*Leads*\n1. Ravi\nID: lead-1'),
    };

    const reply = await executeAgentIntent(
      ctx,
      {
        intent: 'list_leads',
        toolName: 'listLeads',
        parameters: { status: 'new' },
      },
      [],
      null,
      { actionTools: [listLeadsTool] as any },
    );

    expect(listLeadsTool.schema.safeParse).toHaveBeenCalledWith({ status: 'new' });
    expect(listLeadsTool.func).toHaveBeenCalledWith({ status: 'new' });
    expect(reply).toContain('Ravi');
  });

  it('runs classifier, parameter extraction, and generic action execution end to end', async () => {
    const listLeadsTool = {
      name: 'listLeads',
      description: 'List leads by status',
      schema: {
        shape: { status: true },
        safeParse: jest.fn((input) => ({ success: true, data: input })),
      },
      func: jest.fn().mockResolvedValue('*Leads*\n1. Asha\nID: lead-2'),
    };
    (getToolsForRole as jest.Mock).mockReturnValue([listLeadsTool]);

    const llm = jest
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({
          intent: 'list_leads',
          toolName: 'listLeads',
          confidence: 0.9,
          parameters: { status: 'new' },
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          intent: 'list_leads',
          toolName: 'listLeads',
          parameters: { status: 'new' },
          missingFields: [],
        }),
      );

    const reply = await classifyAndExecuteAgentIntent(
      {
        toolContext: ctx,
        messageText: 'show new leads',
        recentMessages: [],
        companyName: 'Demo Realty',
      },
      { llm },
    );

    expect(llm).toHaveBeenCalledTimes(2);
    expect(listLeadsTool.func).toHaveBeenCalledWith({ status: 'new' });
    expect(reply).toContain('Asha');
  });

  it('executeAgentIntent returns clarification when lead cannot be resolved', async () => {
    (resolveLeadForIntent as jest.Mock).mockResolvedValue(null);
    const reply = await executeAgentIntent(
      ctx,
      { intent: 'update_lead_status', parameters: { leadName: 'unknown lead', status: 'visited' } },
      [],
      null,
    );
    expect(reply).toContain('Which lead');
  });

  it('returns read-only reply for viewer when write tool is unavailable', async () => {
    const viewerCtx: ToolContext = { ...ctx, userRole: 'viewer' };
    const reply = await executeAgentIntent(
      viewerCtx,
      { intent: 'update_lead_status', toolName: 'updateLeadStatus', parameters: { status: 'visited' } },
      [],
      null,
      { actionTools: [] },
    );
    expect(reply).toBe(buildRoleBlockedIntentReply('viewer', 'update_lead_status'));
    expect(reply?.toLowerCase()).toContain('read-only');
  });
});

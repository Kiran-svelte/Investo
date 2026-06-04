const mockPrisma = {
  lead: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  notification: { create: jest.fn() },
  user: { findFirst: jest.fn(), findMany: jest.fn() },
  property: { findFirst: jest.fn() },
  visit: { findFirst: jest.fn() },
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

jest.mock('../../services/agent-action-log.service', () => ({
  logAgentAction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/clientMemory.service', () => ({
  setAgentSessionClientContext: jest.fn().mockResolvedValue(undefined),
  syncLeadClientMemory: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/agent/tools', () => ({
  getToolsForRole: jest.fn(),
}));

jest.mock('../../services/agent/agent-lead-resolution.service', () => ({
  resolveLeadForIntent: jest.fn(),
}));

jest.mock('../../services/agent/lead-status-actions', () => ({
  updateLeadStatusById: jest.fn(),
}));

import { WORKFLOW_DEFINITIONS, allWorkflowIds } from '../../services/workflow/workflow-registry';
import {
  classifyAndRunWorkflow,
  classifyWorkflowMessage,
  runWorkflow,
} from '../../services/workflow/workflow-engine.service';
import { resolveLeadForIntent } from '../../services/agent/agent-lead-resolution.service';
import { updateLeadStatusById } from '../../services/agent/lead-status-actions';
import { getToolsForRole } from '../../services/agent/tools';
import type { ToolContext } from '../../services/agent/agent-state';

const ctx: ToolContext = {
  userId: 'agent-1',
  companyId: 'company-1',
  userRole: 'sales_agent',
  userName: 'Agent One',
  sessionId: 'session-1',
};

const kannadaLeadId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

describe('workflow-engine.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getToolsForRole as jest.Mock).mockReturnValue([]);
  });

  it('registers all 15 CRM workflows', () => {
    expect(allWorkflowIds()).toHaveLength(15);
    expect(WORKFLOW_DEFINITIONS.map((w) => w.id)).toEqual(allWorkflowIds());
  });

  it('runs update_status workflow via lead status action', async () => {
    (resolveLeadForIntent as jest.Mock).mockResolvedValue({
      leadId: kannadaLeadId,
      customerName: 'Kannada Media',
    });
    (updateLeadStatusById as jest.Mock).mockResolvedValue({
      handled: true,
      reply: '✅ Lead *Kannada Media* status updated to *visited*.',
      leadId: kannadaLeadId,
    });
    mockPrisma.lead.findFirst.mockResolvedValue({
      id: kannadaLeadId,
      customerName: 'Kannada Media',
      status: 'contacted',
      assignedAgentId: 'agent-1',
    });

    const result = await runWorkflow(
      'update_status',
      {
        toolContext: ctx,
        messageText: 'Update lead kannada media status to visited',
        recentMessages: [],
        companyName: 'Demo Realty',
        staffPhone: '+919999999999',
      },
      { leadName: 'kannada media', status: 'visited' },
    );

    expect(result.ok).toBe(true);
    expect(result.reply).toContain('visited');
    expect(updateLeadStatusById).toHaveBeenCalledWith(ctx, kannadaLeadId, 'visited');
  });

  it('reschedule_visit asks for schedule time when missing', async () => {
    const rescheduleVisitTool = {
      name: 'rescheduleVisit',
      schema: { safeParse: jest.fn((input) => ({ success: true, data: input })) },
      func: jest.fn(),
    };
    (getToolsForRole as jest.Mock).mockReturnValue([rescheduleVisitTool]);
    mockPrisma.visit.findFirst.mockResolvedValue({
      id: 'visit-1',
      leadId: kannadaLeadId,
      status: 'scheduled',
    });

    const result = await runWorkflow(
      'reschedule_visit',
      {
        toolContext: ctx,
        messageText: 'reschedule visit',
        recentMessages: [],
        companyName: 'Demo',
      },
      { visitId: 'visit-1' },
    );

    expect(result.ok).toBe(false);
    expect(result.reply).toMatch(/scheduled|When/i);
    expect(rescheduleVisitTool.func).not.toHaveBeenCalled();
  });

  it('classifies workflow with one LLM call', async () => {
    const llm = jest.fn().mockResolvedValue(
      JSON.stringify({
        workflow: 'schedule_visit',
        confidence: 0.91,
        parameters: { leadName: 'Asha', scheduledAt: '2026-06-06T10:30:00+05:30' },
      }),
    );

    const classified = await classifyWorkflowMessage(
      {
        messageText: 'book Asha visit Saturday morning',
        recentMessages: [],
        companyName: 'Demo Realty',
      },
      llm,
    );

    expect(llm).toHaveBeenCalledTimes(1);
    expect(classified.workflowId).toBe('schedule_visit');
    expect(classified.parameters.scheduledAt).toBe('2026-06-06T10:30:00+05:30');
  });

  it('lets the LLM classify natural status phrasing without keyword branching', async () => {
    (resolveLeadForIntent as jest.Mock).mockResolvedValue({
      leadId: kannadaLeadId,
      customerName: 'Kannada Media',
    });
    (updateLeadStatusById as jest.Mock).mockResolvedValue({
      handled: true,
      reply: 'Lead Kannada Media status updated to contacted.',
      leadId: kannadaLeadId,
    });
    mockPrisma.lead.findFirst.mockResolvedValue({
      id: kannadaLeadId,
      customerName: 'Kannada Media',
      status: 'new',
      assignedAgentId: 'agent-1',
    });
    const llm = jest.fn().mockResolvedValue(
      JSON.stringify({
        workflow: 'update_status',
        confidence: 0.91,
        parameters: { status: 'contacted' },
      }),
    );

    const reply = await classifyAndRunWorkflow(
      {
        toolContext: ctx,
        messageText: 'change to contacted',
        recentMessages: [],
        companyName: 'Demo Realty',
        sessionLeadId: kannadaLeadId,
        staffPhone: '+919999999999',
      },
      { llm },
    );

    expect(llm).toHaveBeenCalledTimes(1);
    expect(updateLeadStatusById).toHaveBeenCalledWith(ctx, kannadaLeadId, 'contacted');
    expect(reply).toContain('contacted');
  });
});

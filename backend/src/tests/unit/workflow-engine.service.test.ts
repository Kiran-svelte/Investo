const mockPrisma = {
  lead: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  notification: { create: jest.fn() },
  user: { findFirst: jest.fn(), findMany: jest.fn() },
  property: { findFirst: jest.fn() },
  visit: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  conversation: { findFirst: jest.fn(), update: jest.fn() },
  workflowRunRecord: { create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
  workflowIdempotencyKey: {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  $executeRawUnsafe: jest.fn().mockResolvedValue(1),
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    agentAi: { enabled: true, llmEnabled: true, copilotEnabled: true, model: 'gpt-4o' },
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

const mockRunCompensators = jest.fn().mockResolvedValue(true);
jest.mock('../../services/workflow/workflow-compensator.service', () => ({
  ...jest.requireActual('../../services/workflow/workflow-compensator.service'),
  runCompensators: (...args: unknown[]) => mockRunCompensators(...args),
}));

jest.mock('../../services/notification.engine', () => ({
  notificationEngine: {
    notify: jest.fn().mockResolvedValue(undefined),
    onLeadStatusChange: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../services/clientMemory.service', () => ({
  setAgentSessionClientContext: jest.fn().mockResolvedValue(undefined),
  syncLeadClientMemory: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../config/redis', () => ({
  cacheGet: jest.fn().mockResolvedValue(null),
  cacheSet: jest.fn().mockResolvedValue(undefined),
  cacheIncr: jest.fn().mockResolvedValue(1),
}));

jest.mock('../../services/lead-memory.service', () => ({
  patchLeadMemory: jest.fn().mockResolvedValue(undefined),
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

jest.mock('../../services/visitBooking.service', () => ({
  scheduleVisit: jest.fn(),
}));

import { WORKFLOW_DEFINITIONS, allWorkflowIds } from '../../services/workflow/workflow-registry';
import {
  classifyAndRunWorkflow,
  classifyAndRunBuyerWorkflow,
  classifyWorkflowMessage,
  detectActiveVisitMutationBias,
  runWorkflow,
  tryRunBuyerWorkflow,
} from '../../services/workflow/workflow-engine.service';
import { resolveLeadForIntent } from '../../services/agent/agent-lead-resolution.service';
import { updateLeadStatusById } from '../../services/agent/lead-status-actions';
import { getToolsForRole } from '../../services/agent/tools';
import { scheduleVisit } from '../../services/visitBooking.service';
import { cacheGet } from '../../config/redis';
import { logAgentAction } from '../../services/agent-action-log.service';
import { WORKFLOW_ACTION_HANDLERS } from '../../services/workflow/actions/index';
import type { ToolContext } from '../../services/agent/agent-state';

const propertyId = '11111111-1111-4111-8111-111111111111';

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
    mockRunCompensators.mockResolvedValue(true);
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

  it('returns cached workflow idempotency reply without executing handlers', async () => {
    (cacheGet as jest.Mock).mockResolvedValueOnce('Cached: visit already scheduled.');
    (getToolsForRole as jest.Mock).mockReturnValue([
      {
        name: 'scheduleVisit',
        schema: { safeParse: jest.fn((input) => ({ success: true, data: input })) },
        func: jest.fn().mockResolvedValue('should not run'),
      },
    ]);

    const result = await runWorkflow(
      'schedule_visit',
      {
        toolContext: ctx,
        messageText: 'book visit tomorrow 1pm',
        recentMessages: [],
        companyName: 'Demo Realty',
      },
      {
        leadId: kannadaLeadId,
        propertyId,
        scheduledAt: '2026-06-06T13:00:00+05:30',
      },
    );

    expect(result.ok).toBe(true);
    expect(result.idempotencyHit).toBe(true);
    expect(result.reply).toBe('Cached: visit already scheduled.');
    expect(getToolsForRole).not.toHaveBeenCalled();
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

  it('formats buyer inquiry workflow replies without duplicate or internal tool details', async () => {
    const toolReply = [
      '*Matches for Kannada Media*',
      '*Skyline Heights* (apartment)',
      'Type: apartment | Status: available',
      'Price: From INR 75,00,000',
      'Location: Indiranagar, Bengaluru',
      'ID: 11111111-1111-4111-8111-111111111111',
      'Match score: 0.89',
    ].join('\n');

    (getToolsForRole as jest.Mock).mockReturnValue([
      {
        name: 'searchPropertiesForLead',
        schema: { safeParse: jest.fn((input) => ({ success: true, data: input })) },
        func: jest.fn().mockResolvedValue(toolReply),
      },
    ]);

    const llm = jest.fn().mockResolvedValue(
      JSON.stringify({
        workflow: 'price_inquiry',
        confidence: 0.9,
        parameters: {},
      }),
    );

    const reply = await classifyAndRunBuyerWorkflow(
      {
        companyId: 'company-1',
        leadId: kannadaLeadId,
        messageText: 'what is the price',
        companyName: 'Demo Realty',
      },
      { llm },
    );

    expect(reply).toContain('Here are the matching options I found:');
    expect(reply).toContain('Price: From INR 75,00,000');
    expect(reply).not.toContain('ID:');
    expect(reply).not.toContain('Match score:');
    expect((reply?.match(/Price:/g) ?? [])).toHaveLength(1);
  });

  it('runs buyer schedule_visit workflow via channel-aware bookVisit', async () => {
    (getToolsForRole as jest.Mock).mockReturnValue([]);
    (scheduleVisit as jest.Mock).mockResolvedValue({
      success: true,
      visit: {
        id: 'visit-new-1',
        leadId: kannadaLeadId,
        propertyId,
        scheduledAt: new Date('2026-06-06T13:00:00+05:30'),
      },
    });
    mockPrisma.visit.findUnique.mockResolvedValue({
      id: 'visit-new-1',
      property: { name: 'Sunset Heights' },
      agent: { name: 'Agent One' },
    });

    const llm = jest.fn().mockResolvedValue(
      JSON.stringify({
        workflow: 'schedule_visit',
        confidence: 0.94,
        parameters: { scheduledAt: '2026-06-06T13:00:00+05:30', propertyId },
      }),
    );

    const reply = await classifyAndRunBuyerWorkflow(
      {
        companyId: 'company-1',
        leadId: kannadaLeadId,
        messageText: 'book site visit tomorrow 1pm',
        companyName: 'Demo Realty',
      },
      { llm },
    );

    expect(reply).toContain('Visit scheduled');
    expect(scheduleVisit).toHaveBeenCalled();
  });

  it('detectActiveVisitMutationBias maps push appointment to reschedule_visit', () => {
    const bias = detectActiveVisitMutationBias('push my appointment please', {
      visitId: 'visit-active-1',
      propertyName: 'Sunset Heights',
    });
    expect(bias?.workflowId).toBe('reschedule_visit');
    expect(bias?.parameters.visitId).toBe('visit-active-1');
  });

  it('classifyAndRunBuyerWorkflow biases reschedule when active visit exists (no LLM)', async () => {
    const rescheduleVisitTool = {
      name: 'rescheduleVisit',
      schema: { safeParse: jest.fn((input) => ({ success: true, data: input })) },
      func: jest.fn(),
    };
    (getToolsForRole as jest.Mock).mockReturnValue([rescheduleVisitTool]);
    mockPrisma.visit.findFirst.mockResolvedValue({
      id: 'visit-active-1',
      leadId: kannadaLeadId,
      status: 'scheduled',
    });

    const llm = jest.fn();

    const reply = await classifyAndRunBuyerWorkflow(
      {
        companyId: 'company-1',
        leadId: kannadaLeadId,
        messageText: 'push my appointment',
        companyName: 'Demo Realty',
        activeVisit: {
          visitId: 'visit-active-1',
          propertyName: 'Sunset Heights',
        },
      },
      { llm },
    );

    expect(llm).not.toHaveBeenCalled();
    expect(reply).toMatch(/scheduled|When/i);
    expect(rescheduleVisitTool.func).not.toHaveBeenCalled();
  });

  it('uses a customer-safe escalation reply for buyer fallback', async () => {
    mockPrisma.lead.findFirst.mockResolvedValue({
      id: kannadaLeadId,
      customerName: 'Kannada Media',
      status: 'contacted',
      assignedAgentId: 'agent-1',
    });
    mockPrisma.user.findMany.mockResolvedValue([]);
    (getToolsForRole as jest.Mock).mockReturnValue([]);

    const reply = await tryRunBuyerWorkflow({
      companyId: 'company-1',
      leadId: kannadaLeadId,
      messageText: 'please call me, I want to talk to an agent',
      companyName: 'Demo Realty',
    });

    expect(reply).toContain('human specialist');
    expect(reply).not.toContain('Urgent alert created');
    expect(reply).not.toContain('agents notified');
  });

  it('logs workflow_clarification for staff mutation in clarification band (0.65–0.75)', async () => {
    const llm = jest.fn().mockResolvedValue(
      JSON.stringify({
        workflow: 'cancel_visit',
        confidence: 0.71,
        parameters: { visitId: 'visit-1' },
      }),
    );

    const reply = await classifyAndRunWorkflow(
      {
        toolContext: ctx,
        messageText: 'not sure if I should cancel the visit',
        recentMessages: [],
        companyName: 'Demo Realty',
        sessionLeadId: kannadaLeadId,
        staffPhone: '+919999999999',
      },
      { llm },
    );

    expect(reply).toMatch(/cancel|confirm|clarif/i);
    expect(logAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow_clarification',
        inputs: expect.objectContaining({
          workflowId: 'cancel_visit',
          confidence: 0.71,
          channel: 'staff',
        }),
      }),
    );
  });

  it('logs workflow_clarification for buyer mutation in clarification band (0.65–0.75)', async () => {
    const llm = jest.fn().mockResolvedValue(
      JSON.stringify({
        workflow: 'cancel_visit',
        confidence: 0.71,
        parameters: { visitId: 'visit-1' },
      }),
    );

    const reply = await classifyAndRunBuyerWorkflow(
      {
        companyId: 'company-1',
        leadId: kannadaLeadId,
        messageText: 'maybe cancel my visit',
        companyName: 'Demo Realty',
      },
      { llm },
    );

    expect(reply).toMatch(/cancel|confirm|clarif/i);
    expect(logAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow_clarification',
        inputs: expect.objectContaining({
          workflowId: 'cancel_visit',
          confidence: 0.71,
          channel: 'buyer',
        }),
      }),
    );
  });

  it('runs compensators when a required step fails after mutation (send/confirm path)', async () => {
    jest.spyOn(WORKFLOW_ACTION_HANDLERS, 'logLeadHistory').mockResolvedValueOnce({
      ok: false,
      message: 'WhatsApp send failed',
    });
    // resolveLeadForIntent must return a lead for update_status to reach the mutation step
    (resolveLeadForIntent as jest.Mock).mockResolvedValue({
      leadId: kannadaLeadId,
      customerName: 'Kannada Media',
    });
    // updateLeadStatusById succeeds (the logLeadHistory step is what fails)
    (updateLeadStatusById as jest.Mock).mockResolvedValue({
      handled: true,
      reply: 'Status updated to visited.',
      leadId: kannadaLeadId,
    });
    mockPrisma.lead.findFirst.mockResolvedValue({
      id: kannadaLeadId,
      customerName: 'Kannada Media',
      status: 'contacted',
      assignedAgentId: 'agent-1',
    });
    mockPrisma.lead.findUnique.mockResolvedValue({ status: 'contacted' });

    const result = await runWorkflow(
      'update_status',
      {
        toolContext: ctx,
        messageText: 'Update lead status to visited',
        recentMessages: [],
        companyName: 'Demo Realty',
      },
      { leadId: kannadaLeadId, status: 'visited' },
    );

    expect(result.ok).toBe(false);
    expect(result.needsReconciliation).toBe(true);
    expect(mockRunCompensators).toHaveBeenCalledWith(
      expect.objectContaining({
        failedStep: 'logLeadHistory',
        completedSteps: expect.arrayContaining(['updateLeadStatus']),
      }),
    );
  });
});

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

jest.mock('../../services/visitBooking.service', () => {
  const actual = jest.requireActual('../../services/visitBooking.service');
  return {
    ...actual,
    scheduleVisit: jest.fn(),
  };
});

jest.mock('../../services/visitPendingApproval.service', () => ({
  createVisitApprovalRequest: jest.fn().mockResolvedValue(undefined),
  notifyAgentVisitChangeRequested: jest.fn().mockResolvedValue(undefined),
  findPendingVisitApprovalForLead: jest.fn().mockResolvedValue(null),
  findPendingVisitApproval: jest.fn().mockResolvedValue(null),
  resolveVisitApproval: jest.fn(),
  cancelPendingVisitApprovalForBuyer: jest.fn().mockResolvedValue({ handled: false }),
}));

import { WORKFLOW_DEFINITIONS, allWorkflowIds } from '../../services/workflow/workflow-registry';
import {
  classifyAndRunWorkflow,
  classifyAndRunBuyerWorkflow,
  classifyWorkflowMessage,
  detectActiveVisitMutationBias,
  detectBuyerNegotiationEscalationBias,
  buildBuyerWorkflowFailureReply,
  isBuyerQualificationOnlyMessage,
  isClarificationOnlyWorkflowFailure,
  runWorkflow,
  tryRunBuyerWorkflow,
} from '../../services/workflow/workflow-engine.service';
import { resolveLeadForIntent } from '../../services/agent/agent-lead-resolution.service';
import { updateLeadStatusById } from '../../services/agent/lead-status-actions';
import { getToolsForRole } from '../../services/agent/tools';
import { scheduleVisit } from '../../services/visitBooking.service';
import { createVisitApprovalRequest } from '../../services/visitPendingApproval.service';
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
    mockPrisma.conversation.findFirst.mockResolvedValue(null);
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

    mockPrisma.visit.findUnique.mockResolvedValue({
      id: 'visit-1',
      leadId: kannadaLeadId,
      status: 'scheduled',
      scheduledAt: new Date('2026-06-10T10:00:00+05:30'),
      companyId: 'company-1',
    });

    const result = await runWorkflow(
      'reschedule_visit',
      {
        toolContext: { ...ctx, userRole: 'company_admin' },
        messageText: 'reschedule visit',
        recentMessages: [],
        companyName: 'Demo',
        channel: 'buyer',
        sessionLeadId: kannadaLeadId,
        sessionVisitId: 'visit-1',
      },
      { visitId: 'visit-1', leadId: kannadaLeadId },
    );

    expect(result.ok).toBe(false);
    expect(result.reply).toMatch(/date and time|site visit/i);
    expect(rescheduleVisitTool.func).not.toHaveBeenCalled();
  });

  it('classifies workflow with one LLM call', async () => {
    const llm = jest.fn().mockResolvedValue(
      JSON.stringify({
        workflow: 'schedule_visit',
        confidence: 0.91,
        parameters: { leadName: 'Asha', scheduledAt: '2026-06-20T10:30:00+05:30' },
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
    expect(classified.parameters.scheduledAt).toBe('2026-06-20T10:30:00+05:30');
  });

  it('post-processes plain details misclassification away from brochure_request', async () => {
    const llm = jest.fn().mockResolvedValue(
      JSON.stringify({
        workflow: 'brochure_request',
        confidence: 0.92,
        parameters: { propertyId },
      }),
    );

    const classified = await classifyWorkflowMessage(
      {
        messageText: 'Need more details on option 4',
        recentMessages: [],
        companyName: 'Demo Realty',
      },
      llm,
    );

    expect(classified.workflowId).toBe('price_inquiry');
  });

  it('post-processes plain site visit booking away from human escalation', async () => {
    const llm = jest.fn().mockResolvedValue(
      JSON.stringify({
        workflow: 'escalate_to_human',
        confidence: 0.91,
        parameters: { propertyId },
      }),
    );

    const classified = await classifyWorkflowMessage(
      {
        messageText: 'I want to book visit for Commercial Hub',
        recentMessages: [],
        companyName: 'Demo Realty',
      },
      llm,
    );

    expect(classified.workflowId).toBe('schedule_visit');
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

  it('routes buyer details follow-up to property details instead of brochure delivery', async () => {
    const detailsTool = {
      name: 'getPropertyDetails',
      schema: { safeParse: jest.fn((input) => ({ success: true, data: input })) },
      func: jest.fn().mockResolvedValue([
        '🏠 *Commercial Hub*',
        'Type: commercial | Status: available',
        'Price: From INR 1,40,00,000',
        `ID: ${propertyId}`,
        'Visits: 0',
      ].join('\n')),
    };
    const brochureTool = {
      name: 'sendBrochureToClient',
      schema: { safeParse: jest.fn((input) => ({ success: true, data: input })) },
      func: jest.fn().mockResolvedValue('should not send brochure'),
    };
    (getToolsForRole as jest.Mock).mockReturnValue([detailsTool, brochureTool]);

    const reply = await tryRunBuyerWorkflow({
      companyId: 'company-1',
      leadId: kannadaLeadId,
      propertyId,
      messageText: 'Need more details on option 4',
      companyName: 'Demo Realty',
    });

    expect(detailsTool.func).toHaveBeenCalledWith({ propertyId });
    expect(brochureTool.func).not.toHaveBeenCalled();
    expect(reply).toContain('Commercial Hub');
    expect(reply).not.toContain('ID:');
    expect(reply).not.toContain('Visits:');
  });

  it('runs buyer schedule_visit workflow via approval-first bookVisit', async () => {
    (getToolsForRole as jest.Mock).mockReturnValue([]);
    (createVisitApprovalRequest as jest.Mock).mockClear();
    (scheduleVisit as jest.Mock).mockClear();
    mockPrisma.lead.findFirst.mockResolvedValue({
      id: kannadaLeadId,
      customerName: 'Kannada Media',
      phone: '+919999999999',
      assignedAgentId: 'agent-1',
    });
    mockPrisma.property.findFirst.mockResolvedValue({ name: 'Sunset Heights' });
    mockPrisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });

    const llm = jest.fn().mockResolvedValue(
      JSON.stringify({
        workflow: 'schedule_visit',
        confidence: 0.94,
        parameters: { scheduledAt: '2026-06-20T13:00:00+05:30', propertyId },
      }),
    );

    const reply = await classifyAndRunBuyerWorkflow(
      {
        companyId: 'company-1',
        leadId: kannadaLeadId,
        messageText: 'book site visit Saturday 1pm',
        companyName: 'Demo Realty',
        propertyId,
      },
      { llm },
    );

    expect(reply).toMatch(/shared your preferred visit time|approval/i);
    expect(createVisitApprovalRequest).toHaveBeenCalled();
    expect(scheduleVisit).not.toHaveBeenCalled();
  });

  it('asks for visit date/time when buyer visit intent has property but no slot', async () => {
    (getToolsForRole as jest.Mock).mockReturnValue([]);
    (scheduleVisit as jest.Mock).mockClear();

    const reply = await tryRunBuyerWorkflow({
      companyId: 'company-1',
      leadId: kannadaLeadId,
      propertyId,
      messageText: 'I want to book visit for Commercial Hub',
      companyName: 'Demo Realty',
    });

    expect(reply).toMatch(/date and time|site visit/i);
    expect(scheduleVisit).not.toHaveBeenCalled();
  });

  it('detectActiveVisitMutationBias maps push appointment to reschedule_visit', () => {
    const bias = detectActiveVisitMutationBias('push my appointment please', {
      visitId: 'visit-active-1',
      propertyName: 'Sunset Heights',
    });
    expect(bias?.workflowId).toBe('reschedule_visit');
    expect(bias?.parameters.visitId).toBe('visit-active-1');
  });

  it('detectBuyerNegotiationEscalationBias maps discount request to escalate_to_human', () => {
    const bias = detectBuyerNegotiationEscalationBias(
      'Can you give me 10% discount on the final price?',
    );
    expect(bias?.workflowId).toBe('escalate_to_human');
  });

  it('buildBuyerWorkflowFailureReply hides internal workflow errors', () => {
    const reply = buildBuyerWorkflowFailureReply(
      'price_inquiry',
      'fetchPropertyPrice',
      'Workflow "price_inquiry" failed at step "fetchPropertyPrice": propertyId: Invalid uuid',
    );
    expect(reply).not.toContain('Workflow "');
    expect(reply).not.toContain('Invalid uuid');
  });

  it('isBuyerQualificationOnlyMessage skips workflow for budget-only turns', () => {
    expect(
      isBuyerQualificationOnlyMessage('My budget is 1.2 to 1.5 crore for 3BHK in Whitefield'),
    ).toBe(true);
    expect(isBuyerQualificationOnlyMessage('What is the price for 3BHK?')).toBe(false);
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
    expect(reply).toMatch(/Book a new visit|Change an existing visit/i);
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

    expect(reply).toContain('notified our team');
    expect(reply).toContain('still here to help');
    expect(reply).not.toContain('Urgent alert created');
    expect(reply).not.toContain('agents notified');
  });

  it('logs workflow_clarification for staff mutation in clarification band (0.70–0.80)', async () => {
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

  it('logs workflow_fallthrough for staff mutation below the clarification band', async () => {
    const llm = jest.fn().mockResolvedValue(
      JSON.stringify({
        workflow: 'cancel_visit',
        confidence: 0.4,
        parameters: { visitId: 'visit-1' },
      }),
    );

    const reply = await classifyAndRunWorkflow(
      {
        toolContext: ctx,
        messageText: 'hmm something about a visit',
        recentMessages: [],
        companyName: 'Demo Realty',
        sessionLeadId: kannadaLeadId,
        staffPhone: '+919999999999',
      },
      { llm },
    );

    expect(reply).toBeNull();
    expect(logAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow_fallthrough',
        inputs: expect.objectContaining({
          workflowId: 'cancel_visit',
          confidence: 0.4,
          channel: 'staff',
          reason: 'low_confidence',
        }),
      }),
    );
  });

  it('logs workflow_clarification for buyer mutation in clarification band (0.70–0.80)', async () => {
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

  it('treats missing visit time as clarification, not staff escalation', () => {
    expect(
      isClarificationOnlyWorkflowFailure(
        'schedule_visit',
        'bookVisit',
        'When should the visit be scheduled? Share date and time.',
      ),
    ).toBe(true);
    expect(
      isClarificationOnlyWorkflowFailure(
        'schedule_visit',
        'bookVisit',
        'Agent has a conflicting visit within 60 minutes',
      ),
    ).toBe(false);
  });
});

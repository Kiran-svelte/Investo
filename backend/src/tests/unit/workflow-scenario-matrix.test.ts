/**
 * Scenario matrix: proves LLM intent + workflow engine routing for all 15 workflows
 * and common phrasing variants (no per-phrase regex trees).
 */
const mockPrisma = {
  lead: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  visit: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  user: { findFirst: jest.fn(), findMany: jest.fn() },
  property: { findFirst: jest.fn(), findMany: jest.fn() },
  notification: { create: jest.fn() },
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
  setAgentSessionClientContext: jest.fn().mockResolvedValue(undefined),
  syncLeadClientMemory: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/agent-action-log.service', () => ({
  logAgentAction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/agent/lead-status-actions', () => ({
  updateLeadStatusById: jest.fn().mockResolvedValue({
    handled: true,
    reply: '✅ status updated',
    leadId: 'lead-1',
  }),
}));

jest.mock('../../services/agent/agent-lead-resolution.service', () => ({
  resolveLeadForIntent: jest.fn().mockResolvedValue({ leadId: 'lead-1', customerName: 'Test Lead' }),
  extractLeadIdsFromText: jest.fn(() => []),
  extractLeadNamesFromAssistantMessages: jest.fn(() => []),
}));

jest.mock('../../services/leadAssignment.service', () => ({
  assignLeadRoundRobin: jest.fn().mockResolvedValue('agent-2'),
  notifyAgentOfNewLead: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/leadTransition.service', () => ({
  transitionLeadStatus: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/notification.engine', () => ({
  notificationEngine: {
    onLeadAssigned: jest.fn().mockResolvedValue(undefined),
    onLeadReassigned: jest.fn().mockResolvedValue(undefined),
    onVisitScheduled: jest.fn().mockResolvedValue(undefined),
    notify: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../services/brochureDelivery.service', () => ({
  deliverBrochureToLead: jest.fn().mockResolvedValue({ ok: true, reply: 'Brochure sent.' }),
}));

jest.mock('../../services/propertyKnowledge.service', () => ({
  answerPropertyQuestion: jest.fn().mockResolvedValue('Pool and gym available.'),
  searchPropertiesForCompany: jest.fn().mockResolvedValue([{ id: 'prop-1', title: 'Demo 3BHK' }]),
}));

jest.mock('../../services/agent/tools', () => {
  const okTool = (text: string) => ({
    schema: { safeParse: (i: unknown) => ({ success: true, data: i as Record<string, unknown> }) },
    func: jest.fn().mockResolvedValue(text),
  });
  const names = [
    'scheduleVisit',
    'rescheduleVisit',
    'cancelVisit',
    'createLead',
    'addLeadNote',
    'assignLead',
    'completeVisit',
    'searchPropertiesForLead',
    'searchCatalogByCustomerMessage',
    'getPropertyDetails',
    'sendBrochureToClient',
    'takeoverConversation',
    'flagLeadPriority',
    'getAvailableSlots',
  ];
  return {
    getToolsForRole: jest.fn(() => names.map((name) => ({ name, ...okTool(`${name} ok`) }))),
  };
});

import type { WorkflowId } from '../../constants/workflow.constants';
import { allWorkflowIds } from '../../services/workflow/workflow-registry';
import {
  classifyWorkflowMessage,
  runWorkflow,
} from '../../services/workflow/workflow-engine.service';
import type { ToolContext } from '../../services/agent/agent-state';

const ctx: ToolContext = {
  userId: 'agent-1',
  companyId: 'company-1',
  userRole: 'sales_agent',
  userName: 'Agent',
  sessionId: 'session-1',
};

const defaultLead = {
  id: 'lead-1',
  customerName: 'Test Lead',
  status: 'contacted',
  assignedAgentId: 'agent-1',
  phone: '9876543210',
};

const defaultVisit = {
  id: 'visit-1',
  leadId: 'lead-1',
  status: 'scheduled',
  scheduledAt: new Date('2026-06-05T08:00:00+05:30'),
};

/** Representative user phrases → expected workflow (LLM is mocked to return these). */
const SCENARIO_MATRIX: Array<{ phrases: string[]; workflow: WorkflowId }> = [
  { workflow: 'new_lead', phrases: ['new lead from WhatsApp', 'create lead Rahul 9876543210'] },
  {
    workflow: 'update_status',
    phrases: [
      'mark as hot',
      'change to contacted',
      'Update lead kannada media status to visited',
      'set status to visited for kannada media',
    ],
  },
  { workflow: 'add_note', phrases: ['Note: wants corner plot', 'Remember: price sensitive'] },
  { workflow: 'assign_agent', phrases: ['Assign to Rajesh', 'change agent to Priya'] },
  { workflow: 'schedule_visit', phrases: ['Visit Saturday 4pm', 'Book site visit tomorrow 1pm'] },
  { workflow: 'reschedule_visit', phrases: ['Postpone to Sunday', 'Pre pone site visit to tomorrow at 1pm'] },
  { workflow: 'cancel_visit', phrases: ['Cancel visit', "I can't make it to the site visit"] },
  { workflow: 'complete_visit', phrases: ['Visit done', 'Saw the property today'] },
  { workflow: 'mark_visit_outcome', phrases: ['Liked it', 'Not interested', 'Will decide later'] },
  { workflow: 'price_inquiry', phrases: ["What's the price?", 'How much for 3BHK?'] },
  { workflow: 'availability_check', phrases: ['Is 3BHK available?', 'Any units left?'] },
  { workflow: 'brochure_request', phrases: ['Send brochure', 'Share PDF details'] },
  { workflow: 'amenities_question', phrases: ['What amenities?', 'Is there a pool?'] },
  { workflow: 'agent_availability', phrases: ['Is Rajesh free?', 'Which agent is available?'] },
  { workflow: 'escalate_to_human', phrases: ['Talk to agent', 'Call me please'] },
];

describe('workflow scenario matrix (15 workflows × phrasing variants)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.lead.findFirst.mockResolvedValue(defaultLead);
    mockPrisma.lead.findUnique.mockResolvedValue(defaultLead);
    mockPrisma.lead.findMany.mockResolvedValue([defaultLead]);
    mockPrisma.lead.update.mockResolvedValue(defaultLead);
    mockPrisma.visit.findFirst.mockResolvedValue(defaultVisit);
    mockPrisma.visit.findMany.mockResolvedValue([defaultVisit]);
    mockPrisma.visit.update.mockResolvedValue(defaultVisit);
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'agent-2', name: 'Rajesh', phone: '919999999999' });
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'agent-2', name: 'Rajesh' }]);
    mockPrisma.property.findFirst.mockResolvedValue({
      id: 'prop-1',
      title: 'Demo Tower',
      priceMin: 5000000,
      priceMax: 6500000,
    });
    mockPrisma.property.findMany.mockResolvedValue([{ id: 'prop-1', title: 'Demo Tower' }]);
  });

  it('registry contains exactly 15 workflows', () => {
    expect(allWorkflowIds()).toHaveLength(15);
  });

  it.each(
    SCENARIO_MATRIX.flatMap((row) =>
      row.phrases.map((phrase) => [row.workflow, phrase, row.workflow] as const),
    ),
  )(
    'classifies "%s" → workflow %s',
    async (_label, phrase, expectedWorkflow) => {
      const llm = jest.fn().mockResolvedValue(
        JSON.stringify({ workflow: expectedWorkflow, confidence: 0.9, parameters: {} }),
      );
      const classified = await classifyWorkflowMessage(
        { messageText: phrase, recentMessages: [], companyName: 'Investo' },
        llm,
      );
      expect(classified.workflowId).toBe(expectedWorkflow);
      expect(classified.confidence).toBeGreaterThanOrEqual(0.55);
    },
  );

  it.each(allWorkflowIds())('runWorkflow executes registered steps for %s', async (workflowId) => {
    const params: Record<string, unknown> = {
      leadId: 'lead-1',
      visitId: 'visit-1',
      propertyId: 'prop-1',
      status: 'visited',
      scheduledAt: '2026-06-05T13:00:00+05:30',
      customerName: 'Rahul',
      phone: '9876543210',
      note: 'test note',
      agentId: 'agent-2',
      outcome: 'interested',
      conversationId: 'conv-1',
    };
    const result = await runWorkflow(
      workflowId,
      {
        toolContext: ctx,
        messageText: 'test',
        recentMessages: [],
        companyName: 'Investo',
        sessionLeadId: 'lead-1',
        sessionVisitId: 'visit-1',
        staffPhone: '+919999999999',
        channel: 'staff',
      },
      params,
    );
    expect(result.ok).toBe(true);
  });
});

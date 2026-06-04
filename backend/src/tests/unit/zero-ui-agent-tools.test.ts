const mockPrisma = {
  lead: {
    findFirst: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  visit: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  property: {
    findFirst: jest.fn(),
  },
  conversation: {
    findFirst: jest.fn(),
  },
  message: {
    create: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
  },
  agentActionLog: {
    findMany: jest.fn(),
  },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../services/agent/confirmation.service', () => ({
  createPendingConfirmation: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/whatsapp.service', () => ({
  whatsappService: {
    resolveCompanyWhatsAppConfig: jest.fn().mockResolvedValue({ phoneNumberId: 'pnid', accessToken: 'token' }),
    sendCompanyTextMessage: jest.fn().mockResolvedValue(true),
    sendPropertyBrochure: jest.fn().mockResolvedValue({ success: true, messageId: 'brochure-1' }),
    sendMessage: jest.fn().mockResolvedValue(true),
  },
}));

import { createLeadTools } from '../../services/agent/tools/lead-tools';
import { createVisitTools } from '../../services/agent/tools/visit-tools';
import { createBrochureTools } from '../../services/agent/tools/brochure-tools';
import { createAdminLogTools } from '../../services/agent/tools/admin-log-tools';
import { ToolContext } from '../../services/agent/agent-state';

const agentContext: ToolContext = {
  userId: 'agent-1',
  companyId: 'company-1',
  userRole: 'sales_agent',
  userName: 'Agent One',
  sessionId: 'session-1',
};

const adminContext: ToolContext = {
  userId: 'admin-1',
  companyId: 'company-1',
  userRole: 'company_admin',
  userName: 'Admin One',
  sessionId: 'session-2',
};

function getTool(tools: { name: string; func: (input: Record<string, unknown>) => Promise<string> }[], name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

describe('Zero-UI agent tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('addLeadNote', () => {
    const tools = createLeadTools(agentContext);

    it('appends note on happy path', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        customerName: 'Ravi',
        notes: 'Existing',
      });
      mockPrisma.lead.update.mockResolvedValue({});
      const result = await getTool(tools, 'addLeadNote').func({ leadId: 'lead-1', note: 'Called back' });
      expect(result).toContain('Note added');
      expect(mockPrisma.lead.update).toHaveBeenCalled();
    });

    it('returns not found when lead missing', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      const result = await getTool(tools, 'addLeadNote').func({ leadId: 'lead-1', note: 'Hi' });
      expect(result).toContain('not found');
    });
  });

  describe('flagLeadPriority', () => {
    const tools = createLeadTools(agentContext);

    it('sets hot priority in metadata', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        customerName: 'Ravi',
        metadata: {},
      });
      mockPrisma.lead.update.mockResolvedValue({});
      const result = await getTool(tools, 'flagLeadPriority').func({ leadId: 'lead-1', priority: 'hot' });
      expect(result).toContain('hot');
    });
  });

  describe('transferLeadPortfolio', () => {
    const tools = createLeadTools(agentContext);

    it('denies non-admin users', async () => {
      const result = await getTool(tools, 'transferLeadPortfolio').func({
        fromAgentId: 'agent-1',
        toAgentId: 'agent-2',
      });
      expect(result).toContain('Only admins');
    });

    it('requests confirmation for admin', async () => {
      const adminTools = createLeadTools(adminContext);
      mockPrisma.user.findFirst
        .mockResolvedValueOnce({ id: 'agent-1', name: 'From' })
        .mockResolvedValueOnce({ id: 'agent-2', name: 'To' });
      mockPrisma.lead.count.mockResolvedValue(3);
      const result = await getTool(adminTools, 'transferLeadPortfolio').func({
        fromAgentId: 'agent-1',
        toAgentId: 'agent-2',
      });
      expect(result).toContain('Confirm transfer');
    });
  });

  describe('bulkReassignVisits', () => {
    const tools = createVisitTools(agentContext);

    it('returns not found when no visits', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'agent-2', name: 'Target' });
      mockPrisma.visit.findMany.mockResolvedValue([]);
      const result = await getTool(tools, 'bulkReassignVisits').func({ toAgentId: 'agent-2' });
      expect(result).toContain('No scheduled visits');
    });

    it('asks for confirmation when visits exist', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'agent-2', name: 'Target' });
      mockPrisma.visit.findMany.mockResolvedValue([{ id: 'visit-1', lead: {}, property: {}, agent: {} }]);
      const result = await getTool(tools, 'bulkReassignVisits').func({ toAgentId: 'agent-2' });
      expect(result).toContain('Confirm reassignment');
    });
  });

  describe('snoozeAllVisits', () => {
    const tools = createVisitTools(agentContext);

    it('returns not found when no visits to snooze', async () => {
      mockPrisma.visit.findMany.mockResolvedValue([]);
      const result = await getTool(tools, 'snoozeAllVisits').func({ postponeByDays: 2 });
      expect(result).toContain('No scheduled visits');
    });
  });

  describe('sendBrochureToClient', () => {
    const tools = createBrochureTools(agentContext);

    it('denies when lead not found', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      const result = await getTool(tools, 'sendBrochureToClient').func({
        leadId: 'lead-1',
        propertyId: 'prop-1',
      });
      expect(result).toContain('not found');
    });

    it('sends brochure when property has URL', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        customerName: 'Ravi',
        phone: '+919999999999',
      });
      mockPrisma.property.findFirst.mockResolvedValue({
        name: 'Tower A',
        brochureUrl: 'https://example.com/brochure.pdf',
      });
      mockPrisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      mockPrisma.message.create.mockResolvedValue({});
      const result = await getTool(tools, 'sendBrochureToClient').func({
        leadId: 'lead-1',
        propertyId: 'prop-1',
      });
      expect(result).toContain('Brochure');
    });
  });

  describe('getAiActionLog', () => {
    it('denies sales agents', async () => {
      const tools = createAdminLogTools(agentContext);
      const result = await getTool(tools, 'getAiActionLog').func({});
      expect(result).toContain('Only admins');
    });

    it('returns logs for admin', async () => {
      const tools = createAdminLogTools(adminContext);
      mockPrisma.agentActionLog.findMany.mockResolvedValue([
        {
          createdAt: new Date(),
          action: 'detectAndMarkNoShows',
          triggeredBy: 'cron',
          status: 'success',
          result: 'ok',
          errorMessage: null,
          resourceType: null,
          resourceId: null,
          durationMs: 10,
        },
      ]);
      const result = await getTool(tools, 'getAiActionLog').func({ limit: 5 });
      expect(result).toContain('AI Action Log');
    });
  });
});

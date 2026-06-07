const mockPrisma = {
  visit: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  lead: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
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

jest.mock('../../services/visitIntentFromMessage.service', () => {
  const actual = jest.requireActual('../../services/visitIntentFromMessage.service') as Record<string, unknown>;
  return {
    ...actual,
    isVisitCancelOrRescheduleMessage: (text: string) =>
      /cancel.*visit.*reschedule|prepone/i.test(text),
  };
});

jest.mock('../../services/agent/agent-session-messages.service', () => ({
  getRecentAgentSessionMessages: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/agent/lead-status-actions', () => ({
  updateLeadStatusById: jest.fn(),
}));

import { applyVisitMutationFromChat } from '../../services/visitMutationFromChat.service';
import { updateLeadStatusById } from '../../services/agent/lead-status-actions';
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
    const result = await tryDeterministicAgentCrmReply(ctx, 'new leads today');
    expect(result).toContain('New leads today');
    expect(result).toContain('Priya');
    expect(result).not.toMatch(/\bID:\s*[0-9a-f-]/i);
  });

  it('caps long visit lists and omits internal IDs', async () => {
    const visits = Array.from({ length: 12 }, (_, i) => ({
      id: `v-${i}`,
      status: 'no_show',
      scheduledAt: new Date(),
      lead: { customerName: `User ${i}`, phone: '+919999999999' },
      property: { name: 'Sunset Heights' },
      agent: { name: 'Agent' },
    }));
    mockPrisma.visit.findMany.mockResolvedValue(visits);
    const result = await tryDeterministicAgentCrmReply(ctx, 'visits today');
    expect(result).toContain("Today's visits");
    expect(result).toContain('+4 more');
    expect(result).not.toMatch(/\bID:\s*[0-9a-f-]/i);
    expect(result).toContain('No-show');
    expect(result).not.toContain('no_show');
  });

  it('returns new leads today (alternate phrasing)', async () => {
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

  it('confirms the next upcoming visit without asking for visit ID', async () => {
    mockPrisma.visit.findFirst.mockResolvedValue({
      id: 'v1',
      status: 'scheduled',
      scheduledAt: new Date(),
      lead: { customerName: 'Amogh', phone: '+919999999999' },
      property: { name: 'Lake Vista' },
      agent: { name: 'Agent' },
    });
    mockPrisma.visit.update.mockResolvedValue({
      id: 'v1',
      status: 'confirmed',
      scheduledAt: new Date(),
      lead: { customerName: 'Amogh', phone: '+919999999999' },
      property: { name: 'Lake Vista' },
      agent: { name: 'Agent' },
    });
    const result = await tryDeterministicAgentCrmReply(ctx, 'Confirm the visit');
    expect(result).toContain('Visit confirmed');
    expect(result).toContain('Amogh');
    expect(mockPrisma.visit.update).toHaveBeenCalled();
  });

  it('updates lead status instead of listing new leads today', async () => {
    mockPrisma.lead.findFirst.mockResolvedValue({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      customerName: 'Kannada media',
      status: 'contacted',
    });
    (updateLeadStatusById as jest.Mock).mockResolvedValue({
      handled: true,
      reply: '✅ Lead *Kannada media* status updated to *visited*.',
      leadId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    });
    const result = await tryDeterministicAgentCrmReply(
      { ...ctx, sessionId: 'session-1' },
      'Update lead kannada media status to visited .actually they have visited today only',
    );
    expect(result).toContain('visited');
    expect(result).toContain('Kannada media');
    expect(mockPrisma.lead.findMany).not.toHaveBeenCalled();
  });

  it('returns next visit for "when is my site visit booked"', async () => {
    mockPrisma.visit.findFirst.mockResolvedValue({
      id: 'v1',
      status: 'scheduled',
      scheduledAt: new Date('2026-06-06T07:30:00Z'),
      lead: { customerName: 'Amogh', phone: '+919999999999' },
      property: { name: 'Sunset Heights' },
      agent: { name: 'Agent' },
    });
    const result = await tryDeterministicAgentCrmReply(ctx, 'When is my site viste booked on ?');
    expect(result).toContain('next site visit');
    expect(result).toContain('Amogh');
  });

  it('handles "Any leads today?"', async () => {
    mockPrisma.lead.findMany.mockResolvedValue([
      {
        id: 'l1',
        status: 'new',
        customerName: 'Amogh',
        phone: '+919888888888',
        assignedAgent: { name: 'Agent' },
      },
    ]);
    const result = await tryDeterministicAgentCrmReply(ctx, 'Any leads today ?');
    expect(result).toContain('New leads today');
    expect(result).toContain('Amogh');
  });
});

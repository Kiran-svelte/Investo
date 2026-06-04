const mockPrisma = {
  lead: { findFirst: jest.fn(), findMany: jest.fn() },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

import { resolveLeadForIntent } from '../../services/agent/agent-lead-resolution.service';
import type { ToolContext } from '../../services/agent/agent-state';

const ctx: ToolContext = {
  userId: 'agent-1',
  companyId: 'company-1',
  userRole: 'sales_agent',
  userName: 'Agent',
};

describe('agent-lead-resolution.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves lead by fuzzy name from recent list context', async () => {
    const leadId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    mockPrisma.lead.findFirst.mockResolvedValue({
      id: leadId,
      customerName: 'Kannada media',
    });

    const resolved = await resolveLeadForIntent(
      ctx,
      { leadName: 'kannada media' },
      null,
      [
        {
          role: 'assistant',
          content:
            '*New leads today (2026-06-04)*\n\n1. 🆕 *Kannada media* +91XXXX\n   Status: contacted | ID: a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          createdAt: new Date(),
        },
      ],
    );

    expect(resolved?.leadId).toBe(leadId);
    expect(resolved?.customerName).toBe('Kannada media');
  });
});

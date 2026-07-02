const mockUserFindMany = jest.fn();
const mockLeadGroupBy = jest.fn();
const mockUserFindUnique = jest.fn();
const mockLeadFindUnique = jest.fn();
const mockUserFindFirst = jest.fn();
const mockLeadFindFirst = jest.fn();
const mockSendCompanyTextMessage = jest.fn().mockResolvedValue(true);

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      findFirst: (...args: unknown[]) => mockUserFindFirst(...args),
    },
    lead: {
      groupBy: (...args: unknown[]) => mockLeadGroupBy(...args),
      findUnique: (...args: unknown[]) => mockLeadFindUnique(...args),
      findFirst: (...args: unknown[]) => mockLeadFindFirst(...args),
    },
  },
}));

jest.mock('../../services/whatsapp.service', () => ({
  whatsappService: {
    sendCompanyTextMessage: (...args: unknown[]) => mockSendCompanyTextMessage(...args),
  },
}));

import { assignLeadRoundRobin } from '../../services/leadAssignment.service';

describe('assignLeadRoundRobin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns null when no active sales agents exist', async () => {
    mockUserFindMany.mockResolvedValueOnce([]);

    const result = await assignLeadRoundRobin('company-1');

    expect(result).toBeNull();
    expect(mockLeadGroupBy).not.toHaveBeenCalled();
  });

  test('picks agent with fewest non-terminal leads', async () => {
    mockUserFindMany.mockResolvedValueOnce([
      { id: 'agent-a' },
      { id: 'agent-b' },
      { id: 'agent-c' },
    ]);
    mockLeadGroupBy.mockResolvedValueOnce([
      { assignedAgentId: 'agent-a', _count: { id: 5 } },
      { assignedAgentId: 'agent-b', _count: { id: 2 } },
      { assignedAgentId: 'agent-c', _count: { id: 4 } },
    ]);

    const result = await assignLeadRoundRobin('company-1', 'lead-1');

    expect(result).toBe('agent-b');
  });

  test('notifies assigned agent via WhatsApp when leadId is provided', async () => {
    mockUserFindMany.mockResolvedValueOnce([{ id: 'agent-a' }]);
    mockLeadGroupBy.mockResolvedValueOnce([]);
    mockUserFindFirst.mockResolvedValueOnce({ name: 'Alice', phone: '+919000000001' });
    mockLeadFindFirst.mockResolvedValueOnce({
      customerName: 'Bob',
      phone: '+919000000002',
      source: 'whatsapp',
      budgetMin: null,
      budgetMax: null,
      locationPreference: null,
      propertyType: null,
    });

    await assignLeadRoundRobin('company-1', 'lead-1');
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockSendCompanyTextMessage).toHaveBeenCalledWith(
      '+919000000001',
      expect.stringContaining('New Lead Assigned'),
      'company-1',
    );
  });

  test('treats agents with no leads as zero load', async () => {
    mockUserFindMany.mockResolvedValueOnce([{ id: 'agent-a' }, { id: 'agent-b' }]);
    mockLeadGroupBy.mockResolvedValueOnce([{ assignedAgentId: 'agent-a', _count: { id: 3 } }]);

    const result = await assignLeadRoundRobin('company-1');

    expect(result).toBe('agent-b');
    expect(mockSendCompanyTextMessage).not.toHaveBeenCalled();
  });
});

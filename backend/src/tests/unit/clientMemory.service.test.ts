const mockPrisma = {
  $executeRawUnsafe: jest.fn(),
  $queryRawUnsafe: jest.fn(),
  lead: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  visit: { findFirst: jest.fn() },
  message: { findFirst: jest.fn() },
  agentActionLog: { findMany: jest.fn() },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../services/propertyKnowledge.service', () => ({
  createTextEmbeddings: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  embeddingVectorLiteral: (v: number[]) => `[${v.join(',')}]`,
}));

import {
  formatClientMemoryForPrompt,
  resolveLeadContextForAgent,
} from '../../services/clientMemory.service';

describe('clientMemory.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);
    mockPrisma.$queryRawUnsafe.mockResolvedValue([{ last_lead_id: 'lead-1', last_visit_id: 'visit-1' }]);
  });

  it('formats RAG chunks for prompt injection', () => {
    const block = formatClientMemoryForPrompt(
      [
        {
          leadId: 'lead-1',
          content: 'Visit scheduled at Lake Vista',
          sourceType: 'visit',
          score: 0.92,
        },
      ],
      'Amogh',
    );
    expect(block).toContain('CLIENT MEMORY');
    expect(block).toContain('Amogh');
    expect(block).toContain('Lake Vista');
  });

  it('resolves lead from session visit for confirm the visit', async () => {
    mockPrisma.visit.findFirst.mockResolvedValue({
      id: 'visit-1',
      leadId: 'lead-1',
      lead: { customerName: 'Amogh' },
    });

    const resolved = await resolveLeadContextForAgent({
      companyId: 'co-1',
      userId: 'agent-1',
      userRole: 'sales_agent',
      messageText: 'Confirm the visit',
      sessionLeadId: null,
      sessionVisitId: 'visit-1',
    });

    expect(resolved.leadId).toBe('lead-1');
    expect(resolved.visitId).toBe('visit-1');
    expect(resolved.leadName).toBe('Amogh');
  });
});

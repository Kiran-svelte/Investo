import { countPropertyKnowledgeBackfillCandidates } from '../../services/propertyKnowledgeBackfill.service';

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    $queryRawUnsafe: jest.fn(),
    property: { findFirst: jest.fn() },
  },
}));

jest.mock('../../services/propertyKnowledge.service', () => ({
  indexPropertyKnowledge: jest.fn(),
  loadPropertyKnowledgeIndexPayload: jest.fn(),
}));

describe('propertyKnowledgeBackfill.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('countPropertyKnowledgeBackfillCandidates queries all tenants without company filter', async () => {
    const prisma = require('../../config/prisma').default;
    prisma.$queryRawUnsafe.mockResolvedValue([{ count: BigInt(42) }]);

    const count = await countPropertyKnowledgeBackfillCandidates();

    expect(count).toBe(42);
    const sql = prisma.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).not.toMatch(/company_id\s*=/i);
    expect(sql).toMatch(/extended_attributes/i);
  });
});

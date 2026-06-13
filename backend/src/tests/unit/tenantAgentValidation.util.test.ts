/// <reference types="jest" />

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findFirst: jest.fn(),
    },
  },
}));

import prisma from '../../config/prisma';
import { assertActiveLeadAgentInCompany, assertUserBelongsToCompany } from '../../utils/tenantAgentValidation.util';

const mockPrisma = prisma as unknown as {
  user: { findFirst: jest.Mock };
};

describe('tenantAgentValidation.util', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects foreign agent assignment targets', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    const result = await assertActiveLeadAgentInCompany('company-a', 'agent-b');
    expect(result).toEqual({ ok: false, reason: 'agent_not_in_company' });
  });

  it('accepts active sales agent in same company', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'agent-a' });
    const result = await assertActiveLeadAgentInCompany('company-a', 'agent-a');
    expect(result).toEqual({ ok: true, agentId: 'agent-a' });
  });

  it('assertUserBelongsToCompany returns false for foreign users', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    await expect(assertUserBelongsToCompany('company-a', 'user-b')).resolves.toBe(false);
  });
});

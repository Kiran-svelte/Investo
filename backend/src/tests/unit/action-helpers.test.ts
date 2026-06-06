const mockPrisma = {
  lead: { findUnique: jest.fn() },
  user: { findFirst: jest.fn() },
  property: { findFirst: jest.fn() },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../services/agent/agent-lead-resolution.service', () => ({
  resolveLeadForIntent: jest.fn(),
}));

import type { UserRole } from '@prisma/client';
import { enrichWorkflowParams, isValidUuid } from '../../services/workflow/actions/action-helpers';

const context = {
  companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  userRole: 'agent' as UserRole,
  userName: 'Scenario Buyer',
};

const propertyId = '11111111-1111-4111-8111-111111111111';
const leadId = '22222222-2222-4222-8222-222222222222';

describe('action-helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isValidUuid', () => {
    it('accepts RFC-4122 uuids', () => {
      expect(isValidUuid(propertyId)).toBe(true);
    });
    it('rejects property names and partial ids', () => {
      expect(isValidUuid('Palmvilla')).toBe(false);
      expect(isValidUuid('prop-1')).toBe(false);
    });
  });

  describe('enrichWorkflowParams', () => {
    it('coerces invalid propertyId to propertyName lookup', async () => {
      mockPrisma.property.findFirst.mockResolvedValue({ id: propertyId });

      const enriched = await enrichWorkflowParams({
        context,
        params: { propertyId: 'Palmvilla' },
        messageText: 'brochure for Palmvilla',
        recentMessages: [],
      });

      expect(enriched.propertyId).toBe(propertyId);
      expect(enriched.propertyName).toBe('Palmvilla');
    });

    it('resolves propertyId from lead_memory projectsDiscussed', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue({
        leadMemory: {
          projectsDiscussed: [{ name: 'Palmvilla', propertyId }],
        },
      });

      const enriched = await enrichWorkflowParams({
        context,
        params: { leadId },
        messageText: 'what is the price?',
        recentMessages: [],
      });

      expect(enriched.propertyId).toBe(propertyId);
    });

    it('drops invalid visitId instead of passing to tools', async () => {
      const enriched = await enrichWorkflowParams({
        context,
        params: { visitId: 'Saturday 4pm' },
        messageText: 'book Saturday 4pm',
        recentMessages: [],
      });

      expect(enriched.visitId).toBeUndefined();
    });
  });
});

const mockPrisma = {
  visit: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  conversation: {
    findUnique: jest.fn(),
    update: jest.fn(),
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

const mockCancelVisitById = jest.fn();
const mockConfirmVisitById = jest.fn();
const mockRescheduleVisitById = jest.fn();

jest.mock('../../services/visitState.service', () => ({
  cancelVisitById: (...args: unknown[]) => mockCancelVisitById(...args),
  confirmVisitById: (...args: unknown[]) => mockConfirmVisitById(...args),
  rescheduleVisitById: (...args: unknown[]) => mockRescheduleVisitById(...args),
}));

import config from '../../config';
import {
  applyVisitMutationFromChat,
  findTargetVisitsWithDisambiguation,
} from '../../services/visitMutationFromChat.service';

describe('visitMutationFromChat.service disambiguation', () => {
  const originalFlag = config.features.visitDisambiguation;

  const visitA = {
    id: 'visit-a',
    companyId: 'co-1',
    leadId: 'lead-1',
    scheduledAt: new Date('2026-06-14T10:30:00+05:30'),
    status: 'scheduled',
    property: { name: 'Sunset Heights' },
    lead: { id: 'lead-1', customerName: 'Ravi', phone: '+919999999999' },
  };

  const visitB = {
    id: 'visit-b',
    companyId: 'co-1',
    leadId: 'lead-1',
    scheduledAt: new Date('2026-06-14T12:30:00+05:30'),
    status: 'confirmed',
    property: { name: 'Lake Vista' },
    lead: { id: 'lead-1', customerName: 'Ravi', phone: '+919999999999' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    config.features.visitDisambiguation = false;
    mockPrisma.conversation.findUnique.mockResolvedValue({ commitments: {} });
    mockPrisma.conversation.update.mockResolvedValue({});
    mockCancelVisitById.mockResolvedValue({ success: true });
  });

  afterAll(() => {
    config.features.visitDisambiguation = originalFlag;
  });

  it('flag OFF cancels earliest visit for generic cancel message', async () => {
    mockPrisma.visit.findFirst.mockResolvedValue(visitA);

    const result = await applyVisitMutationFromChat({
      companyId: 'co-1',
      leadId: 'lead-1',
      message: 'cancel my visit',
    });

    expect(result.handled).toBe(true);
    expect(result.mode).toBe('cancelled');
    expect(mockCancelVisitById).toHaveBeenCalledWith(expect.objectContaining({ visitId: 'visit-a' }));
  });

  describe('flag ON', () => {
    beforeEach(() => {
      config.features.visitDisambiguation = true;
    });

    it('returns disambiguation prompt when multiple visits match', async () => {
      mockPrisma.visit.findMany.mockResolvedValue([visitA, visitB]);

      const result = await applyVisitMutationFromChat({
        companyId: 'co-1',
        leadId: 'lead-1',
        conversationId: 'conv-1',
        message: 'cancel my visit',
      });

      expect(result.handled).toBe(true);
      expect(result.mode).toBe('disambiguate');
      expect(result.reply).toContain('Sunset Heights');
      expect(result.reply).toContain('Lake Vista');
      expect(mockCancelVisitById).not.toHaveBeenCalled();
      expect(mockPrisma.conversation.update).toHaveBeenCalled();
    });

    it('cancels named visit directly without disambiguation prompt', async () => {
      mockPrisma.visit.findMany.mockResolvedValue([visitA, visitB]);

      const result = await applyVisitMutationFromChat({
        companyId: 'co-1',
        leadId: 'lead-1',
        conversationId: 'conv-1',
        message: 'cancel lake vista visit',
      });

      expect(result.mode).toBe('cancelled');
      expect(mockCancelVisitById).toHaveBeenCalledWith(expect.objectContaining({ visitId: 'visit-b' }));
    });

    it('resolves pending disambiguation on ordinal reply', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        commitments: {
          visit_disambiguation: {
            kind: 'visit_disambiguation',
            candidateVisitIds: ['visit-a', 'visit-b'],
            action: 'cancel',
            createdAt: new Date().toISOString(),
          },
        },
      });
      mockPrisma.visit.findMany.mockResolvedValue([visitA, visitB]);

      const result = await applyVisitMutationFromChat({
        companyId: 'co-1',
        leadId: 'lead-1',
        conversationId: 'conv-1',
        message: '2',
      });

      expect(result.mode).toBe('cancelled');
      expect(mockCancelVisitById).toHaveBeenCalledWith(expect.objectContaining({ visitId: 'visit-b' }));
    });

    it('findTargetVisitsWithDisambiguation reports disambiguate status', async () => {
      mockPrisma.visit.findMany.mockResolvedValue([visitA, visitB]);

      const resolution = await findTargetVisitsWithDisambiguation(
        { companyId: 'co-1', leadId: 'lead-1', message: 'cancel' },
        'cancel',
      );

      expect(resolution.status).toBe('disambiguate');
      if (resolution.status === 'disambiguate') {
        expect(resolution.candidates).toHaveLength(2);
      }
    });
  });
});

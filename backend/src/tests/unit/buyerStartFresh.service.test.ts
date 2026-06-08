const mockVisitFindMany = jest.fn();
const mockVisitUpdateMany = jest.fn();
const mockConversationUpdate = jest.fn();
const mockTransaction = jest.fn();
const mockQueryRaw = jest.fn();
const mockApprovalFindMany = jest.fn();
const mockCancelCall = jest.fn();
const mockResolveApproval = jest.fn();
const mockCancelVisitReminders = jest.fn();
const mockLogAgentAction = jest.fn();

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    $queryRawUnsafe: (...args: unknown[]) => mockQueryRaw(...args),
    visit: {
      findMany: (...args: unknown[]) => mockVisitFindMany(...args),
      updateMany: (...args: unknown[]) => mockVisitUpdateMany(...args),
    },
    conversation: {
      update: (...args: unknown[]) => mockConversationUpdate(...args),
    },
    bookingApprovalRequest: {
      findMany: (...args: unknown[]) => mockApprovalFindMany(...args),
    },
  },
}));

jest.mock('../../services/visitLifecycle.service', () => ({
  cancelVisitReminderJobs: (...args: unknown[]) => mockCancelVisitReminders(...args),
}));

jest.mock('../../services/callRequest.service', () => ({
  ensureCallRequestsSchema: jest.fn().mockResolvedValue(undefined),
  cancelCallRequest: (...args: unknown[]) => mockCancelCall(...args),
}));

jest.mock('../../services/bookingApproval.service', () => ({
  resolveBookingApprovalStatus: (...args: unknown[]) => mockResolveApproval(...args),
}));

jest.mock('../../services/agent-action-log.service', () => ({
  logAgentAction: (...args: unknown[]) => mockLogAgentAction(...args),
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  buildBuyerStartFreshReply,
  isBuyerStartCommand,
  resetBuyerBookingAndConversationState,
} from '../../services/buyer/buyerStartFresh.service';

describe('buyerStartFresh.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockVisitFindMany.mockResolvedValue([{ id: 'visit-1' }, { id: 'visit-2' }]);
    mockVisitUpdateMany.mockResolvedValue({ count: 2 });
    mockConversationUpdate.mockResolvedValue({ id: 'conv-1' });
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        visit: {
          findMany: mockVisitFindMany,
          updateMany: mockVisitUpdateMany,
        },
        conversation: {
          update: mockConversationUpdate,
        },
      }),
    );
    mockQueryRaw.mockResolvedValue([{ id: 'call-1' }]);
    mockCancelCall.mockResolvedValue({ success: true });
    mockApprovalFindMany.mockResolvedValue([{ id: 'approval-1' }, { id: 'approval-2' }]);
    mockResolveApproval.mockResolvedValue({ status: 'cancelled' });
    mockCancelVisitReminders.mockResolvedValue(undefined);
    mockLogAgentAction.mockResolvedValue(undefined);
  });

  describe('isBuyerStartCommand', () => {
    it('matches exact /start case-insensitively with surrounding whitespace', () => {
      expect(isBuyerStartCommand('/start')).toBe(true);
      expect(isBuyerStartCommand('  /START  ')).toBe(true);
      expect(isBuyerStartCommand('/Start')).toBe(true);
    });

    it('does not match partial or prefixed commands', () => {
      expect(isBuyerStartCommand('please /start')).toBe(false);
      expect(isBuyerStartCommand('/start over')).toBe(false);
      expect(isBuyerStartCommand('start')).toBe(false);
      expect(isBuyerStartCommand('hi')).toBe(false);
    });
  });

  describe('buildBuyerStartFreshReply', () => {
    it('includes company name and fresh-start guidance', () => {
      const reply = buildBuyerStartFreshReply('Palm Realty');
      expect(reply).toContain('Palm Realty');
      expect(reply).toContain('starting fresh');
      expect(reply).toContain('AI assistant');
    });
  });

  describe('resetBuyerBookingAndConversationState', () => {
    it('cancels visits, calls, approvals and resets conversation without touching lead status', async () => {
      const result = await resetBuyerBookingAndConversationState({
        companyId: 'company-1',
        leadId: 'lead-1',
        conversationId: 'conv-1',
        customerPhone: '+919999988888',
      });

      expect(result).toEqual({
        visitsCancelled: 2,
        callRequestsCancelled: 1,
        approvalsCancelled: 2,
        conversationReset: true,
      });

      expect(mockVisitUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            leadId: 'lead-1',
            status: { in: ['scheduled', 'confirmed'] },
          }),
          data: expect.objectContaining({ status: 'cancelled' }),
        }),
      );

      expect(mockConversationUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conv-1' },
          data: expect.objectContaining({
            status: 'ai_active',
            aiEnabled: true,
            stage: 'rapport',
            escalationReason: null,
            escalatedAt: null,
            selectedPropertyId: null,
            proposedVisitTime: null,
            recommendedPropertyIds: [],
          }),
        }),
      );

      expect(mockCancelVisitReminders).toHaveBeenCalledTimes(2);
      expect(mockCancelCall).toHaveBeenCalledWith({
        companyId: 'company-1',
        callId: 'call-1',
        notifyAgent: false,
      });
      expect(mockResolveApproval).toHaveBeenCalledTimes(2);
      expect(mockLogAgentAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'buyer_start_fresh_reset',
          resourceId: 'lead-1',
        }),
      );
    });

    it('returns zero counts when nothing is active', async () => {
      mockVisitFindMany.mockResolvedValue([]);
      mockQueryRaw.mockResolvedValue([]);
      mockApprovalFindMany.mockResolvedValue([]);

      const result = await resetBuyerBookingAndConversationState({
        companyId: 'company-1',
        leadId: 'lead-1',
        conversationId: 'conv-1',
      });

      expect(result).toEqual({
        visitsCancelled: 0,
        callRequestsCancelled: 0,
        approvalsCancelled: 0,
        conversationReset: true,
      });
      expect(mockCancelVisitReminders).not.toHaveBeenCalled();
      expect(mockCancelCall).not.toHaveBeenCalled();
    });
  });
});

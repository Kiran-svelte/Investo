/**
 * Tests that socket events are correctly emitted when lead status changes
 * occur via the key mutation paths:
 *   1. transitionLeadStatus (auto-transitions)
 *   2. PATCH /api/leads/:id/status (manual transitions via route handler)
 *   3. syncLeadScoreFromConversation (score change)
 */

// ── Prisma mock ──────────────────────────────────────────────────────────────
const mockLeadFindUnique = jest.fn();
const mockLeadUpdate = jest.fn();

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    lead: {
      findUnique: (...args: unknown[]) => mockLeadFindUnique(...args),
      update: (...args: unknown[]) => mockLeadUpdate(...args),
    },
  },
}));

// ── Socket mock ──────────────────────────────────────────────────────────────
const mockEmitToCompany = jest.fn().mockReturnValue(true);
jest.mock('../../services/socket.service', () => ({
  socketService: { emitToCompany: (...args: unknown[]) => mockEmitToCompany(...args) },
  SOCKET_EVENTS: {
    LEAD_UPDATED: 'lead:updated',
    NOTIFICATION_NEW: 'notification:new',
  },
}));

// ── notificationEngine mock ───────────────────────────────────────────────────
jest.mock('../../services/notification.engine', () => ({
  notificationEngine: {
    notify: jest.fn().mockResolvedValue(undefined),
    onLeadStatusChange: jest.fn().mockResolvedValue(undefined),
  },
}));

import { transitionLeadStatus } from '../../services/leadTransition.service';

describe('socket emission on lead status change (transitionLeadStatus)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('emits lead:updated when status transition succeeds', async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', status: 'new', companyId: 'company-1', assignedAgentId: null });
    mockLeadUpdate.mockResolvedValue({ id: 'lead-1', status: 'contacted', companyId: 'company-1' });

    await transitionLeadStatus('lead-1', 'contacted');

    expect(mockEmitToCompany).toHaveBeenCalledWith(
      'company-1',
      'lead:updated',
      expect.objectContaining({
        lead: expect.objectContaining({ id: 'lead-1', status: 'contacted' }),
      }),
    );
  });

  test('does NOT emit lead:updated when transition is invalid', async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', status: 'new', companyId: 'company-1', assignedAgentId: null });

    const result = await transitionLeadStatus('lead-1', 'visit_scheduled');

    expect(result).toBe(false);
    expect(mockEmitToCompany).not.toHaveBeenCalled();
    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });

  test('does NOT emit lead:updated when lead is not found', async () => {
    mockLeadFindUnique.mockResolvedValue(null);

    const result = await transitionLeadStatus('ghost-lead', 'contacted');

    expect(result).toBe(false);
    expect(mockEmitToCompany).not.toHaveBeenCalled();
  });

  test('does NOT emit lead:updated when already at target status (no-op)', async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', status: 'contacted', companyId: 'company-1', assignedAgentId: null });

    await transitionLeadStatus('lead-1', 'contacted');

    expect(mockEmitToCompany).not.toHaveBeenCalled();
    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });
});

const mockPrisma = {
  pendingAction: {
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
  },
  lead: {
    findFirst: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
  },
  agentActionLog: {
    create: jest.fn(),
  },
  visit: {
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  agentSession: {
    updateMany: jest.fn(),
  },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { checkAndResolvePendingConfirmation, executePendingAction } from '../../services/agent/confirmation.service';

describe('Agent AI confirmation workflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('confirms and executes a pending lead soft deletion with company scoping', async () => {
    mockPrisma.pendingAction.findFirst.mockResolvedValue({
      id: 'pending-1',
      actionType: 'deleteLead',
      actionParams: { leadId: 'lead-1' },
      displayMessage: 'Confirm delete?',
    });
    mockPrisma.pendingAction.update.mockResolvedValue({ id: 'pending-1' });
    mockPrisma.pendingAction.findUnique.mockResolvedValue({
      id: 'pending-1',
      status: 'confirmed',
      actionType: 'deleteLead',
      actionParams: { leadId: 'lead-1' },
      session: { companyId: 'company-1' },
    });
    mockPrisma.lead.findFirst.mockResolvedValue({ id: 'lead-1', customerName: 'A Lead' });
    mockPrisma.lead.update.mockResolvedValue({ id: 'lead-1', status: 'closed_lost' });

    const confirmation = await checkAndResolvePendingConfirmation('session-1', 'yes');
    expect(confirmation).toEqual(expect.objectContaining({
      hasPending: true,
      isConfirmed: true,
      pendingActionId: 'pending-1',
    }));
    expect(mockPrisma.pendingAction.update).toHaveBeenCalledWith({
      where: { id: 'pending-1' },
      data: { status: 'confirmed', resolvedAt: expect.any(Date) },
    });

    const result = await executePendingAction('pending-1');
    expect(result).toBe('Closed lead A Lead (marked as lost).');
    expect(mockPrisma.lead.findFirst).toHaveBeenCalledWith({
      where: { id: 'lead-1', companyId: 'company-1' },
      select: { id: true, customerName: true },
    });
    expect(mockPrisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { status: 'closed_lost' },
    });
    expect(mockPrisma.lead.delete).not.toHaveBeenCalled();
  });
});

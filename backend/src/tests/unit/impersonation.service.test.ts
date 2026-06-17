/// <reference types="jest" />

const mockPrisma = {
  supportImpersonation: {
    create: jest.fn(),
    updateMany: jest.fn(),
    findFirst: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: { features: { supportOps: true } },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { impersonationService } from '../../supportOps/impersonation.service';

describe('ImpersonationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.supportImpersonation.create.mockResolvedValue({ id: 'imp-1' });
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.supportImpersonation.updateMany.mockResolvedValue({ count: 1 });
  });

  it('requires ticket id', async () => {
    await expect(
      impersonationService.startImpersonation({
        companyId: 'co-1',
        supportUserId: 'support-1',
        targetUserId: 'user-1',
        ticketId: '',
      }),
    ).rejects.toThrow(/ticket_id/);
  });

  it('creates impersonation session and audit log', async () => {
    const session = await impersonationService.startImpersonation({
      companyId: 'co-1',
      supportUserId: 'support-1',
      targetUserId: 'user-1',
      ticketId: 'ZENDESK-123',
    });
    expect(session.id).toBe('imp-1');
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'support_impersonation_start' }),
      }),
    );
  });
});

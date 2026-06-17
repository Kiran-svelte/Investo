/// <reference types="jest" />

const mockPrisma = {
  dataSubjectRequest: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  lead: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  visit: { findMany: jest.fn() },
  auditLog: { findMany: jest.fn() },
  conversation: { findMany: jest.fn() },
  message: { updateMany: jest.fn() },
  legalHold: { count: jest.fn() },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: { features: { dsr: true } },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../compliance/legalHold.service', () => ({
  legalHoldService: {
    isEntityOnHold: jest.fn(),
  },
}));

import { dsrService } from '../../compliance/dsr.service';
import { legalHoldService } from '../../compliance/legalHold.service';

describe('DsrService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.dataSubjectRequest.create.mockResolvedValue({ id: 'dsr-1', requestType: 'export' });
    mockPrisma.dataSubjectRequest.findFirst.mockResolvedValue({
      id: 'dsr-1',
      companyId: 'co-1',
      requestType: 'export',
      subjectPhone: '+911234567890',
    });
    mockPrisma.lead.findMany.mockResolvedValue([{ id: 'lead-1', phone: '+911234567890' }]);
    mockPrisma.visit.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.dataSubjectRequest.update.mockResolvedValue({});
    (legalHoldService.isEntityOnHold as jest.Mock).mockResolvedValue(false);
  });

  it('creates a pending DSR when enabled', async () => {
    const row = await dsrService.createRequest({
      companyId: 'co-1',
      requestType: 'export',
      requestedBy: 'user-1',
      subjectPhone: '+911234567890',
    });
    expect(row.id).toBe('dsr-1');
    expect(mockPrisma.dataSubjectRequest.create).toHaveBeenCalled();
  });

  it('processes export and sets artifact path', async () => {
    const path = await dsrService.processExport('dsr-1', 'co-1');
    expect(path).toContain('dsr-1');
    expect(mockPrisma.dataSubjectRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }),
    );
  });

  it('rejects delete when legal hold is active', async () => {
    mockPrisma.dataSubjectRequest.findFirst.mockResolvedValue({
      id: 'dsr-del',
      companyId: 'co-1',
      requestType: 'delete',
      subjectPhone: '+911234567890',
    });
    mockPrisma.lead.findFirst.mockResolvedValue({ id: 'lead-1' });
    (legalHoldService.isEntityOnHold as jest.Mock).mockResolvedValue(true);

    await expect(dsrService.processDelete('dsr-del', 'co-1')).rejects.toThrow(/Legal hold/);
  });
});

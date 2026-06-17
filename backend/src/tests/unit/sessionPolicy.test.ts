/// <reference types="jest" />

const mockPrisma = {
  refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
  auditLog: { create: jest.fn() },
  scimProvisioningEvent: { create: jest.fn() },
  user: {
    findFirst: jest.fn(),
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

import { deactivateScimUser } from '../../identity/sessionPolicy.service';

describe('sessionPolicy.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('revokes refresh tokens when SCIM deactivates a user', async () => {
    mockPrisma.user.findFirst.mockResolvedValueOnce({
      id: 'user-9',
      companyId: 'company-9',
      externalId: 'scim-9',
    });
    mockPrisma.user.update.mockResolvedValueOnce({ id: 'user-9', status: 'inactive' });

    const result = await deactivateScimUser({
      companyId: 'company-9',
      externalId: 'scim-9',
    });

    expect(result.sessionsRevoked).toBe(3);
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-9', revoked: false },
      data: { revoked: true },
    });
  });
});

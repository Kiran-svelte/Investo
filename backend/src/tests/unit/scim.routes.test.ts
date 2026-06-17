/// <reference types="jest" />

const mockPrisma = {
  user: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
  scimProvisioningEvent: { create: jest.fn() },
  auditLog: { create: jest.fn() },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { ScimService } from '../../identity/scim/scim.service';
import { deactivateScimUser } from '../../identity/sessionPolicy.service';

describe('scim lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deactivates user and revokes sessions', async () => {
    mockPrisma.user.findFirst.mockResolvedValueOnce({
      id: 'user-1',
      companyId: 'company-1',
      externalId: 'scim-123',
    });
    mockPrisma.user.update.mockResolvedValueOnce({
      id: 'user-1',
      status: 'inactive',
    });

    const result = await deactivateScimUser({
      companyId: 'company-1',
      externalId: 'scim-123',
    });

    expect(result.userId).toBe('user-1');
    expect(result.sessionsRevoked).toBe(2);
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revoked: false },
      data: { revoked: true },
    });
  });

  it('creates SCIM users with external ids', async () => {
    mockPrisma.user.findFirst.mockResolvedValueOnce(null);
    mockPrisma.user.create.mockResolvedValueOnce({
      id: 'user-2',
      companyId: 'company-1',
      email: 'new@acme.test',
      name: 'New User',
      externalId: 'scim-999',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = new ScimService();
    const resource = await service.createUser('company-1', {
      userName: 'new@acme.test',
      externalId: 'scim-999',
      active: true,
    });

    expect(resource.emails).toEqual([{ value: 'new@acme.test', primary: true }]);
    expect(resource.active).toBe(true);
  });
});

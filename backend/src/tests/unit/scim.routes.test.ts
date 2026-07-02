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

  it('patches non-UUID external ids without querying the UUID id field', async () => {
    mockPrisma.user.findFirst.mockResolvedValueOnce({
      id: '550e8400-e29b-41d4-a716-446655440000',
      companyId: 'company-1',
      email: 'old@acme.test',
      name: 'SCIM User',
      externalId: 'scim-external-999',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.user.update.mockResolvedValueOnce({
      id: '550e8400-e29b-41d4-a716-446655440000',
      companyId: 'company-1',
      email: 'updated@acme.test',
      name: 'SCIM User',
      externalId: 'scim-external-999',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = new ScimService();
    const resource = await service.patchUser('company-1', 'scim-external-999', {
      Operations: [{ op: 'replace', path: 'userName', value: 'updated@acme.test' }],
    });

    expect(resource.userName).toBe('updated@acme.test');
    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        OR: [{ externalId: 'scim-external-999' }],
      },
    });
  });
});

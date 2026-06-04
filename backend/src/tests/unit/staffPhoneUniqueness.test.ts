import { StaffPhoneInUseError, assertStaffPhoneAvailable } from '../../utils/staffPhoneUniqueness';

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    user: { findFirst: jest.fn() },
  },
}));

import prisma from '../../config/prisma';

describe('staffPhoneUniqueness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null for empty phone', async () => {
    await expect(assertStaffPhoneAvailable('')).resolves.toBeNull();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('normalizes and allows phone when no active user has it', async () => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(assertStaffPhoneAvailable('9876543210')).resolves.toBe('+919876543210');
  });

  it('throws when another active user has the same normalized phone', async () => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'other-user' });
    await expect(assertStaffPhoneAvailable('9876543210')).rejects.toBeInstanceOf(
      StaffPhoneInUseError,
    );
  });

  it('excludes the current user when updating profile', async () => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
    await assertStaffPhoneAvailable('9876543210', 'user-1');
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: 'user-1' },
          status: 'active',
          phone: '+919876543210',
        }),
      }),
    );
  });
});

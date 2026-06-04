import prisma from '../config/prisma';
import { normalizeStaffProfilePhone } from './userProfilePhone';

export class StaffPhoneInUseError extends Error {
  constructor() {
    super(
      'This mobile number is already registered to another active user on Investo. Use a different number or ask an admin to remove the old account.',
    );
    this.name = 'StaffPhoneInUseError';
  }
}

/**
 * Ensures normalized staff phones are not shared by two active users platform-wide.
 * Inactive or deleted users do not block reuse (e.g. agent moves to another company).
 */
export async function assertStaffPhoneAvailable(
  raw: string | null | undefined,
  excludeUserId?: string,
): Promise<string | null> {
  const normalized = normalizeStaffProfilePhone(raw);
  if (!normalized) return null;

  const existing = await prisma.user.findFirst({
    where: {
      phone: normalized,
      status: 'active',
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: { id: true },
  });

  if (existing) {
    throw new StaffPhoneInUseError();
  }

  return normalized;
}

export function isStaffPhoneInUseError(err: unknown): err is StaffPhoneInUseError {
  return err instanceof StaffPhoneInUseError;
}

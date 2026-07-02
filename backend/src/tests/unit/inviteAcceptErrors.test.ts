import { getInviteAcceptErrorCode, mapInviteAcceptError } from '../../utils/inviteAcceptErrors';
import { StaffPhoneInUseError } from '../../utils/staffPhoneUniqueness';

describe('mapInviteAcceptError', () => {
  test('maps known invite states', () => {
    expect(mapInviteAcceptError(new Error('Invalid invite link'))).toEqual({
      status: 404,
      error: 'Invalid invite link',
    });
    expect(mapInviteAcceptError(new Error('Invite has expired'))).toEqual({
      status: 409,
      error: 'Invite has expired',
    });
  });

  test('maps duplicate email variants', () => {
    expect(mapInviteAcceptError(new Error('Email already registered'))).toEqual({
      status: 409,
      error: 'An account with this email already exists',
    });
  });

  test('maps staff phone conflicts', () => {
    const err = new StaffPhoneInUseError();
    expect(mapInviteAcceptError(err).status).toBe(409);
    expect(mapInviteAcceptError(err).error).toContain('mobile number');
  });

  test('maps transaction timeout to retryable provisioning error code', () => {
    const mapped = mapInviteAcceptError(new Error('Transaction already closed: timeout'));

    expect(mapped).toEqual({
      status: 503,
      error: 'Account setup took too long and was safely rolled back. Please try again.',
    });
    expect(getInviteAcceptErrorCode(mapped.error)).toBe('invite_accept_timeout');
  });

  test('maps client-facing invite errors to stable codes', () => {
    expect(getInviteAcceptErrorCode('Invalid invite link')).toBe('invite_not_found');
    expect(getInviteAcceptErrorCode('Invite already accepted')).toBe('invite_already_accepted');
    expect(getInviteAcceptErrorCode('Invite has expired')).toBe('invite_expired');
    expect(getInviteAcceptErrorCode('An account with this email already exists')).toBe('email_already_registered');
    expect(getInviteAcceptErrorCode('This mobile number is already registered to another active user.')).toBe(
      'phone_already_registered',
    );
  });
});

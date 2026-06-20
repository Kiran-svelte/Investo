import { mapInviteAcceptError } from '../../utils/inviteAcceptErrors';
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
});

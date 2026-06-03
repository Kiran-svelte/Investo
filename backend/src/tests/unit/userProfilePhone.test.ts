import {
  isStaffProfilePhoneComplete,
  normalizeStaffProfilePhone,
} from '../../utils/userProfilePhone';

describe('userProfilePhone', () => {
  it('normalizes 10-digit Indian mobile', () => {
    expect(normalizeStaffProfilePhone('9876543210')).toBe('+919876543210');
  });

  it('marks profile complete for valid phone', () => {
    expect(isStaffProfilePhoneComplete('+919876543210')).toBe(true);
    expect(isStaffProfilePhoneComplete(null)).toBe(false);
  });
});

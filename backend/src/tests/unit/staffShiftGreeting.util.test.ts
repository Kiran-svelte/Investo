import {
  isStaffCheckIn,
  isStaffCheckOut,
  STAFF_CHECK_IN_PATTERN,
  STAFF_CHECK_OUT_PATTERN,
} from '../../utils/staffShiftGreeting.util';

describe('staffShiftGreeting.util', () => {
  describe('isStaffCheckIn', () => {
    it.each([
      'check in',
      'CHECK IN',
      'checkin',
      'sign in',
      'start shift',
      'clock in',
      "i'm in",
      'im in',
    ])('detects check-in phrase: %s', (phrase) => {
      expect(isStaffCheckIn(phrase)).toBe(true);
      expect(STAFF_CHECK_IN_PATTERN.test(phrase)).toBe(true);
    });

    it('does not treat generic hello as check-in', () => {
      expect(isStaffCheckIn('hello')).toBe(false);
      expect(isStaffCheckIn('good morning')).toBe(false);
    });
  });

  describe('isStaffCheckOut', () => {
    it.each([
      'check out',
      'CHECK OUT',
      'checkout',
      'sign out',
      'end shift',
      'done for today',
      'clock out',
    ])('detects check-out phrase: %s', (phrase) => {
      expect(isStaffCheckOut(phrase)).toBe(true);
      expect(STAFF_CHECK_OUT_PATTERN.test(phrase)).toBe(true);
    });

    it('does not treat goodbye as check-out', () => {
      expect(isStaffCheckOut('bye')).toBe(false);
      expect(isStaffCheckOut('good evening')).toBe(false);
    });
  });
});

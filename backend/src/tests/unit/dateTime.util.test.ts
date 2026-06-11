import {
  formatISTDateTime,
  formatISTDateTimeLong,
  formatISTShortDate,
  getISTDatePlusDays,
  IST_TIMEZONE,
} from '../../utils/dateTime.util';
import { resolveVisitSlotToDate } from '../../services/visitBooking.service';

describe('dateTime.util', () => {
  /** 10:00 AM IST on 12 Jun 2026 stored as UTC */
  const tenAmIst = new Date('2026-06-12T04:30:00.000Z');

  test('formatISTDateTime shows IST wall time on UTC host', () => {
    const formatted = formatISTDateTime(tenAmIst);
    expect(formatted).toMatch(/10:00\s*am/i);
    expect(formatted).toMatch(/12/i);
    expect(formatted).toMatch(/Jun/i);
  });

  test('formatISTDateTimeLong matches buyer pending-approval copy', () => {
    const formatted = formatISTDateTimeLong(tenAmIst);
    expect(formatted).toMatch(/Friday/i);
    expect(formatted).toMatch(/10:00\s*am/i);
  });

  test('formatISTShortDate uses IST calendar day', () => {
    // 2026-06-11 22:00 UTC = 2026-06-12 03:30 IST
    const lateUtc = new Date('2026-06-11T22:00:00.000Z');
    const istDate = formatISTShortDate(lateUtc);
    expect(istDate).toMatch(/12/i);
    expect(istDate).toMatch(/Jun/i);
  });

  test('getISTDatePlusDays aligns with resolveVisitSlotToDate calendar', () => {
    const anchor = new Date('2026-06-11T10:00:00.000Z').getTime();
    const tomorrowLabel = formatISTShortDate(getISTDatePlusDays(1, anchor));

    jest.useFakeTimers();
    jest.setSystemTime(anchor);
    const resolved = resolveVisitSlotToDate('tomorrow-10am');
    jest.useRealTimers();

    expect(resolved.toISOString()).toBe('2026-06-12T04:30:00.000Z');
    expect(formatISTDateTime(resolved)).toMatch(/10:00\s*am/i);
    expect(tomorrowLabel).toMatch(/12/i);
  });

  test('IST_TIMEZONE constant is Asia/Kolkata', () => {
    expect(IST_TIMEZONE).toBe('Asia/Kolkata');
  });
});

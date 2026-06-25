import {
  getISTDateKey,
  getISTMinutesSinceMidnight,
  isEndOfDayBriefingDue,
  isMorningBriefingDue,
  istDayBounds,
  parseCompanyWorkingHours,
  parseHHMMToMinutes,
} from '../../utils/istCalendar.util';

describe('istCalendar.util', () => {
  describe('parseCompanyWorkingHours', () => {
    it('defaults when missing or invalid', () => {
      expect(parseCompanyWorkingHours(null)).toEqual({ start: '09:00', end: '21:00' });
      expect(parseCompanyWorkingHours({ start: 'bad', end: '25:99' })).toEqual({
        start: '09:00',
        end: '21:00',
      });
    });

    it('accepts valid HH:MM values', () => {
      expect(parseCompanyWorkingHours({ start: '08:30', end: '20:00' })).toEqual({
        start: '08:30',
        end: '20:00',
      });
    });
  });

  describe('parseHHMMToMinutes', () => {
    it('parses wall-clock minutes', () => {
      expect(parseHHMMToMinutes('09:00')).toBe(540);
      expect(parseHHMMToMinutes('21:00')).toBe(1260);
      expect(parseHHMMToMinutes('invalid')).toBeNull();
    });
  });

  describe('istDayBounds', () => {
    it('covers the full IST calendar day in UTC', () => {
      const at = new Date('2026-06-23T10:00:00+05:30');
      const [start, end] = istDayBounds(at);
      expect(getISTDateKey(start)).toBe('2026-06-23');
      expect(getISTDateKey(end)).toBe('2026-06-23');
      expect(start.getTime()).toBeLessThan(at.getTime());
      expect(end.getTime()).toBeGreaterThan(at.getTime());
    });

    it('handles IST date rollover near UTC midnight', () => {
      const lateIst = new Date('2026-06-22T23:30:00+05:30');
      expect(getISTDateKey(lateIst)).toBe('2026-06-22');
      const [start] = istDayBounds(lateIst);
      expect(getISTDateKey(start)).toBe('2026-06-22');
    });
  });

  describe('shift briefing windows', () => {
    const hours = { start: '09:00', end: '21:00' };

    it('morning briefing due within 90 minutes after shift start', () => {
      const atStart = new Date('2026-06-23T09:15:00+05:30');
      const atLate = new Date('2026-06-23T10:29:00+05:30');
      const afterWindow = new Date('2026-06-23T10:31:00+05:30');
      expect(isMorningBriefingDue(hours, atStart)).toBe(true);
      expect(isMorningBriefingDue(hours, atLate)).toBe(true);
      expect(isMorningBriefingDue(hours, afterWindow)).toBe(false);
    });

    it('EOD briefing due from 15 min before shift end', () => {
      const beforeEnd = new Date('2026-06-23T20:50:00+05:30');
      const atEnd = new Date('2026-06-23T21:10:00+05:30');
      const tooEarly = new Date('2026-06-23T20:00:00+05:30');
      expect(isEndOfDayBriefingDue(hours, beforeEnd)).toBe(true);
      expect(isEndOfDayBriefingDue(hours, atEnd)).toBe(true);
      expect(isEndOfDayBriefingDue(hours, tooEarly)).toBe(false);
    });

    it('respects per-company custom hours', () => {
      const custom = { start: '10:00', end: '19:00' };
      const nineAm = new Date('2026-06-23T09:30:00+05:30');
      const tenAm = new Date('2026-06-23T10:15:00+05:30');
      expect(isMorningBriefingDue(custom, nineAm)).toBe(false);
      expect(isMorningBriefingDue(custom, tenAm)).toBe(true);
      expect(getISTMinutesSinceMidnight(tenAm)).toBe(615);
    });
  });
});

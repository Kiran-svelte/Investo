import {
  extractDateTimeIso,
  parseDateTimeFromNaturalLanguage,
} from '../../utils/parseDateTimeFromMessage.util';

describe('parseDateTimeFromMessage.util', () => {
  test('parses "call me at 6pm" as 6pm IST same day when before 6pm', () => {
    const ref = new Date('2026-06-07T11:30:00.000Z'); // ~5pm IST
    const parsed = parseDateTimeFromNaturalLanguage('Call me at 6pm', ref);
    expect(parsed).not.toBeNull();
    const istHour = Number(
      parsed!.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }),
    );
    expect(istHour).toBe(18);
  });

  test('parses "tomorrow 3pm" via chrono or visit fallback', () => {
    const ref = new Date('2026-06-07T10:00:00.000Z');
    const parsed = parseDateTimeFromNaturalLanguage('tomorrow 3pm', ref);
    expect(parsed).not.toBeNull();
    expect(parsed!.getTime()).toBeGreaterThan(ref.getTime());
  });

  test('"Tomorrow at 1pm" books tomorrow IST, never today, even when today 1pm is still ahead', () => {
    // 06:39 UTC = 12:09 IST — today 1pm IST is still in the future, but "tomorrow" must win.
    const ref = new Date('2026-07-02T06:39:00.000Z');
    const parsed = parseDateTimeFromNaturalLanguage('Tomorrow at 1pm', ref);
    expect(parsed).not.toBeNull();
    const istDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
    }).format(parsed!);
    expect(istDay).toBe('03');
    const istHour = Number(
      parsed!.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }),
    );
    expect(istHour).toBe(13);
  });

  test('"Friday 10am" resolves to the upcoming Friday in IST', () => {
    const ref = new Date('2026-07-02T06:39:00.000Z'); // Thursday
    const parsed = parseDateTimeFromNaturalLanguage('Friday 10am', ref);
    expect(parsed).not.toBeNull();
    const istWeekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
    }).format(parsed!);
    expect(istWeekday).toBe('Fri');
    const istHour = Number(
      parsed!.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }),
    );
    expect(istHour).toBe(10);
  });

  test('extractDateTimeIso returns ISO without milliseconds', () => {
    const iso = extractDateTimeIso('call me at 6pm', new Date('2026-06-07T11:30:00.000Z'));
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

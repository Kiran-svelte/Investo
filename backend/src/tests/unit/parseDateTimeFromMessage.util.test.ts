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

  test('extractDateTimeIso returns ISO without milliseconds', () => {
    const iso = extractDateTimeIso('call me at 6pm', new Date('2026-06-07T11:30:00.000Z'));
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

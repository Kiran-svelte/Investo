import {
  isCallBookingIntent,
  isCallCancelIntent,
  isCallRescheduleIntent,
  isCallStatusQuery,
  isBareSchedulingTimeReply,
  resolveCallScheduledAt,
} from '../../utils/callIntentFromMessage.util';

describe('callIntentFromMessage.util', () => {
  test('detects booking intents', () => {
    expect(isCallBookingIntent('I need to talk to a human')).toBe(true);
    expect(isCallBookingIntent('Please call me back tomorrow 3pm')).toBe(true);
    expect(isCallBookingIntent('call me')).toBe(true);
  });

  test('does not treat cancel/reschedule/status as booking', () => {
    expect(isCallBookingIntent('cancel my call')).toBe(false);
    expect(isCallBookingIntent('reschedule my callback to Friday')).toBe(false);
    expect(isCallBookingIntent('when is my call?')).toBe(false);
    expect(isCallBookingIntent('call me at 6pm')).toBe(true);
  });

  test('detects cancel, reschedule, and status', () => {
    expect(isCallCancelIntent('cancel my scheduled call')).toBe(true);
    expect(isCallRescheduleIntent('reschedule my call to tomorrow')).toBe(true);
    expect(isCallStatusQuery('when is my call time?')).toBe(true);
  });

  test('resolveCallScheduledAt defaults to ~15 minutes ahead', () => {
    const ref = new Date('2026-06-07T10:00:00.000Z');
    const at = resolveCallScheduledAt('call me', ref);
    expect(at.getTime()).toBe(ref.getTime() + 15 * 60 * 1000);
  });

  test('isBareSchedulingTimeReply detects time-only answers', () => {
    expect(isBareSchedulingTimeReply('9 pm today ?')).toBe(true);
    expect(isBareSchedulingTimeReply('book visit tomorrow 3pm')).toBe(false);
    expect(isBareSchedulingTimeReply('call me at 6pm')).toBe(false);
  });
});

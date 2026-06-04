import {
  isVisitCancelOrRescheduleMessage,
  isVisitListQueryMessage,
  isVisitSchedulingMessage,
  parseRescheduleTargetFromMessage,
  parseVisitDateTimeFromMessage,
  parseVisitDateTimeFromHistory,
} from '../../services/visitIntentFromMessage.service';

describe('visitIntentFromMessage.service', () => {
  const friday = new Date('2026-06-05T18:00:00+05:30');

  it('detects visit scheduling phrases', () => {
    expect(isVisitSchedulingMessage('This Saturday 12 pm okay ??')).toBe(true);
    expect(isVisitSchedulingMessage('hello')).toBe(false);
  });

  it('parses Saturday 12 pm from message', () => {
    const parsed = parseVisitDateTimeFromMessage('This Saturday 12 pm okay ??', friday);
    expect(parsed).not.toBeNull();
    expect(parsed!.getDay()).toBe(6);
    expect(parsed!.getHours()).toBe(12);
  });

  it('treats "visits on 6th june" as list query, not mutation', () => {
    expect(isVisitListQueryMessage('Visits on 6th june')).toBe(true);
    expect(isVisitCancelOrRescheduleMessage('Visits on 6th june')).toBe(false);
  });

  it('detects cancel and reschedule intent', () => {
    const msg =
      'Cancel my site visit which is on tomorrow and reschedule it to this saturday 1pm';
    expect(isVisitCancelOrRescheduleMessage(msg)).toBe(true);
    expect(isVisitSchedulingMessage(msg)).toBe(false);
  });

  it('parses Saturday 1pm from reschedule tail, not tomorrow', () => {
    const parsed = parseRescheduleTargetFromMessage(
      'Cancel my site visit which is on tomorrow and reschedule it to this saturday 1pm',
      friday,
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.getDay()).toBe(6);
    expect(parsed!.getHours()).toBe(13);
  });

  it('detects prepone site visit as reschedule intent', () => {
    const msg = 'Pre pone site visit to tomorrow at 1pm';
    expect(isVisitCancelOrRescheduleMessage(msg)).toBe(true);
    expect(isVisitSchedulingMessage(msg)).toBe(false);
  });

  it('parses tomorrow 1pm from prepone message', () => {
    const thursday = new Date('2026-06-04T18:00:00+05:30');
    const parsed = parseRescheduleTargetFromMessage('Pre pone site visit to tomorrow at 1pm', thursday);
    expect(parsed).not.toBeNull();
    expect(parsed!.getDate()).toBe(5);
    expect(parsed!.getHours()).toBe(13);
  });

  it('parses slot from recent history when user replies yes', () => {
    const parsed = parseVisitDateTimeFromHistory(
      ['This Saturday 12 pm okay ??', 'Yes'],
      friday,
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.getHours()).toBe(12);
  });
});

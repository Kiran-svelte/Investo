import {
  isVisitCancelOrRescheduleMessage,
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

  it('detects cancel and reschedule intent', () => {
    expect(
      isVisitCancelOrRescheduleMessage(
        'Cancel my site visit which is on tomorrow and reschedule it to this saturday 1pm',
      ),
    ).toBe(true);
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

  it('parses slot from recent history when user replies yes', () => {
    const parsed = parseVisitDateTimeFromHistory(
      ['This Saturday 12 pm okay ??', 'Yes'],
      friday,
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.getHours()).toBe(12);
  });
});

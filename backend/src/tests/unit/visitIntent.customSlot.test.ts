import {
  isVisitSchedulingMessage,
  parseCustomVisitSlotFromMessage,
  isCustomVisitSlotMessage,
} from '../../services/visitIntentFromMessage.service';

describe('visitIntentFromMessage custom slot parsing', () => {
  it('treats visit_booking stage + weekday + time as scheduling intent', () => {
    const msg = 'New day is on Wednesday 3pm';
    expect(
      isVisitSchedulingMessage(msg, { visitBookingStage: true }),
    ).toBe(true);
    expect(parseCustomVisitSlotFromMessage(msg)).toBeInstanceOf(Date);
    expect(isCustomVisitSlotMessage(msg, { visitBookingStage: true })).toBe(true);
  });

  it('parses Wednesday 3pm without explicit visit keyword in visit_booking stage', () => {
    const parsed = parseCustomVisitSlotFromMessage('Wednesday 3pm');
    expect(parsed).toBeInstanceOf(Date);
    expect(isCustomVisitSlotMessage('Wednesday 3pm', { visitBookingStage: true })).toBe(true);
  });
});

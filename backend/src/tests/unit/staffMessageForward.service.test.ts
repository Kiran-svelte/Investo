import { parseStaffForwardCommand } from '../../services/staffMessageForward.service';

describe('staffMessageForward.service', () => {
  test('parseStaffForwardCommand extracts message and phones', () => {
    const parsed = parseStaffForwardCommand('send "Hi everyone" to 9036165603,919876543210');
    expect(parsed?.body).toBe('Hi everyone');
    expect(parsed?.phones).toHaveLength(2);
    expect(parsed?.phones[0]).toMatch(/9036165603/);
    expect(parsed?.phones[1]).toMatch(/9876543210/);
  });

  test('parseStaffForwardCommand supports single quotes', () => {
    const parsed = parseStaffForwardCommand("send 'Team standup at 4pm' to +919036165603");
    expect(parsed?.body).toBe('Team standup at 4pm');
    expect(parsed?.phones).toHaveLength(1);
    expect(parsed?.phones[0]).toMatch(/9036165603/);
  });

  test('returns null for invalid commands', () => {
    expect(parseStaffForwardCommand('forward hi to 9036165603')).toBeNull();
    expect(parseStaffForwardCommand('send "hi"')).toBeNull();
  });
});

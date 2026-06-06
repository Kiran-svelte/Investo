import { guardBookingClaims } from '../../services/whatsapp/mutationLanguageGuard.service';

describe('mutationLanguageGuard.service', () => {
  it('replaces booking claims when no mutation succeeded', () => {
    const result = guardBookingClaims('Your visit is booked for tomorrow at 4pm!', {});
    expect(result).not.toMatch(/booked/i);
    expect(result).toContain('which project');
  });

  it('allows booking claims when visitCommitted', () => {
    const original = 'Your visit is booked for tomorrow at 4pm!';
    expect(guardBookingClaims(original, { visitCommitted: true })).toBe(original);
  });

  it('allows booking claims when workflowSuccess', () => {
    const original = 'Visit confirmed for Saturday.';
    expect(guardBookingClaims(original, { workflowSuccess: true })).toBe(original);
  });

  it('passes through neutral text unchanged', () => {
    const original = 'Lake Vista has 3BHK options from 1.2Cr.';
    expect(guardBookingClaims(original, {})).toBe(original);
  });
});

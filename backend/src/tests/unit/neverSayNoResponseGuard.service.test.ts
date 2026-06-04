import { enforceNeverSayNoResponse } from '../../services/neverSayNoResponseGuard.service';

describe('neverSayNoResponseGuard.service', () => {
  it('does not append visit CTA when visit time is already confirmed', () => {
    const text =
      "Great choice with the Palmvilla Brochure! I've noted your preference for a site visit this Saturday at 12 PM. " +
      'Our agent will give you a call an hour before the visit to confirm everything.';
    const result = enforceNeverSayNoResponse({
      text,
      hasInventoryAlternatives: true,
      fallbackCta: 'Would you like to book a site visit for your top pick this week?',
    });
    expect(result.text).not.toContain('Would you like to book a site visit');
    expect(result.guardApplied).toBe(false);
  });

  it('still appends CTA for dead-end replies without visit context', () => {
    const result = enforceNeverSayNoResponse({
      text: 'Here are some options for you.',
      hasInventoryAlternatives: true,
      fallbackCta: 'Would you like to book a site visit for your top pick this week?',
    });
    expect(result.text).toContain('Would you like to book a site visit');
    expect(result.guardApplied).toBe(true);
  });

  it('respects skipFallbackCta flag', () => {
    const result = enforceNeverSayNoResponse({
      text: 'Thanks for sharing your budget.',
      hasInventoryAlternatives: true,
      fallbackCta: 'Would you like to book a site visit for your top pick this week?',
      skipFallbackCta: true,
    });
    expect(result.text).not.toContain('Would you like to book a site visit');
  });
});

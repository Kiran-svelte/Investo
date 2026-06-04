import { isWrongReportMessage } from '../../services/wrongReport.service';
import {
  appendTransparencyFooter,
  buildTransparencyFooter,
  stripInternalCustomerMeta,
} from '../../services/aiTransparency.service';

describe('aiTransparency.service', () => {
  it('builds footer with confidence and WRONG hint', () => {
    const footer = buildTransparencyFooter({
      confidence: 'medium',
      sources: ['Project A', 'Project B'],
      priceUpdatedAt: new Date('2026-06-01T10:00:00Z'),
    });
    expect(footer).toContain('Confidence: Medium');
    expect(footer).toContain('Reply WRONG');
  });

  it('does not duplicate footer', () => {
    const text = 'Hello\n\n—\nReply WRONG if any info is incorrect.';
    expect(appendTransparencyFooter(text, '\nfooter')).toBe(text);
  });

  it('strips internal meta footer from customer messages', () => {
    const raw =
      'Great choice with Palmvilla!\n\n' +
      '—\nConfidence: High\nSources: Palmvilla Brochure\nPrice last updated: 3 Jun 2026, 11:57 pm IST\n' +
      'Note: Some details need agent verification.\nReply WRONG if any info is incorrect.';
    const cleaned = stripInternalCustomerMeta(raw);
    expect(cleaned).toContain('Great choice with Palmvilla!');
    expect(cleaned).not.toContain('Confidence:');
    expect(cleaned).not.toContain('Reply WRONG');
    expect(cleaned).not.toContain('Sources:');
  });
});

describe('wrongReport.service', () => {
  it('detects WRONG replies', () => {
    expect(isWrongReportMessage('WRONG')).toBe(true);
    expect(isWrongReportMessage('wrong')).toBe(true);
    expect(isWrongReportMessage('thanks')).toBe(false);
  });
});

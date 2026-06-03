import { isWrongReportMessage } from '../../services/wrongReport.service';
import {
  appendTransparencyFooter,
  buildTransparencyFooter,
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
});

describe('wrongReport.service', () => {
  it('detects WRONG replies', () => {
    expect(isWrongReportMessage('WRONG')).toBe(true);
    expect(isWrongReportMessage('wrong')).toBe(true);
    expect(isWrongReportMessage('thanks')).toBe(false);
  });
});

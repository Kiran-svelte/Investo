import {
  selectPropertiesForBrochureDelivery,
  stripBrochureLinksFromText,
} from '../../services/brochureDelivery.service';

describe('brochureDelivery.service', () => {
  const properties = [
    { id: '1', name: 'Palmvilla Brochure', brochureUrl: 'aws://investo/companies/x/properties/y/brochure/palm.pdf' },
    { id: '2', name: 'Lake Vista', brochureUrl: null },
  ];

  test('stripBrochureLinksFromText removes markdown and S3 pdf links', () => {
    const raw =
      "Sure! [View Palmvilla Brochure](https://bucket.s3.eu-north-1.amazonaws.com/investo/companies/x/brochure/palm.pdf)\n" +
      'Also see https://evil.com/other.pdf';
    const cleaned = stripBrochureLinksFromText(raw);
    expect(cleaned).not.toContain('amazonaws.com');
    expect(cleaned).not.toContain('[View');
    expect(cleaned).toContain('https://evil.com/other.pdf');
  });

  test('selectPropertiesForBrochureDelivery matches named project on brochure request', () => {
    const selected = selectPropertiesForBrochureDelivery({
      customerMessage: 'Send me brochure of palm villa',
      aiText: 'Here is Palmvilla for you.',
      properties,
    });
    expect(selected).toHaveLength(1);
    expect(selected[0].name).toBe('Palmvilla Brochure');
  });

  test('selectPropertiesForBrochureDelivery returns empty without intent', () => {
    const selected = selectPropertiesForBrochureDelivery({
      customerMessage: 'What is the price?',
      aiText: 'Lake Vista starts at 50L',
      properties,
    });
    expect(selected).toHaveLength(0);
  });
});

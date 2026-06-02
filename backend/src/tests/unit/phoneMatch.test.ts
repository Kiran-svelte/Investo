/// <reference types="jest" />

import {
  normalizeInboundWhatsAppPhone,
  phonesMatchLast10,
} from '../../utils/phoneMatch';

describe('phoneMatch', () => {
  it('normalizes Indian numbers to E.164', () => {
    expect(normalizeInboundWhatsAppPhone('9876543210')).toBe('+919876543210');
    expect(normalizeInboundWhatsAppPhone('919876543210')).toBe('+919876543210');
    expect(normalizeInboundWhatsAppPhone('+919876543210')).toBe('+919876543210');
  });

  it('matches numbers with different formatting', () => {
    expect(phonesMatchLast10('+919876543210', '9876543210')).toBe(true);
    expect(phonesMatchLast10('+919876543210', '+919876543211')).toBe(false);
  });
});

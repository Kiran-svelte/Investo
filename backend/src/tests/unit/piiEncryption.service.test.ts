/// <reference types="jest" />

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    jwt: { secret: 'test-jwt-secret-for-pii' },
    features: { piiEncryption: true },
  },
}));

import { blindIndex, decryptField, encryptField, maskPhone } from '../../services/piiEncryption.service';

describe('piiEncryption.service', () => {
  it('round-trips encrypt/decrypt', () => {
    const plain = '+919876543210';
    const encrypted = encryptField(plain);
    expect(encrypted).not.toEqual(plain);
    expect(decryptField(encrypted)).toBe(plain);
  });

  it('creates stable blind indexes', () => {
    expect(blindIndex('User@Example.COM')).toBe(blindIndex('user@example.com'));
  });

  it('masks phone numbers for display', () => {
    expect(maskPhone('+919876543210')).toBe('********3210');
  });
});

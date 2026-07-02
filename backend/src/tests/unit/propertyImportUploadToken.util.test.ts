/// <reference types="jest" />

import {
  buildPropertyImportUploadExpiry,
  signPropertyImportUploadToken,
  verifyPropertyImportUploadToken,
  parseSignedUploadQuery,
} from '../../utils/propertyImportUploadToken.util';

describe('propertyImportUploadToken.util', () => {
  it('signs and verifies upload tokens for the same company', () => {
    const uploadToken = 'upload-abc';
    const companyId = 'company-1';
    const expiresAtMs = buildPropertyImportUploadExpiry(new Date());

    const sig = signPropertyImportUploadToken(uploadToken, companyId, expiresAtMs);

    expect(verifyPropertyImportUploadToken(uploadToken, companyId, expiresAtMs, sig)).toBe(true);
  });

  it('rejects tokens for a different company', () => {
    const uploadToken = 'upload-abc';
    const expiresAtMs = buildPropertyImportUploadExpiry(new Date());
    const sig = signPropertyImportUploadToken(uploadToken, 'company-a', expiresAtMs);

    expect(verifyPropertyImportUploadToken(uploadToken, 'company-b', expiresAtMs, sig)).toBe(false);
  });

  it('rejects expired tokens', () => {
    const uploadToken = 'upload-abc';
    const companyId = 'company-1';
    const expiresAtMs = Date.now() - 1000;
    const sig = signPropertyImportUploadToken(uploadToken, companyId, expiresAtMs);

    expect(verifyPropertyImportUploadToken(uploadToken, companyId, expiresAtMs, sig)).toBe(false);
  });

  it('parses signed upload query params', () => {
    expect(parseSignedUploadQuery({ exp: '12345', sig: 'abc' })).toEqual({
      expiresAtMs: 12345,
      signature: 'abc',
    });
  });
});

import {
  extractAwsObjectKeyFromReference,
  extractR2ObjectKeyFromReference,
  parseR2StorageKey,
} from '../../services/storageTargets';

describe('storageTargets object key extraction', () => {
  const imagePath =
    'investo/companies/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/properties/bbbbbbbb-cccc-dddd-eeee-ffffffffffff/image/1710000000000-uuid-photo.jpg';
  const brochurePath =
    'investo/companies/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/properties/bbbbbbbb-cccc-dddd-eeee-ffffffffffff/brochure/1710000000000-uuid-brochure.pdf';

  it('extracts full S3 image object key from HTTPS URL path', () => {
    const url = `https://biginvesto.s3.eu-north-1.amazonaws.com/${imagePath}`;
    expect(extractAwsObjectKeyFromReference(url)).toBe(imagePath);
  });

  it('extracts full image key from CDN path fragment', () => {
    const cdn = `https://cdn.biginvesto.online/${imagePath}`;
    expect(extractAwsObjectKeyFromReference(cdn)).toBe(imagePath);
  });

  it('extracts brochure subpath from storage reference', () => {
    expect(extractAwsObjectKeyFromReference(brochurePath)).toBe(brochurePath);
  });

  it('does not treat HTTPS URLs as raw R2 keys', () => {
    expect(parseR2StorageKey('https://cdn.example.com/hero.jpg')).toBeNull();
  });

  it('extracts R2 image key from r2:// prefix', () => {
    expect(extractR2ObjectKeyFromReference(`r2://${imagePath}`)).toBe(imagePath);
  });
});

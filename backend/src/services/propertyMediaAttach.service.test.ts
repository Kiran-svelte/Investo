import {
  assertMediaRoleForMime,
  inferDefaultMediaRole,
  isPropertyMediaMime,
  PropertyMediaAttachError,
} from '../services/propertyMediaAttach.service';

describe('propertyMediaAttach.service helpers', () => {
  it('detects property media mime types', () => {
    expect(isPropertyMediaMime('image/jpeg')).toBe(true);
    expect(isPropertyMediaMime('image/png')).toBe(true);
    expect(isPropertyMediaMime('application/pdf')).toBe(true);
    expect(isPropertyMediaMime('text/csv')).toBe(false);
  });

  it('infers brochure for PDF and screenshot for images', () => {
    expect(inferDefaultMediaRole('application/pdf')).toBe('brochure');
    expect(inferDefaultMediaRole('image/png')).toBe('screenshot');
  });

  it('validates media role against mime type', () => {
    expect(() => assertMediaRoleForMime('brochure', 'image/png')).toThrow(PropertyMediaAttachError);
    expect(() => assertMediaRoleForMime('screenshot', 'application/pdf')).toThrow(
      PropertyMediaAttachError,
    );
    expect(() => assertMediaRoleForMime('screenshot', 'image/jpeg')).not.toThrow();
    expect(() => assertMediaRoleForMime('brochure', 'application/pdf')).not.toThrow();
  });
});

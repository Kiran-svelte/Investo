import { describe, expect, it } from 'vitest';
import { getPublishReadiness } from './propertyImportPublishReadiness';
import { PROPERTY_IMPORT_DEFAULT_FORM_VALUES } from './propertyImport.utils';

describe('getPublishReadiness', () => {
  it('blocks publish when property type is missing', () => {
    const result = getPublishReadiness({
      formValues: {
        ...PROPERTY_IMPORT_DEFAULT_FORM_VALUES,
        name: 'Palmvilla',
        property_type: '',
      },
      draft: {
        id: 'd1',
        status: 'review_ready',
        extractionStatus: 'extracted',
        mediaAssets: [{ id: 'm1' }],
      } as any,
      isUploading: false,
      activeUploadCount: 0,
    });

    expect(result.ready).toBe(false);
    expect(result.blockers.some((b) => b.includes('property type'))).toBe(true);
  });

  it('is ready when type, name, media, and extraction are satisfied', () => {
    const result = getPublishReadiness({
      formValues: {
        ...PROPERTY_IMPORT_DEFAULT_FORM_VALUES,
        name: 'Towers',
        property_type: 'apartment',
      },
      draft: {
        id: 'd1',
        status: 'review_ready',
        extractionStatus: 'extracted',
        mediaAssets: [{ id: 'm1' }],
      } as any,
      isUploading: false,
      activeUploadCount: 0,
    });

    expect(result.ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });
});

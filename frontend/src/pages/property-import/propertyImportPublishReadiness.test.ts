import { describe, expect, it } from 'vitest';
import { getPublishReadiness } from './propertyImportPublishReadiness';
import { PROPERTY_IMPORT_DEFAULT_FORM_VALUES } from './propertyImport.utils';

describe('getPublishReadiness', () => {
  it('blocks publish when property type is missing', () => {
    const result = getPublishReadiness({
      formValues: {
        ...PROPERTY_IMPORT_DEFAULT_FORM_VALUES,
        name: 'Palmvilla',
        price_min: '8500000',
        price_max: '12500000',
        property_type: '',
      },
      draft: {
        id: 'd1',
        status: 'review_ready',
        extractionStatus: 'extracted',
      } as any,
      isUploading: false,
      activeUploadCount: 0,
    });

    expect(result.ready).toBe(false);
    expect(result.blockers.some((b) => b.includes('Property type'))).toBe(true);
  });
});

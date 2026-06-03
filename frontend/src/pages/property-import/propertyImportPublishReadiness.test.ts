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
    expect(result.blockers.some((b) => b.includes('property type'))).toBe(true);
  });

  it('blocks apartment publish without unit rows or single-unit bedrooms', () => {
    const result = getPublishReadiness({
      formValues: {
        ...PROPERTY_IMPORT_DEFAULT_FORM_VALUES,
        name: 'Towers',
        property_type: 'apartment',
        price_min: '8500000',
        price_max: '12500000',
        unit_configurations: [{ bhk: '2', unit_label: '', count: '', price_min: '', price_max: '' }],
        single_unit_mode: false,
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
    expect(result.blockers.some((b) => b.includes('unit type row'))).toBe(true);
  });
});

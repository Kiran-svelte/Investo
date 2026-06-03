import { describe, expect, it } from 'vitest';
import {
  getKnowledgeFieldsForType,
  isTypeKnowledgeFieldFilled,
} from './propertyTypeKnowledgeSchema';
import { PROPERTY_IMPORT_DEFAULT_FORM_VALUES } from './propertyImport.utils';

describe('propertyTypeKnowledgeSchema', () => {
  it('returns apartment field set', () => {
    const fields = getKnowledgeFieldsForType('apartment');
    expect(fields.map((f) => f.key)).toContain('carpet_area_sqft');
    expect(fields.map((f) => f.key)).toContain('bhk');
  });

  it('detects filled bhk from form bedrooms', () => {
    const field = getKnowledgeFieldsForType('apartment').find((f) => f.key === 'bhk')!;
    expect(
      isTypeKnowledgeFieldFilled(
        field,
        { ...PROPERTY_IMPORT_DEFAULT_FORM_VALUES, bedrooms: '3' },
        null,
      ),
    ).toBe(true);
  });
});

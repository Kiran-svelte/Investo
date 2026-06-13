import config from '../../config';
import {
  extractExtendedPropertyAttributes,
  formatExtendedAttributesForPrompt,
} from '../../utils/extractExtendedPropertyAttributes.util';

describe('extractExtendedPropertyAttributes.util', () => {
  const originalFlag = config.features.extendedPropertyAttrs;

  afterEach(() => {
    config.features.extendedPropertyAttrs = originalFlag;
  });

  test('extracts non-catalog import fields', () => {
    const attrs = extractExtendedPropertyAttributes({
      name: 'Lake Vista',
      builder: 'Horizon',
      carpet_area_sqft: 1450,
      possession_date: 'Dec 2027',
      facing: 'East',
      maintenance_monthly: 4500,
    });
    expect(attrs.carpet_area_sqft).toBe(1450);
    expect(attrs.possession_date).toBe('Dec 2027');
    expect(attrs.facing).toBe('East');
    expect(attrs.name).toBeUndefined();
    expect(attrs.builder).toBeUndefined();
  });

  test('formatExtendedAttributesForPrompt uses human labels', () => {
    const text = formatExtendedAttributesForPrompt({
      carpet_area_sqft: 1200,
      facing: 'North',
    });
    expect(text).toContain('Carpet area (sq ft): 1200');
    expect(text).toContain('Facing direction: North');
  });
});

import { describe, expect, it } from 'vitest';
import { assessProjectKnowledgeGaps } from './assessProjectKnowledgeGaps';
import { PROPERTY_IMPORT_DEFAULT_FORM_VALUES } from './propertyImport.utils';

describe('assessProjectKnowledgeGaps', () => {
  it('returns no questions when brochure data is sufficient', () => {
    const gaps = assessProjectKnowledgeGaps(
      {
        ...PROPERTY_IMPORT_DEFAULT_FORM_VALUES,
        name: 'Skyline',
        property_type: 'apartment',
        price_min: '8500000',
        price_max: '12500000',
        location_city: 'Bengaluru',
        location_area: 'Whitefield',
        builder: 'Acme',
        description: 'A'.repeat(90),
        amenities: 'Pool, Gym',
      },
      {
        unit_configurations: [{ bhk: 2, count: 40, unit_label: null, price_min: null, price_max: null }],
        ai_marketing_answers: {
          target_buyer: 'Families',
          possession_timeline: 'Ready to move',
          payment_plan: 'EMI',
          key_selling_point: 'Location',
          amenities_focus: 'Pool',
        },
      },
    );

    expect(gaps).toHaveLength(0);
  });

  it('asks property type when missing', () => {
    const gaps = assessProjectKnowledgeGaps(
      {
        ...PROPERTY_IMPORT_DEFAULT_FORM_VALUES,
        name: 'Villa Park',
        property_type: '',
        price_min: '1',
        price_max: '2',
      },
      null,
    );

    expect(gaps.map((g) => g.id)).toContain('property_type');
  });

  it('asks villa unit mix when inventory missing', () => {
    const gaps = assessProjectKnowledgeGaps(
      {
        ...PROPERTY_IMPORT_DEFAULT_FORM_VALUES,
        name: 'Villa Park',
        property_type: 'villa',
        price_min: '1',
        price_max: '2',
      },
      null,
    );

    expect(gaps.some((g) => g.id === 'villa_unit_mix' || g.id === 'unit_mix')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { assessProjectKnowledgeGaps } from './assessProjectKnowledgeGaps';
import { PROPERTY_IMPORT_DEFAULT_FORM_VALUES } from './propertyImport.utils';

describe('assessProjectKnowledgeGaps', () => {
  it('returns only missing apartment fields', () => {
    const gaps = assessProjectKnowledgeGaps(
      {
        ...PROPERTY_IMPORT_DEFAULT_FORM_VALUES,
        property_type: 'apartment',
        bedrooms: '3',
        price_min: '8500000',
        price_max: '12500000',
        amenities: 'Pool, Gym',
        description: 'East facing 3 BHK with possession Dec 2027 and clubhouse pool parking security',
      },
      {
        type_knowledge: {
          carpet_area_sqft: '1200–1600 sq ft',
          floor_number: 'High rise',
          tower_name: 'Tower A',
          maintenance_fee: '₹3–5/sqft',
          facing: 'East',
          parking: '2 covered',
          anything_else: 'Nothing else',
        },
      },
    );

    expect(gaps.map((g) => g.typeKnowledgeKey)).not.toContain('bhk');
    expect(gaps.map((g) => g.typeKnowledgeKey)).not.toContain('amenities');
    expect(gaps.length).toBeLessThan(5);
  });

  it('always ends with anything_else when not answered', () => {
    const gaps = assessProjectKnowledgeGaps(
      {
        ...PROPERTY_IMPORT_DEFAULT_FORM_VALUES,
        property_type: 'plot',
        name: 'Green Acres',
        description: 'DTCP approved gated corner plot 40x60 east facing',
      },
      {
        type_knowledge: {
          plot_area_sqft: '40×60',
          price_per_cent: '₹20 L/cent',
          is_gated: 'Fully gated',
          approvals: 'DTCP approved',
          facing: 'East',
          is_corner_plot: 'Yes',
          road_width_ft: '40 ft',
          construction_allowed: 'Individual villa',
          plot_dimensions: '40×60',
          legal_status: 'Clear title',
        },
      },
    );

    expect(gaps.some((g) => g.typeKnowledgeKey === 'anything_else')).toBe(true);
  });

  it('asks villa fields when brochure did not fill them', () => {
    const gaps = assessProjectKnowledgeGaps(
      {
        ...PROPERTY_IMPORT_DEFAULT_FORM_VALUES,
        property_type: 'villa',
        name: 'Palm Grove',
      },
      null,
    );

    expect(gaps.length).toBeGreaterThan(3);
    expect(gaps.some((g) => g.typeKnowledgeKey === 'bhk')).toBe(true);
    expect(gaps.some((g) => g.typeKnowledgeKey === 'anything_else')).toBe(true);
  });

  it('returns empty when property type missing', () => {
    const gaps = assessProjectKnowledgeGaps(
      { ...PROPERTY_IMPORT_DEFAULT_FORM_VALUES, property_type: '' },
      null,
    );
    expect(gaps).toHaveLength(0);
  });
});

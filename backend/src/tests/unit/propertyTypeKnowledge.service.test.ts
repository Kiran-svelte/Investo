import {
  countMissingKnowledgeFields,
  isPropertyKnowledgeComplete,
} from '../../services/propertyTypeKnowledge.service';

describe('propertyTypeKnowledge.service', () => {
  it('counts missing apartment fields', () => {
    const result = countMissingKnowledgeFields({
      property_type: 'apartment',
      name: 'Skyline',
    });
    expect(result.gapCount).toBeGreaterThan(5);
    expect(result.missingKeys).toContain('anything_else');
  });

  it('is complete when type_knowledge and form fields cover gaps', () => {
    const draftData = {
      property_type: 'apartment',
      bedrooms: 3,
      price_min: 8000000,
      price_max: 12000000,
      amenities: 'Pool, Gym',
      description: 'East facing 3 BHK possession Dec 2027 clubhouse pool parking security',
      type_knowledge: {
        carpet_area_sqft: '1200–1600 sq ft',
        floor_number: 'High rise',
        tower_name: 'Tower A',
        maintenance_fee: '₹3–5/sqft',
        facing: 'East',
        parking: '2 covered',
        anything_else: 'Nothing else',
      },
    };
    expect(isPropertyKnowledgeComplete(draftData)).toBe(true);
    expect(countMissingKnowledgeFields(draftData).gapCount).toBe(0);
  });
});

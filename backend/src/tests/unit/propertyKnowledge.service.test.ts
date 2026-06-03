import { buildPropertyKnowledgeSections } from '../../services/propertyKnowledge.service';

describe('propertyKnowledge.service', () => {
  it('builds factual sections from property and extraction metadata', () => {
    const sections = buildPropertyKnowledgeSections({
      property: {
        id: 'prop-1',
        name: 'Green Valley',
        builder: 'ABC Builders',
        locationCity: 'Bengaluru',
        locationArea: 'Whitefield',
        priceMin: 8500000,
        priceMax: 12000000,
        bedrooms: 3,
        propertyType: 'apartment',
        amenities: ['pool', 'gym'],
        description: 'Lake-facing towers.',
        reraNumber: 'PRM/KA/RERA/123',
        status: 'available',
      },
      draftData: {
        review_notes: 'Verified brochure pricing.',
      },
      mediaExtractions: [
        {
          assetType: 'brochure',
          fileName: 'brochure.pdf',
          extractedMetadata: {
            summary: 'Phase 2 launch with clubhouse.',
            fields: { possession: 'Dec 2027' },
          },
        },
      ],
    });

    const joined = sections.join('\n');
    expect(joined).toContain('Green Valley');
    expect(joined).toContain('PRM/KA/RERA/123');
    expect(joined).toContain('Lake-facing towers');
    expect(joined).toContain('Phase 2 launch');
    expect(joined).not.toContain('invented');
  });
});

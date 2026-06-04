import {
  buildPropertyKnowledgeSections,
  createLocalKnowledgeEmbedding,
} from '../../services/propertyKnowledge.service';

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
        brochureUrl: 'https://cdn.example.com/green-valley-brochure.pdf',
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
    expect(joined).toContain('Brochure PDF: on file');
    expect(joined).toContain('Lake-facing towers');
    expect(joined).toContain('Phase 2 launch');
    expect(joined).not.toContain('invented');
  });

  it('includes type_knowledge in knowledge sections', () => {
    const sections = buildPropertyKnowledgeSections({
      property: {
        id: 'prop-3',
        name: 'Lake View',
        propertyType: 'villa',
      },
      draftData: {
        type_knowledge: {
          plot_area_sqft: '3000 sq ft',
          has_pool: 'Community pool',
          anything_else: 'Weekend site visits by appointment',
        },
      },
    });

    const joined = sections.join('\n');
    expect(joined).toContain('Type-specific knowledge');
    expect(joined).toContain('has_pool');
    expect(joined).toContain('Weekend site visits');
  });

  it('includes unit_configurations in knowledge sections', () => {
    const sections = buildPropertyKnowledgeSections({
      property: {
        id: 'prop-2',
        name: 'Villa Enclave',
        propertyType: 'villa',
        bedrooms: 4,
      },
      draftData: {
        property_type: 'villa',
        unit_configurations: [
          { bhk: 3, count: 4, unit_label: 'Garden villa' },
          { bhk: 4, count: 1 },
        ],
      },
    });

    const joined = sections.join('\n');
    expect(joined).toContain('Unit inventory');
    expect(joined).toContain('Garden villa');
    expect(joined).toContain('5 units');
  });

  it('creates deterministic local embeddings for fallback indexing', () => {
    const a = createLocalKnowledgeEmbedding('Villa near Anekal with garden');
    const b = createLocalKnowledgeEmbedding('Villa near Anekal with garden');
    const c = createLocalKnowledgeEmbedding('Commercial shop on main road');

    expect(a).toHaveLength(1536);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    const magnitude = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0));
    expect(magnitude).toBeCloseTo(1, 3);
  });
});

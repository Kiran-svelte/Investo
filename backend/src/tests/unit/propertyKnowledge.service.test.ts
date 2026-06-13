import {
  buildPropertyKnowledgeSections,
  buildImportFieldKnowledgeSection,
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

  it('includes full CSV import fields when includeFullImportFields is enabled', () => {
    const sections = buildPropertyKnowledgeSections({
      property: {
        id: 'prop-4',
        name: 'Lake Vista',
        builder: 'Horizon',
        locationCity: 'Bengaluru',
        bedrooms: 3,
        propertyType: 'apartment',
      },
      draftData: {
        carpet_area_sqft: 1450,
        possession_date: 'Dec 2027',
        facing: 'East',
        maintenance_monthly: 4500,
        payment_plan: '20:80 CLP',
        ai_knowledge_context: 'Row 1: Lake Vista 3BHK East 1450 sqft possession Dec 2027',
      },
    }, { includeFullImportFields: true });

    const joined = sections.join('\n');
    expect(joined).toContain('Imported property attributes');
    expect(joined).toContain('Carpet area (sq ft): 1450');
    expect(joined).toContain('Possession date / timeline: Dec 2027');
    expect(joined).toContain('Facing direction: East');
    expect(joined).toContain('Spreadsheet inventory summary');
    expect(joined).toContain('Lake Vista 3BHK East');
  });

  it('buildImportFieldKnowledgeSection omits empty values', () => {
    const section = buildImportFieldKnowledgeSection({
      name: 'Lake Vista',
      carpet_area_sqft: 1200,
      facing: '',
      possession_date: null,
    });
    expect(section).toContain('Carpet area (sq ft): 1200');
    expect(section).not.toContain('Facing direction');
    expect(section).not.toContain('Possession date');
  });
});

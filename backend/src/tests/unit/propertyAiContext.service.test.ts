import {
  buildFocusedPropertyPromptBlock,
  buildWhatsAppPropertyDetailText,
  formatPropertyCatalogLine,
  propertyToAiPromptInput,
  supplementPropertyFromKnowledgeContent,
} from '../../services/propertyAiContext.service';

describe('propertyAiContext.service', () => {
  const sampleProperty = {
    id: 'prop-1',
    companyId: 'co-1',
    projectId: null,
    name: 'Sunset Heights',
    builder: 'Palm Builders',
    locationCity: 'Bangalore',
    locationArea: 'Whitefield',
    locationPincode: '560066',
    priceMin: { toNumber: () => 8500000 },
    priceMax: { toNumber: () => 12000000 },
    bedrooms: 3,
    propertyType: 'apartment',
    amenities: ['Pool', 'Gym', 'Clubhouse', 'Power backup'],
    description: 'Premium 3BHK apartments with lake view and wide balconies near ITPL.',
    images: ['https://cdn.example.com/hero.jpg'],
    brochureUrl: 'https://cdn.example.com/brochure.pdf',
    floorPlanUrls: [],
    priceListUrl: null,
    latitude: null,
    longitude: null,
    reraNumber: 'PRM/KA/RERA/1256/446/PR/17112024/006507',
    status: 'available',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as const;

  test('propertyToAiPromptInput maps admin-uploaded catalog fields', () => {
    const input = propertyToAiPromptInput(sampleProperty as any);
    expect(input.name).toBe('Sunset Heights');
    expect(input.priceMin).toBe(8500000);
    expect(input.amenities).toEqual(['Pool', 'Gym', 'Clubhouse', 'Power backup']);
    expect(input.reraNumber).toContain('RERA');
    expect(input.hasImages).toBe(true);
  });

  test('formatPropertyCatalogLine includes price, amenities, description excerpt', () => {
    const line = formatPropertyCatalogLine(propertyToAiPromptInput(sampleProperty as any));
    expect(line).toContain('Sunset Heights');
    expect(line).toContain('Whitefield');
    expect(line).toContain('Amenities: Pool');
    expect(line).toContain('About: Premium 3BHK');
    expect(line).toContain('RERA:');
  });

  test('buildFocusedPropertyPromptBlock surfaces full facts for LLM', () => {
    const block = buildFocusedPropertyPromptBlock(propertyToAiPromptInput(sampleProperty as any));
    expect(block).toContain('FOCUSED PROPERTY');
    expect(block).toContain('Palm Builders');
    expect(block).toContain('Power backup');
    expect(block).toContain('lake view');
  });

  test('supplementPropertyFromKnowledgeContent backfills sparse catalog rows', () => {
    const sparse = propertyToAiPromptInput({
      ...sampleProperty,
      priceMin: null,
      priceMax: null,
      amenities: [],
      locationArea: null,
      locationCity: null,
      description: null,
    } as any);
    const enriched = supplementPropertyFromKnowledgeContent(
      sparse,
      `Property: Sunset Heights\nPrice range: ₹1.18 Cr to ₹1.18 Cr\nBedrooms: 3 BHK\nType: apartment\nAmenities: Pool, Gym\nDescription:\nReady to move in with lake view`,
    );
    expect(enriched.priceMin).toBe(11_800_000);
    expect(enriched.bedrooms).toBe(3);
    expect(enriched.amenities).toEqual(['Pool', 'Gym']);
    expect(enriched.description).toContain('Ready to move in');
  });

  test('buildWhatsAppPropertyDetailText is informative for More Info', () => {
    const text = buildWhatsAppPropertyDetailText(sampleProperty as any);
    expect(text).toContain('Sunset Heights');
    expect(text).toContain('₹');
    expect(text).toContain('Amenities:');
    expect(text).toContain('RERA:');
    expect(text).toContain('lake view');
  });

  test('buildWhatsAppPropertyDetailText uses Hindi field labels when lang is hi', () => {
    const text = buildWhatsAppPropertyDetailText(sampleProperty as any, 'hi');
    expect(text).toContain('कीमत:');
    expect(text).toContain('सुविधाएँ:');
    expect(text).toContain('प्रकार:');
  });
});

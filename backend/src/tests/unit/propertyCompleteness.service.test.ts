/// <reference types="jest" />

import {
  assessPropertyCompleteness,
  assessDraftCompleteness,
} from '../../services/propertyCompleteness.service';

describe('propertyCompleteness.service', () => {
  const completeResidential = {
    name: 'Sunrise Heights',
    propertyType: 'apartment',
    locationCity: 'Bengaluru',
    locationArea: 'Whitefield',
    priceMin: 5_000_000,
    priceMax: 8_000_000,
    bedrooms: 2,
    description: 'Premium 2BHK with club house.',
    brochureUrl: 'https://cdn.example.com/sunrise.pdf',
    images: ['https://cdn.example.com/sunrise-hero.jpg'],
    status: 'available',
  };

  test('publishable when all required residential fields present', () => {
    const result = assessPropertyCompleteness(completeResidential);
    expect(result.isPublishable).toBe(true);
    expect(result.missingFields).toHaveLength(0);
  });

  test('missing price and bedrooms for residential', () => {
    const result = assessPropertyCompleteness({
      ...completeResidential,
      priceMin: null,
      priceMax: null,
      bedrooms: null,
      brochureUrl: null,
      description: null,
    });
    expect(result.isPublishable).toBe(false);
    expect(result.missingFields).toEqual(
      expect.arrayContaining(['price', 'bedrooms', 'descriptionOrBrochure']),
    );
  });

  test('plot does not require bedrooms', () => {
    const result = assessPropertyCompleteness({
      ...completeResidential,
      propertyType: 'plot',
      bedrooms: null,
      brochureUrl: 'https://example.com/brochure.pdf',
      description: null,
    });
    expect(result.isPublishable).toBe(true);
  });

  test('requires hero image or brochure for WhatsApp media when fix-md flag active', () => {
    const result = assessPropertyCompleteness({
      ...completeResidential,
      brochureUrl: null,
      images: [],
      description: 'Text only listing.',
    });
    expect(result.isPublishable).toBe(false);
    expect(result.missingFields).toContain('customerMedia');
  });

  test('draft assessment reads snake_case keys', () => {
    const result = assessDraftCompleteness({
      name: 'Draft Villa',
      property_type: 'villa',
      location_city: 'Mysuru',
      location_area: 'VV Mohalla',
      price_max: 1_200_0000,
      bedrooms: 3,
      brochure_url: 'https://cdn.example.com/b.pdf',
    });
    expect(result.isPublishable).toBe(true);
  });
});

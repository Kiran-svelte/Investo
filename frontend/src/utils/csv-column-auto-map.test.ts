import { describe, expect, it } from 'vitest';
import {
  autoDetectedHeadersFromMapping,
  buildSuggestedColumnMapping,
  mergeSuggestedColumnMappings,
} from './csv-column-auto-map';

const MASTER_HEADERS = [
  'project_name', 'property_type', 'unit_label', 'builder', 'location_city', 'location_area',
  'location_pincode', 'latitude', 'longitude', 'bhk', 'bedrooms', 'carpet_area_sqft',
  'built_up_area_sqft', 'plot_area_sqft', 'super_built_up_sqft', 'commercial_area_sqft',
  'price', 'price_min', 'price_max', 'price_per_sqft', 'price_per_cent', 'maintenance_monthly',
  'maintenance_per_sqft', 'facing', 'floor_number', 'tower_name', 'possession_date', 'status',
  'rera_number', 'parking', 'amenities', 'has_garden', 'has_pool', 'has_servant_room',
  'is_corner_plot', 'road_width_ft', 'is_gated', 'approvals', 'road_frontage_ft',
  'expected_rent_monthly', 'roi_percentage', 'gst_applicable', 'shutters_included',
  'has_3phase_power', 'payment_plan', 'nearby_landmarks', 'visit_timings', 'description',
  'brochure_url', 'hero_image_url', '__EMPTY',
];

describe('csv-column-auto-map', () => {
  it('maps all investo master catalog columns except junk headers', () => {
    const mapping = buildSuggestedColumnMapping(MASTER_HEADERS);
    const skipped = MASTER_HEADERS.filter((header) => mapping[header] === 'skip');

    expect(skipped).toEqual(['__EMPTY']);
    expect(mapping.project_name).toBe('project_name');
    expect(mapping.unit_label).toBe('unit_label');
    expect(mapping.carpet_area_sqft).toBe('carpet_area_sqft');
    expect(mapping.latitude).toBe('latitude');
  });

  it('overrides legacy backend skip mappings with client auto-map', () => {
    const legacyBackend = Object.fromEntries(
      MASTER_HEADERS.map((header) => [header, 'skip']),
    );
    legacyBackend.project_name = 'name';
    legacyBackend.price = 'price_single';

    const merged = mergeSuggestedColumnMappings(MASTER_HEADERS, legacyBackend);

    expect(merged.project_name).toBe('project_name');
    expect(merged.price).toBe('price');
    expect(merged.carpet_area_sqft).toBe('carpet_area_sqft');
    expect(merged.__EMPTY).toBe('skip');
    expect(autoDetectedHeadersFromMapping(merged).length).toBe(MASTER_HEADERS.length - 1);
  });
});

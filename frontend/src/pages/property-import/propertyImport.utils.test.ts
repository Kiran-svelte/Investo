import { describe, expect, it } from 'vitest';
import {
  createPropertyImportFormValues,
  getPropertyImportMediaLabel,
  getPropertyImportStage,
  isPropertyImportTerminalStatus,
  serializePropertyImportFormValues,
} from './propertyImport.utils';

describe('property import utils', () => {
  it('builds editable form values from draft data', () => {
    const values = createPropertyImportFormValues({
      name: '  Skyline Towers  ',
      builder: 'Builder One',
      location_city: 'Bengaluru',
      location_area: 'Whitefield',
      location_pincode: '560066',
      price_min: 8500000,
      price_max: '12500000',
      bedrooms: 3,
      property_type: 'apartment',
      description: '  Premium homes  ',
      rera_number: 'KA-RERA-123',
      status: 'available',
      amenities: ['Pool', 'Gym'],
      reviewNotes: 'Needs final check',
    });

    expect(values).toMatchObject({
      name: 'Skyline Towers',
      builder: 'Builder One',
      location_city: 'Bengaluru',
      price_min: '8500000',
      price_max: '12500000',
      bedrooms: '3',
      amenities: 'Pool, Gym',
      review_notes: 'Needs final check',
    });
  });

  it('serializes the review form into backend-ready draft data', () => {
    const serialized = serializePropertyImportFormValues({
      name: 'Skyline Towers',
      builder: 'Builder One',
      location_city: 'Bengaluru',
      location_area: 'Whitefield',
      location_pincode: '560066',
      price_min: '8500000',
      price_max: '12500000',
      bedrooms: '3',
      property_type: 'apartment',
      description: 'Premium homes',
      rera_number: 'KA-RERA-123',
      status: 'available',
      amenities: 'Pool, Gym, Clubhouse',
      review_notes: 'Ready for publish',
      mapping_source_type: 'manual',
      mapping_profile_name: 'default-profile',
      mapping_confidence_threshold: '0.75',
      mapping_low_confidence_threshold: '0.55',
      mapping_require_human_review: true,
      mapping_field_mappings: [
        {
          source_field: 'project_name',
          target_field: 'name',
          confidence: '0.9',
          required: true,
          label: 'Project Name',
          notes: 'Primary title mapping',
        },
      ],
    });

    expect(serialized).toMatchObject({
      name: 'Skyline Towers',
      builder: 'Builder One',
      location_city: 'Bengaluru',
      location_area: 'Whitefield',
      location_pincode: '560066',
      price_min: 8500000,
      price_max: 12500000,
      bedrooms: 3,
      property_type: 'apartment',
      description: 'Premium homes',
      rera_number: 'KA-RERA-123',
      status: 'available',
      amenities: ['Pool', 'Gym', 'Clubhouse'],
      import_mapping: {
        source_type: 'manual',
        profile_name: 'default-profile',
        review_settings: {
          confidence_threshold: '0.75',
          low_confidence_threshold: '0.55',
          require_human_review: true,
        },
      },
      import_review: {
        review_notes: 'Ready for publish',
      },
    });
  });

  it('maps draft and media statuses into UI stages', () => {
    expect(getPropertyImportStage(null).key).toBe('upload');
    expect(getPropertyImportStage({ status: 'extracting', extractionStatus: 'queued' }).key).toBe('queue');
    expect(getPropertyImportStage({ status: 'review_ready', extractionStatus: 'extracted' }).key).toBe('review');
    expect(getPropertyImportMediaLabel('queued_for_extraction').label).toBe('Queued');
    expect(isPropertyImportTerminalStatus('published')).toBe(true);
    expect(isPropertyImportTerminalStatus('failed')).toBe(false);
  });
});

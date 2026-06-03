import { describe, expect, it } from 'vitest';
import { getPublishReadiness } from './propertyImportPublishReadiness';
import { PROPERTY_IMPORT_DEFAULT_FORM_VALUES } from './propertyImport.utils';

describe('getPublishReadiness', () => {
  it('blocks publish when property type is missing', () => {
    const result = getPublishReadiness({
      formValues: {
        ...PROPERTY_IMPORT_DEFAULT_FORM_VALUES,
        name: 'Palmvilla',
        property_type: '',
      },
      draft: {
        id: 'd1',
        status: 'review_ready',
        extractionStatus: 'extracted',
        draftData: {
          type_knowledge: {
            carpet_area_sqft: '1200 sq ft',
            bhk: '2 BHK',
            price: 'Rs 80 L',
            floor_number: 'Mid rise',
            tower_name: 'Tower A',
            possession_date: 'Ready to move',
            maintenance_fee: 'Rs 3/sqft',
            facing: 'East',
            parking: '1 covered',
            amenities: 'Pool',
            anything_else: 'Nothing else',
          },
        },
        mediaAssets: [{ id: 'm1' }],
      } as any,
      isUploading: false,
      activeUploadCount: 0,
    });

    expect(result.ready).toBe(false);
    expect(result.blockers.some((b) => b.includes('property type'))).toBe(true);
  });

  it('is ready when type, name, media, and extraction are satisfied', () => {
    const result = getPublishReadiness({
      formValues: {
        ...PROPERTY_IMPORT_DEFAULT_FORM_VALUES,
        name: 'Towers',
        property_type: 'apartment',
      },
      draft: {
        id: 'd1',
        status: 'review_ready',
        extractionStatus: 'extracted',
        draftData: {
          type_knowledge: {
            carpet_area_sqft: '1200 sq ft',
            bhk: '2 BHK',
            price: 'Rs 80 L',
            floor_number: 'Mid rise',
            tower_name: 'Tower A',
            possession_date: 'Ready to move',
            maintenance_fee: 'Rs 3/sqft',
            facing: 'East',
            parking: '1 covered',
            amenities: 'Pool',
            anything_else: 'Nothing else',
          },
        },
        mediaAssets: [{ id: 'm1' }],
      } as any,
      isUploading: false,
      activeUploadCount: 0,
    });

    expect(result.ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it('blocks publish until AI knowledge gaps are answered', () => {
    const result = getPublishReadiness({
      formValues: {
        ...PROPERTY_IMPORT_DEFAULT_FORM_VALUES,
        name: 'Palm Villas',
        property_type: 'villa',
      },
      draft: {
        id: 'd1',
        status: 'review_ready',
        extractionStatus: 'extracted',
        draftData: {},
        mediaAssets: [{ id: 'm1' }],
      } as any,
      isUploading: false,
      activeUploadCount: 0,
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('Answer the remaining AI knowledge questions.');
    expect(result.missingQuestions.some((q) => q.typeKnowledgeKey === 'anything_else')).toBe(true);
  });
});

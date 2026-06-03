const mockPrisma = {
  propertyImportDraft: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  propertyImportMedia: {
    update: jest.fn(),
  },
  propertyImportJob: {
    upsert: jest.fn(),
  },
  property: {
    findFirst: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  $transaction: jest.fn(),
} as any;

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../services/storage.service', () => ({
  isAwsStorageConfigured: jest.fn(() => false),
  isR2StorageConfigured: jest.fn(() => false),
  storageService: {
    verifyUploadedObject: jest.fn(),
  },
}));

jest.mock('../../services/supabaseStorage.service', () => ({
  isSupabaseStorageConfigured: jest.fn(() => false),
}));

jest.mock('../../services/propertyImportQueue.service', () => ({
  propertyImportQueueService: {
    enqueueExtraction: jest.fn(),
    clearAll: jest.fn(),
    processDueJobs: jest.fn(),
  },
}));

jest.mock('../../services/propertyKnowledge.service', () => ({
  assertPropertyKnowledgeReady: jest.fn(),
  assertPublishStorageReady: jest.fn(),
  indexPropertyKnowledge: jest.fn().mockResolvedValue({
    ok: true,
    propertyId: 'property-1',
    chunkCount: 2,
  }),
}));

import { PropertyImportError, propertyImportService } from '../../services/propertyImport.service';

describe('Property Import Service publish gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(mockPrisma));
  });

  test('preserves mapping metadata when saving and marks the draft ready after approval', async () => {
    mockPrisma.propertyImportDraft.findFirst.mockResolvedValue({
      id: 'draft-1',
      status: 'review_ready',
      draftData: {
        name: 'Sunrise Residences',
        import_mapping: {
          source_type: 'brochure',
          profile_name: 'Default brochure profile',
          field_mappings: [
            {
              source_field: 'project_title',
              target_field: 'name',
              confidence: 0.82,
              required: true,
              label: 'Project title',
              notes: 'Use brochure heading',
            },
          ],
          review_settings: {
            confidence_threshold: 0.75,
            low_confidence_threshold: 0.55,
            require_human_review: true,
          },
        },
        import_review: {
          status: 'needs_review',
          confidence_hints: [
            {
              field: 'name',
              confidence: 0.82,
              source_field: 'project_title',
              note: 'Brochure heading extracted',
            },
          ],
        },
      },
    });

    mockPrisma.propertyImportDraft.update.mockResolvedValue({
      id: 'draft-1',
      status: 'publish_ready',
      draftData: {
        name: 'Sunrise Residences',
        import_mapping: {
          source_type: 'brochure',
          profile_name: 'Default brochure profile',
          field_mappings: [],
          review_settings: {
            confidence_threshold: 0.75,
            low_confidence_threshold: 0.55,
            require_human_review: true,
          },
        },
        import_review: {
          status: 'approved',
          confidence_hints: [],
          review_notes: 'Verified by reviewer',
          reviewed_by_user_id: 'user-1',
          reviewed_at: new Date().toISOString(),
          approved_at: new Date().toISOString(),
        },
      },
    });

    const result = await propertyImportService.saveDraft('company-1', 'draft-1', 'user-1', {
      draftData: {
        name: 'Sunrise Residences',
        import_mapping: {
          source_type: 'brochure',
          profile_name: 'Default brochure profile',
          field_mappings: [
            {
              source_field: 'project_title',
              target_field: 'name',
              confidence: 0.82,
              required: true,
              label: 'Project title',
              notes: 'Use brochure heading',
            },
          ],
          review_settings: {
            confidence_threshold: 0.75,
            low_confidence_threshold: 0.55,
            require_human_review: true,
          },
        },
        import_review: {
          status: 'needs_review',
          confidence_hints: [
            {
              field: 'name',
              confidence: 0.82,
              source_field: 'project_title',
              note: 'Brochure heading extracted',
            },
          ],
        },
      },
      reviewNotes: 'Verified by reviewer',
      markPublishReady: true,
    });

    expect(mockPrisma.propertyImportDraft.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'draft-1' },
      data: expect.objectContaining({
        status: 'publish_ready',
        draftData: expect.objectContaining({
          import_mapping: expect.objectContaining({
            source_type: 'brochure',
            profile_name: 'Default brochure profile',
          }),
          import_review: expect.objectContaining({
            status: 'approved',
            reviewed_by_user_id: 'user-1',
          }),
        }),
      }),
    }));

    expect(result.status).toBe('publish_ready');
  });

  test('rejects publishing before extraction is complete', async () => {
    mockPrisma.propertyImportDraft.findFirst.mockResolvedValue({
      id: 'draft-1',
      status: 'publish_ready',
      extractionStatus: 'queued',
      publishedPropertyId: null,
      draftData: { name: 'Sunrise Residences' },
      mediaAssets: [],
    });

    await expect(
      propertyImportService.publishDraft('company-1', 'draft-1', 'user-1', false),
    ).rejects.toMatchObject({
      message: 'Draft is not ready for publishing',
      statusCode: 409,
    } as PropertyImportError);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('publishes once extraction is complete and the draft is publish_ready without requiring catalog price', async () => {
    mockPrisma.propertyImportDraft.findFirst.mockResolvedValue({
      id: 'draft-1',
      companyId: 'company-1',
      status: 'publish_ready',
      extractionStatus: 'extracted',
      publishedPropertyId: null,
      draftData: {
        name: 'Sunrise Residences',
        property_type: 'apartment',
        bedrooms: 3,
        price_min: 8000000,
        price_max: 12000000,
        amenities: 'Pool, Gym',
        description: 'East facing 3 BHK possession Dec 2027 clubhouse pool parking security',
        type_knowledge: {
          carpet_area_sqft: '1200 sq ft',
          bhk: '3 BHK',
          price: '₹80 L – ₹1.2 Cr',
          floor_number: 'Mid rise',
          tower_name: 'Tower A',
          possession_date: 'Within 12 months',
          maintenance_fee: '₹3/sqft',
          facing: 'East',
          parking: '1 covered',
          amenities: 'Pool, Gym',
          anything_else: 'Nothing else',
        },
      },
      mediaAssets: [],
    });

    mockPrisma.property.create.mockResolvedValue({
      id: 'property-1',
      companyId: 'company-1',
      name: 'Sunrise Residences',
      propertyType: 'apartment',
    });

    mockPrisma.propertyImportDraft.update.mockResolvedValue({
      id: 'draft-1',
      status: 'published',
      extractionStatus: 'extracted',
      publishedPropertyId: 'property-1',
    });

    const result = await propertyImportService.publishDraft('company-1', 'draft-1', 'user-1', false);

    expect(mockPrisma.property.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        companyId: 'company-1',
        name: 'Sunrise Residences',
        propertyType: 'apartment',
        priceMin: 8000000,
        priceMax: 12000000,
      }),
    }));
    expect(mockPrisma.propertyImportDraft.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'draft-1' },
      data: expect.objectContaining({
        status: 'published',
        extractionStatus: 'extracted',
        publishedPropertyId: 'property-1',
      }),
    }));
    const { indexPropertyKnowledge } = require('../../services/propertyKnowledge.service');
    expect(indexPropertyKnowledge).toHaveBeenCalledWith(expect.objectContaining({
      draftData: expect.objectContaining({
        type_knowledge: expect.objectContaining({
          price: '₹80 L – ₹1.2 Cr',
        }),
      }),
    }));
    expect(result.draft).toBeDefined();
    expect(result.draft?.status).toBe('published');
  });

  test('rejects publishing when AI knowledge gaps remain', async () => {
    mockPrisma.propertyImportDraft.findFirst.mockResolvedValue({
      id: 'draft-1',
      companyId: 'company-1',
      status: 'publish_ready',
      extractionStatus: 'extracted',
      publishedPropertyId: null,
      draftData: {
        name: 'Sunrise Residences',
        property_type: 'villa',
      },
      mediaAssets: [],
    });

    await expect(
      propertyImportService.publishDraft('company-1', 'draft-1', 'user-1', false),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/AI knowledge/i),
      statusCode: 409,
    } as PropertyImportError);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

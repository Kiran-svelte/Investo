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
  storageService: {
    verifyUploadedObject: jest.fn(),
  },
}));

jest.mock('../../services/propertyImportQueue.service', () => ({
  propertyImportQueueService: {
    enqueueExtraction: jest.fn(),
    clearAll: jest.fn(),
    processDueJobs: jest.fn(),
  },
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

  test('publishes once extraction is complete and the draft is publish_ready', async () => {
    mockPrisma.propertyImportDraft.findFirst.mockResolvedValue({
      id: 'draft-1',
      companyId: 'company-1',
      status: 'publish_ready',
      extractionStatus: 'extracted',
      publishedPropertyId: null,
      draftData: { name: 'Sunrise Residences' },
      mediaAssets: [],
    });

    mockPrisma.property.create.mockResolvedValue({
      id: 'property-1',
      companyId: 'company-1',
      name: 'Sunrise Residences',
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
    expect(result.draft).toBeDefined();
    expect(result.draft?.status).toBe('published');
  });

  test('rejects publishing when the draft still needs review', async () => {
    mockPrisma.propertyImportDraft.findFirst.mockResolvedValue({
      id: 'draft-1',
      companyId: 'company-1',
      status: 'publish_ready',
      extractionStatus: 'extracted',
      publishedPropertyId: null,
      draftData: {
        name: 'Sunrise Residences',
        import_review: {
          status: 'needs_review',
          confidence_hints: [
            {
              field: 'name',
              confidence: 0.42,
              source_field: 'headline',
              note: 'Low OCR confidence',
            },
          ],
        },
      },
      mediaAssets: [],
    });

    await expect(
      propertyImportService.publishDraft('company-1', 'draft-1', 'user-1', false),
    ).rejects.toMatchObject({
      message: 'Draft requires review before publishing',
      statusCode: 409,
    } as PropertyImportError);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
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
});
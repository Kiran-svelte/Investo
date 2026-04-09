import { PropertyImportWorkerService } from '../../services/propertyImportWorker.service';

const mockDb = {
  propertyImportJob: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  propertyImportMedia: {
    update: jest.fn(),
    findMany: jest.fn(),
  },
  propertyImportDraft: {
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(async (callback: any) => callback(mockDb)),
} as any;

const mockQueue = {
  processDueJobs: jest.fn(async (processor: any) => {
    await processor({ payload: { jobId: 'job-1' } });
    return 1;
  }),
};

const mockStorage = {
  verifyUploadedObject: jest.fn(),
};

describe('PropertyImportWorkerService review transitions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('keeps the draft in review_ready when extraction is complete but review is pending', async () => {
    mockDb.propertyImportJob.findUnique.mockResolvedValue({
      id: 'job-1',
      companyId: 'company-1',
      draftId: 'draft-1',
      mediaId: 'media-1',
      status: 'queued',
      attempt: 0,
      maxAttempts: 3,
      idempotencyKey: 'draft-1:media-1:extract:v1',
      nextRetryAt: null,
      draft: {
        id: 'draft-1',
        status: 'extracting',
        draftData: {
          name: 'Sunrise Residences',
          import_review: {
            status: 'needs_review',
            confidence_hints: [
              {
                field: 'name',
                confidence: 0.42,
                source_field: 'headline',
                note: 'OCR confidence is low',
              },
            ],
          },
        },
      },
      media: {
        id: 'media-1',
        status: 'extracted',
        assetType: 'brochure',
        fileName: 'sunrise-brochure.pdf',
        storageKey: 'draft-1/media-1.pdf',
        mimeType: 'application/pdf',
        fileSize: 1024,
        publicUrl: 'https://cdn.example.com/media-1.pdf',
        extractedMetadata: {},
      },
    });
    mockDb.propertyImportMedia.findMany.mockResolvedValue([
      { status: 'extracted' },
    ]);
    mockDb.propertyImportJob.update.mockResolvedValue({});
    mockDb.propertyImportDraft.update.mockResolvedValue({});
    mockDb.propertyImportDraft.findUnique.mockResolvedValue({
      id: 'draft-1',
      status: 'extracting',
      draftData: {
        name: 'Sunrise Residences',
        import_review: {
          status: 'needs_review',
          confidence_hints: [
            {
              field: 'name',
              confidence: 0.42,
              source_field: 'headline',
              note: 'OCR confidence is low',
            },
          ],
        },
      },
    });

    const worker = new PropertyImportWorkerService(
      { pollIntervalMs: 999999 },
      {
        db: mockDb,
        queue: mockQueue as any,
        storage: mockStorage as any,
        now: () => new Date('2026-04-07T00:00:00.000Z'),
      },
    );

    const processed = await worker.runOnce();

    expect(processed).toBe(1);
    expect(mockDb.propertyImportDraft.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'draft-1' },
      data: expect.objectContaining({
        status: 'review_ready',
        extractionStatus: 'extracted',
      }),
    }));
  });

  test('promotes the draft to publish_ready when review has been approved', async () => {
    mockDb.propertyImportJob.findUnique.mockResolvedValue({
      id: 'job-1',
      companyId: 'company-1',
      draftId: 'draft-1',
      mediaId: 'media-1',
      status: 'queued',
      attempt: 0,
      maxAttempts: 3,
      idempotencyKey: 'draft-1:media-1:extract:v1',
      nextRetryAt: null,
      draft: {
        id: 'draft-1',
        status: 'extracting',
        draftData: {
          name: 'Sunrise Residences',
          import_review: {
            status: 'approved',
            confidence_hints: [],
            reviewed_by_user_id: 'user-1',
            reviewed_at: '2026-04-07T00:00:00.000Z',
            approved_at: '2026-04-07T00:00:00.000Z',
          },
        },
      },
      media: {
        id: 'media-1',
        status: 'extracted',
        assetType: 'brochure',
        fileName: 'sunrise-brochure.pdf',
        storageKey: 'draft-1/media-1.pdf',
        mimeType: 'application/pdf',
        fileSize: 1024,
        publicUrl: 'https://cdn.example.com/media-1.pdf',
        extractedMetadata: {},
      },
    });
    mockDb.propertyImportMedia.findMany.mockResolvedValue([
      { status: 'extracted' },
    ]);
    mockDb.propertyImportJob.update.mockResolvedValue({});
    mockDb.propertyImportDraft.update.mockResolvedValue({});
    mockDb.propertyImportDraft.findUnique.mockResolvedValue({
      id: 'draft-1',
      status: 'extracting',
      draftData: {
        name: 'Sunrise Residences',
        import_review: {
          status: 'approved',
          confidence_hints: [],
          reviewed_by_user_id: 'user-1',
          reviewed_at: '2026-04-07T00:00:00.000Z',
          approved_at: '2026-04-07T00:00:00.000Z',
        },
      },
    });

    const worker = new PropertyImportWorkerService(
      { pollIntervalMs: 999999 },
      {
        db: mockDb,
        queue: mockQueue as any,
        storage: mockStorage as any,
        now: () => new Date('2026-04-07T00:00:00.000Z'),
      },
    );

    const processed = await worker.runOnce();

    expect(processed).toBe(1);
    expect(mockDb.propertyImportDraft.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'draft-1' },
      data: expect.objectContaining({
        status: 'publish_ready',
        extractionStatus: 'extracted',
      }),
    }));
  });
});

function createJobRecord(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'job-1',
    companyId: 'company-1',
    draftId: 'draft-1',
    mediaId: 'media-1',
    status: 'queued',
    attempt: 0,
    maxAttempts: 3,
    idempotencyKey: 'draft-1:media-1:extract:v1',
    nextRetryAt: null,
    draft: {
      id: 'draft-1',
      status: 'extracting',
    },
    media: {
      id: 'media-1',
      status: 'queued_for_extraction',
      assetType: 'image',
      fileName: 'file.jpg',
      storageKey: 'companies/company-1/properties/draft-1/image/file.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024,
      publicUrl: 'https://cdn.example.com/file.jpg',
      extractedMetadata: {},
    },
    ...overrides,
  };
}

function createWorkerWithMocks(
  dbOverrides: Record<string, unknown> = {},
  storageOverrides: Record<string, unknown> = {},
  depsOverrides: Record<string, unknown> = {},
) {
  const db = {
    propertyImportJob: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    propertyImportMedia: {
      update: jest.fn(),
      findMany: jest.fn(),
    },
    propertyImportDraft: {
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(async (callback) => callback(db)),
    ...dbOverrides,
  } as any;

  const storage = {
    verifyUploadedObject: jest.fn(),
    ...storageOverrides,
  } as any;

  const queue = {
    processDueJobs: jest.fn(),
  } as any;

  const extractor = {
    extractMedia: jest.fn(async () => null),
  } as any;

  const now = new Date('2026-04-03T10:30:00.000Z');
  const worker = new PropertyImportWorkerService(
    { pollIntervalMs: 5000 },
    {
      db,
      queue,
      storage,
      now: () => now,
      extractor,
      ...depsOverrides,
    },
  );

  return {
    worker,
    db,
    storage,
    extractor,
  };
}

describe('Property Import Worker Service', () => {
  test('marks job succeeded idempotently when media is already extracted', async () => {
    const { worker, db } = createWorkerWithMocks();
    db.propertyImportJob.findUnique.mockResolvedValue(
      createJobRecord({
        media: {
          id: 'media-1',
          status: 'extracted',
          assetType: 'image',
          fileName: 'key-1.jpg',
          storageKey: 'key-1',
          mimeType: 'image/jpeg',
          fileSize: 100,
          publicUrl: 'https://cdn.example.com/key-1',
          extractedMetadata: { previous: true },
        },
      }),
    );
    db.propertyImportDraft.findUnique.mockResolvedValue({ id: 'draft-1', status: 'extracting' });
    db.propertyImportMedia.findMany.mockResolvedValue([{ status: 'extracted' }]);

    const result = await (worker as any).handleQueuedJob({
      payload: { jobId: 'job-1' },
    });

    expect(result).toBe('completed');
    expect(db.propertyImportJob.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job-1' },
      data: expect.objectContaining({
        status: 'succeeded',
      }),
    }));
  });

  test('returns retry and schedules backoff when extraction fails with attempts remaining', async () => {
    const { worker, db, storage } = createWorkerWithMocks();
    db.propertyImportJob.findUnique.mockResolvedValue(createJobRecord());
    db.propertyImportDraft.findUnique.mockResolvedValue({ id: 'draft-1', status: 'extracting' });
    storage.verifyUploadedObject.mockRejectedValue(new Error('temporary storage failure'));

    const result = await (worker as any).handleQueuedJob({
      payload: { jobId: 'job-1' },
    });

    expect(result).toBe('retry');
    expect(db.$transaction).toHaveBeenCalled();
    expect(db.propertyImportJob.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job-1' },
      data: expect.objectContaining({
        status: 'queued',
        attempt: 1,
        nextRetryAt: new Date('2026-04-03T10:30:20.000Z'),
      }),
    }));
  });

  test('marks job and draft failed when extraction retries are exhausted', async () => {
    const { worker, db, storage } = createWorkerWithMocks();
    db.propertyImportJob.findUnique.mockResolvedValue(
      createJobRecord({
        attempt: 2,
        maxAttempts: 3,
      }),
    );
    db.propertyImportDraft.findUnique.mockResolvedValue({ id: 'draft-1', status: 'extracting' });
    storage.verifyUploadedObject.mockRejectedValue(new Error('permanent failure'));

    const result = await (worker as any).handleQueuedJob({
      payload: { jobId: 'job-1' },
    });

    expect(result).toBe('completed');
    expect(db.propertyImportJob.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job-1' },
      data: expect.objectContaining({
        status: 'failed',
        nextRetryAt: null,
      }),
    }));
    expect(db.propertyImportDraft.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'draft-1' },
      data: expect.objectContaining({
        status: 'failed',
        extractionStatus: 'failed',
      }),
    }));
  });

  test('fails the job honestly when extractor is not configured', async () => {
    const { worker, db } = createWorkerWithMocks({}, {}, { extractor: undefined });
    db.propertyImportJob.findUnique.mockResolvedValue(createJobRecord());

    const result = await (worker as any).handleQueuedJob({
      payload: { jobId: 'job-1' },
    });

    expect(result).toBe('completed');
    expect(db.propertyImportJob.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job-1' },
      data: expect.objectContaining({
        status: 'failed',
        failureReason: expect.stringContaining('No property import extractor is configured'),
      }),
    }));
    expect(db.propertyImportMedia.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'media-1' },
      data: expect.objectContaining({
        status: 'failed',
      }),
    }));
    expect(db.propertyImportDraft.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'draft-1' },
      data: expect.objectContaining({
        status: 'failed',
        extractionStatus: 'failed',
      }),
    }));
  });

  test('writes extracted brochure data back into the draft for review', async () => {
    const extractionResult = {
      structuredData: {
        name: 'Sunrise Residences',
        price_min: 8500000,
        price_max: 12500000,
        bedrooms: 3,
        property_type: 'apartment',
        amenities: ['Pool', 'Gym'],
        status: 'available',
      },
      confidenceHints: [
        {
          field: 'name',
          confidence: 0.92,
          source_field: 'title',
          note: 'Brochure heading',
        },
      ],
      reviewRequired: true,
      metadata: {
        sourceType: 'openai',
      },
    };

    const { worker, db, extractor } = createWorkerWithMocks();
    db.propertyImportJob.findUnique.mockResolvedValue(createJobRecord());
    db.propertyImportDraft.findUnique.mockResolvedValue({ id: 'draft-1', status: 'extracting', draftData: {} });
    db.propertyImportMedia.findMany.mockResolvedValue([{ status: 'extracted' }]);
    db.propertyImportJob.update.mockResolvedValue({});
    db.propertyImportMedia.update.mockResolvedValue({});
    db.propertyImportDraft.update.mockResolvedValue({});
    db.$transaction.mockImplementation(async (callback) => callback(db));
    db.propertyImportDraft.findUnique.mockResolvedValue({ id: 'draft-1', status: 'extracting', draftData: {} });
    (worker as any).deps.storage.verifyUploadedObject.mockResolvedValue({
      exists: true,
      contentType: 'application/pdf',
      contentLength: 1024,
      eTag: 'etag-1',
    });
    extractor.extractMedia.mockResolvedValue(extractionResult);

    const result = await (worker as any).handleQueuedJob({
      payload: { jobId: 'job-1' },
    });

    expect(result).toBe('completed');
    expect(db.propertyImportDraft.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'draft-1' },
      data: expect.objectContaining({
        draftData: expect.objectContaining({
          name: 'Sunrise Residences',
          price_min: 8500000,
          price_max: 12500000,
          bedrooms: 3,
          import_mapping: expect.objectContaining({
            source_type: 'brochure',
          }),
          import_review: expect.objectContaining({
            status: 'needs_review',
          }),
        }),
      }),
    }));
  });
});

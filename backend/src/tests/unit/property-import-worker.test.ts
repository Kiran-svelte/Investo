import { PropertyImportWorkerService } from '../../services/propertyImportWorker.service';

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
      storageKey: 'companies/company-1/properties/draft-1/image/file.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024,
      publicUrl: 'https://cdn.example.com/file.jpg',
      extractedMetadata: {},
    },
    ...overrides,
  };
}

function createWorkerWithMocks(dbOverrides: Record<string, unknown> = {}, storageOverrides: Record<string, unknown> = {}) {
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

  const now = new Date('2026-04-03T10:30:00.000Z');
  const worker = new PropertyImportWorkerService(
    { pollIntervalMs: 5000 },
    {
      db,
      queue,
      storage,
      now: () => now,
    },
  );

  return {
    worker,
    db,
    storage,
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
});

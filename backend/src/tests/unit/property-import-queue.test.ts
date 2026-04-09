jest.mock('../../config/redis', () => ({
  getRedis: jest.fn(() => null),
}));

import { propertyImportQueueService } from '../../services/propertyImportQueue.service';

describe('Property Import Queue Service', () => {
  beforeEach(async () => {
    await propertyImportQueueService.clearAll();
  });

  test('enqueues extraction job once and rejects duplicate idempotency key', async () => {
    const first = await propertyImportQueueService.enqueueExtraction('draft-1:media-1:extract:v1', {
      jobId: 'job-1',
      companyId: 'company-1',
      draftId: 'draft-1',
      mediaId: 'media-1',
      attempt: 1,
      maxAttempts: 3,
    });

    const duplicate = await propertyImportQueueService.enqueueExtraction('draft-1:media-1:extract:v1', {
      jobId: 'job-2',
      companyId: 'company-1',
      draftId: 'draft-1',
      mediaId: 'media-1',
      attempt: 1,
      maxAttempts: 3,
    });

    expect(first).toBe(true);
    expect(duplicate).toBe(false);
  });

  test('processes queued extraction jobs and clears queue state', async () => {
    const processed: string[] = [];

    await propertyImportQueueService.enqueueExtraction('draft-1:media-1:extract:v1', {
      jobId: 'job-1',
      companyId: 'company-1',
      draftId: 'draft-1',
      mediaId: 'media-1',
      attempt: 1,
      maxAttempts: 3,
    });

    const count = await propertyImportQueueService.processDueJobs(async (job) => {
      processed.push(job.payload.jobId);
    });

    expect(count).toBe(1);
    expect(processed).toEqual(['job-1']);
  });

  test('keeps duplicate claims idempotent while a job is already being processed', async () => {
    let nestedAttemptCalls = 0;

    await propertyImportQueueService.enqueueExtraction('draft-1:media-2:extract:v1', {
      jobId: 'job-3',
      companyId: 'company-1',
      draftId: 'draft-1',
      mediaId: 'media-2',
      attempt: 1,
      maxAttempts: 3,
    });

    const processed = await propertyImportQueueService.processDueJobs(async () => {
      const nestedProcessed = await propertyImportQueueService.processDueJobs(async () => {
        nestedAttemptCalls += 1;
      });
      expect(nestedProcessed).toBe(0);
    });

    expect(processed).toBe(1);
    expect(nestedAttemptCalls).toBe(0);
  });

  test('retains job when processor requests retry and processes it on next run', async () => {
    await propertyImportQueueService.enqueueExtraction('draft-1:media-3:extract:v1', {
      jobId: 'job-4',
      companyId: 'company-1',
      draftId: 'draft-1',
      mediaId: 'media-3',
      attempt: 1,
      maxAttempts: 3,
    });

    const processor = jest
      .fn<Promise<'retry' | void>, any[]>()
      .mockResolvedValueOnce('retry')
      .mockResolvedValueOnce(undefined);

    const first = await propertyImportQueueService.processDueJobs(processor);
    const second = await propertyImportQueueService.processDueJobs(processor);

    expect(first).toBe(0);
    expect(second).toBe(1);
    expect(processor).toHaveBeenCalledTimes(2);
  });
});

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
});

jest.mock('../../config/redis', () => ({
  getRedis: jest.fn(() => null),
}));

import { automationQueueService } from '../../services/automationQueue.service';

describe('Automation Queue Service', () => {
  beforeEach(async () => {
    await automationQueueService.clearAll();
  });

  test('schedules a job once and rejects duplicates', async () => {
    const executeAt = new Date(Date.now() - 1000);

    const first = await automationQueueService.schedule(
      'visit_reminder_24h',
      'visit-123:24h',
      executeAt,
      { visitId: 'visit-123', timing: '24h' },
    );

    const duplicate = await automationQueueService.schedule(
      'visit_reminder_24h',
      'visit-123:24h',
      executeAt,
      { visitId: 'visit-123', timing: '24h' },
    );

    expect(first).toBe(true);
    expect(duplicate).toBe(false);
  });

  test('processes only due jobs', async () => {
    const processedTypes: string[] = [];
    const dueAt = new Date(Date.now() - 1000);
    const futureAt = new Date(Date.now() + 60 * 60 * 1000);

    await automationQueueService.schedule(
      'lead_follow_up_48h',
      'lead-1:48h',
      dueAt,
      { leadId: 'lead-1', reason: '48h_no_activity' },
    );

    await automationQueueService.schedule(
      'lead_follow_up_7d',
      'lead-2:7d',
      futureAt,
      { leadId: 'lead-2', reason: '7d_negotiation' },
    );

    const processed = await automationQueueService.processDueJobs(async (job) => {
      processedTypes.push(job.type);
    });

    expect(processed).toBe(1);
    expect(processedTypes).toEqual(['lead_follow_up_48h']);
  });
});
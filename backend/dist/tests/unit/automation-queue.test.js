"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
jest.mock('../../config/redis', () => ({
    getRedis: jest.fn(() => null),
}));
const automationQueue_service_1 = require("../../services/automationQueue.service");
describe('Automation Queue Service', () => {
    beforeEach(async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-04-08T10:00:00.000Z'));
        await automationQueue_service_1.automationQueueService.clearAll();
    });
    afterEach(() => {
        jest.useRealTimers();
    });
    test('schedules a job once and rejects duplicates', async () => {
        const executeAt = new Date(Date.now() - 1000);
        const first = await automationQueue_service_1.automationQueueService.schedule('visit_reminder_24h', 'visit-123:24h', executeAt, { visitId: 'visit-123', timing: '24h' });
        const duplicate = await automationQueue_service_1.automationQueueService.schedule('visit_reminder_24h', 'visit-123:24h', executeAt, { visitId: 'visit-123', timing: '24h' });
        expect(first).toBe(true);
        expect(duplicate).toBe(false);
    });
    test('processes only due jobs', async () => {
        const processedTypes = [];
        const dueAt = new Date(Date.now() - 1000);
        const futureAt = new Date(Date.now() + 60 * 60 * 1000);
        await automationQueue_service_1.automationQueueService.schedule('lead_follow_up_48h', 'lead-1:48h', dueAt, { leadId: 'lead-1', reason: '48h_no_activity' });
        await automationQueue_service_1.automationQueueService.schedule('lead_follow_up_7d', 'lead-2:7d', futureAt, { leadId: 'lead-2', reason: '7d_negotiation' });
        const processed = await automationQueue_service_1.automationQueueService.processDueJobs(async (job) => {
            processedTypes.push(job.type);
        });
        expect(processed).toBe(1);
        expect(processedTypes).toEqual(['lead_follow_up_48h']);
    });
    test('retries failed jobs with deterministic backoff and processes once when due again', async () => {
        await automationQueue_service_1.automationQueueService.schedule('lead_follow_up_48h', 'lead-3:48h', new Date(Date.now() - 1000), { leadId: 'lead-3', reason: '48h_no_activity' });
        const processor = jest
            .fn()
            .mockRejectedValueOnce(new Error('transient-1'))
            .mockRejectedValueOnce(new Error('transient-2'))
            .mockResolvedValue(undefined);
        const firstRun = await automationQueue_service_1.automationQueueService.processDueJobs(processor);
        expect(firstRun).toBe(0);
        expect(processor).toHaveBeenCalledTimes(1);
        const secondRunTooEarly = await automationQueue_service_1.automationQueueService.processDueJobs(processor);
        expect(secondRunTooEarly).toBe(0);
        expect(processor).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(20000);
        const secondRetryRun = await automationQueue_service_1.automationQueueService.processDueJobs(processor);
        expect(secondRetryRun).toBe(0);
        expect(processor).toHaveBeenCalledTimes(2);
        const thirdRunTooEarly = await automationQueue_service_1.automationQueueService.processDueJobs(processor);
        expect(thirdRunTooEarly).toBe(0);
        expect(processor).toHaveBeenCalledTimes(2);
        jest.advanceTimersByTime(40000);
        const successRun = await automationQueue_service_1.automationQueueService.processDueJobs(processor);
        expect(successRun).toBe(1);
        expect(processor).toHaveBeenCalledTimes(3);
    });
    test('moves job to terminal dead-letter behavior after retry budget is exhausted', async () => {
        await automationQueue_service_1.automationQueueService.schedule('conversation_timeout_24h', 'conversation-1:timeout', new Date(Date.now() - 1000), { conversationId: 'conversation-1' });
        const processor = jest.fn().mockRejectedValue(new Error('permanent failure'));
        await automationQueue_service_1.automationQueueService.processDueJobs(processor);
        expect(processor).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(20000);
        await automationQueue_service_1.automationQueueService.processDueJobs(processor);
        expect(processor).toHaveBeenCalledTimes(2);
        jest.advanceTimersByTime(40000);
        await automationQueue_service_1.automationQueueService.processDueJobs(processor);
        expect(processor).toHaveBeenCalledTimes(3);
        jest.advanceTimersByTime(5 * 60 * 1000);
        const afterTerminal = await automationQueue_service_1.automationQueueService.processDueJobs(processor);
        expect(afterTerminal).toBe(0);
        expect(processor).toHaveBeenCalledTimes(3);
    });
});
//# sourceMappingURL=automation-queue.test.js.map
export type AutomationJobType = 'visit_reminder_24h' | 'visit_reminder_1h' | 'visit_agent_notification_15m' | 'lead_follow_up_48h' | 'lead_follow_up_7d' | 'conversation_timeout_24h';
export interface AutomationJobPayload {
    type: AutomationJobType;
    uniqueKey: string;
    executeAt: string;
    data: Record<string, unknown>;
}
interface StoredAutomationJob extends AutomationJobPayload {
    createdAt: string;
    attempt: number;
    maxAttempts: number;
    lastError?: string | null;
}
export declare class AutomationQueueService {
    schedule(type: AutomationJobType, uniqueKey: string, executeAt: Date, data: Record<string, unknown>, ttlSeconds?: number): Promise<boolean>;
    processDueJobs(processor: (job: StoredAutomationJob) => Promise<void>): Promise<number>;
    clearAll(): Promise<void>;
    private getAllJobs;
    private claimJob;
    private releaseJob;
    private deleteJob;
    private handleProcessingFailure;
    private upsertJob;
    private saveDeadLetter;
}
export declare const automationQueueService: AutomationQueueService;
export {};
//# sourceMappingURL=automationQueue.service.d.ts.map
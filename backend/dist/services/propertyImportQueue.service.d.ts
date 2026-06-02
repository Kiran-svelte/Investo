export type PropertyImportQueueJobType = 'extract_media';
export interface PropertyImportQueuePayload {
    jobId: string;
    companyId: string;
    draftId: string;
    mediaId: string;
    attempt: number;
    maxAttempts: number;
}
export interface StoredPropertyImportJob {
    type: PropertyImportQueueJobType;
    idempotencyKey: string;
    payload: PropertyImportQueuePayload;
    enqueuedAt: string;
}
export type PropertyImportQueueProcessResult = 'completed' | 'retry';
export declare class PropertyImportQueueService {
    enqueueExtraction(idempotencyKey: string, payload: PropertyImportQueuePayload, ttlSeconds?: number): Promise<boolean>;
    clearAll(): Promise<void>;
    processDueJobs(processor: (job: StoredPropertyImportJob) => Promise<PropertyImportQueueProcessResult | void>): Promise<number>;
    private getAllJobs;
    private claimJob;
    private releaseJob;
    private deleteJob;
}
export declare const propertyImportQueueService: PropertyImportQueueService;
//# sourceMappingURL=propertyImportQueue.service.d.ts.map
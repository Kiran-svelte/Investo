import { PropertyImportQueueProcessResult, StoredPropertyImportJob } from './propertyImportQueue.service';
type PropertyImportWorkerJobStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
type PropertyImportWorkerDraftStatus = 'draft' | 'extracting' | 'review_ready' | 'publish_ready' | 'published' | 'failed' | 'cancelled';
type PropertyImportWorkerMediaStatus = 'upload_requested' | 'uploaded' | 'verified' | 'queued_for_extraction' | 'extracted' | 'failed' | 'cancelled';
type PropertyImportWorkerConfidenceHint = {
    field: string;
    confidence: number;
    source_field?: string | null;
    note?: string | null;
};
type PropertyImportWorkerExtractionResult = {
    structuredData?: Record<string, unknown> | null;
    confidenceHints?: PropertyImportWorkerConfidenceHint[];
    reviewRequired?: boolean;
    metadata?: Record<string, unknown>;
};
type PropertyImportWorkerJobRecord = {
    id: string;
    companyId: string;
    draftId: string;
    mediaId: string | null;
    status: PropertyImportWorkerJobStatus;
    attempt: number;
    maxAttempts: number;
    idempotencyKey: string;
    nextRetryAt: Date | null;
    draft: {
        id: string;
        status: PropertyImportWorkerDraftStatus;
        draftData: Record<string, unknown>;
    };
    media: {
        id: string;
        status: PropertyImportWorkerMediaStatus;
        assetType: 'image' | 'brochure' | 'video';
        fileName: string;
        storageKey: string;
        mimeType: string;
        fileSize: number;
        publicUrl: string;
        extractedMetadata: Record<string, unknown>;
    } | null;
};
type PropertyImportWorkerDb = {
    propertyImportJob: {
        findUnique(args: any): Promise<PropertyImportWorkerJobRecord | null>;
        update(args: any): Promise<unknown>;
    };
    propertyImportMedia: {
        update(args: any): Promise<unknown>;
        findMany(args: any): Promise<Array<{
            status: PropertyImportWorkerMediaStatus;
        }>>;
    };
    propertyImportDraft: {
        update(args: any): Promise<unknown>;
        findUnique(args: any): Promise<{
            id: string;
            status: PropertyImportWorkerDraftStatus;
        } | null>;
    };
    $transaction<T>(callback: (tx: PropertyImportWorkerDb) => Promise<T>): Promise<T>;
};
type PropertyImportWorkerQueue = {
    processDueJobs(processor: (job: StoredPropertyImportJob) => Promise<PropertyImportQueueProcessResult | void>): Promise<number>;
};
type PropertyImportWorkerExtractor = {
    extractMedia(input: {
        companyId: string;
        draftId: string;
        mediaId: string;
        media: PropertyImportWorkerJobRecord['media'];
        draftData: Record<string, unknown>;
    }): Promise<PropertyImportWorkerExtractionResult | null>;
};
type PropertyImportWorkerStorage = {
    verifyUploadedObject(key: string, expected: {
        mimeType?: string;
        fileSize?: number;
    }): Promise<{
        exists: boolean;
        contentType?: string;
        contentLength?: number;
        eTag?: string;
    }>;
};
interface PropertyImportWorkerOptions {
    pollIntervalMs?: number;
}
interface PropertyImportWorkerDeps {
    db: PropertyImportWorkerDb;
    queue: PropertyImportWorkerQueue;
    storage: PropertyImportWorkerStorage;
    now: () => Date;
    extractor?: PropertyImportWorkerExtractor;
}
export declare class PropertyImportWorkerService {
    private readonly pollIntervalMs;
    private readonly deps;
    private workerTimer;
    private running;
    constructor(options?: PropertyImportWorkerOptions, deps?: Partial<PropertyImportWorkerDeps>);
    start(): void;
    stop(): void;
    runOnce(): Promise<number>;
    private handleQueuedJob;
    private handleFailure;
    private markJobAsFailedWithoutRetry;
    private markJobCancelled;
    private updateDraftToProcessing;
    private reconcileDraftStatus;
    private mergeExtractionIntoDraftData;
}
export declare const propertyImportWorkerService: PropertyImportWorkerService;
export {};
//# sourceMappingURL=propertyImportWorker.service.d.ts.map
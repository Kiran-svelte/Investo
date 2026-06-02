/**
 * Deduplication Service for WhatsApp Messages
 *
 * Prevents duplicate processing of WhatsApp webhook messages.
 * Uses Redis SET with NX (only if not exists) for atomic operation.
 * Falls back to in-memory Map if Redis is unavailable.
 *
 * Default TTL: 5 minutes (300 seconds) - this covers the typical
 * retry window for WhatsApp webhook delivery.
 */
export declare class DeduplicationService {
    private ttlSeconds;
    constructor(ttlSeconds?: number);
    /**
     * Check if a message has already been processed
     *
     * Uses Redis SETNX for atomic check-and-set operation.
     * Returns true if message was already processed (key exists).
     *
     * @param messageId - Unique WhatsApp message ID
     * @param ttlSeconds - Time-to-live for the deduplication key
     * @returns Promise<boolean> - True if duplicate, false if new message
     */
    isDuplicate(messageId: string, ttlSeconds?: number): Promise<boolean>;
    /**
     * Atomically claim a message for processing.
     *
     * Returns true only for the first claimant inside TTL window.
     */
    claimMessageProcessing(messageId: string, ttlSeconds?: number): Promise<boolean>;
    /**
     * Mark a message as processed
     *
     * Explicitly marks a message as processed with TTL.
     * Useful when processing starts but isn't complete yet.
     *
     * @param messageId - Unique WhatsApp message ID
     * @param ttlSeconds - Time-to-live for the deduplication key
     */
    markProcessed(messageId: string, ttlSeconds?: number): Promise<void>;
    /**
     * Release a message claim so a failed processing attempt can be retried.
     */
    release(messageId: string): Promise<void>;
    /**
     * Get the count of currently processed messages (for monitoring)
     *
     * Note: This is approximate with Redis SCARD, and not supported
     * with in-memory fallback (returns 0).
     *
     * @returns Promise<number> - Approximate count of tracked messages
     */
    getProcessedCount(): Promise<number>;
    /**
     * Clear all deduplication keys (for testing)
     */
    clearAll(): Promise<void>;
    private memoryIsDuplicate;
    private memoryClaimMessage;
    private memoryMarkProcessed;
    private memoryGetCount;
    private memoryCleanup;
}
/**
 * Default deduplication service instance
 */
export declare const deduplicationService: DeduplicationService;
/**
 * Convenience function for checking duplicates
 */
export declare const isMessageDuplicate: (messageId: string, ttlSeconds?: number) => Promise<boolean>;
/**
 * Convenience function for marking messages as processed
 */
export declare const markMessageProcessed: (messageId: string, ttlSeconds?: number) => Promise<void>;
//# sourceMappingURL=deduplication.service.d.ts.map
declare const router: import("express-serve-static-core").Router;
/**
 * Verify the webhook payload signature from Meta.
 */
declare function verifyWebhookSignature(body: any, signature: string | undefined): {
    allowed: boolean;
    reason: string;
};
type WebhookMessageStatus = 'processed' | 'skipped' | 'duplicate' | 'failed';
interface WebhookMessageOutcome {
    messageId: string | null;
    type: string | null;
    from: string | null;
    status: WebhookMessageStatus;
    reason: string;
    propagationStatus: 'success' | 'failed' | 'not_attempted';
    error?: string;
}
interface WebhookProcessSummary {
    object: string | null;
    totalMessages: number;
    processed: number;
    skipped: number;
    duplicate: number;
    failed: number;
    outcomes: WebhookMessageOutcome[];
}
/**
 * Process incoming webhook payload from Meta.
 */
declare function processWebhook(body: any): Promise<WebhookProcessSummary>;
declare function extractCustomerMessage(message: any): {
    messageText: string;
    normalizedType: 'text' | 'interactive';
    interactiveId?: string;
    interactiveType?: 'button_reply' | 'list_reply';
} | null;
export declare const webhookRouteInternals: {
    verifyWebhookSignature: typeof verifyWebhookSignature;
    processWebhook: typeof processWebhook;
    extractCustomerMessage: typeof extractCustomerMessage;
};
export default router;
//# sourceMappingURL=webhook.routes.d.ts.map
declare const router: import("express-serve-static-core").Router;
type GreenApiWebhookMessageStatus = 'processed' | 'skipped' | 'duplicate' | 'failed';
interface GreenApiWebhookMessageOutcome {
    messageId: string | null;
    from: string | null;
    typeWebhook: string | null;
    typeMessage: string | null;
    status: GreenApiWebhookMessageStatus;
    reason: string;
    propagationStatus: 'success' | 'failed' | 'not_attempted';
    error?: string;
}
interface GreenApiWebhookProcessSummary {
    totalNotifications: number;
    totalMessages: number;
    processed: number;
    skipped: number;
    duplicate: number;
    failed: number;
    outcomes: GreenApiWebhookMessageOutcome[];
}
declare function extractAuthorizationToken(header: string | string[] | undefined): string | null;
declare function timingSafeEquals(a: string, b: string): boolean;
declare function normalizeSenderToE164Like(value: unknown): string | null;
declare function extractGreenApiInstanceIdentifier(notification: any): string | null;
declare function extractTextFromGreenApiMessageData(messageData: any): string | null;
type ExtractedIncomingText = {
    instanceId: string | null;
    messageId: string | null;
    customerPhone: string | null;
    customerName: string;
    messageText: string | null;
    typeWebhook: string | null;
    typeMessage: string | null;
};
declare function extractIncomingTextNotifications(body: any): ExtractedIncomingText[];
declare function processGreenApiWebhook(body: any, webhookTokenHint?: string, companyIdHint?: string): Promise<GreenApiWebhookProcessSummary>;
export declare const greenApiWebhookRouteInternals: {
    extractAuthorizationToken: typeof extractAuthorizationToken;
    timingSafeEquals: typeof timingSafeEquals;
    normalizeSenderToE164Like: typeof normalizeSenderToE164Like;
    extractGreenApiInstanceIdentifier: typeof extractGreenApiInstanceIdentifier;
    extractTextFromGreenApiMessageData: typeof extractTextFromGreenApiMessageData;
    extractIncomingTextNotifications: typeof extractIncomingTextNotifications;
    processGreenApiWebhook: typeof processGreenApiWebhook;
};
export default router;
//# sourceMappingURL=greenapi-webhook.routes.d.ts.map
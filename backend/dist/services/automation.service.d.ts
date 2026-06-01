/**
 * Automation Service - handles scheduled tasks through a durable queue-backed workflow:
 * - Visit reminders (24h and 1h before)
 * - Follow-up automation
 * - Lead assignment
 * - Analytics aggregation
 */
export declare class AutomationService {
    private intervalIds;
    private workerIntervalId;
    private workerRunning;
    /**
     * Start all scheduled jobs.
     * In production, use a proper job scheduler like Bull or Agenda.
     */
    start(): void;
    /**
     * Schedule a WhatsApp follow-up ~24h after a completed site visit.
     */
    scheduleVisitPostFollowUp(leadId: string, visitId: string): Promise<void>;
    /**
     * Stop all scheduled jobs.
     */
    stop(): void;
    /**
     * Process visit reminders.
     * Sends WhatsApp reminders:
     * - 24 hours before visit
     * - 1 hour before visit
     * Also creates notifications for agents.
     */
    processVisitReminders(): Promise<void>;
    /**
     * Send a visit reminder via WhatsApp.
     */
    private sendVisitReminder;
    /**
     * Create a notification for the agent about an upcoming visit.
     * Uses raw query because the 'details' JSONB column is not in the Prisma schema.
     */
    private createAgentNotification;
    /**
     * Process follow-up automation rules:
     * - Lead in 'contacted' status for 48h without activity -> auto follow-up
     * - Visit completed -> next day follow-up asking for feedback
     * - Lead in 'negotiation' for 7 days -> reminder to agent
     */
    processFollowUps(): Promise<void>;
    /**
     * Send an automated follow-up message.
     */
    private nurtureMessage;
    private sendFollowUpMessage;
    /**
     * Process conversation timeouts (24h inactivity -> auto-close).
     */
    processConversationTimeouts(): Promise<void>;
    private startWorker;
    private processQueuedAutomationJobs;
    private enqueueJob;
    private executeQueuedJob;
    private executeVisitReminder;
    private executeAgentNotification;
    private executeFollowUp;
    private executeNegotiationReminder;
    private executeConversationTimeout;
}
export declare const automationService: AutomationService;
//# sourceMappingURL=automation.service.d.ts.map
import { NotificationType as PrismaNotificationType } from '@prisma/client';
/**
 * NotificationEngine - Event-driven notifications.
 * When business events happen, the right people get notified.
 */
interface NotifyOptions {
    companyId: string;
    userId?: string | null;
    type: PrismaNotificationType;
    title: string;
    message: string;
    data?: Record<string, any>;
}
declare class NotificationEngine {
    /**
     * Create an in-app notification.
     */
    notify(opts: NotifyOptions): Promise<void>;
    /**
     * Notify assigned agent when a new lead is assigned.
     */
    onLeadAssigned(lead: any, agentId: string): Promise<void>;
    /**
     * Notify when lead is reassigned (old agent loses it, new agent gets it).
     */
    onLeadReassigned(lead: any, oldAgentId: string | null, newAgentId: string): Promise<void>;
    /**
     * Notify on lead status change.
     */
    onLeadStatusChange(lead: any, oldStatus: string, newStatus: string): Promise<void>;
    /**
     * Notify when a visit is scheduled.
     */
    onVisitScheduled(visit: any, lead: any, property: any, agent: any): Promise<void>;
    /**
     * Notify when visit status changes (confirmed, completed, cancelled).
     */
    onVisitStatusChange(visit: any, oldStatus: string, newStatus: string, lead: any, company: any): Promise<void>;
    /**
     * Notify when visit is rescheduled.
     */
    onVisitRescheduled(visit: any, oldTime: Date, newTime: Date, lead: any, company: any): Promise<void>;
}
export declare const notificationEngine: NotificationEngine;
export {};
//# sourceMappingURL=notification.engine.d.ts.map
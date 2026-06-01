declare const router: import("express-serve-static-core").Router;
type VisitWithRelations = {
    id: string;
    companyId: string;
    leadId: string;
    propertyId: string | null;
    agentId: string;
    scheduledAt: Date;
    durationMinutes: number;
    status: string;
    notes: string | null;
    reminderSent: boolean;
    createdAt: Date;
    updatedAt: Date;
    lead?: {
        customerName: string | null;
        phone: string | null;
    } | null;
    property?: {
        name?: string | null;
        locationArea?: string | null;
    } | null;
    agent?: {
        name: string | null;
    } | null;
};
export declare function mapVisitToSnakeCaseDTO(visit: VisitWithRelations): {
    id: string;
    company_id: string;
    lead_id: string;
    property_id: string;
    agent_id: string;
    scheduled_at: string;
    duration_minutes: number;
    status: string;
    notes: string;
    reminder_sent: boolean;
    created_at: string;
    updated_at: string;
    customer_name: string;
    customer_phone: string;
    property_name: string;
    property_area: string;
    agent_name: string;
};
export default router;
//# sourceMappingURL=visit.routes.d.ts.map
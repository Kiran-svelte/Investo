import { z } from 'zod';
/**
 * Normalizes commonly entered Indian phone number formats into E.164 (+91XXXXXXXXXX).
 * Accepted inputs:
 * - 9876543210
 * - 919876543210
 * - +91 98765 43210
 * - +91-98765-43210
 */
export declare function normalizeIndianPhoneNumber(input: unknown): unknown;
export declare function isIndianE164Phone(value: string): boolean;
export declare const ROLES: readonly ["super_admin", "company_admin", "sales_agent", "operations", "viewer"];
export type Role = typeof ROLES[number];
export declare const LEAD_STATUSES: readonly ["new", "contacted", "visit_scheduled", "visited", "negotiation", "closed_won", "closed_lost"];
export type LeadStatus = typeof LEAD_STATUSES[number];
export declare const LEAD_TRANSITIONS: Record<LeadStatus, LeadStatus[]>;
export declare const VISIT_STATUSES: readonly ["scheduled", "confirmed", "completed", "cancelled", "no_show"];
export type VisitStatus = typeof VISIT_STATUSES[number];
export declare const VISIT_TRANSITIONS: Record<VisitStatus, VisitStatus[]>;
export declare const CONVERSATION_STATUSES: readonly ["ai_active", "agent_active", "closed"];
export type ConversationStatus = typeof CONVERSATION_STATUSES[number];
export declare const CONVERSATION_TRANSITIONS: Record<ConversationStatus, ConversationStatus[]>;
export declare const PROPERTY_TYPES: readonly ["villa", "apartment", "plot", "commercial"];
export declare const PROPERTY_ASSET_MIME_TYPES: readonly ["image/jpeg", "image/png", "image/webp", "application/pdf", "video/mp4"];
export declare const PROPERTY_IMPORT_DRAFT_STATUSES: readonly ["draft", "extracting", "review_ready", "publish_ready", "published", "failed", "cancelled"];
export type PropertyImportDraftStatus = typeof PROPERTY_IMPORT_DRAFT_STATUSES[number];
export declare const PROPERTY_IMPORT_DRAFT_TRANSITIONS: Record<PropertyImportDraftStatus, PropertyImportDraftStatus[]>;
export declare const registerSchema: z.ZodObject<{
    name: z.ZodString;
    email: z.ZodString;
    password: z.ZodString;
    phone: z.ZodEffects<z.ZodUnion<[z.ZodString, z.ZodNull, z.ZodUndefined]>, string, unknown>;
}, "strip", z.ZodTypeAny, {
    email?: string;
    name?: string;
    phone?: string;
    password?: string;
}, {
    email?: string;
    name?: string;
    phone?: unknown;
    password?: string;
}>;
export declare const loginSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email?: string;
    password?: string;
}, {
    email?: string;
    password?: string;
}>;
export declare const createCompanySchema: z.ZodObject<{
    name: z.ZodString;
    slug: z.ZodString;
    whatsapp_phone: z.ZodEffects<z.ZodUnion<[z.ZodString, z.ZodNull, z.ZodUndefined]>, string, unknown>;
    plan_id: z.ZodUnion<[z.ZodNullable<z.ZodOptional<z.ZodString>>, z.ZodLiteral<"">]>;
}, "strip", z.ZodTypeAny, {
    name?: string;
    slug?: string;
    whatsapp_phone?: string;
    plan_id?: string;
}, {
    name?: string;
    slug?: string;
    whatsapp_phone?: unknown;
    plan_id?: string;
}>;
export declare const createLeadSchema: z.ZodObject<{
    customer_name: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    phone: z.ZodEffects<z.ZodString, string, unknown>;
    email: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    budget_min: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    budget_max: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    location_preference: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    property_type: z.ZodNullable<z.ZodOptional<z.ZodEnum<["villa", "apartment", "plot", "commercial", "other"]>>>;
    source: z.ZodOptional<z.ZodEnum<["whatsapp", "website", "manual", "referral"]>>;
    assigned_agent_id: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    notes: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    language: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    email?: string;
    phone?: string;
    customer_name?: string;
    budget_min?: number;
    budget_max?: number;
    location_preference?: string;
    property_type?: "villa" | "apartment" | "plot" | "commercial" | "other";
    source?: "whatsapp" | "website" | "manual" | "referral";
    assigned_agent_id?: string;
    notes?: string;
    language?: string;
}, {
    email?: string;
    phone?: unknown;
    customer_name?: string;
    budget_min?: number;
    budget_max?: number;
    location_preference?: string;
    property_type?: "villa" | "apartment" | "plot" | "commercial" | "other";
    source?: "whatsapp" | "website" | "manual" | "referral";
    assigned_agent_id?: string;
    notes?: string;
    language?: string;
}>;
export declare const updateLeadStatusSchema: z.ZodObject<{
    status: z.ZodEnum<["new", "contacted", "visit_scheduled", "visited", "negotiation", "closed_won", "closed_lost"]>;
}, "strip", z.ZodTypeAny, {
    status?: "new" | "contacted" | "visit_scheduled" | "visited" | "negotiation" | "closed_won" | "closed_lost";
}, {
    status?: "new" | "contacted" | "visit_scheduled" | "visited" | "negotiation" | "closed_won" | "closed_lost";
}>;
export declare const createPropertySchema: z.ZodObject<{
    name: z.ZodString;
    builder: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    location_city: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    location_area: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    location_pincode: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    price_min: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    price_max: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    bedrooms: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    property_type: z.ZodNullable<z.ZodOptional<z.ZodEnum<["villa", "apartment", "plot", "commercial"]>>>;
    amenities: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    description: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    rera_number: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    status: z.ZodOptional<z.ZodEnum<["available", "sold", "upcoming"]>>;
    images: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    brochure_url: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    floor_plan_urls: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    price_list_url: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    latitude: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    longitude: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    name?: string;
    status?: "available" | "sold" | "upcoming";
    property_type?: "villa" | "apartment" | "plot" | "commercial";
    builder?: string;
    location_city?: string;
    location_area?: string;
    location_pincode?: string;
    price_min?: number;
    price_max?: number;
    bedrooms?: number;
    amenities?: string[];
    description?: string;
    rera_number?: string;
    images?: string[];
    brochure_url?: string;
    floor_plan_urls?: string[];
    price_list_url?: string;
    latitude?: number;
    longitude?: number;
}, {
    name?: string;
    status?: "available" | "sold" | "upcoming";
    property_type?: "villa" | "apartment" | "plot" | "commercial";
    builder?: string;
    location_city?: string;
    location_area?: string;
    location_pincode?: string;
    price_min?: number;
    price_max?: number;
    bedrooms?: number;
    amenities?: string[];
    description?: string;
    rera_number?: string;
    images?: string[];
    brochure_url?: string;
    floor_plan_urls?: string[];
    price_list_url?: string;
    latitude?: number;
    longitude?: number;
}>;
export declare const createPropertyAssetUploadSchema: z.ZodObject<{
    file_name: z.ZodString;
    mime_type: z.ZodEnum<["image/jpeg", "image/png", "image/webp", "application/pdf", "video/mp4"]>;
    file_size: z.ZodNumber;
    property_id: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    asset_type: z.ZodOptional<z.ZodEnum<["image", "brochure"]>>;
}, "strip", z.ZodTypeAny, {
    file_name?: string;
    mime_type?: "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | "video/mp4";
    file_size?: number;
    property_id?: string;
    asset_type?: "image" | "brochure";
}, {
    file_name?: string;
    mime_type?: "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | "video/mp4";
    file_size?: number;
    property_id?: string;
    asset_type?: "image" | "brochure";
}>;
export declare const createPropertyImportDraftSchema: z.ZodObject<{
    draft_data: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    max_retries: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    draft_data?: Record<string, any>;
    max_retries?: number;
}, {
    draft_data?: Record<string, any>;
    max_retries?: number;
}>;
export declare const calculateEmiSchema: z.ZodObject<{
    principal: z.ZodNumber;
    down_payment: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    interest_rate: z.ZodNumber;
    tenure_months: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    principal?: number;
    down_payment?: number;
    interest_rate?: number;
    tenure_months?: number;
}, {
    principal?: number;
    down_payment?: number;
    interest_rate?: number;
    tenure_months?: number;
}>;
export declare const registerPropertyImportUploadSchema: z.ZodObject<{
    file_name: z.ZodString;
    mime_type: z.ZodEnum<["image/jpeg", "image/png", "image/webp", "application/pdf", "video/mp4"]>;
    file_size: z.ZodNumber;
    asset_type: z.ZodEnum<["image", "brochure", "video"]>;
}, "strip", z.ZodTypeAny, {
    file_name?: string;
    mime_type?: "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | "video/mp4";
    file_size?: number;
    asset_type?: "image" | "brochure" | "video";
}, {
    file_name?: string;
    mime_type?: "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | "video/mp4";
    file_size?: number;
    asset_type?: "image" | "brochure" | "video";
}>;
export declare const confirmPropertyImportUploadSchema: z.ZodObject<{
    upload_token: z.ZodString;
}, "strip", z.ZodTypeAny, {
    upload_token?: string;
}, {
    upload_token?: string;
}>;
export declare const updatePropertyImportDraftSchema: z.ZodObject<{
    draft_data: z.ZodRecord<z.ZodString, z.ZodAny>;
    review_notes: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    mark_publish_ready: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    draft_data?: Record<string, any>;
    review_notes?: string;
    mark_publish_ready?: boolean;
}, {
    draft_data?: Record<string, any>;
    review_notes?: string;
    mark_publish_ready?: boolean;
}>;
export declare const publishPropertyImportDraftSchema: z.ZodObject<{
    force_republish: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    force_republish?: boolean;
}, {
    force_republish?: boolean;
}>;
export declare const retryPropertyImportDraftSchema: z.ZodObject<{
    reason: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    reason?: string;
}, {
    reason?: string;
}>;
export declare const cancelPropertyImportDraftSchema: z.ZodObject<{
    reason: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    reason?: string;
}, {
    reason?: string;
}>;
export declare const createVisitSchema: z.ZodObject<{
    lead_id: z.ZodString;
    property_id: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    agent_id: z.ZodString;
    scheduled_at: z.ZodString;
    duration_minutes: z.ZodOptional<z.ZodNumber>;
    notes: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    notes?: string;
    property_id?: string;
    lead_id?: string;
    agent_id?: string;
    scheduled_at?: string;
    duration_minutes?: number;
}, {
    notes?: string;
    property_id?: string;
    lead_id?: string;
    agent_id?: string;
    scheduled_at?: string;
    duration_minutes?: number;
}>;
export declare const updateVisitStatusSchema: z.ZodObject<{
    status: z.ZodEnum<["scheduled", "confirmed", "completed", "cancelled", "no_show"]>;
}, "strip", z.ZodTypeAny, {
    status?: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";
}, {
    status?: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";
}>;
export declare const createUserSchema: z.ZodObject<{
    name: z.ZodString;
    email: z.ZodString;
    password: z.ZodString;
    phone: z.ZodEffects<z.ZodUnion<[z.ZodString, z.ZodNull, z.ZodUndefined]>, string, unknown>;
    role: z.ZodEnum<["super_admin", "company_admin", "sales_agent", "operations", "viewer"]>;
    target_company_id: z.ZodOptional<z.ZodString>;
    must_change_password: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    email?: string;
    name?: string;
    phone?: string;
    role?: "super_admin" | "company_admin" | "sales_agent" | "operations" | "viewer";
    password?: string;
    target_company_id?: string;
    must_change_password?: boolean;
}, {
    email?: string;
    name?: string;
    phone?: unknown;
    role?: "super_admin" | "company_admin" | "sales_agent" | "operations" | "viewer";
    password?: string;
    target_company_id?: string;
    must_change_password?: boolean;
}>;
export declare const aiSettingsSchema: z.ZodObject<{
    business_name: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    business_description: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    operating_locations: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    budget_ranges: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    response_tone: z.ZodOptional<z.ZodEnum<["formal", "friendly", "casual"]>>;
    working_hours: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    faq_knowledge: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodAny>, "many">>;
    greeting_template: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    persuasion_level: z.ZodOptional<z.ZodNumber>;
    auto_detect_language: z.ZodOptional<z.ZodBoolean>;
    default_language: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    business_name?: string;
    business_description?: string;
    operating_locations?: string[];
    budget_ranges?: Record<string, any>;
    response_tone?: "formal" | "friendly" | "casual";
    working_hours?: Record<string, any>;
    faq_knowledge?: Record<string, any>[];
    greeting_template?: string;
    persuasion_level?: number;
    auto_detect_language?: boolean;
    default_language?: string;
}, {
    business_name?: string;
    business_description?: string;
    operating_locations?: string[];
    budget_ranges?: Record<string, any>;
    response_tone?: "formal" | "friendly" | "casual";
    working_hours?: Record<string, any>;
    faq_knowledge?: Record<string, any>[];
    greeting_template?: string;
    persuasion_level?: number;
    auto_detect_language?: boolean;
    default_language?: string;
}>;
export declare const sendConversationMessageSchema: z.ZodDiscriminatedUnion<"mode", [z.ZodObject<{
    mode: z.ZodLiteral<"text">;
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    mode?: "text";
    text?: string;
}, {
    mode?: "text";
    text?: string;
}>, z.ZodObject<{
    mode: z.ZodLiteral<"document">;
    document_url: z.ZodString;
    filename: z.ZodOptional<z.ZodString>;
    caption: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    mode?: "document";
    document_url?: string;
    filename?: string;
    caption?: string;
}, {
    mode?: "document";
    document_url?: string;
    filename?: string;
    caption?: string;
}>, z.ZodObject<{
    mode: z.ZodLiteral<"quick_reply">;
    body_text: z.ZodString;
    header_text: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    footer_text: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    buttons: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id?: string;
        title?: string;
    }, {
        id?: string;
        title?: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    mode?: "quick_reply";
    body_text?: string;
    header_text?: string;
    footer_text?: string;
    buttons?: {
        id?: string;
        title?: string;
    }[];
}, {
    mode?: "quick_reply";
    body_text?: string;
    header_text?: string;
    footer_text?: string;
    buttons?: {
        id?: string;
        title?: string;
    }[];
}>]>;
export type SendConversationMessagePayload = z.infer<typeof sendConversationMessageSchema>;
export declare function isValidTransition<T extends string>(transitions: Record<T, T[]>, from: T, to: T): boolean;
//# sourceMappingURL=validation.d.ts.map
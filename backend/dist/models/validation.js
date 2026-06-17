"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetPasswordSchema = exports.forgotPasswordSchema = exports.changePasswordSchema = exports.updateStaffProfileSchema = exports.sendConversationMessageSchema = exports.aiSettingsSchema = exports.createAiGreetingMediaUploadSchema = exports.greetingMediaItemSchema = exports.createUserSchema = exports.rescheduleVisitSchema = exports.updateVisitStatusSchema = exports.createVisitSchema = exports.propertyImportReplaceUnitsSchema = exports.propertyImportSpreadsheetImportSchema = exports.cancelPropertyImportDraftSchema = exports.retryPropertyImportDraftSchema = exports.publishPropertyImportDraftSchema = exports.updatePropertyImportDraftSchema = exports.confirmPropertyImportUploadSchema = exports.registerPropertyImportUploadSchema = exports.calculateEmiSchema = exports.createPropertyImportDraftSchema = exports.createPropertyAssetUploadSchema = exports.createPropertySchema = exports.updateLeadSchema = exports.updateLeadStatusSchema = exports.createLeadSchema = exports.createCompanySchema = exports.selfServiceSignupSchema = exports.loginSchema = exports.registerSchema = exports.PROPERTY_IMPORT_DRAFT_TRANSITIONS = exports.PROPERTY_IMPORT_DRAFT_STATUSES = exports.PROPERTY_ASSET_MIME_TYPES = exports.PROPERTY_TYPES = exports.CONVERSATION_TRANSITIONS = exports.CONVERSATION_STATUSES = exports.VISIT_TRANSITIONS = exports.VISIT_STATUSES = exports.LEAD_TRANSITIONS = exports.LEAD_STATUSES = exports.ROLES = void 0;
exports.normalizeIndianPhoneNumber = normalizeIndianPhoneNumber;
exports.isIndianE164Phone = isIndianE164Phone;
exports.whatsappPhoneLookupVariants = whatsappPhoneLookupVariants;
exports.isValidTransition = isValidTransition;
exports.isValidVisitTransition = isValidVisitTransition;
const zod_1 = require("zod");
const INDIAN_E164_REGEX = /^\+91\d{10}$/;
/**
 * Normalizes commonly entered Indian phone number formats into E.164 (+91XXXXXXXXXX).
 * Accepted inputs:
 * - 9876543210
 * - 919876543210
 * - +91 98765 43210
 * - +91-98765-43210
 */
function normalizeIndianPhoneNumber(input) {
    if (input === null || input === undefined) {
        return input;
    }
    if (typeof input !== 'string') {
        return input;
    }
    const trimmed = input.trim();
    if (!trimmed) {
        return null;
    }
    // Keep explicit non-Indian international formats invalid.
    if (trimmed.startsWith('+') && !trimmed.startsWith('+91')) {
        return trimmed;
    }
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length === 10 && !trimmed.startsWith('+')) {
        return `+91${digits}`;
    }
    if (digits.length === 12 && digits.startsWith('91')) {
        return `+${digits}`;
    }
    return trimmed;
}
function isIndianE164Phone(value) {
    return INDIAN_E164_REGEX.test(value);
}
/** DB lookup variants for legacy rows stored as 10-digit or 91-prefixed values. */
function whatsappPhoneLookupVariants(e164) {
    const digits = e164.replace(/\D/g, '');
    const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
    return Array.from(new Set([e164, `+91${last10}`, last10, `91${last10}`].filter(Boolean)));
}
// Phone number: E.164 format for Indian numbers
const phoneSchema = zod_1.z.preprocess(normalizeIndianPhoneNumber, zod_1.z.string().regex(INDIAN_E164_REGEX, 'Phone must be in E.164 format: +91XXXXXXXXXX'));
const optionalPhone = zod_1.z.preprocess(normalizeIndianPhoneNumber, zod_1.z.union([
    zod_1.z.string().regex(INDIAN_E164_REGEX, 'Phone must be in E.164 format: +91XXXXXXXXXX'),
    zod_1.z.null(),
    zod_1.z.undefined(),
]));
const emailSchema = zod_1.z.string().email('Invalid email address');
// Roles
exports.ROLES = ['super_admin', 'company_admin', 'sales_agent', 'operations', 'viewer'];
// Lead statuses with valid transitions
exports.LEAD_STATUSES = ['new', 'contacted', 'visit_scheduled', 'visited', 'negotiation', 'closed_won', 'closed_lost'];
exports.LEAD_TRANSITIONS = {
    new: ['contacted'],
    contacted: ['visit_scheduled', 'closed_lost'],
    visit_scheduled: ['visited', 'contacted'], // contacted = cancelled visit reverts
    visited: ['negotiation', 'closed_lost'],
    negotiation: ['closed_won', 'closed_lost'],
    closed_won: [], // terminal
    closed_lost: [], // terminal (only company_admin can reopen to 'contacted')
};
// Visit statuses
exports.VISIT_STATUSES = ['pending_approval', 'scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'];
exports.VISIT_TRANSITIONS = {
    // pending_approval → scheduled means an agent approved it from the dashboard calendar.
    // pending_approval → cancelled means an agent declined it.
    pending_approval: ['scheduled', 'cancelled'],
    // Allow direct scheduled → completed for walk-in / same-day visits where the
    // agent completes the visit without going through the confirmed state.
    // Also allow scheduled → no_show for the same reason.
    scheduled: ['confirmed', 'completed', 'no_show', 'cancelled'],
    confirmed: ['completed', 'no_show', 'cancelled'],
    completed: [], // terminal
    cancelled: [], // terminal
    no_show: [], // terminal
};
// Conversation statuses
exports.CONVERSATION_STATUSES = ['ai_active', 'agent_active', 'closed'];
exports.CONVERSATION_TRANSITIONS = {
    ai_active: ['agent_active', 'closed'],
    agent_active: ['ai_active', 'closed'],
    closed: [], // terminal
};
// Property types
exports.PROPERTY_TYPES = ['villa', 'apartment', 'plot', 'commercial'];
exports.PROPERTY_ASSET_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'video/mp4',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
exports.PROPERTY_IMPORT_DRAFT_STATUSES = ['draft', 'extracting', 'review_ready', 'publish_ready', 'published', 'failed', 'cancelled'];
exports.PROPERTY_IMPORT_DRAFT_TRANSITIONS = {
    draft: ['extracting', 'cancelled'],
    extracting: ['review_ready', 'failed', 'cancelled'],
    review_ready: ['publish_ready', 'extracting', 'failed', 'cancelled'],
    publish_ready: ['published', 'extracting', 'failed', 'cancelled'],
    published: [],
    failed: ['extracting', 'cancelled'],
    cancelled: [],
};
// Validation Schemas
exports.registerSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(255),
    email: emailSchema,
    password: zod_1.z.string().min(8).max(128),
    phone: optionalPhone,
});
exports.loginSchema = zod_1.z.object({
    email: emailSchema,
    password: zod_1.z.string().min(1),
});
exports.selfServiceSignupSchema = zod_1.z.object({
    company_name: zod_1.z.string().min(1).max(255),
    admin_name: zod_1.z.string().min(1).max(255),
    email: emailSchema,
    password: zod_1.z.string().min(8).max(128),
    whatsapp_phone: optionalPhone,
});
exports.createCompanySchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(255),
    slug: zod_1.z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
    whatsapp_phone: optionalPhone,
    plan_id: zod_1.z.string().uuid().optional().nullable().or(zod_1.z.literal('')),
});
exports.createLeadSchema = zod_1.z.object({
    customer_name: zod_1.z.string().max(255).optional().nullable(),
    phone: phoneSchema,
    email: zod_1.z.string().email().optional().nullable(),
    budget_min: zod_1.z.number().positive().optional().nullable(),
    budget_max: zod_1.z.number().positive().optional().nullable(),
    location_preference: zod_1.z.string().max(255).optional().nullable(),
    property_type: zod_1.z.enum(['villa', 'apartment', 'plot', 'commercial', 'other']).optional().nullable(),
    source: zod_1.z.enum(['whatsapp', 'website', 'manual', 'referral']).optional(),
    assigned_agent_id: zod_1.z.string().uuid().optional().nullable(),
    notes: zod_1.z.string().optional().nullable(),
    language: zod_1.z.string().max(5).optional(),
});
exports.updateLeadStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(exports.LEAD_STATUSES),
    /** Company admin may jump to any status (manual correction). */
    force: zod_1.z.boolean().optional(),
});
/** Partial update schema for PUT /api/leads/:id — all fields optional but typed. */
exports.updateLeadSchema = zod_1.z.object({
    customer_name: zod_1.z.string().trim().max(255).optional().nullable(),
    email: zod_1.z.string().email('Invalid email').optional().nullable(),
    budget_min: zod_1.z.number().nonnegative().optional().nullable(),
    budget_max: zod_1.z.number().nonnegative().optional().nullable(),
    location_preference: zod_1.z.string().trim().max(255).optional().nullable(),
    property_type: zod_1.z.enum(['villa', 'apartment', 'plot', 'commercial', 'other']).optional().nullable(),
    assigned_agent_id: zod_1.z.string().uuid().optional().nullable(),
    notes: zod_1.z.string().trim().max(5000).optional().nullable(),
    language: zod_1.z.string().trim().max(5).optional().nullable(),
    tags: zod_1.z.array(zod_1.z.string().trim().max(50)).max(20).optional(),
    lead_score: zod_1.z.string().trim().max(20).optional().nullable(),
    source_detail: zod_1.z.string().trim().max(500).optional().nullable(),
    lost_reason: zod_1.z.string().trim().max(1000).optional().nullable(),
});
exports.createPropertySchema = zod_1.z.object({
    project_id: zod_1.z.string().uuid().optional().nullable(),
    name: zod_1.z.string().min(1).max(255),
    builder: zod_1.z.string().max(255).optional().nullable(),
    location_city: zod_1.z.string().max(100).optional().nullable(),
    location_area: zod_1.z.string().max(100).optional().nullable(),
    location_pincode: zod_1.z.string().max(10).optional().nullable(),
    price_min: zod_1.z.number().positive().optional().nullable(),
    price_max: zod_1.z.number().positive().optional().nullable(),
    bedrooms: zod_1.z.number().int().min(0).optional().nullable(),
    property_type: zod_1.z.enum(['villa', 'apartment', 'plot', 'commercial']).optional().nullable(),
    amenities: zod_1.z.array(zod_1.z.string()).optional(),
    description: zod_1.z.string().optional().nullable(),
    rera_number: zod_1.z.string().max(50).optional().nullable(),
    status: zod_1.z.enum(['available', 'sold', 'upcoming']).optional(),
    // Rich media fields for WhatsApp integration
    images: zod_1.z.array(zod_1.z.string().url().max(500)).max(10).optional(), // Max 10 images
    brochure_url: zod_1.z.string().url().max(500).optional().nullable(),
    floor_plan_urls: zod_1.z.array(zod_1.z.string().url().max(500)).max(10).optional(), // Max 10 floor plans
    price_list_url: zod_1.z.string().url().max(500).optional().nullable(),
    latitude: zod_1.z.number().min(-90).max(90).optional().nullable(), // Valid latitude range
    longitude: zod_1.z.number().min(-180).max(180).optional().nullable(), // Valid longitude range
});
exports.createPropertyAssetUploadSchema = zod_1.z.object({
    file_name: zod_1.z.string().min(1).max(255),
    mime_type: zod_1.z.enum(exports.PROPERTY_ASSET_MIME_TYPES),
    file_size: zod_1.z.number().int().positive(),
    property_id: zod_1.z.string().uuid().optional().nullable(),
    asset_type: zod_1.z.enum(['image', 'brochure']).optional(),
});
exports.createPropertyImportDraftSchema = zod_1.z.object({
    draft_data: zod_1.z.record(zod_1.z.any()).optional(),
    max_retries: zod_1.z.number().int().min(1).max(10).optional(),
    project_id: zod_1.z.string().uuid().optional().nullable(),
});
exports.calculateEmiSchema = zod_1.z.object({
    principal: zod_1.z.number().positive(),
    down_payment: zod_1.z.number().min(0).optional().default(0),
    interest_rate: zod_1.z.number().min(0).max(100),
    tenure_months: zod_1.z.number().int().positive().max(600),
});
exports.registerPropertyImportUploadSchema = zod_1.z.object({
    file_name: zod_1.z.string().min(1).max(255),
    mime_type: zod_1.z.enum(exports.PROPERTY_ASSET_MIME_TYPES),
    file_size: zod_1.z.number().int().positive(),
    asset_type: zod_1.z.enum(['image', 'brochure', 'video']),
});
exports.confirmPropertyImportUploadSchema = zod_1.z.object({
    upload_token: zod_1.z.string().min(10).max(64),
});
exports.updatePropertyImportDraftSchema = zod_1.z.object({
    draft_data: zod_1.z.record(zod_1.z.any()),
    review_notes: zod_1.z.string().max(5000).optional().nullable(),
    mark_publish_ready: zod_1.z.boolean().optional(),
});
exports.publishPropertyImportDraftSchema = zod_1.z.object({
    force_republish: zod_1.z.boolean().optional(),
});
exports.retryPropertyImportDraftSchema = zod_1.z.object({
    reason: zod_1.z.string().max(1000).optional().nullable(),
});
exports.cancelPropertyImportDraftSchema = zod_1.z.object({
    reason: zod_1.z.string().max(1000).optional().nullable(),
    purge: zod_1.z.boolean().optional(),
});
const bulkImportValidation_util_1 = require("../utils/bulkImportValidation.util");
exports.propertyImportSpreadsheetImportSchema = zod_1.z.object({
    project_name: zod_1.z.string().min(1).max(255),
    property_type: zod_1.z.enum(['villa', 'apartment', 'plot', 'commercial', 'other']),
    column_mapping: zod_1.z.record(zod_1.z.string()),
    raw_rows: (0, bulkImportValidation_util_1.bulkImportRawRowsSchema)(500),
});
exports.propertyImportReplaceUnitsSchema = zod_1.z.object({
    units: zod_1.z.array(zod_1.z.object({
        label: zod_1.z.string().max(255).optional().nullable(),
        unit_data: zod_1.z.record(zod_1.z.any()),
        sort_order: zod_1.z.number().int().min(0).optional(),
    })).min(1),
});
exports.createVisitSchema = zod_1.z.object({
    lead_id: zod_1.z.string().uuid(),
    property_id: zod_1.z.string().uuid().optional().nullable(),
    agent_id: zod_1.z.string().uuid(),
    scheduled_at: zod_1.z.string().datetime(),
    duration_minutes: zod_1.z.number().int().min(15).max(480).optional(),
    notes: zod_1.z.string().optional().nullable(),
});
exports.updateVisitStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(exports.VISIT_STATUSES),
});
/** Schema for PUT /api/visits/:id — reschedule a visit. All fields optional but typed. */
exports.rescheduleVisitSchema = zod_1.z.object({
    scheduled_at: zod_1.z.string().datetime({ message: 'scheduled_at must be an ISO 8601 datetime string' }).optional(),
    agent_id: zod_1.z.string().uuid('agent_id must be a valid UUID').optional(),
    notes: zod_1.z.string().trim().max(2000).optional().nullable(),
    property_id: zod_1.z.string().uuid('property_id must be a valid UUID').optional().nullable(),
});
exports.createUserSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(255),
    email: emailSchema,
    password: zod_1.z.string().min(8).max(128),
    phone: optionalPhone,
    role: zod_1.z.enum(exports.ROLES),
    target_company_id: zod_1.z.string().uuid().optional(), // For super_admin to create users in any company
    must_change_password: zod_1.z.boolean().optional(),
    branch_id: zod_1.z.string().uuid().nullable().optional(),
}).superRefine((data, ctx) => {
    const whatsappStaffRoles = ['sales_agent', 'operations', 'company_admin'];
    if (whatsappStaffRoles.includes(data.role) && !data.phone) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: 'Phone number is required for staff who use WhatsApp copilot',
            path: ['phone'],
        });
    }
});
exports.greetingMediaItemSchema = zod_1.z.object({
    id: zod_1.z.string().min(1).max(64),
    kind: zod_1.z.enum(['image', 'document']),
    url: zod_1.z.string().url().max(2000),
    mimeType: zod_1.z.string().min(3).max(100),
    fileName: zod_1.z.string().max(255).optional(),
    caption: zod_1.z.string().max(500).optional(),
});
exports.createAiGreetingMediaUploadSchema = zod_1.z.object({
    file_name: zod_1.z.string().min(1).max(255),
    mime_type: zod_1.z.enum(exports.PROPERTY_ASSET_MIME_TYPES),
    file_size: zod_1.z.number().int().positive().max(20 * 1024 * 1024),
    asset_type: zod_1.z.enum(['image', 'brochure']),
});
exports.aiSettingsSchema = zod_1.z.object({
    business_name: zod_1.z.string().max(255).optional().nullable(),
    business_description: zod_1.z.string().optional().nullable(),
    operating_locations: zod_1.z.array(zod_1.z.string()).optional(),
    budget_ranges: zod_1.z.record(zod_1.z.any()).optional(),
    response_tone: zod_1.z.enum(['formal', 'friendly', 'casual']).optional(),
    working_hours: zod_1.z.record(zod_1.z.any()).optional(),
    faq_knowledge: zod_1.z.array(zod_1.z.record(zod_1.z.any())).optional(),
    greeting_template: zod_1.z.string().optional().nullable(),
    greeting_media: zod_1.z.array(exports.greetingMediaItemSchema).max(2).optional(),
    persuasion_level: zod_1.z.number().int().min(1).max(10).optional(),
    auto_detect_language: zod_1.z.boolean().optional(),
    default_language: zod_1.z.string().max(5).optional(),
});
exports.sendConversationMessageSchema = zod_1.z.discriminatedUnion('mode', [
    zod_1.z.object({
        mode: zod_1.z.literal('text'),
        text: zod_1.z.string().trim().min(1, 'text is required').max(4096, 'text is too long'),
    }),
    zod_1.z.object({
        mode: zod_1.z.literal('document'),
        document_url: zod_1.z.string().url('document_url must be a valid URL'),
        filename: zod_1.z.string().trim().max(255).optional(),
        caption: zod_1.z.string().trim().max(1024).optional().nullable(),
    }),
    zod_1.z.object({
        mode: zod_1.z.literal('quick_reply'),
        body_text: zod_1.z.string().trim().min(1, 'body_text is required').max(1024, 'body_text is too long'),
        header_text: zod_1.z.string().trim().max(60).optional().nullable(),
        footer_text: zod_1.z.string().trim().max(60).optional().nullable(),
        buttons: zod_1.z
            .array(zod_1.z.object({
            id: zod_1.z.string().trim().min(1, 'button id is required').max(256, 'button id is too long'),
            title: zod_1.z.string().trim().min(1, 'button title is required').max(20, 'button title is too long'),
        }))
            .min(1, 'at least 1 button is required')
            .max(3, 'at most 3 buttons are allowed'),
    }),
]);
exports.updateStaffProfileSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1, 'Name is required').max(120).optional(),
    phone: zod_1.z
        .string()
        .trim()
        .min(1, 'Phone number is required')
        .transform(normalizeIndianPhoneNumber)
        .refine((v) => typeof v === 'string' && isIndianE164Phone(v), {
        message: 'Enter a valid Indian mobile number (10 digits)',
    }),
});
// Helper to validate state transitions
function isValidTransition(transitions, from, to) {
    const allowed = transitions[from];
    return allowed ? allowed.includes(to) : false;
}
/** Visit state machine guard — shared by REST API and copilot tools. */
function isValidVisitTransition(from, to) {
    return isValidTransition(exports.VISIT_TRANSITIONS, from, to);
}
/** Schema for POST /api/auth/change-password */
exports.changePasswordSchema = zod_1.z.object({
    current_password: zod_1.z.string().optional(),
    new_password: zod_1.z.string().min(8, 'Password must be at least 8 characters').max(128),
});
/** Schema for POST /api/auth/forgot-password */
exports.forgotPasswordSchema = zod_1.z.object({
    email: zod_1.z.string().trim().pipe(emailSchema),
});
/** Schema for POST /api/auth/reset-password */
exports.resetPasswordSchema = zod_1.z.object({
    token: zod_1.z.string().trim().min(1, 'Token is required'),
    email: emailSchema,
    new_password: zod_1.z.string().min(8, 'Password must be at least 8 characters').max(128),
});

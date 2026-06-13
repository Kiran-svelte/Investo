import { z } from 'zod';

const INDIAN_E164_REGEX = /^\+91\d{10}$/;

/**
 * Normalizes commonly entered Indian phone number formats into E.164 (+91XXXXXXXXXX).
 * Accepted inputs:
 * - 9876543210
 * - 919876543210
 * - +91 98765 43210
 * - +91-98765-43210
 */
export function normalizeIndianPhoneNumber(input: unknown): unknown {
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

export function isIndianE164Phone(value: string): boolean {
  return INDIAN_E164_REGEX.test(value);
}

/** DB lookup variants for legacy rows stored as 10-digit or 91-prefixed values. */
export function whatsappPhoneLookupVariants(e164: string): string[] {
  const digits = e164.replace(/\D/g, '');
  const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
  return Array.from(
    new Set([e164, `+91${last10}`, last10, `91${last10}`].filter(Boolean)),
  );
}

// Phone number: E.164 format for Indian numbers
const phoneSchema = z.preprocess(
  normalizeIndianPhoneNumber,
  z.string().regex(INDIAN_E164_REGEX, 'Phone must be in E.164 format: +91XXXXXXXXXX')
);

const optionalPhone = z.preprocess(
  normalizeIndianPhoneNumber,
  z.union([
    z.string().regex(INDIAN_E164_REGEX, 'Phone must be in E.164 format: +91XXXXXXXXXX'),
    z.null(),
    z.undefined(),
  ])
);

const emailSchema = z.string().email('Invalid email address');

// Roles
export const ROLES = ['super_admin', 'company_admin', 'sales_agent', 'operations', 'viewer'] as const;
export type Role = typeof ROLES[number];

// Lead statuses with valid transitions
export const LEAD_STATUSES = ['new', 'contacted', 'visit_scheduled', 'visited', 'negotiation', 'closed_won', 'closed_lost'] as const;
export type LeadStatus = typeof LEAD_STATUSES[number];

export const LEAD_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  new: ['contacted'],
  contacted: ['visit_scheduled', 'closed_lost'],
  visit_scheduled: ['visited', 'contacted'], // contacted = cancelled visit reverts
  visited: ['negotiation', 'closed_lost'],
  negotiation: ['closed_won', 'closed_lost'],
  closed_won: [],   // terminal
  closed_lost: [],   // terminal (only company_admin can reopen to 'contacted')
};

// Visit statuses
export const VISIT_STATUSES = ['pending_approval', 'scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'] as const;
export type VisitStatus = typeof VISIT_STATUSES[number];

export const VISIT_TRANSITIONS: Record<VisitStatus, VisitStatus[]> = {
  // pending_approval → scheduled means an agent approved it from the dashboard calendar.
  // pending_approval → cancelled means an agent declined it.
  pending_approval: ['scheduled', 'cancelled'],
  // Allow direct scheduled → completed for walk-in / same-day visits where the
  // agent completes the visit without going through the confirmed state.
  // Also allow scheduled → no_show for the same reason.
  scheduled: ['confirmed', 'completed', 'no_show', 'cancelled'],
  confirmed: ['completed', 'no_show', 'cancelled'],
  completed: [],    // terminal
  cancelled: [],    // terminal
  no_show: [],      // terminal
};

// Conversation statuses
export const CONVERSATION_STATUSES = ['ai_active', 'agent_active', 'closed'] as const;
export type ConversationStatus = typeof CONVERSATION_STATUSES[number];

export const CONVERSATION_TRANSITIONS: Record<ConversationStatus, ConversationStatus[]> = {
  ai_active: ['agent_active', 'closed'],
  agent_active: ['ai_active', 'closed'],
  closed: [],  // terminal
};

// Property types
export const PROPERTY_TYPES = ['villa', 'apartment', 'plot', 'commercial'] as const;
export const PROPERTY_ASSET_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;
export const PROPERTY_IMPORT_DRAFT_STATUSES = ['draft', 'extracting', 'review_ready', 'publish_ready', 'published', 'failed', 'cancelled'] as const;
export type PropertyImportDraftStatus = typeof PROPERTY_IMPORT_DRAFT_STATUSES[number];

export const PROPERTY_IMPORT_DRAFT_TRANSITIONS: Record<PropertyImportDraftStatus, PropertyImportDraftStatus[]> = {
  draft: ['extracting', 'cancelled'],
  extracting: ['review_ready', 'failed', 'cancelled'],
  review_ready: ['publish_ready', 'extracting', 'failed', 'cancelled'],
  publish_ready: ['published', 'extracting', 'failed', 'cancelled'],
  published: [],
  failed: ['extracting', 'cancelled'],
  cancelled: [],
};

// Validation Schemas
export const registerSchema = z.object({
  name: z.string().min(1).max(255),
  email: emailSchema,
  password: z.string().min(8).max(128),
  phone: optionalPhone,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

export const selfServiceSignupSchema = z.object({
  company_name: z.string().min(1).max(255),
  admin_name: z.string().min(1).max(255),
  email: emailSchema,
  password: z.string().min(8).max(128),
  whatsapp_phone: optionalPhone,
});

export const createCompanySchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  whatsapp_phone: optionalPhone,
  plan_id: z.string().uuid().optional().nullable().or(z.literal('')),
});

export const createLeadSchema = z.object({
  customer_name: z.string().max(255).optional().nullable(),
  phone: phoneSchema,
  email: z.string().email().optional().nullable(),
  budget_min: z.number().positive().optional().nullable(),
  budget_max: z.number().positive().optional().nullable(),
  location_preference: z.string().max(255).optional().nullable(),
  property_type: z.enum(['villa', 'apartment', 'plot', 'commercial', 'other']).optional().nullable(),
  source: z.enum(['whatsapp', 'website', 'manual', 'referral']).optional(),
  assigned_agent_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
  language: z.string().max(5).optional(),
});

export const updateLeadStatusSchema = z.object({
  status: z.enum(LEAD_STATUSES),
  /** Company admin may jump to any status (manual correction). */
  force: z.boolean().optional(),
});

/** Partial update schema for PUT /api/leads/:id — all fields optional but typed. */
export const updateLeadSchema = z.object({
  customer_name: z.string().trim().max(255).optional().nullable(),
  email: z.string().email('Invalid email').optional().nullable(),
  budget_min: z.number().nonnegative().optional().nullable(),
  budget_max: z.number().nonnegative().optional().nullable(),
  location_preference: z.string().trim().max(255).optional().nullable(),
  property_type: z.enum(['villa', 'apartment', 'plot', 'commercial', 'other']).optional().nullable(),
  assigned_agent_id: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
  language: z.string().trim().max(5).optional().nullable(),
  tags: z.array(z.string().trim().max(50)).max(20).optional(),
  lead_score: z.string().trim().max(20).optional().nullable(),
  source_detail: z.string().trim().max(500).optional().nullable(),
  lost_reason: z.string().trim().max(1000).optional().nullable(),
});

export const createPropertySchema = z.object({
  project_id: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(255),
  builder: z.string().max(255).optional().nullable(),
  location_city: z.string().max(100).optional().nullable(),
  location_area: z.string().max(100).optional().nullable(),
  location_pincode: z.string().max(10).optional().nullable(),
  price_min: z.number().positive().optional().nullable(),
  price_max: z.number().positive().optional().nullable(),
  bedrooms: z.number().int().min(0).optional().nullable(),
  property_type: z.enum(['villa', 'apartment', 'plot', 'commercial']).optional().nullable(),
  amenities: z.array(z.string()).optional(),
  description: z.string().optional().nullable(),
  rera_number: z.string().max(50).optional().nullable(),
  status: z.enum(['available', 'sold', 'upcoming']).optional(),
  // Rich media fields for WhatsApp integration
  images: z.array(z.string().url().max(500)).max(10).optional(), // Max 10 images
  brochure_url: z.string().url().max(500).optional().nullable(),
  floor_plan_urls: z.array(z.string().url().max(500)).max(10).optional(), // Max 10 floor plans
  price_list_url: z.string().url().max(500).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(), // Valid latitude range
  longitude: z.number().min(-180).max(180).optional().nullable(), // Valid longitude range
});

export const createPropertyAssetUploadSchema = z.object({
  file_name: z.string().min(1).max(255),
  mime_type: z.enum(PROPERTY_ASSET_MIME_TYPES),
  file_size: z.number().int().positive(),
  property_id: z.string().uuid().optional().nullable(),
  asset_type: z.enum(['image', 'brochure']).optional(),
});

export const createPropertyImportDraftSchema = z.object({
  draft_data: z.record(z.any()).optional(),
  max_retries: z.number().int().min(1).max(10).optional(),
  project_id: z.string().uuid().optional().nullable(),
});

export const calculateEmiSchema = z.object({
  principal: z.number().positive(),
  down_payment: z.number().min(0).optional().default(0),
  interest_rate: z.number().min(0).max(100),
  tenure_months: z.number().int().positive().max(600),
});

export const registerPropertyImportUploadSchema = z.object({
  file_name: z.string().min(1).max(255),
  mime_type: z.enum(PROPERTY_ASSET_MIME_TYPES),
  file_size: z.number().int().positive(),
  asset_type: z.enum(['image', 'brochure', 'video']),
});

export const confirmPropertyImportUploadSchema = z.object({
  upload_token: z.string().min(10).max(64),
});

export const updatePropertyImportDraftSchema = z.object({
  draft_data: z.record(z.any()),
  review_notes: z.string().max(5000).optional().nullable(),
  mark_publish_ready: z.boolean().optional(),
});

export const publishPropertyImportDraftSchema = z.object({
  force_republish: z.boolean().optional(),
});

export const retryPropertyImportDraftSchema = z.object({
  reason: z.string().max(1000).optional().nullable(),
});

export const cancelPropertyImportDraftSchema = z.object({
  reason: z.string().max(1000).optional().nullable(),
  purge: z.boolean().optional(),
});

import { bulkImportRawRowsSchema } from '../utils/bulkImportValidation.util';

export const propertyImportSpreadsheetImportSchema = z.object({
  project_name: z.string().min(1).max(255),
  property_type: z.enum(['villa', 'apartment', 'plot', 'commercial', 'other']),
  column_mapping: z.record(z.string()),
  raw_rows: bulkImportRawRowsSchema(500),
});

export const propertyImportReplaceUnitsSchema = z.object({
  units: z.array(z.object({
    label: z.string().max(255).optional().nullable(),
    unit_data: z.record(z.any()),
    sort_order: z.number().int().min(0).optional(),
  })).min(1),
});

export const createVisitSchema = z.object({
  lead_id: z.string().uuid(),
  property_id: z.string().uuid().optional().nullable(),
  agent_id: z.string().uuid(),
  scheduled_at: z.string().datetime(),
  duration_minutes: z.number().int().min(15).max(480).optional(),
  notes: z.string().optional().nullable(),
});

export const updateVisitStatusSchema = z.object({
  status: z.enum(VISIT_STATUSES),
});

/** Schema for PUT /api/visits/:id — reschedule a visit. All fields optional but typed. */
export const rescheduleVisitSchema = z.object({
  scheduled_at: z.string().datetime({ message: 'scheduled_at must be an ISO 8601 datetime string' }).optional(),
  agent_id: z.string().uuid('agent_id must be a valid UUID').optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  property_id: z.string().uuid('property_id must be a valid UUID').optional().nullable(),
});

export const createUserSchema = z.object({
  name: z.string().min(1).max(255),
  email: emailSchema,
  password: z.string().min(8).max(128),
  phone: optionalPhone,
  role: z.enum(ROLES),
  target_company_id: z.string().uuid().optional(), // For super_admin to create users in any company
  must_change_password: z.boolean().optional(),
}).superRefine((data, ctx) => {
  const whatsappStaffRoles = ['sales_agent', 'operations', 'company_admin'] as const;
  if (whatsappStaffRoles.includes(data.role as typeof whatsappStaffRoles[number]) && !data.phone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Phone number is required for staff who use WhatsApp copilot',
      path: ['phone'],
    });
  }
});

export const greetingMediaItemSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(['image', 'document']),
  url: z.string().url().max(2000),
  mimeType: z.string().min(3).max(100),
  fileName: z.string().max(255).optional(),
  caption: z.string().max(500).optional(),
});

export const createAiGreetingMediaUploadSchema = z.object({
  file_name: z.string().min(1).max(255),
  mime_type: z.enum(PROPERTY_ASSET_MIME_TYPES),
  file_size: z.number().int().positive().max(20 * 1024 * 1024),
  asset_type: z.enum(['image', 'brochure']),
});

export const aiSettingsSchema = z.object({
  business_name: z.string().max(255).optional().nullable(),
  business_description: z.string().optional().nullable(),
  operating_locations: z.array(z.string()).optional(),
  budget_ranges: z.record(z.any()).optional(),
  response_tone: z.enum(['formal', 'friendly', 'casual']).optional(),
  working_hours: z.record(z.any()).optional(),
  faq_knowledge: z.array(z.record(z.any())).optional(),
  greeting_template: z.string().optional().nullable(),
  greeting_media: z.array(greetingMediaItemSchema).max(2).optional(),
  persuasion_level: z.number().int().min(1).max(10).optional(),
  auto_detect_language: z.boolean().optional(),
  default_language: z.string().max(5).optional(),
});

export const sendConversationMessageSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('text'),
    text: z.string().trim().min(1, 'text is required').max(4096, 'text is too long'),
  }),
  z.object({
    mode: z.literal('document'),
    document_url: z.string().url('document_url must be a valid URL'),
    filename: z.string().trim().max(255).optional(),
    caption: z.string().trim().max(1024).optional().nullable(),
  }),
  z.object({
    mode: z.literal('quick_reply'),
    body_text: z.string().trim().min(1, 'body_text is required').max(1024, 'body_text is too long'),
    header_text: z.string().trim().max(60).optional().nullable(),
    footer_text: z.string().trim().max(60).optional().nullable(),
    buttons: z
      .array(
        z.object({
          id: z.string().trim().min(1, 'button id is required').max(256, 'button id is too long'),
          title: z.string().trim().min(1, 'button title is required').max(20, 'button title is too long'),
        })
      )
      .min(1, 'at least 1 button is required')
      .max(3, 'at most 3 buttons are allowed'),
  }),
]);

export type SendConversationMessagePayload = z.infer<typeof sendConversationMessageSchema>;

export const updateStaffProfileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120).optional(),
  phone: z
    .string()
    .trim()
    .min(1, 'Phone number is required')
    .transform(normalizeIndianPhoneNumber)
    .refine((v) => typeof v === 'string' && isIndianE164Phone(v), {
      message: 'Enter a valid Indian mobile number (10 digits)',
    }),
});

// Helper to validate state transitions
export function isValidTransition<T extends string>(
  transitions: Record<T, T[]>,
  from: T,
  to: T,
): boolean {
  const allowed = transitions[from];
  return allowed ? allowed.includes(to) : false;
}

/** Visit state machine guard — shared by REST API and copilot tools. */
export function isValidVisitTransition(from: VisitStatus, to: VisitStatus): boolean {
  return isValidTransition(VISIT_TRANSITIONS, from, to);
}

/** Schema for POST /api/auth/change-password */
export const changePasswordSchema = z.object({
  current_password: z.string().optional(),
  new_password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

/** Schema for POST /api/auth/forgot-password */
export const forgotPasswordSchema = z.object({
  email: z.string().trim().pipe(emailSchema),
});

/** Schema for POST /api/auth/reset-password */
export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1, 'Token is required'),
  email: emailSchema,
  new_password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

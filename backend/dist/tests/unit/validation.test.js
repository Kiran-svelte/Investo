"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const validation_1 = require("../../models/validation");
describe('State Machine: Lead Transitions', () => {
    test('new -> contacted is valid', () => {
        expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'new', 'contacted')).toBe(true);
    });
    test('new -> visit_scheduled is NOT valid (cannot skip)', () => {
        expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'new', 'visit_scheduled')).toBe(false);
    });
    test('new -> closed_won is NOT valid (cannot skip)', () => {
        expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'new', 'closed_won')).toBe(false);
    });
    test('contacted -> visit_scheduled is valid', () => {
        expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'contacted', 'visit_scheduled')).toBe(true);
    });
    test('contacted -> closed_lost is valid', () => {
        expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'contacted', 'closed_lost')).toBe(true);
    });
    test('visit_scheduled -> visited is valid', () => {
        expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'visit_scheduled', 'visited')).toBe(true);
    });
    test('visit_scheduled -> contacted is valid (cancel reverts)', () => {
        expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'visit_scheduled', 'contacted')).toBe(true);
    });
    test('visited -> negotiation is valid', () => {
        expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'visited', 'negotiation')).toBe(true);
    });
    test('visited -> closed_lost is valid', () => {
        expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'visited', 'closed_lost')).toBe(true);
    });
    test('negotiation -> closed_won is valid', () => {
        expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'negotiation', 'closed_won')).toBe(true);
    });
    test('negotiation -> closed_lost is valid', () => {
        expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'negotiation', 'closed_lost')).toBe(true);
    });
    test('closed_won is terminal (no transitions)', () => {
        expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'closed_won', 'new')).toBe(false);
        expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'closed_won', 'contacted')).toBe(false);
        expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'closed_won', 'negotiation')).toBe(false);
    });
    test('closed_lost is terminal (no transitions)', () => {
        expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'closed_lost', 'new')).toBe(false);
        expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'closed_lost', 'contacted')).toBe(false);
    });
    test('cannot skip from new to negotiation', () => {
        expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'new', 'negotiation')).toBe(false);
    });
    test('cannot skip from contacted to visited', () => {
        expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'contacted', 'visited')).toBe(false);
    });
});
describe('State Machine: Visit Transitions', () => {
    test('scheduled -> confirmed is valid', () => {
        expect((0, validation_1.isValidTransition)(validation_1.VISIT_TRANSITIONS, 'scheduled', 'confirmed')).toBe(true);
    });
    test('scheduled -> cancelled is valid', () => {
        expect((0, validation_1.isValidTransition)(validation_1.VISIT_TRANSITIONS, 'scheduled', 'cancelled')).toBe(true);
    });
    test('confirmed -> completed is valid', () => {
        expect((0, validation_1.isValidTransition)(validation_1.VISIT_TRANSITIONS, 'confirmed', 'completed')).toBe(true);
    });
    test('confirmed -> no_show is valid', () => {
        expect((0, validation_1.isValidTransition)(validation_1.VISIT_TRANSITIONS, 'confirmed', 'no_show')).toBe(true);
    });
    test('completed is terminal', () => {
        expect((0, validation_1.isValidTransition)(validation_1.VISIT_TRANSITIONS, 'completed', 'scheduled')).toBe(false);
    });
    test('cancelled is terminal', () => {
        expect((0, validation_1.isValidTransition)(validation_1.VISIT_TRANSITIONS, 'cancelled', 'scheduled')).toBe(false);
    });
    test('no_show is terminal', () => {
        expect((0, validation_1.isValidTransition)(validation_1.VISIT_TRANSITIONS, 'no_show', 'scheduled')).toBe(false);
    });
    test('cannot skip scheduled -> completed', () => {
        expect((0, validation_1.isValidTransition)(validation_1.VISIT_TRANSITIONS, 'scheduled', 'completed')).toBe(false);
    });
});
describe('State Machine: Conversation Transitions', () => {
    test('ai_active -> agent_active is valid', () => {
        expect((0, validation_1.isValidTransition)(validation_1.CONVERSATION_TRANSITIONS, 'ai_active', 'agent_active')).toBe(true);
    });
    test('ai_active -> closed is valid', () => {
        expect((0, validation_1.isValidTransition)(validation_1.CONVERSATION_TRANSITIONS, 'ai_active', 'closed')).toBe(true);
    });
    test('agent_active -> ai_active is valid', () => {
        expect((0, validation_1.isValidTransition)(validation_1.CONVERSATION_TRANSITIONS, 'agent_active', 'ai_active')).toBe(true);
    });
    test('agent_active -> closed is valid', () => {
        expect((0, validation_1.isValidTransition)(validation_1.CONVERSATION_TRANSITIONS, 'agent_active', 'closed')).toBe(true);
    });
    test('closed is terminal', () => {
        expect((0, validation_1.isValidTransition)(validation_1.CONVERSATION_TRANSITIONS, 'closed', 'ai_active')).toBe(false);
        expect((0, validation_1.isValidTransition)(validation_1.CONVERSATION_TRANSITIONS, 'closed', 'agent_active')).toBe(false);
    });
});
describe('Validation: Login Schema', () => {
    test('valid login data passes', () => {
        const result = validation_1.loginSchema.safeParse({ email: 'test@example.com', password: 'pass123' });
        expect(result.success).toBe(true);
    });
    test('invalid email fails', () => {
        const result = validation_1.loginSchema.safeParse({ email: 'notanemail', password: 'pass123' });
        expect(result.success).toBe(false);
    });
    test('missing password fails', () => {
        const result = validation_1.loginSchema.safeParse({ email: 'test@example.com' });
        expect(result.success).toBe(false);
    });
});
describe('Validation: Register Schema', () => {
    test('valid registration data passes', () => {
        const result = validation_1.registerSchema.safeParse({
            name: 'Test User',
            email: 'test@example.com',
            password: 'securepass',
        });
        expect(result.success).toBe(true);
    });
    test('short password fails', () => {
        const result = validation_1.registerSchema.safeParse({
            name: 'Test User',
            email: 'test@example.com',
            password: 'short',
        });
        expect(result.success).toBe(false);
    });
});
describe('Validation: Lead Schema', () => {
    test('valid lead with E.164 phone passes', () => {
        const result = validation_1.createLeadSchema.safeParse({
            customer_name: 'Rahul',
            phone: '+919876543210',
            budget_min: 5000000,
        });
        expect(result.success).toBe(true);
    });
    test('valid lead with local Indian phone is normalized and passes', () => {
        const result = validation_1.createLeadSchema.safeParse({
            phone: '9876543210',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.phone).toBe('+919876543210');
        }
    });
    test('local Indian phone is accepted and normalized', () => {
        const result = validation_1.createLeadSchema.safeParse({
            phone: '9876543210',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.phone).toBe('+919876543210');
        }
    });
    test('phone with non-Indian country code fails', () => {
        const result = validation_1.createLeadSchema.safeParse({
            phone: '+1234567890', // not Indian
        });
        expect(result.success).toBe(false);
    });
    test('valid property types accepted', () => {
        const result = validation_1.createLeadSchema.safeParse({
            phone: '+919876543210',
            property_type: 'villa',
        });
        expect(result.success).toBe(true);
    });
    test('invalid property type rejected', () => {
        const result = validation_1.createLeadSchema.safeParse({
            phone: '+919876543210',
            property_type: 'castle',
        });
        expect(result.success).toBe(false);
    });
});
describe('Validation: Company Schema', () => {
    test('company whatsapp local phone is normalized and passes', () => {
        const result = validation_1.createCompanySchema.safeParse({
            name: 'PLM',
            slug: 'plm',
            whatsapp_phone: '9036165606',
            plan_id: '',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.whatsapp_phone).toBe('+919036165606');
        }
    });
    test('company whatsapp invalid country code fails', () => {
        const result = validation_1.createCompanySchema.safeParse({
            name: 'PLM',
            slug: 'plm',
            whatsapp_phone: '+1234567890',
            plan_id: '',
        });
        expect(result.success).toBe(false);
    });
});
describe('Validation: User Schema', () => {
    test('optional user phone local format is normalized and passes', () => {
        const result = validation_1.createUserSchema.safeParse({
            name: 'Ops User',
            email: 'ops@example.com',
            password: 'securepass123',
            phone: '9876543210',
            role: 'operations',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.phone).toBe('+919876543210');
        }
    });
});
describe('Validation: Visit Schema', () => {
    test('valid visit data passes', () => {
        const result = validation_1.createVisitSchema.safeParse({
            lead_id: '550e8400-e29b-41d4-a716-446655440000',
            agent_id: '550e8400-e29b-41d4-a716-446655440001',
            scheduled_at: '2026-04-01T10:00:00.000Z',
        });
        expect(result.success).toBe(true);
    });
    test('missing lead_id fails', () => {
        const result = validation_1.createVisitSchema.safeParse({
            agent_id: '550e8400-e29b-41d4-a716-446655440001',
            scheduled_at: '2026-04-01T10:00:00.000Z',
        });
        expect(result.success).toBe(false);
    });
    test('invalid UUID fails', () => {
        const result = validation_1.createVisitSchema.safeParse({
            lead_id: 'not-a-uuid',
            agent_id: '550e8400-e29b-41d4-a716-446655440001',
            scheduled_at: '2026-04-01T10:00:00.000Z',
        });
        expect(result.success).toBe(false);
    });
    test('duration within bounds passes', () => {
        const result = validation_1.createVisitSchema.safeParse({
            lead_id: '550e8400-e29b-41d4-a716-446655440000',
            agent_id: '550e8400-e29b-41d4-a716-446655440001',
            scheduled_at: '2026-04-01T10:00:00.000Z',
            duration_minutes: 120,
        });
        expect(result.success).toBe(true);
    });
    test('duration too short fails', () => {
        const result = validation_1.createVisitSchema.safeParse({
            lead_id: '550e8400-e29b-41d4-a716-446655440000',
            agent_id: '550e8400-e29b-41d4-a716-446655440001',
            scheduled_at: '2026-04-01T10:00:00.000Z',
            duration_minutes: 5,
        });
        expect(result.success).toBe(false);
    });
});
describe('Validation: Property Asset Upload Schema', () => {
    test('valid image upload payload passes', () => {
        const result = validation_1.createPropertyAssetUploadSchema.safeParse({
            file_name: 'living-room.webp',
            mime_type: 'image/webp',
            file_size: 1024,
            property_id: '550e8400-e29b-41d4-a716-446655440000',
            asset_type: 'image',
        });
        expect(result.success).toBe(true);
    });
    test('invalid mime type fails', () => {
        const result = validation_1.createPropertyAssetUploadSchema.safeParse({
            file_name: 'living-room.exe',
            mime_type: 'application/x-msdownload',
            file_size: 1024,
        });
        expect(result.success).toBe(false);
    });
    test('missing file name fails', () => {
        const result = validation_1.createPropertyAssetUploadSchema.safeParse({
            mime_type: 'image/png',
            file_size: 1024,
        });
        expect(result.success).toBe(false);
    });
});
describe('Validation: Property Import Schemas', () => {
    test('valid draft creation payload passes', () => {
        const result = validation_1.createPropertyImportDraftSchema.safeParse({
            draft_data: { name: 'Sunrise Villa', location_city: 'Bengaluru' },
            max_retries: 3,
        });
        expect(result.success).toBe(true);
    });
    test('upload registration accepts video/mp4 in import workflow', () => {
        const result = validation_1.registerPropertyImportUploadSchema.safeParse({
            file_name: 'walkthrough.mp4',
            mime_type: 'video/mp4',
            file_size: 2000000,
            asset_type: 'video',
        });
        expect(result.success).toBe(true);
    });
    test('confirm upload requires token', () => {
        const result = validation_1.confirmPropertyImportUploadSchema.safeParse({
            upload_token: 'abc',
        });
        expect(result.success).toBe(false);
    });
    test('draft update can mark publish-ready', () => {
        const result = validation_1.updatePropertyImportDraftSchema.safeParse({
            draft_data: { name: 'Sunrise Villa' },
            review_notes: 'Reviewed manually',
            mark_publish_ready: true,
        });
        expect(result.success).toBe(true);
    });
});
describe('State Machine: Property Import Draft Transitions', () => {
    test('draft -> extracting is valid', () => {
        expect((0, validation_1.isValidTransition)(validation_1.PROPERTY_IMPORT_DRAFT_TRANSITIONS, 'draft', 'extracting')).toBe(true);
    });
    test('failed -> extracting is valid retry path', () => {
        expect((0, validation_1.isValidTransition)(validation_1.PROPERTY_IMPORT_DRAFT_TRANSITIONS, 'failed', 'extracting')).toBe(true);
    });
    test('published is terminal', () => {
        expect((0, validation_1.isValidTransition)(validation_1.PROPERTY_IMPORT_DRAFT_TRANSITIONS, 'published', 'extracting')).toBe(false);
    });
});
//# sourceMappingURL=validation.test.js.map
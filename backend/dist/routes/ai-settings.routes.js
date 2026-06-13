"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const tenant_1 = require("../middleware/tenant");
const audit_1 = require("../middleware/audit");
const validate_1 = require("../middleware/validate");
const featureGate_1 = require("../middleware/featureGate");
const validation_1 = require("../models/validation");
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const aiKnowledgeStorage_service_1 = require("../services/aiKnowledgeStorage.service");
const storage_service_1 = require("../services/storage.service");
const rejectPlatformAdmin_1 = require("../middleware/rejectPlatformAdmin");
const greetingMedia_util_1 = require("../utils/greetingMedia.util");
const router = (0, express_1.Router)();
async function markWhatsAppVerified(companyId) {
    const company = await prisma_1.default.company.findUnique({
        where: { id: companyId },
        select: { settings: true },
    });
    if (!company) {
        return;
    }
    const settings = (company.settings && typeof company.settings === 'object')
        ? { ...company.settings }
        : {};
    const whatsapp = (settings.whatsapp && typeof settings.whatsapp === 'object')
        ? { ...settings.whatsapp }
        : {};
    whatsapp.verifiedAt = new Date().toISOString();
    settings.whatsapp = whatsapp;
    await prisma_1.default.company.update({
        where: { id: companyId },
        data: { settings: settings },
    });
}
router.use(auth_1.authenticate);
router.use((req, res, next) => {
    if ((0, rejectPlatformAdmin_1.rejectPlatformAdminTenantApi)(req, res))
        return;
    next();
});
router.use(tenant_1.tenantIsolation);
router.use((0, featureGate_1.requireFeature)('ai_bot'));
/**
 * GET /api/ai-settings
 * Get AI configuration for the company.
 */
router.get('/', (0, rbac_1.authorize)('ai_settings', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        let settings = await prisma_1.default.aiSetting.findUnique({ where: { companyId } });
        if (!settings) {
            settings = await prisma_1.default.aiSetting.create({
                data: {
                    companyId,
                    responseTone: 'friendly',
                    persuasionLevel: 7,
                    autoDetectLanguage: true,
                    defaultLanguage: 'en',
                },
            });
        }
        const supabaseFaqs = await (0, aiKnowledgeStorage_service_1.loadFaqKnowledgeFromSupabase)(companyId);
        if (supabaseFaqs !== null) {
            settings = { ...settings, faqKnowledge: supabaseFaqs };
        }
        res.json({ data: settings });
    }
    catch (err) {
        logger_1.default.error('Failed to fetch AI settings', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch AI settings' });
    }
});
/**
 * PUT /api/ai-settings
 * Update AI configuration.
 */
router.put('/', (0, rbac_1.authorize)('ai_settings', 'update'), (0, validate_1.validate)(validation_1.aiSettingsSchema), (0, audit_1.auditLog)('update', 'ai_settings'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const data = req.body;
        const updateFields = {};
        if (data.business_name !== undefined)
            updateFields.businessName = data.business_name;
        if (data.business_description !== undefined)
            updateFields.businessDescription = data.business_description;
        if (data.operating_locations !== undefined)
            updateFields.operatingLocations = data.operating_locations;
        if (data.budget_ranges !== undefined)
            updateFields.budgetRanges = data.budget_ranges;
        if (data.response_tone !== undefined)
            updateFields.responseTone = data.response_tone;
        if (data.working_hours !== undefined)
            updateFields.workingHours = data.working_hours;
        if (data.faq_knowledge !== undefined)
            updateFields.faqKnowledge = data.faq_knowledge;
        if (data.greeting_template !== undefined)
            updateFields.greetingTemplate = data.greeting_template;
        if (data.greeting_media !== undefined)
            updateFields.greetingMedia = data.greeting_media;
        if (data.persuasion_level !== undefined)
            updateFields.persuasionLevel = data.persuasion_level;
        if (data.auto_detect_language !== undefined)
            updateFields.autoDetectLanguage = data.auto_detect_language;
        if (data.default_language !== undefined)
            updateFields.defaultLanguage = data.default_language;
        const settings = await prisma_1.default.aiSetting.upsert({
            where: { companyId },
            update: updateFields,
            create: {
                companyId,
                ...updateFields,
            },
        });
        if (data.faq_knowledge !== undefined) {
            void (0, aiKnowledgeStorage_service_1.syncFaqKnowledgeToSupabase)(companyId, data.faq_knowledge).catch((syncErr) => {
                logger_1.default.warn('FAQ knowledge Supabase sync failed', { companyId, error: syncErr.message });
            });
        }
        res.json({ data: settings });
    }
    catch (err) {
        logger_1.default.error('Failed to update AI settings', { error: err.message });
        res.status(500).json({ error: 'Failed to update AI settings' });
    }
});
/**
 * POST /api/ai-settings/greeting-media/upload-url
 * Presigned upload for greeting hero image or brochure PDF.
 */
router.post('/greeting-media/upload-url', (0, rbac_1.authorize)('ai_settings', 'update'), (0, validate_1.validate)(validation_1.createAiGreetingMediaUploadSchema), (0, audit_1.auditLog)('create', 'ai_settings_greeting_media_upload'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const { file_name, mime_type, file_size, asset_type } = req.body;
        const upload = await storage_service_1.storageService.createAiGreetingMediaUploadUrl({
            companyId,
            fileName: file_name,
            mimeType: mime_type,
            fileSize: file_size,
            assetType: asset_type,
        });
        res.status(201).json({ data: upload });
    }
    catch (err) {
        const message = err?.message || 'Failed to create greeting media upload URL';
        logger_1.default.error('Failed to create greeting media upload URL', { error: message });
        if (message.startsWith('R2 storage is not configured')
            || message.startsWith('AWS S3 storage is not configured')
            || message.startsWith('No object storage configured')) {
            res.status(503).json({ error: message });
            return;
        }
        res.status(400).json({ error: message });
    }
});
/**
 * POST /api/ai-settings/greeting-media/test
 * Verify saved greeting media URLs are reachable (HEAD).
 */
router.post('/greeting-media/test', (0, rbac_1.authorize)('ai_settings', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const bodyItems = Array.isArray(req.body?.items) ? req.body.items : null;
        let items = bodyItems;
        if (!items) {
            const settings = await prisma_1.default.aiSetting.findUnique({
                where: { companyId },
                select: { greetingMedia: true },
            });
            items = (0, greetingMedia_util_1.parseGreetingMediaItems)(settings?.greetingMedia);
        }
        else {
            items = (0, greetingMedia_util_1.parseGreetingMediaItems)(items);
        }
        if (!items.length) {
            res.status(400).json({ success: false, error: 'No greeting media configured' });
            return;
        }
        const results = await Promise.all(items.map(async (item) => {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 8000);
                const response = await fetch(item.url, { method: 'HEAD', signal: controller.signal });
                clearTimeout(timer);
                return {
                    id: item.id,
                    url: item.url,
                    ok: response.ok,
                    status: response.status,
                    kind: item.kind,
                };
            }
            catch (err) {
                return {
                    id: item.id,
                    url: item.url,
                    ok: false,
                    status: 0,
                    kind: item.kind,
                    error: err?.message || 'Request failed',
                };
            }
        }));
        const success = results.every((r) => r.ok);
        res.json({ success, items: results });
    }
    catch (err) {
        logger_1.default.error('Greeting media test failed', { error: err.message });
        res.status(500).json({ success: false, error: 'Failed to test greeting media' });
    }
});
/**
 * POST /api/ai-settings/whatsapp/test
 * Test WhatsApp connection with the provided config.
 */
router.post('/whatsapp/test', (0, rbac_1.authorize)('ai_settings', 'update'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const { phone_number_id, access_token } = req.body;
        if (!phone_number_id || !access_token) {
            res.status(400).json({ success: false, error: 'phone_number_id and access_token are required' });
            return;
        }
        const { whatsappService } = await Promise.resolve().then(() => __importStar(require('../services/whatsapp.service')));
        const result = await whatsappService.testConnection({
            provider: 'meta',
            phoneNumberId: phone_number_id,
            accessToken: access_token,
            verifyToken: '',
        });
        if (result.success) {
            await markWhatsAppVerified(companyId);
            res.json({ success: true, provider: 'meta', message: 'WhatsApp connection successful' });
        }
        else {
            res.status(400).json({ success: false, provider: 'meta', error: result.error });
        }
    }
    catch (err) {
        logger_1.default.error('WhatsApp test failed', { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.default = router;

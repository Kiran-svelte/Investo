"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const tenant_1 = require("../middleware/tenant");
const featureGate_1 = require("../middleware/featureGate");
const validate_1 = require("../middleware/validate");
const audit_1 = require("../middleware/audit");
const validation_1 = require("../models/validation");
const logger_1 = __importDefault(require("../config/logger"));
const propertyImport_service_1 = require("../services/propertyImport.service");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.use(tenant_1.tenantIsolation);
router.use((0, featureGate_1.requireFeature)('property_management'));
function isStatusCodedError(err) {
    return Boolean(err)
        && typeof err === 'object'
        && 'statusCode' in err
        && typeof err.statusCode === 'number'
        && typeof err.message === 'string';
}
function getRequestBaseUrl(req) {
    const forwardedProto = (req.header('x-forwarded-proto') || '').split(',')[0]?.trim();
    const host = (req.header('x-forwarded-host') || req.header('host') || '').trim();
    const isLocalhost = host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.startsWith('[::1]');
    const proto = forwardedProto || (isLocalhost ? 'http' : 'https');
    return `${proto}://${host}`;
}
function handleRouteError(err, res, fallbackMessage) {
    if (isStatusCodedError(err)) {
        res.status(err.statusCode).json({ error: err.message });
        return;
    }
    if (err instanceof Error) {
        const message = err.message || fallbackMessage;
        if (message.startsWith('R2 storage is not configured')) {
            res.status(503).json({ error: message });
            return;
        }
        const shouldUseBadRequest = message.startsWith('Unsupported mime type')
            || message.startsWith('File size')
            || message.toLowerCase().includes('validation')
            || message.toLowerCase().includes('not found');
        if (shouldUseBadRequest) {
            res.status(400).json({ error: message });
            return;
        }
        // Surface the actual error message even if it's a 500, to help diagnose environment issues.
        res.status(500).json({ error: message });
        return;
    }
    logger_1.default.error('Property import route failure', {
        error: err instanceof Error ? err.message : String(err),
        fallbackMessage,
    });
    res.status(500).json({ error: fallbackMessage });
}
/**
 * POST /api/property-imports/drafts
 * Create a new import draft for the authenticated tenant.
 */
router.post('/drafts', (0, rbac_1.authorize)('properties', 'create'), (0, validate_1.validate)(validation_1.createPropertyImportDraftSchema), (0, audit_1.auditLog)('create_draft', 'property_imports'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const userId = req.user.id;
        const draft = await propertyImport_service_1.propertyImportService.createDraft(companyId, userId, {
            draftData: req.body.draft_data,
            maxRetries: req.body.max_retries,
        });
        res.status(201).json({ data: draft, id: draft.id });
    }
    catch (err) {
        handleRouteError(err, res, 'Failed to create property import draft');
    }
});
/**
 * GET /api/property-imports/drafts/:id
 * Read draft status, media, and extraction jobs.
 */
router.get('/drafts/:id', (0, rbac_1.authorize)('properties', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const draft = await propertyImport_service_1.propertyImportService.getDraft(companyId, req.params.id);
        res.json({ data: draft });
    }
    catch (err) {
        handleRouteError(err, res, 'Failed to fetch property import draft');
    }
});
/**
 * POST /api/property-imports/drafts/:id/uploads
 * Register media upload and return a presigned R2 URL.
 */
router.post('/drafts/:id/uploads', (0, rbac_1.authorize)('properties', 'update'), (0, validate_1.validate)(validation_1.registerPropertyImportUploadSchema), (0, audit_1.auditLog)('register_upload', 'property_imports'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const baseUrl = getRequestBaseUrl(req);
        const result = await propertyImport_service_1.propertyImportService.registerUpload(companyId, req.params.id, {
            fileName: req.body.file_name,
            mimeType: req.body.mime_type,
            fileSize: req.body.file_size,
            assetType: req.body.asset_type,
        }, { baseUrl });
        res.status(201).json({ data: result });
    }
    catch (err) {
        handleRouteError(err, res, 'Failed to register upload');
    }
});
/**
 * POST /api/property-imports/drafts/:id/uploads/confirm
 * Verify upload exists in R2 and enqueue extraction.
 */
router.post('/drafts/:id/uploads/confirm', (0, rbac_1.authorize)('properties', 'update'), (0, validate_1.validate)(validation_1.confirmPropertyImportUploadSchema), (0, audit_1.auditLog)('confirm_upload', 'property_imports'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const result = await propertyImport_service_1.propertyImportService.confirmUpload(companyId, req.params.id, req.body.upload_token);
        res.json({ data: result });
    }
    catch (err) {
        handleRouteError(err, res, 'Failed to confirm upload');
    }
});
/**
 * PUT /api/property-imports/drafts/:id
 * Manual override or save draft data.
 */
router.put('/drafts/:id', (0, rbac_1.authorize)('properties', 'update'), (0, validate_1.validate)(validation_1.updatePropertyImportDraftSchema), (0, audit_1.auditLog)('save_draft', 'property_imports'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const userId = req.user.id;
        const draft = await propertyImport_service_1.propertyImportService.saveDraft(companyId, req.params.id, userId, {
            draftData: req.body.draft_data,
            reviewNotes: req.body.review_notes,
            markPublishReady: req.body.mark_publish_ready,
        });
        res.json({ data: draft });
    }
    catch (err) {
        handleRouteError(err, res, 'Failed to save draft changes');
    }
});
/**
 * POST /api/property-imports/drafts/:id/publish
 * Publish draft into properties catalog.
 */
router.post('/drafts/:id/publish', (0, rbac_1.authorize)('properties', 'create'), (0, validate_1.validate)(validation_1.publishPropertyImportDraftSchema), (0, audit_1.auditLog)('publish', 'property_imports'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const userId = req.user.id;
        const result = await propertyImport_service_1.propertyImportService.publishDraft(companyId, req.params.id, userId, Boolean(req.body.force_republish));
        res.json({ data: result });
    }
    catch (err) {
        handleRouteError(err, res, 'Failed to publish draft');
    }
});
/**
 * POST /api/property-imports/drafts/:id/retry
 * Retry failed extraction jobs for a draft.
 */
router.post('/drafts/:id/retry', (0, rbac_1.authorize)('properties', 'update'), (0, validate_1.validate)(validation_1.retryPropertyImportDraftSchema), (0, audit_1.auditLog)('retry_extraction', 'property_imports'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const result = await propertyImport_service_1.propertyImportService.retryExtraction(companyId, req.params.id, {
            reason: req.body.reason,
        });
        res.json({ data: result });
    }
    catch (err) {
        handleRouteError(err, res, 'Failed to retry extraction');
    }
});
/**
 * POST /api/property-imports/drafts/:id/cancel
 * Cancel draft and mark pending jobs/media as cancelled.
 */
router.post('/drafts/:id/cancel', (0, rbac_1.authorize)('properties', 'update'), (0, validate_1.validate)(validation_1.cancelPropertyImportDraftSchema), (0, audit_1.auditLog)('cancel', 'property_imports'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const result = await propertyImport_service_1.propertyImportService.cancelDraft(companyId, req.params.id, {
            reason: req.body.reason,
        });
        res.json({ data: result });
    }
    catch (err) {
        handleRouteError(err, res, 'Failed to cancel draft');
    }
});
exports.default = router;

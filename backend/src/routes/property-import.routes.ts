import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import { requireFeature } from '../middleware/featureGate';
import { validate } from '../middleware/validate';
import { auditLog } from '../middleware/audit';
import {
  cancelPropertyImportDraftSchema,
  confirmPropertyImportUploadSchema,
  createPropertyImportDraftSchema,
  publishPropertyImportDraftSchema,
  registerPropertyImportUploadSchema,
  retryPropertyImportDraftSchema,
  updatePropertyImportDraftSchema,
} from '../models/validation';
import logger from '../config/logger';
import { PropertyImportError, propertyImportService } from '../services/propertyImport.service';

const router = Router();

router.use(authenticate);
router.use(tenantIsolation);
router.use(requireFeature('property_management'));

function handleRouteError(err: unknown, res: Response, fallbackMessage: string): void {
  if (err instanceof PropertyImportError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  if (err instanceof Error) {
    const message = err.message || fallbackMessage;
    const shouldUseBadRequest =
      message.startsWith('Unsupported mime type')
      || message.startsWith('File size')
      || message.startsWith('Uploaded object mime type mismatch')
      || message.startsWith('Uploaded object size mismatch');

    if (shouldUseBadRequest) {
      res.status(400).json({ error: message });
      return;
    }
  }

  logger.error('Property import route failure', {
    error: err instanceof Error ? err.message : String(err),
    fallbackMessage,
  });

  res.status(500).json({ error: fallbackMessage });
}

/**
 * POST /api/property-imports/drafts
 * Create a new import draft for the authenticated tenant.
 */
router.post(
  '/drafts',
  authorize('properties', 'create'),
  validate(createPropertyImportDraftSchema),
  auditLog('create_draft', 'property_imports'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const userId = req.user!.id;
      const draft = await propertyImportService.createDraft(companyId, userId, {
        draftData: req.body.draft_data,
        maxRetries: req.body.max_retries,
      });

      res.status(201).json({ data: draft, id: draft.id });
    } catch (err) {
      handleRouteError(err, res, 'Failed to create property import draft');
    }
  },
);

/**
 * GET /api/property-imports/drafts/:id
 * Read draft status, media, and extraction jobs.
 */
router.get(
  '/drafts/:id',
  authorize('properties', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const draft = await propertyImportService.getDraft(companyId, req.params.id);
      res.json({ data: draft });
    } catch (err) {
      handleRouteError(err, res, 'Failed to fetch property import draft');
    }
  },
);

/**
 * POST /api/property-imports/drafts/:id/uploads
 * Register media upload and return a presigned R2 URL.
 */
router.post(
  '/drafts/:id/uploads',
  authorize('properties', 'update'),
  validate(registerPropertyImportUploadSchema),
  auditLog('register_upload', 'property_imports'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const result = await propertyImportService.registerUpload(companyId, req.params.id, {
        fileName: req.body.file_name,
        mimeType: req.body.mime_type,
        fileSize: req.body.file_size,
        assetType: req.body.asset_type,
      });

      res.status(201).json({ data: result });
    } catch (err) {
      handleRouteError(err, res, 'Failed to register upload');
    }
  },
);

/**
 * POST /api/property-imports/drafts/:id/uploads/confirm
 * Verify upload exists in R2 and enqueue extraction.
 */
router.post(
  '/drafts/:id/uploads/confirm',
  authorize('properties', 'update'),
  validate(confirmPropertyImportUploadSchema),
  auditLog('confirm_upload', 'property_imports'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const result = await propertyImportService.confirmUpload(companyId, req.params.id, req.body.upload_token);
      res.json({ data: result });
    } catch (err) {
      handleRouteError(err, res, 'Failed to confirm upload');
    }
  },
);

/**
 * PUT /api/property-imports/drafts/:id
 * Manual override or save draft data.
 */
router.put(
  '/drafts/:id',
  authorize('properties', 'update'),
  validate(updatePropertyImportDraftSchema),
  auditLog('save_draft', 'property_imports'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const userId = req.user!.id;
      const draft = await propertyImportService.saveDraft(companyId, req.params.id, userId, {
        draftData: req.body.draft_data,
        reviewNotes: req.body.review_notes,
        markPublishReady: req.body.mark_publish_ready,
      });

      res.json({ data: draft });
    } catch (err) {
      handleRouteError(err, res, 'Failed to save draft changes');
    }
  },
);

/**
 * POST /api/property-imports/drafts/:id/publish
 * Publish draft into properties catalog.
 */
router.post(
  '/drafts/:id/publish',
  authorize('properties', 'create'),
  validate(publishPropertyImportDraftSchema),
  auditLog('publish', 'property_imports'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const userId = req.user!.id;
      const result = await propertyImportService.publishDraft(
        companyId,
        req.params.id,
        userId,
        Boolean(req.body.force_republish),
      );

      res.json({ data: result });
    } catch (err) {
      handleRouteError(err, res, 'Failed to publish draft');
    }
  },
);

/**
 * POST /api/property-imports/drafts/:id/retry
 * Retry failed extraction jobs for a draft.
 */
router.post(
  '/drafts/:id/retry',
  authorize('properties', 'update'),
  validate(retryPropertyImportDraftSchema),
  auditLog('retry_extraction', 'property_imports'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const result = await propertyImportService.retryExtraction(companyId, req.params.id, {
        reason: req.body.reason,
      });
      res.json({ data: result });
    } catch (err) {
      handleRouteError(err, res, 'Failed to retry extraction');
    }
  },
);

/**
 * POST /api/property-imports/drafts/:id/cancel
 * Cancel draft and mark pending jobs/media as cancelled.
 */
router.post(
  '/drafts/:id/cancel',
  authorize('properties', 'update'),
  validate(cancelPropertyImportDraftSchema),
  auditLog('cancel', 'property_imports'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const result = await propertyImportService.cancelDraft(companyId, req.params.id, {
        reason: req.body.reason,
      });
      res.json({ data: result });
    } catch (err) {
      handleRouteError(err, res, 'Failed to cancel draft');
    }
  },
);

export default router;

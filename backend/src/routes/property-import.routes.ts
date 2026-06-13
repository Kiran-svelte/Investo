import { Router, Response, Request } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { strictTenantIsolation, getCompanyId } from '../middleware/tenant';
import { requireFeature } from '../middleware/featureGate';
import { validate } from '../middleware/validate';
import { auditLog } from '../middleware/audit';
import {
  cancelPropertyImportDraftSchema,
  propertyImportReplaceUnitsSchema,
  propertyImportSpreadsheetImportSchema,
  confirmPropertyImportUploadSchema,
  createPropertyImportDraftSchema,
  publishPropertyImportDraftSchema,
  registerPropertyImportUploadSchema,
  retryPropertyImportDraftSchema,
  updatePropertyImportDraftSchema,
} from '../models/validation';
import logger from '../config/logger';
import { PropertyImportError, propertyImportService } from '../services/propertyImport.service';
import { requirePropertyPublisher } from '../middleware/requirePropertyPublisher';

const router = Router();

router.use(authenticate);
router.use(strictTenantIsolation);
router.use(requireFeature('property_management'));
router.use(requirePropertyPublisher);

type StatusCodedError = { statusCode: number; message: string };

function isStatusCodedError(err: unknown): err is StatusCodedError {
  return Boolean(err)
    && typeof err === 'object'
    && 'statusCode' in err
    && typeof (err as any).statusCode === 'number'
    && typeof (err as any).message === 'string';
}

function getRequestBaseUrl(req: Request): string {
  const forwardedProto = (req.header('x-forwarded-proto') || '').split(',')[0]?.trim();
  const host = (req.header('x-forwarded-host') || req.header('host') || '').trim();

  const isLocalhost = host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.startsWith('[::1]');
  const proto = forwardedProto || (isLocalhost ? 'http' : 'https');
  return `${proto}://${host}`;
}

function handleRouteError(err: unknown, res: Response, fallbackMessage: string): void {
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

    const shouldUseBadRequest =
      message.startsWith('Unsupported mime type')
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

  logger.error('Property import route failure', {
    error: err instanceof Error ? err.message : String(err),
    fallbackMessage,
  });

  res.status(500).json({ error: fallbackMessage });
}

/**
 * GET /api/property-imports/knowledge-gate
 * Whether company admin must complete in-progress import AI knowledge before using the app.
 */
router.get(
  '/knowledge-gate',
  authorize('properties', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const gate = await propertyImportService.getKnowledgeGate(companyId);
      res.json({ data: gate });
    } catch (err) {
      handleRouteError(err, res, 'Failed to check property knowledge gate');
    }
  },
);

/**
 * GET /api/property-imports/drafts
 * List in-progress import drafts (not yet published).
 */
router.get(
  '/drafts',
  authorize('properties', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const drafts = await propertyImportService.listInProgressDrafts(companyId);
      res.json({ data: drafts });
    } catch (err) {
      handleRouteError(err, res, 'Failed to list property import drafts');
    }
  },
);

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
        projectId: req.body.project_id ?? null,
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
      const baseUrl = getRequestBaseUrl(req);
      const result = await propertyImportService.registerUpload(companyId, req.params.id, {
        fileName: req.body.file_name,
        mimeType: req.body.mime_type,
        fileSize: req.body.file_size,
        assetType: req.body.asset_type,
      }, { baseUrl });

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
 * POST /api/property-imports/drafts/:id/defer-knowledge
 * Allow company admin to use the app without finishing in-progress AI Q&A.
 */
router.post(
  '/drafts/:id/defer-knowledge',
  authorize('properties', 'update'),
  auditLog('defer_knowledge', 'property_imports'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const userId = req.user!.id;
      const draft = await propertyImportService.deferKnowledgeGate(companyId, req.params.id, userId);
      res.json({ data: draft });
    } catch (err) {
      handleRouteError(err, res, 'Failed to defer property knowledge setup');
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
 * POST /api/property-imports/drafts/:id/spreadsheet/import
 * Parse CSV/Excel and create import units on the draft.
 */
router.post(
  '/drafts/:id/spreadsheet/import',
  authorize('properties', 'update'),
  validate(propertyImportSpreadsheetImportSchema),
  auditLog('spreadsheet_import', 'property_imports'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const result = await propertyImportService.importSpreadsheet(companyId, req.params.id, {
        fileBuffer: Buffer.alloc(0),
        mimeType: 'text/csv',
        columnMapping: req.body.column_mapping,
        rawRows: req.body.raw_rows,
        propertyType: req.body.property_type,
        projectName: req.body.project_name,
      });
      res.status(201).json({ data: result });
    } catch (err) {
      handleRouteError(err, res, 'Failed to import spreadsheet');
    }
  },
);

/**
 * PUT /api/property-imports/drafts/:id/units
 * Replace draft units after column-mapping review.
 */
router.put(
  '/drafts/:id/units',
  authorize('properties', 'update'),
  validate(propertyImportReplaceUnitsSchema),
  auditLog('replace_units', 'property_imports'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const draft = await propertyImportService.replaceSpreadsheetUnits(
        companyId,
        req.params.id,
        req.body.units.map((unit: { label?: string | null; unit_data: Record<string, unknown>; sort_order?: number }, index: number) => ({
          label: unit.label ?? null,
          unitData: unit.unit_data,
          sortOrder: unit.sort_order ?? index,
        })),
      );
      res.json({ data: draft });
    } catch (err) {
      handleRouteError(err, res, 'Failed to update import units');
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
        purge: req.body.purge === true,
      });
      res.json({ data: result });
    } catch (err) {
      handleRouteError(err, res, 'Failed to cancel draft');
    }
  },
);

export default router;

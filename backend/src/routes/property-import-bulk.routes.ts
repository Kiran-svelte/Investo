/**
 * Property Import Bulk Routes
 *
 * Three endpoints for the CSV/Excel bulk property import pipeline:
 *   POST /api/property-imports/bulk/parse     – parse uploaded file, return preview
 *   POST /api/property-imports/bulk/confirm   – create draft from confirmed mapping + rows
 *   POST /api/property-imports/bulk/publish/:draftId – atomically publish all valid rows
 *
 * Security:
 *   - authenticate + tenantIsolation on every route
 *   - requireFeature('property_management') gate
 *   - requirePropertyPublisher role gate
 *   - Magic byte validation (not just MIME / extension)
 *   - File size hard cap via multer memoryStorage
 *   - No uploaded filenames are persisted or used in storage keys
 *   - All inputs validated before processing
 */

import { Router, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import { requireFeature } from '../middleware/featureGate';
import { requirePropertyPublisher } from '../middleware/requirePropertyPublisher';
import { auditLog } from '../middleware/audit';
import logger from '../config/logger';
import prisma from '../config/prisma';
import { csvImportService, type ColumnMapping, type PropertyRowCandidate } from '../services/csv-import.service';
import { indexPropertyKnowledge } from '../services/propertyKnowledge.service';
import {
  BULK_IMPORT_ACCEPTED_MIME_TYPES,
  CSV_IMPORT_MAX_FILE_SIZE_BYTES,
  CSV_IMPORT_MAX_ROW_COUNT,
  XLSX_MAGIC_BYTES,
} from '../constants/csv-import.constants';

/** Custom error class for bulk import route errors. */
class BulkImportError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Guards the buffer against non-CSV / non-XLSX magic bytes. */
function validateMagicBytes(buffer: Buffer, mimeType: string): void {
  const isXlsx = buffer.slice(0, 4).equals(XLSX_MAGIC_BYTES);
  const isText = buffer.slice(0, 3).every((byte) => byte >= 0x09 && byte <= 0x7e);
  const isDeclaredXlsx = mimeType.includes('spreadsheet') || mimeType.includes('excel');

  if (!isXlsx && !isText) {
    throw new BulkImportError(
      'Uploaded file does not appear to be a valid CSV or Excel file. Check the file format.',
      400,
    );
  }

  if (isDeclaredXlsx && !isXlsx) {
    throw new BulkImportError(
      'Declared MIME type is Excel but the file does not have a valid xlsx header. Re-export as .xlsx.',
      400,
    );
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CSV_IMPORT_MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, callback) => {
    const accepted = (BULK_IMPORT_ACCEPTED_MIME_TYPES as readonly string[]).includes(file.mimetype);
    if (!accepted) {
      callback(new BulkImportError(`Unsupported file type: ${file.mimetype}. Upload a .csv or .xlsx file.`, 400));
      return;
    }
    callback(null, true);
  },
});

/** Zod schema for the confirm endpoint body. */
const confirmBodySchema = z.object({
  project_name: z.string().min(1).max(255),
  property_type: z.enum(['villa', 'apartment', 'plot', 'commercial', 'other']),
  /** Column mapping: header name → target field or 'skip' */
  column_mapping: z.record(z.string()),
  /** All raw rows from the original parse result */
  raw_rows: z.array(z.record(z.string())).max(CSV_IMPORT_MAX_ROW_COUNT),
  /** Which headers were auto-detected (vs. manually set by admin) */
  auto_detected_headers: z.array(z.string()).optional(),
});

/** Zod schema for the publish endpoint body. */
const publishBodySchema = z.object({
  /** Force-republish even if draft already published (idempotent) */
  force_republish: z.boolean().optional().default(false),
});

function handleBulkError(err: unknown, res: Response, fallback: string): void {
  if (err instanceof BulkImportError) {
    res.status(err.statusCode).json({ error: { code: 'BULK_IMPORT_ERROR', message: err.message } });
    return;
  }

  if (err instanceof z.ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request body is invalid',
        details: err.errors,
      },
    });
    return;
  }

  logger.error('Bulk property import route error', {
    error: err instanceof Error ? err.message : String(err),
    fallback,
  });

  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: fallback } });
}

const router = Router();

router.use(authenticate);
router.use(tenantIsolation);
router.use(requireFeature('property_management'));
router.use(requirePropertyPublisher);

/**
 * POST /api/property-imports/bulk/parse
 * Accepts a multipart upload of a .csv or .xlsx file.
 * Returns: headers, first-5 preview rows, total row count, and suggested column mapping.
 */
router.post(
  '/parse',
  upload.single('file'),
  auditLog('bulk_parse', 'property_imports'),
  async (req: AuthRequest, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        throw new BulkImportError('No file uploaded. Include a "file" field in the multipart request.', 400);
      }

      validateMagicBytes(file.buffer, file.mimetype);

      const result = await csvImportService.parseFile(file.buffer, file.mimetype);

      logger.info('Bulk property import file parsed', {
        companyId: getCompanyId(req),
        rowCount: result.rowCount,
        headerCount: result.headers.length,
      });

      res.json({ data: result });
    } catch (err) {
      handleBulkError(err, res, 'Failed to parse uploaded file');
    }
  },
);

/**
 * POST /api/property-imports/bulk/confirm
 * Creates a `PropertyImportDraft` with import_mode='bulk_csv' storing the
 * mapped rows in draftData. Does NOT create Property records yet.
 * Returns: { draftId, rowCount, validCount, invalidCount }
 */
router.post(
  '/confirm',
  auditLog('bulk_confirm', 'property_imports'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const userId = req.user!.id;
      const body = confirmBodySchema.parse(req.body);

      csvImportService.validateMapping(body.column_mapping as ColumnMapping, Object.keys(body.column_mapping));

      const { candidates, validCount, invalidCount } = csvImportService.applyMappingToRows(
        body.raw_rows,
        body.column_mapping as ColumnMapping,
        body.property_type,
      );

      const aiKnowledgeContext = csvImportService.buildAiKnowledgeContext(candidates, body.project_name);

      const draft = await prisma.propertyImportDraft.create({
        data: {
          companyId,
          createdByUserId: userId,
          maxRetries: 3,
          status: 'review_ready',
          extractionStatus: 'extracted',
          draftData: {
            import_mode: 'bulk_csv',
            project_name: body.project_name,
            property_type: body.property_type,
            column_mapping: body.column_mapping,
            auto_detected_headers: body.auto_detected_headers ?? [],
            csv_rows: candidates.map((c) => ({
              row_number: c.rowNumber,
              is_valid: c.isValid,
              errors: c.errors,
              data: c.data,
            })),
            valid_count: validCount,
            invalid_count: invalidCount,
            ai_knowledge_context: aiKnowledgeContext,
            import_review: {
              status: 'needs_review',
              confidence_hints: [],
              review_notes: `Bulk CSV import: ${validCount} valid rows, ${invalidCount} invalid rows`,
              reviewed_by_user_id: null,
              reviewed_at: null,
              approved_at: null,
            },
          },
        },
      });

      logger.info('Bulk property import draft created', {
        companyId,
        draftId: draft.id,
        rowCount: candidates.length,
        validCount,
        invalidCount,
      });

      res.status(201).json({
        data: {
          draft_id: draft.id,
          row_count: candidates.length,
          valid_count: validCount,
          invalid_count: invalidCount,
        },
      });
    } catch (err) {
      handleBulkError(err, res, 'Failed to confirm bulk import');
    }
  },
);

/**
 * POST /api/property-imports/bulk/publish/:draftId
 * Atomically publishes all valid rows as Property records.
 * Rejects the entire batch if any valid row fails — no partial commits.
 * Returns: { publishedCount, skippedInvalidCount }
 */
router.post(
  '/publish/:draftId',
  auditLog('bulk_publish', 'property_imports'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const userId = req.user!.id;
      const { draftId } = req.params;
      const body = publishBodySchema.parse(req.body);

      const draft = await prisma.propertyImportDraft.findFirst({
        where: { id: draftId, companyId },
      });

      if (!draft) {
        throw new BulkImportError('Draft not found', 404);
      }

      if (draft.status === 'cancelled') {
        throw new BulkImportError('Cancelled drafts cannot be published', 409);
      }

      const draftData = (draft.draftData ?? {}) as Record<string, unknown>;

      if (draftData.import_mode !== 'bulk_csv') {
        throw new BulkImportError('This draft is not a bulk CSV import', 400);
      }

      if (draft.status === 'published' && !body.force_republish) {
        throw new BulkImportError('Draft is already published. Set force_republish=true to re-publish.', 409);
      }

      const rawRows = draftData.csv_rows as Array<{
        is_valid: boolean;
        data: PropertyRowCandidate['data'];
      }> ?? [];

      const validRows = rawRows.filter((r) => r.is_valid);

      if (validRows.length === 0) {
        throw new BulkImportError('No valid rows to publish. Fix validation errors and re-confirm.', 400);
      }

      const projectName = String(draftData.project_name ?? 'Untitled project');

      // Atomic: all-or-nothing insert. If any property.create fails, everything rolls back.
      const published = await prisma.$transaction(async (tx) => {
        const createdProperties = await Promise.all(
          validRows.map(async (row) => {
            const data = row.data;
            return tx.property.create({
              data: {
                companyId,
                name: data.name ?? projectName,
                builder: data.builder ?? null,
                locationCity: data.location_city ?? null,
                locationArea: data.location_area ?? null,
                locationPincode: data.location_pincode ?? null,
                priceMin: data.price_min !== null ? String(data.price_min) as unknown as any : null,
                priceMax: data.price_max !== null ? String(data.price_max) as unknown as any : null,
                bedrooms: data.bedrooms ?? null,
                propertyType: data.property_type as any,
                amenities: data.amenities,
                description: data.description ?? null,
                reraNumber: data.rera_number ?? null,
                status: data.status as any,
                images: [],
                brochureUrl: null,
              },
            });
          }),
        );

        await tx.propertyImportDraft.update({
          where: { id: draftId },
          data: {
            status: 'published',
            extractionStatus: 'extracted',
            publishedAt: new Date(),
            reviewedAt: new Date(),
            reviewedByUserId: userId,
            failureReason: null,
          },
        });

        return createdProperties;
      });

      // Index AI knowledge for each published property (outside transaction, non-fatal on failure).
      let knowledgeIndexedCount = 0;
      for (const property of published) {
        try {
          await indexPropertyKnowledge({
            companyId,
            property: {
              id: property.id,
              name: property.name,
              builder: property.builder,
              locationCity: property.locationCity,
              locationArea: property.locationArea,
              locationPincode: property.locationPincode,
              priceMin: property.priceMin ? Number(property.priceMin) : null,
              priceMax: property.priceMax ? Number(property.priceMax) : null,
              bedrooms: property.bedrooms,
              propertyType: property.propertyType,
              amenities: property.amenities as string[],
              description: property.description,
              reraNumber: property.reraNumber,
              brochureUrl: null,
              status: property.status,
            },
            draftData: draftData,
            mediaExtractions: [],
          });
          knowledgeIndexedCount++;
        } catch (knowledgeErr) {
          logger.warn('Bulk import: AI knowledge indexing failed for property', {
            companyId,
            propertyId: property.id,
            error: knowledgeErr instanceof Error ? knowledgeErr.message : String(knowledgeErr),
          });
        }
      }

      logger.info('Bulk property import published', {
        companyId,
        draftId,
        publishedCount: published.length,
        knowledgeIndexedCount,
      });

      res.json({
        data: {
          published_count: published.length,
          skipped_invalid_count: rawRows.length - validRows.length,
          knowledge_indexed_count: knowledgeIndexedCount,
        },
      });
    } catch (err) {
      handleBulkError(err, res, 'Failed to publish bulk import');
    }
  },
);

export default router;

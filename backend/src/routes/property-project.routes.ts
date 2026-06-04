import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import { requireFeature } from '../middleware/featureGate';
import { auditLog } from '../middleware/audit';
import { validate } from '../middleware/validate';
import { z } from 'zod';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { storageService } from '../services/storage.service';
import {
  deletePropertyProjectFile,
  ResourceDeleteError,
} from '../services/resourceDelete.service';

const router = Router();

const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(5000).optional().nullable(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional().nullable(),
  sort_order: z.number().int().min(0).optional(),
});

const assignPropertySchema = z.object({
  project_id: z.string().uuid().nullable(),
});

const PROJECT_FILE_MIMES = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf',
  'text/plain',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

router.use(authenticate);
router.use(tenantIsolation);
router.use(requireFeature('property_management'));

function mapProject(row: {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  _count?: { properties: number; importDrafts: number; files: number };
}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sort_order: row.sortOrder,
    property_count: row._count?.properties ?? 0,
    draft_count: row._count?.importDrafts ?? 0,
    file_count: row._count?.files ?? 0,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/**
 * GET /api/property-projects
 */
router.get('/', authorize('properties', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await prisma.propertyProject.findMany({
      where: { companyId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: {
        _count: { select: { properties: true, importDrafts: true, files: true } },
      },
    });
    const unassignedCount = await prisma.property.count({
      where: { companyId, projectId: null },
    });
    res.json({ data: rows.map(mapProject), unassigned_property_count: unassignedCount });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to list property projects', { error: message });
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

/**
 * POST /api/property-projects
 */
router.post(
  '/',
  authorize('properties', 'create'),
  validate(createProjectSchema),
  auditLog('create', 'property_project'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const maxSort = await prisma.propertyProject.aggregate({
        where: { companyId },
        _max: { sortOrder: true },
      });
      const row = await prisma.propertyProject.create({
        data: {
          companyId,
          name: req.body.name,
          description: req.body.description ?? null,
          sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        },
        include: { _count: { select: { properties: true, importDrafts: true, files: true } } },
      });
      res.status(201).json({ data: mapProject(row) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to create property project', { error: message });
      res.status(500).json({ error: 'Failed to create project' });
    }
  },
);

/**
 * PUT /api/property-projects/:id
 */
router.put(
  '/:id',
  authorize('properties', 'update'),
  validate(updateProjectSchema),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const existing = await prisma.propertyProject.findFirst({
        where: { id: req.params.id, companyId },
      });
      if (!existing) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      const row = await prisma.propertyProject.update({
        where: { id: existing.id },
        data: {
          ...(req.body.name !== undefined ? { name: req.body.name } : {}),
          ...(req.body.description !== undefined ? { description: req.body.description } : {}),
          ...(req.body.sort_order !== undefined ? { sortOrder: req.body.sort_order } : {}),
        },
        include: { _count: { select: { properties: true, importDrafts: true, files: true } } },
      });
      res.json({ data: mapProject(row) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to update property project', { error: message });
      res.status(500).json({ error: 'Failed to update project' });
    }
  },
);

/**
 * DELETE /api/property-projects/:id — unassigns properties/drafts, does not delete listings.
 */
router.delete(
  '/:id',
  authorize('properties', 'delete'),
  auditLog('delete', 'property_project'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const existing = await prisma.propertyProject.findFirst({
        where: { id: req.params.id, companyId },
      });
      if (!existing) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      await prisma.$transaction([
        prisma.property.updateMany({
          where: { companyId, projectId: existing.id },
          data: { projectId: null },
        }),
        prisma.propertyImportDraft.updateMany({
          where: { companyId, projectId: existing.id },
          data: { projectId: null },
        }),
        prisma.propertyProject.delete({ where: { id: existing.id } }),
      ]);
      res.json({ message: 'Project deleted' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to delete property project', { error: message });
      res.status(500).json({ error: 'Failed to delete project' });
    }
  },
);

/**
 * PATCH /api/property-projects/assign-property/:propertyId
 */
router.patch(
  '/assign-property/:propertyId',
  authorize('properties', 'update'),
  validate(assignPropertySchema),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const property = await prisma.property.findFirst({
        where: { id: req.params.propertyId, companyId },
      });
      if (!property) {
        res.status(404).json({ error: 'Property not found' });
        return;
      }
      const projectId = req.body.project_id as string | null;
      if (projectId) {
        const project = await prisma.propertyProject.findFirst({
          where: { id: projectId, companyId },
        });
        if (!project) {
          res.status(404).json({ error: 'Project not found' });
          return;
        }
      }
      const updated = await prisma.property.update({
        where: { id: property.id },
        data: { projectId },
      });
      res.json({
        data: {
          id: updated.id,
          project_id: updated.projectId,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to assign property to project', { error: message });
      res.status(500).json({ error: 'Failed to assign property' });
    }
  },
);

/**
 * GET /api/property-projects/:id/files
 */
router.get('/:id/files', authorize('properties', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const project = await prisma.propertyProject.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const files = await prisma.propertyProjectFile.findMany({
      where: { projectId: project.id, companyId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      data: files.map((f) => ({
        id: f.id,
        file_name: f.fileName,
        mime_type: f.mimeType,
        file_size: f.fileSize,
        created_at: f.createdAt.toISOString(),
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to list project files', { error: message });
    res.status(500).json({ error: 'Failed to list project files' });
  }
});

/**
 * POST /api/property-projects/:id/files — attach CSV/PDF/Excel to a project
 */
router.post(
  '/:id/files',
  authorize('properties', 'create'),
  upload.single('file'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const project = await prisma.propertyProject.findFirst({
        where: { id: req.params.id, companyId },
      });
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'file is required' });
        return;
      }
      const mime = file.mimetype || 'application/octet-stream';
      if (!PROJECT_FILE_MIMES.has(mime)) {
        res.status(400).json({
          error: 'Unsupported file type. Use CSV, Excel, PDF, or plain text.',
        });
        return;
      }

      const safeName = path.basename(file.originalname || 'upload').replace(/[^\w.\-]+/g, '_');
      let storageKey: string;
      try {
        const uploaded = await storageService.uploadProjectFileBuffer({
          companyId,
          projectId: project.id,
          fileName: safeName,
          mimeType: mime,
          buffer: file.buffer,
        });
        storageKey = uploaded.storageKey;
      } catch (uploadErr: unknown) {
        const msg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
        res.status(503).json({ error: msg.includes('not configured') ? msg : 'File storage upload failed' });
        return;
      }

      const row = await prisma.propertyProjectFile.create({
        data: {
          projectId: project.id,
          companyId,
          fileName: safeName,
          mimeType: mime,
          storageKey,
          fileSize: file.size,
        },
      });

      res.status(201).json({
        data: {
          id: row.id,
          file_name: row.fileName,
          mime_type: row.mimeType,
          file_size: row.fileSize,
          created_at: row.createdAt.toISOString(),
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to upload project file', { error: message });
      res.status(500).json({ error: 'Failed to upload file' });
    }
  },
);

/**
 * DELETE /api/property-projects/:id/files/:fileId
 */
router.delete(
  '/:id/files/:fileId',
  authorize('properties', 'delete'),
  auditLog('delete', 'property_project_file'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      await deletePropertyProjectFile(companyId, req.params.id, req.params.fileId);
      res.json({ message: 'Project file deleted' });
    } catch (err: unknown) {
      if (err instanceof ResourceDeleteError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to delete project file', { error: message });
      res.status(500).json({ error: 'Failed to delete project file' });
    }
  },
);

export default router;

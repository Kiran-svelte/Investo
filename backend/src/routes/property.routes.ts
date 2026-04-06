import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import { auditLog } from '../middleware/audit';
import { validate } from '../middleware/validate';
import { requireFeature } from '../middleware/featureGate';
import { createPropertyAssetUploadSchema, createPropertySchema } from '../models/validation';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { storageService } from '../services/storage.service';

const router = Router();

router.use(authenticate);
router.use(tenantIsolation);
router.use(requireFeature('property_management'));

/**
 * GET /api/properties
 * List properties for the company with search/filter.
 */
router.get(
  '/',
  authorize('properties', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const where: any = { companyId };

      // Filters
      const { status, property_type, location_city, location_area, bedrooms, price_min, price_max, search } = req.query;
      if (status) where.status = status as string;
      if (property_type) where.propertyType = property_type as string;
      if (location_city) where.locationCity = { contains: location_city as string, mode: 'insensitive' as const };
      if (location_area) where.locationArea = { contains: location_area as string, mode: 'insensitive' as const };
      if (bedrooms) where.bedrooms = parseInt(bedrooms as string);
      if (price_min) where.priceMin = { gte: parseFloat(price_min as string) };
      if (price_max) where.priceMax = { lte: parseFloat(price_max as string) };
      if (search) {
        where.OR = [
          { name: { contains: search as string, mode: 'insensitive' as const } },
          { builder: { contains: search as string, mode: 'insensitive' as const } },
          { locationCity: { contains: search as string, mode: 'insensitive' as const } },
          { locationArea: { contains: search as string, mode: 'insensitive' as const } },
        ];
      }

      // Pagination
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
      const offset = (page - 1) * limit;

      const [properties, total] = await Promise.all([
        prisma.property.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: offset,
          take: limit,
        }),
        prisma.property.count({ where }),
      ]);

      res.json({
        data: properties,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (err: any) {
      logger.error('Failed to fetch properties', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch properties' });
    }
  }
);

/**
 * GET /api/properties/:id
 */
router.get(
  '/:id',
  authorize('properties', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const property = await prisma.property.findFirst({
        where: { id: req.params.id, companyId },
      });

      if (!property) {
        res.status(404).json({ error: 'Property not found' });
        return;
      }

      res.json({ data: property });
    } catch (err: any) {
      logger.error('Failed to fetch property', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch property' });
    }
  }
);

/**
 * POST /api/properties
 * Company admin only: create property.
 */
router.post(
  '/',
  authorize('properties', 'create'),
  validate(createPropertySchema),
  auditLog('create', 'properties'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);

      // After Zod validation, req.body uses snake_case field names
      const property = await prisma.property.create({
        data: {
          companyId,
          name: req.body.name,
          builder: req.body.builder || null,
          locationCity: req.body.location_city || null,
          locationArea: req.body.location_area || null,
          locationPincode: req.body.location_pincode || null,
          priceMin: req.body.price_min || null,
          priceMax: req.body.price_max || null,
          bedrooms: req.body.bedrooms || null,
          propertyType: req.body.property_type || null,
          amenities: req.body.amenities || [],
          description: req.body.description || null,
          reraNumber: req.body.rera_number || null,
          status: req.body.status || 'available',
          images: req.body.images || [],
        },
      });

      res.status(201).json({ data: property, id: property.id });
    } catch (err: any) {
      logger.error('Failed to create property', { error: err.message });
      res.status(500).json({ error: 'Failed to create property' });
    }
  }
);

/**
 * POST /api/properties/upload-url
 * Generate a presigned upload URL for property assets.
 */
router.post(
  '/upload-url',
  authorize('properties', 'update'),
  validate(createPropertyAssetUploadSchema),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { property_id, file_name, mime_type, file_size, asset_type } = req.body;

      if (property_id) {
        const property = await prisma.property.findFirst({ where: { id: property_id, companyId } });
        if (!property) {
          res.status(404).json({ error: 'Property not found' });
          return;
        }
      }

      const upload = await storageService.createPropertyUploadUrl({
        companyId,
        propertyId: property_id,
        fileName: file_name,
        mimeType: mime_type,
        fileSize: file_size,
        assetType: asset_type,
      });

      res.status(201).json({ data: upload });
    } catch (err: any) {
      const message = err?.message || 'Failed to create upload URL';
      logger.error('Failed to create property upload URL', { error: message });

      if (message.startsWith('Unsupported mime type') || message.startsWith('File size')) {
        res.status(400).json({ error: message });
        return;
      }

      res.status(500).json({ error: 'Failed to create upload URL' });
    }
  }
);

/**
 * PUT /api/properties/:id
 * Company admin only: update property.
 */
router.put(
  '/:id',
  authorize('properties', 'update'),
  auditLog('update', 'properties'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;

      const property = await prisma.property.findFirst({ where: { id, companyId } });
      if (!property) {
        res.status(404).json({ error: 'Property not found' });
        return;
      }

      const fields = req.body;
      const updateData: any = {};
      const fieldMap: Record<string, string> = {
        name: 'name',
        builder: 'builder',
        location_city: 'locationCity',
        location_area: 'locationArea',
        location_pincode: 'locationPincode',
        price_min: 'priceMin',
        price_max: 'priceMax',
        bedrooms: 'bedrooms',
        property_type: 'propertyType',
        description: 'description',
        rera_number: 'reraNumber',
        status: 'status',
        brochure_url: 'brochureUrl',
      };

      Object.entries(fieldMap).forEach(([reqField, prismaField]) => {
        if (fields[reqField] !== undefined) updateData[prismaField] = fields[reqField];
      });

      if (fields.amenities) updateData.amenities = fields.amenities;
      if (fields.images) updateData.images = fields.images;

      const updated = await prisma.property.update({
        where: { id },
        data: updateData,
      });

      res.json({ data: updated });
    } catch (err: any) {
      logger.error('Failed to update property', { error: err.message });
      res.status(500).json({ error: 'Failed to update property' });
    }
  }
);

/**
 * DELETE /api/properties/:id
 * Company admin only.
 */
router.delete(
  '/:id',
  authorize('properties', 'delete'),
  auditLog('delete', 'properties'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;

      const property = await prisma.property.findFirst({ where: { id, companyId } });
      if (!property) {
        res.status(404).json({ error: 'Property not found' });
        return;
      }

      await prisma.property.delete({ where: { id } });
      res.json({ message: 'Property deleted' });
    } catch (err: any) {
      logger.error('Failed to delete property', { error: err.message });
      res.status(500).json({ error: 'Failed to delete property' });
    }
  }
);

export default router;

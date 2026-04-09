import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import { auditLog } from '../middleware/audit';
import { validate } from '../middleware/validate';
import { requireFeature } from '../middleware/featureGate';
import { enforcePlanLimit, requireActivePaidSubscription } from '../middleware/subscriptionEnforcement';
import { createPropertyAssetUploadSchema, createPropertySchema } from '../models/validation';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { storageService } from '../services/storage.service';
import { geocodingService, buildAddressFromProperty } from '../services/geocoding.service';

const router = Router();

type PropertyRow = {
  id: string;
  name: string;
  builder: string | null;
  locationCity: string | null;
  locationArea: string | null;
  locationPincode: string | null;
  priceMin: any;
  priceMax: any;
  bedrooms: number | null;
  propertyType: string | null;
  amenities: unknown;
  description: string | null;
  reraNumber: string | null;
  status: string;
  images: unknown;
  brochureUrl: string | null;
  floorPlanUrls: unknown;
  priceListUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: Date;
  updatedAt: Date;
};

function toIsoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function toNullableNumber(value: any): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value?.toNumber === 'function') {
    return value.toNumber();
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function mapPropertyToSnakeCaseDTO(property: any) {
  return {
    id: property.id,
    name: property.name,
    builder: property.builder,
    location_city: property.locationCity,
    location_area: property.locationArea,
    location_pincode: property.locationPincode,
    price_min: toNullableNumber(property.priceMin),
    price_max: toNullableNumber(property.priceMax),
    bedrooms: property.bedrooms,
    property_type: property.propertyType,
    amenities: property.amenities,
    description: property.description,
    rera_number: property.reraNumber,
    status: property.status,
    images: property.images,
    brochure_url: property.brochureUrl,
    floor_plan_urls: property.floorPlanUrls,
    price_list_url: property.priceListUrl,
    latitude: toNullableNumber(property.latitude),
    longitude: toNullableNumber(property.longitude),
    created_at: toIsoString(property.createdAt),
    updated_at: toIsoString(property.updatedAt),
  };
}

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
        data: properties.map((property) => mapPropertyToSnakeCaseDTO(property)),
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

      res.json({ data: mapPropertyToSnakeCaseDTO(property) });
    } catch (err: any) {
      logger.error('Failed to fetch property', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch property' });
    }
  }
);

/**
 * POST /api/properties
 * Company admin only: create property.
 * Auto-geocodes address to lat/long if coordinates not provided.
 */
router.post(
  '/',
  authorize('properties', 'create'),
  requireActivePaidSubscription,
  enforcePlanLimit('properties'),
  validate(createPropertySchema),
  auditLog('create', 'properties'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);

      // Auto-geocode if coordinates not provided
      let latitude = req.body.latitude ?? null;
      let longitude = req.body.longitude ?? null;

      if (latitude === null || longitude === null) {
        const address = buildAddressFromProperty({
          locationArea: req.body.location_area,
          locationCity: req.body.location_city,
          locationPincode: req.body.location_pincode,
        });

        if (address) {
          const geocoded = await geocodingService.geocodeAddress(address);
          if (geocoded) {
            latitude = geocoded.latitude;
            longitude = geocoded.longitude;
            logger.info('Auto-geocoded property address', {
              address: address.substring(0, 50),
              lat: latitude,
              lng: longitude,
              confidence: geocoded.confidence,
            });
          }
        }
      }

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
          bedrooms: req.body.bedrooms ?? null,
          propertyType: req.body.property_type || null,
          amenities: req.body.amenities || [],
          description: req.body.description || null,
          reraNumber: req.body.rera_number || null,
          status: req.body.status || 'available',
          images: req.body.images || [],
          brochureUrl: req.body.brochure_url || null,
          floorPlanUrls: req.body.floor_plan_urls || [],
          priceListUrl: req.body.price_list_url || null,
          latitude,
          longitude,
        },
      });

      res.status(201).json({ data: mapPropertyToSnakeCaseDTO(property), id: property.id });
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

      res.status(500).json({ error: message });
    }
  }
);

/**
 * PUT /api/properties/:id
 * Company admin only: update property.
 * Auto-geocodes if location changed and coordinates not provided.
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
        price_list_url: 'priceListUrl',
        latitude: 'latitude',
        longitude: 'longitude',
      };

      Object.entries(fieldMap).forEach(([reqField, prismaField]) => {
        if (fields[reqField] !== undefined) updateData[prismaField] = fields[reqField];
      });

      if (fields.amenities !== undefined) updateData.amenities = fields.amenities;
      if (fields.images !== undefined) updateData.images = fields.images;
      if (fields.floor_plan_urls !== undefined) updateData.floorPlanUrls = fields.floor_plan_urls;

      // Auto-geocode if location changed and coordinates not explicitly provided
      const locationChanged = 
        (fields.location_city !== undefined && fields.location_city !== property.locationCity) ||
        (fields.location_area !== undefined && fields.location_area !== property.locationArea) ||
        (fields.location_pincode !== undefined && fields.location_pincode !== property.locationPincode);

      const coordsProvided = fields.latitude !== undefined || fields.longitude !== undefined;

      if (locationChanged && !coordsProvided) {
        // Build address from updated + existing fields
        const address = buildAddressFromProperty({
          locationArea: fields.location_area ?? property.locationArea,
          locationCity: fields.location_city ?? property.locationCity,
          locationPincode: fields.location_pincode ?? property.locationPincode,
        });

        if (address) {
          const geocoded = await geocodingService.geocodeAddress(address);
          if (geocoded) {
            updateData.latitude = geocoded.latitude;
            updateData.longitude = geocoded.longitude;
            logger.info('Auto-geocoded updated property address', {
              propertyId: id,
              address: address.substring(0, 50),
              lat: geocoded.latitude,
              lng: geocoded.longitude,
            });
          }
        }
      }

      const updated = await prisma.property.update({
        where: { id },
        data: updateData,
      });

      res.json({ data: mapPropertyToSnakeCaseDTO(updated) });
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

/**
 * POST /api/properties/:id/geocode
 * Manually trigger geocoding for a property.
 * Useful for properties created before auto-geocoding or to refresh coordinates.
 */
router.post(
  '/:id/geocode',
  authorize('properties', 'update'),
  auditLog('update', 'properties'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;
      const force = req.query.force === 'true';

      const property = await prisma.property.findFirst({ where: { id, companyId } });
      if (!property) {
        res.status(404).json({ error: 'Property not found' });
        return;
      }

      // Don't overwrite existing coordinates unless forced
      if (property.latitude !== null && property.longitude !== null && !force) {
        res.json({
          data: mapPropertyToSnakeCaseDTO(property),
          message: 'Property already has coordinates. Use ?force=true to re-geocode.',
          geocoded: false,
        });
        return;
      }

      const address = buildAddressFromProperty({
        locationArea: property.locationArea,
        locationCity: property.locationCity,
        locationPincode: property.locationPincode,
      });

      if (!address) {
        res.status(400).json({ error: 'Property has no location information to geocode' });
        return;
      }

      const geocoded = await geocodingService.geocodeAddress(address);
      if (!geocoded) {
        res.status(404).json({ error: 'Could not geocode address', address });
        return;
      }

      const updated = await prisma.property.update({
        where: { id },
        data: {
          latitude: geocoded.latitude,
          longitude: geocoded.longitude,
        },
      });

      logger.info('Manually geocoded property', {
        propertyId: id,
        address,
        lat: geocoded.latitude,
        lng: geocoded.longitude,
        confidence: geocoded.confidence,
      });

      res.json({
        data: mapPropertyToSnakeCaseDTO(updated),
        geocoded: true,
        confidence: geocoded.confidence,
        formattedAddress: geocoded.formattedAddress,
      });
    } catch (err: any) {
      logger.error('Failed to geocode property', { error: err.message });
      res.status(500).json({ error: 'Failed to geocode property' });
    }
  }
);

/**
 * POST /api/properties/geocode-all
 * Bulk geocode all properties without coordinates.
 * Rate limited to avoid overwhelming geocoding service.
 */
router.post(
  '/geocode-all',
  authorize('properties', 'update'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

      // Find properties without coordinates
      const properties = await prisma.property.findMany({
        where: {
          companyId,
          OR: [{ latitude: null }, { longitude: null }],
        },
        take: limit,
      });

      const results = {
        processed: 0,
        geocoded: 0,
        failed: 0,
        skipped: 0,
        details: [] as Array<{ id: string; name: string; status: string; error?: string }>,
      };

      for (const property of properties) {
        results.processed++;

        const address = buildAddressFromProperty({
          locationArea: property.locationArea,
          locationCity: property.locationCity,
          locationPincode: property.locationPincode,
        });

        if (!address) {
          results.skipped++;
          results.details.push({ id: property.id, name: property.name, status: 'skipped', error: 'No address' });
          continue;
        }

        try {
          const geocoded = await geocodingService.geocodeAddress(address);
          if (geocoded) {
            await prisma.property.update({
              where: { id: property.id },
              data: {
                latitude: geocoded.latitude,
                longitude: geocoded.longitude,
              },
            });
            results.geocoded++;
            results.details.push({ id: property.id, name: property.name, status: 'geocoded' });
          } else {
            results.failed++;
            results.details.push({ id: property.id, name: property.name, status: 'failed', error: 'Geocoding returned no results' });
          }
        } catch (err: any) {
          results.failed++;
          results.details.push({ id: property.id, name: property.name, status: 'failed', error: err.message });
        }

        // Rate limit: 1 request per second for free tier APIs
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      res.json({
        message: `Processed ${results.processed} properties`,
        ...results,
      });
    } catch (err: any) {
      logger.error('Failed to bulk geocode properties', { error: err.message });
      res.status(500).json({ error: 'Failed to bulk geocode properties' });
    }
  }
);

export default router;

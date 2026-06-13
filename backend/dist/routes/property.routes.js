"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapPropertyToSnakeCaseDTO = mapPropertyToSnakeCaseDTO;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const tenant_1 = require("../middleware/tenant");
const audit_1 = require("../middleware/audit");
const validate_1 = require("../middleware/validate");
const featureGate_1 = require("../middleware/featureGate");
const subscriptionEnforcement_1 = require("../middleware/subscriptionEnforcement");
const validation_1 = require("../models/validation");
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const storage_service_1 = require("../services/storage.service");
const geocoding_service_1 = require("../services/geocoding.service");
const propertyCompleteness_service_1 = require("../services/propertyCompleteness.service");
const requirePropertyPublisher_1 = require("../middleware/requirePropertyPublisher");
const propertyKnowledge_service_1 = require("../services/propertyKnowledge.service");
const config_1 = __importDefault(require("../config"));
const extractExtendedPropertyAttributes_util_1 = require("../utils/extractExtendedPropertyAttributes.util");
const router = (0, express_1.Router)();
function toIsoString(value) {
    return value ? value.toISOString() : null;
}
function toNullableNumber(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === 'number')
        return value;
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
function mapPropertyToSnakeCaseDTO(property) {
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
        project_id: property.projectId ?? null,
    };
}
router.use(auth_1.authenticate);
router.use(tenant_1.strictTenantIsolation);
router.use((0, featureGate_1.requireFeature)('property_management'));
/**
 * GET /api/properties/catalog-status
 * Whether the current user is blocked until property catalog is complete.
 */
router.get('/catalog-status', (0, rbac_1.authorize)('properties', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const userId = req.user.id;
        const block = await (0, propertyCompleteness_service_1.getUserCatalogCompletenessBlock)(companyId, userId);
        res.json({
            blocked: Boolean(block),
            message: block?.promptMessage ?? null,
            reasons: block?.reasons ?? [],
        });
    }
    catch (err) {
        logger_1.default.error('Catalog status check failed', { error: err.message });
        res.status(500).json({ error: 'Failed to check catalog status' });
    }
});
/**
 * GET /api/properties
 * List properties for the company with search/filter.
 */
router.get('/', (0, rbac_1.authorize)('properties', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const where = { companyId };
        // Filters
        const { status, property_type, location_city, location_area, bedrooms, price_min, price_max, search, project_id } = req.query;
        if (status)
            where.status = status;
        if (property_type)
            where.propertyType = property_type;
        if (project_id === 'unassigned')
            where.projectId = null;
        else if (project_id)
            where.projectId = project_id;
        if (location_city)
            where.locationCity = { contains: location_city, mode: 'insensitive' };
        if (location_area)
            where.locationArea = { contains: location_area, mode: 'insensitive' };
        if (bedrooms)
            where.bedrooms = parseInt(bedrooms);
        if (price_min)
            where.priceMin = { gte: parseFloat(price_min) };
        if (price_max)
            where.priceMax = { lte: parseFloat(price_max) };
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { builder: { contains: search, mode: 'insensitive' } },
                { locationCity: { contains: search, mode: 'insensitive' } },
                { locationArea: { contains: search, mode: 'insensitive' } },
            ];
        }
        // Pagination
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 25, 100);
        const offset = (page - 1) * limit;
        const [properties, total] = await Promise.all([
            prisma_1.default.property.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: offset,
                take: limit,
            }),
            prisma_1.default.property.count({ where }),
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
    }
    catch (err) {
        logger_1.default.error('Failed to fetch properties', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch properties' });
    }
});
/**
 * GET /api/properties/:id/completeness
 */
router.get('/:id/completeness', (0, rbac_1.authorize)('properties', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const property = await prisma_1.default.property.findFirst({
            where: { id: req.params.id, companyId },
        });
        if (!property) {
            res.status(404).json({ error: 'Property not found' });
            return;
        }
        const assessment = (0, propertyCompleteness_service_1.assessPropertyCompleteness)(property);
        res.json({
            is_publishable: assessment.isPublishable,
            missing_fields: assessment.missingFields,
            missing_labels: assessment.humanMissing,
        });
    }
    catch (err) {
        logger_1.default.error('Property completeness check failed', { error: err.message });
        res.status(500).json({ error: 'Failed to check property completeness' });
    }
});
/**
 * GET /api/properties/:id
 */
router.get('/:id', (0, rbac_1.authorize)('properties', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const property = await prisma_1.default.property.findFirst({
            where: { id: req.params.id, companyId },
        });
        if (!property) {
            res.status(404).json({ error: 'Property not found' });
            return;
        }
        res.json({ data: mapPropertyToSnakeCaseDTO(property) });
    }
    catch (err) {
        logger_1.default.error('Failed to fetch property', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch property' });
    }
});
/**
 * POST /api/properties
 * Company admin only: create property.
 * Auto-geocodes address to lat/long if coordinates not provided.
 */
router.post('/', (0, rbac_1.authorize)('properties', 'create'), requirePropertyPublisher_1.requirePropertyPublisher, subscriptionEnforcement_1.requireActivePaidSubscription, (0, subscriptionEnforcement_1.enforcePlanLimit)('properties'), (0, validate_1.validate)(validation_1.createPropertySchema), (0, audit_1.auditLog)('create', 'properties'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        // Auto-geocode if coordinates not provided
        let latitude = req.body.latitude ?? null;
        let longitude = req.body.longitude ?? null;
        if (latitude === null || longitude === null) {
            const address = (0, geocoding_service_1.buildAddressFromProperty)({
                locationArea: req.body.location_area,
                locationCity: req.body.location_city,
                locationPincode: req.body.location_pincode,
            });
            if (address) {
                const geocoded = await geocoding_service_1.geocodingService.geocodeAddress(address);
                if (geocoded) {
                    latitude = geocoded.latitude;
                    longitude = geocoded.longitude;
                    logger_1.default.info('Auto-geocoded property address', {
                        address: address.substring(0, 50),
                        lat: latitude,
                        lng: longitude,
                        confidence: geocoded.confidence,
                    });
                }
            }
        }
        // After Zod validation, req.body uses snake_case field names
        let projectId = req.body.project_id ?? null;
        if (projectId) {
            const project = await prisma_1.default.propertyProject.findFirst({
                where: { id: projectId, companyId },
            });
            if (!project) {
                res.status(400).json({ error: 'Project not found' });
                return;
            }
        }
        const extendedSource = req.body;
        const extendedAttributes = config_1.default.features.extendedPropertyAttrs
            ? (0, extractExtendedPropertyAttributes_util_1.extractExtendedPropertyAttributes)(extendedSource)
            : {};
        const property = await prisma_1.default.property.create({
            data: {
                companyId,
                projectId,
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
                ...(Object.keys(extendedAttributes).length > 0
                    ? { extendedAttributes: extendedAttributes }
                    : {}),
            },
        });
        const indexPayload = await (0, propertyKnowledge_service_1.loadPropertyKnowledgeIndexPayload)(companyId, property.id);
        const knowledge = await (0, propertyKnowledge_service_1.indexPropertyKnowledge)({
            companyId,
            property,
            draftData: indexPayload.draftData ?? extendedSource,
            mediaExtractions: indexPayload.mediaExtractions,
        });
        res.status(201).json({
            data: mapPropertyToSnakeCaseDTO(property),
            id: property.id,
            knowledge_indexed: knowledge.ok,
            knowledge_chunk_count: knowledge.chunkCount,
        });
    }
    catch (err) {
        logger_1.default.error('Failed to create property', { error: err.message });
        res.status(500).json({ error: 'Failed to create property' });
    }
});
/**
 * POST /api/properties/upload-url
 * Generate a presigned upload URL for property assets.
 */
router.post('/upload-url', (0, rbac_1.authorize)('properties', 'update'), requirePropertyPublisher_1.requirePropertyPublisher, (0, validate_1.validate)(validation_1.createPropertyAssetUploadSchema), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const { property_id, file_name, mime_type, file_size, asset_type } = req.body;
        if (property_id) {
            const property = await prisma_1.default.property.findFirst({ where: { id: property_id, companyId } });
            if (!property) {
                res.status(404).json({ error: 'Property not found' });
                return;
            }
        }
        const upload = await storage_service_1.storageService.createPropertyUploadUrl({
            companyId,
            propertyId: property_id,
            fileName: file_name,
            mimeType: mime_type,
            fileSize: file_size,
            assetType: asset_type,
        });
        res.status(201).json({ data: upload });
    }
    catch (err) {
        const message = err?.message || 'Failed to create upload URL';
        logger_1.default.error('Failed to create property upload URL', { error: message });
        if (message.startsWith('R2 storage is not configured')
            || message.startsWith('AWS S3 storage is not configured')
            || message.startsWith('No object storage configured')) {
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
        res.status(500).json({ error: message });
    }
});
/**
 * PUT /api/properties/:id
 * Company admin only: update property.
 * Auto-geocodes if location changed and coordinates not provided.
 */
router.put('/:id', (0, rbac_1.authorize)('properties', 'update'), requirePropertyPublisher_1.requirePropertyPublisher, (0, audit_1.auditLog)('update', 'properties'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const { id } = req.params;
        const property = await prisma_1.default.property.findFirst({ where: { id, companyId } });
        if (!property) {
            res.status(404).json({ error: 'Property not found' });
            return;
        }
        const fields = req.body;
        const updateData = {};
        const fieldMap = {
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
            if (fields[reqField] !== undefined)
                updateData[prismaField] = fields[reqField];
        });
        if (fields.amenities !== undefined)
            updateData.amenities = fields.amenities;
        if (fields.images !== undefined)
            updateData.images = fields.images;
        if (fields.floor_plan_urls !== undefined)
            updateData.floorPlanUrls = fields.floor_plan_urls;
        // Auto-geocode if location changed and coordinates not explicitly provided
        const locationChanged = (fields.location_city !== undefined && fields.location_city !== property.locationCity) ||
            (fields.location_area !== undefined && fields.location_area !== property.locationArea) ||
            (fields.location_pincode !== undefined && fields.location_pincode !== property.locationPincode);
        const coordsProvided = fields.latitude !== undefined || fields.longitude !== undefined;
        if (locationChanged && !coordsProvided) {
            // Build address from updated + existing fields
            const address = (0, geocoding_service_1.buildAddressFromProperty)({
                locationArea: fields.location_area ?? property.locationArea,
                locationCity: fields.location_city ?? property.locationCity,
                locationPincode: fields.location_pincode ?? property.locationPincode,
            });
            if (address) {
                const geocoded = await geocoding_service_1.geocodingService.geocodeAddress(address);
                if (geocoded) {
                    updateData.latitude = geocoded.latitude;
                    updateData.longitude = geocoded.longitude;
                    logger_1.default.info('Auto-geocoded updated property address', {
                        propertyId: id,
                        address: address.substring(0, 50),
                        lat: geocoded.latitude,
                        lng: geocoded.longitude,
                    });
                }
            }
        }
        const updated = await prisma_1.default.property.update({
            where: { id },
            data: updateData,
        });
        const indexPayload = await (0, propertyKnowledge_service_1.loadPropertyKnowledgeIndexPayload)(companyId, id);
        const knowledge = await (0, propertyKnowledge_service_1.indexPropertyKnowledge)({
            companyId,
            property: updated,
            draftData: indexPayload.draftData,
            mediaExtractions: indexPayload.mediaExtractions,
        });
        res.json({
            data: mapPropertyToSnakeCaseDTO(updated),
            knowledge_indexed: knowledge.ok,
            knowledge_chunk_count: knowledge.chunkCount,
        });
    }
    catch (err) {
        logger_1.default.error('Failed to update property', { error: err.message });
        res.status(500).json({ error: 'Failed to update property' });
    }
});
/**
 * DELETE /api/properties/:id
 * Company admin only.
 */
router.delete('/:id', (0, rbac_1.authorize)('properties', 'delete'), requirePropertyPublisher_1.requirePropertyPublisher, (0, audit_1.auditLog)('delete', 'properties'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const { id } = req.params;
        const property = await prisma_1.default.property.findFirst({ where: { id, companyId } });
        if (!property) {
            res.status(404).json({ error: 'Property not found' });
            return;
        }
        await (0, propertyKnowledge_service_1.deletePropertyKnowledge)(id);
        await prisma_1.default.property.delete({ where: { id } });
        res.json({ message: 'Property deleted' });
    }
    catch (err) {
        logger_1.default.error('Failed to delete property', { error: err.message });
        res.status(500).json({ error: 'Failed to delete property' });
    }
});
/**
 * POST /api/properties/:id/geocode
 * Manually trigger geocoding for a property.
 * Useful for properties created before auto-geocoding or to refresh coordinates.
 */
router.post('/:id/geocode', (0, rbac_1.authorize)('properties', 'update'), (0, audit_1.auditLog)('update', 'properties'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const { id } = req.params;
        const force = req.query.force === 'true';
        const property = await prisma_1.default.property.findFirst({ where: { id, companyId } });
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
        const address = (0, geocoding_service_1.buildAddressFromProperty)({
            locationArea: property.locationArea,
            locationCity: property.locationCity,
            locationPincode: property.locationPincode,
        });
        if (!address) {
            res.status(400).json({ error: 'Property has no location information to geocode' });
            return;
        }
        const geocoded = await geocoding_service_1.geocodingService.geocodeAddress(address);
        if (!geocoded) {
            res.status(404).json({ error: 'Could not geocode address', address });
            return;
        }
        const updated = await prisma_1.default.property.update({
            where: { id },
            data: {
                latitude: geocoded.latitude,
                longitude: geocoded.longitude,
            },
        });
        logger_1.default.info('Manually geocoded property', {
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
    }
    catch (err) {
        logger_1.default.error('Failed to geocode property', { error: err.message });
        res.status(500).json({ error: 'Failed to geocode property' });
    }
});
/**
 * POST /api/properties/geocode-all
 * Bulk geocode all properties without coordinates.
 * Rate limited to avoid overwhelming geocoding service.
 */
router.post('/geocode-all', (0, rbac_1.authorize)('properties', 'update'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        // Find properties without coordinates
        const properties = await prisma_1.default.property.findMany({
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
            details: [],
        };
        for (const property of properties) {
            results.processed++;
            const address = (0, geocoding_service_1.buildAddressFromProperty)({
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
                const geocoded = await geocoding_service_1.geocodingService.geocodeAddress(address);
                if (geocoded) {
                    await prisma_1.default.property.update({
                        where: { id: property.id },
                        data: {
                            latitude: geocoded.latitude,
                            longitude: geocoded.longitude,
                        },
                    });
                    results.geocoded++;
                    results.details.push({ id: property.id, name: property.name, status: 'geocoded' });
                }
                else {
                    results.failed++;
                    results.details.push({ id: property.id, name: property.name, status: 'failed', error: 'Geocoding returned no results' });
                }
            }
            catch (err) {
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
    }
    catch (err) {
        logger_1.default.error('Failed to bulk geocode properties', { error: err.message });
        res.status(500).json({ error: 'Failed to bulk geocode properties' });
    }
});
exports.default = router;

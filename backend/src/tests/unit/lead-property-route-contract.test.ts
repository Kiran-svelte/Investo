/// <reference types="jest" />

import express, { Express, RequestHandler } from 'express';
import request from 'supertest';

jest.setTimeout(30000);

type MockPrisma = {
  lead: {
    findMany: jest.Mock;
    count: jest.Mock;
  };
  property: {
    findMany: jest.Mock;
    count: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
};

function noopMiddleware(): RequestHandler {
  return (_req, _res, next) => next();
}

function createRouteContractApp(): { app: Express; mockPrisma: MockPrisma } {
  jest.resetModules();

  const mockPrisma: MockPrisma = {
    lead: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    property: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  jest.doMock('../../config/prisma', () => ({
    __esModule: true,
    default: mockPrisma,
  }));

  jest.doMock('../../config/logger', () => ({
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  }));

  jest.doMock('../../middleware/auth', () => ({
    __esModule: true,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = {
        id: 'user-1',
        company_id: 'company-1',
        companyId: 'company-1',
        role: 'company_admin',
        email: 'admin@investo.in',
        name: 'Admin',
      };
      next();
    },
  }));

  jest.doMock('../../middleware/tenant', () => ({
    __esModule: true,
    tenantIsolation: noopMiddleware(),
    getCompanyId: () => 'company-1',
  }));

  jest.doMock('../../middleware/rbac', () => ({
    __esModule: true,
    authorize: () => noopMiddleware(),
  }));

  jest.doMock('../../middleware/featureGate', () => ({
    __esModule: true,
    requireFeature: () => noopMiddleware(),
  }));

  jest.doMock('../../middleware/audit', () => ({
    __esModule: true,
    auditLog: () => noopMiddleware(),
  }));

  jest.doMock('../../middleware/validate', () => ({
    __esModule: true,
    validate: () => noopMiddleware(),
  }));

  jest.doMock('../../middleware/rateLimiter', () => ({
    __esModule: true,
    exportRateLimiter: noopMiddleware(),
  }));

  jest.doMock('../../services/notification.engine', () => ({
    __esModule: true,
    notificationEngine: {
      onLeadAssigned: jest.fn(),
      onLeadReassigned: jest.fn(),
      onLeadStatusChange: jest.fn(),
    },
  }));

  jest.doMock('../../services/socket.service', () => ({
    __esModule: true,
    socketService: {
      emitToCompany: jest.fn(),
      emitToUser: jest.fn(),
    },
    SOCKET_EVENTS: {
      LEAD_CREATED: 'lead.created',
      LEAD_UPDATED: 'lead.updated',
      LEAD_ASSIGNED: 'lead.assigned',
    },
  }));

  jest.doMock('../../services/storage.service', () => ({
    __esModule: true,
    storageService: {
      createPropertyAssetUploadUrl: jest.fn(),
    },
  }));

  jest.doMock('../../services/geocoding.service', () => ({
    __esModule: true,
    geocodingService: {
      geocodeAddress: jest.fn(),
    },
    buildAddressFromProperty: jest.fn(),
  }));

  let leadRouter: any;
  let propertyRouter: any;

  jest.isolateModules(() => {
    leadRouter = require('../../routes/lead.routes').default;
    propertyRouter = require('../../routes/property.routes').default;
  });

  const app = express();
  app.use(express.json());
  app.use('/api/leads', leadRouter);
  app.use('/api/properties', propertyRouter);

  return { app, mockPrisma };
}

describe('lead/property route contract mapping', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('GET /api/leads returns snake_case lead DTO keys', async () => {
    const { app, mockPrisma } = createRouteContractApp();
    const now = new Date('2026-04-08T10:00:00.000Z');

    mockPrisma.lead.findMany.mockResolvedValue([
      {
        id: 'lead-1',
        customerName: 'Asha',
        phone: '+919876543210',
        email: 'asha@example.com',
        budgetMin: 1000000,
        budgetMax: 3000000,
        locationPreference: 'Bangalore',
        propertyType: 'apartment',
        status: 'new',
        source: 'manual',
        assignedAgentId: 'agent-1',
        notes: 'priority',
        language: 'en',
        createdAt: now,
        updatedAt: now,
        lastContactAt: now,
        assignedAgent: { name: 'Agent A' },
      },
    ]);
    mockPrisma.lead.count.mockResolvedValue(1);

    const response = await request(app).get('/api/leads');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);

    const dto = response.body.data[0];
    expect(dto).toEqual(
      expect.objectContaining({
        customer_name: 'Asha',
        budget_min: 1000000,
        budget_max: 3000000,
        location_preference: 'Bangalore',
        property_type: 'apartment',
        assigned_agent_id: 'agent-1',
        agent_name: 'Agent A',
        created_at: '2026-04-08T10:00:00.000Z',
        updated_at: '2026-04-08T10:00:00.000Z',
        last_contact_at: '2026-04-08T10:00:00.000Z',
      }),
    );

    expect(dto.customerName).toBeUndefined();
    expect(dto.budgetMin).toBeUndefined();
    expect(dto.locationPreference).toBeUndefined();
    expect(dto.assignedAgentId).toBeUndefined();
  });

  test('GET /api/properties returns snake_case property DTO keys', async () => {
    const { app, mockPrisma } = createRouteContractApp();
    const now = new Date('2026-04-08T10:00:00.000Z');

    mockPrisma.property.findMany.mockResolvedValue([
      {
        id: 'property-1',
        name: 'Green Acres',
        builder: 'Acme',
        locationCity: 'Pune',
        locationArea: 'Baner',
        locationPincode: '411045',
        priceMin: 5000000,
        priceMax: 9000000,
        bedrooms: 3,
        propertyType: 'villa',
        amenities: ['pool'],
        description: 'Nice',
        reraNumber: 'RERA123',
        status: 'available',
        images: ['https://example.com/a.jpg'],
        brochureUrl: 'https://example.com/brochure.pdf',
        floorPlanUrls: ['https://example.com/floor.pdf'],
        priceListUrl: 'https://example.com/prices.pdf',
        latitude: 12.9,
        longitude: 77.6,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    mockPrisma.property.count.mockResolvedValue(1);

    const response = await request(app).get('/api/properties');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);

    const dto = response.body.data[0];
    expect(dto).toEqual(
      expect.objectContaining({
        location_city: 'Pune',
        location_area: 'Baner',
        location_pincode: '411045',
        price_min: 5000000,
        price_max: 9000000,
        property_type: 'villa',
        rera_number: 'RERA123',
        brochure_url: 'https://example.com/brochure.pdf',
        floor_plan_urls: ['https://example.com/floor.pdf'],
        price_list_url: 'https://example.com/prices.pdf',
        created_at: '2026-04-08T10:00:00.000Z',
        updated_at: '2026-04-08T10:00:00.000Z',
      }),
    );

    expect(dto.locationCity).toBeUndefined();
    expect(dto.priceMin).toBeUndefined();
    expect(dto.propertyType).toBeUndefined();
    expect(dto.brochureUrl).toBeUndefined();
  });

  test('PUT /api/properties/:id allows clearing floor_plan_urls with an empty array', async () => {
    const { app, mockPrisma } = createRouteContractApp();
    const now = new Date('2026-04-08T10:00:00.000Z');

    mockPrisma.property.findFirst.mockResolvedValue({
      id: 'property-1',
      companyId: 'company-1',
      locationCity: 'Pune',
      locationArea: 'Baner',
      locationPincode: '411045',
    });

    mockPrisma.property.update.mockResolvedValue({
      id: 'property-1',
      name: 'Green Acres',
      builder: 'Acme',
      locationCity: 'Pune',
      locationArea: 'Baner',
      locationPincode: '411045',
      priceMin: 5000000,
      priceMax: 9000000,
      bedrooms: 3,
      propertyType: 'villa',
      amenities: ['pool'],
      description: 'Nice',
      reraNumber: 'RERA123',
      status: 'available',
      images: ['https://example.com/a.jpg'],
      brochureUrl: 'https://example.com/brochure.pdf',
      floorPlanUrls: [],
      priceListUrl: 'https://example.com/prices.pdf',
      latitude: 12.9,
      longitude: 77.6,
      createdAt: now,
      updatedAt: now,
    });

    const response = await request(app)
      .put('/api/properties/property-1')
      .send({ floor_plan_urls: [] });

    expect(response.status).toBe(200);
    expect(mockPrisma.property.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'property-1' },
        data: expect.objectContaining({ floorPlanUrls: [] }),
      }),
    );
    expect(response.body.data.floor_plan_urls).toEqual([]);
  });

  test('PUT /api/properties/:id preserves latitude/longitude values of 0', async () => {
    const { app, mockPrisma } = createRouteContractApp();
    const now = new Date('2026-04-08T10:00:00.000Z');

    mockPrisma.property.findFirst.mockResolvedValue({
      id: 'property-1',
      companyId: 'company-1',
      locationCity: 'Pune',
      locationArea: 'Baner',
      locationPincode: '411045',
    });

    mockPrisma.property.update.mockResolvedValue({
      id: 'property-1',
      name: 'Green Acres',
      builder: 'Acme',
      locationCity: 'Pune',
      locationArea: 'Baner',
      locationPincode: '411045',
      priceMin: 5000000,
      priceMax: 9000000,
      bedrooms: 3,
      propertyType: 'villa',
      amenities: ['pool'],
      description: 'Nice',
      reraNumber: 'RERA123',
      status: 'available',
      images: ['https://example.com/a.jpg'],
      brochureUrl: 'https://example.com/brochure.pdf',
      floorPlanUrls: ['https://example.com/floor.pdf'],
      priceListUrl: 'https://example.com/prices.pdf',
      latitude: 0,
      longitude: 0,
      createdAt: now,
      updatedAt: now,
    });

    const response = await request(app)
      .put('/api/properties/property-1')
      .send({ latitude: 0, longitude: 0 });

    expect(response.status).toBe(200);
    expect(mockPrisma.property.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'property-1' },
        data: expect.objectContaining({ latitude: 0, longitude: 0 }),
      }),
    );
    expect(response.body.data.latitude).toBe(0);
    expect(response.body.data.longitude).toBe(0);
  });
});

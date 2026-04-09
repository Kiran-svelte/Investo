import { mapLeadToSnakeCaseDTO } from '../../routes/lead.routes';
import { mapPropertyToSnakeCaseDTO } from '../../routes/property.routes';

describe('route DTO mappers', () => {
  it('maps lead fields to snake_case including date fields', () => {
    const now = new Date('2026-04-08T10:00:00.000Z');
    const lead = {
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
      companyId: 'company-1',
      createdAt: now,
      updatedAt: now,
      lastContactAt: now,
      assignedAgent: { name: 'Agent A' },
    };

    expect(mapLeadToSnakeCaseDTO(lead)).toEqual({
      id: 'lead-1',
      customer_name: 'Asha',
      phone: '+919876543210',
      email: 'asha@example.com',
      budget_min: 1000000,
      budget_max: 3000000,
      location_preference: 'Bangalore',
      property_type: 'apartment',
      status: 'new',
      source: 'manual',
      assigned_agent_id: 'agent-1',
      agent_name: 'Agent A',
      conversation_id: null,
      notes: 'priority',
      language: 'en',
      created_at: '2026-04-08T10:00:00.000Z',
      updated_at: '2026-04-08T10:00:00.000Z',
      last_contact_at: '2026-04-08T10:00:00.000Z',
    });
  });

  it('maps property fields to snake_case including media and dates', () => {
    const now = new Date('2026-04-08T10:00:00.000Z');
    const property = {
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
    };

    expect(mapPropertyToSnakeCaseDTO(property)).toEqual({
      id: 'property-1',
      name: 'Green Acres',
      builder: 'Acme',
      location_city: 'Pune',
      location_area: 'Baner',
      location_pincode: '411045',
      price_min: 5000000,
      price_max: 9000000,
      bedrooms: 3,
      property_type: 'villa',
      amenities: ['pool'],
      description: 'Nice',
      rera_number: 'RERA123',
      status: 'available',
      images: ['https://example.com/a.jpg'],
      brochure_url: 'https://example.com/brochure.pdf',
      floor_plan_urls: ['https://example.com/floor.pdf'],
      price_list_url: 'https://example.com/prices.pdf',
      latitude: 12.9,
      longitude: 77.6,
      created_at: '2026-04-08T10:00:00.000Z',
      updated_at: '2026-04-08T10:00:00.000Z',
    });
  });

  it('keeps zero latitude/longitude values in property DTO mapping', () => {
    const now = new Date('2026-04-08T10:00:00.000Z');
    const property = {
      id: 'property-2',
      name: 'Equator View',
      builder: null,
      locationCity: null,
      locationArea: null,
      locationPincode: null,
      priceMin: null,
      priceMax: null,
      bedrooms: null,
      propertyType: null,
      amenities: [],
      description: null,
      reraNumber: null,
      status: 'available',
      images: [],
      brochureUrl: null,
      floorPlanUrls: [],
      priceListUrl: null,
      latitude: 0,
      longitude: 0,
      createdAt: now,
      updatedAt: now,
    };

    const dto = mapPropertyToSnakeCaseDTO(property);

    expect(dto.latitude).toBe(0);
    expect(dto.longitude).toBe(0);
  });
});

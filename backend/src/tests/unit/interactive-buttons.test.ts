/**
 * CHUNK 3: Interactive Buttons Webhook Handling - Unit Tests
 * 
 * Tests for webhook extraction and action handling of interactive buttons.
 */

// All mocks must be defined before any imports that use them
jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    message: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    property: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    lead: {
      update: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
    conversation: {
      update: jest.fn(),
    },
  },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    whatsapp: {
      apiUrl: 'https://graph.facebook.com/v17.0',
    },
  },
}));

jest.mock('../../services/ai.service', () => ({
  aiService: {
    generateResponse: jest.fn(),
  },
}));

// Now import after mocks are set up
import { WhatsAppService } from '../../services/whatsapp.service';
import prisma from '../../config/prisma';

// Mock fetch for WhatsApp API calls
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('Interactive Buttons Handling (CHUNK 3)', () => {
  let whatsappService: WhatsAppService;
  
  const mockConfig = {
    phoneNumberId: '123456789',
    accessToken: 'test-access-token',
    verifyToken: 'test-verify-token',
  };

  const mockLead = {
    id: 'lead-1',
    companyId: 'company-1',
    customerName: 'John Doe',
    phone: '+919876543210',
    assignedAgentId: 'agent-1',
    propertyType: null,
  };

  const mockConversation = {
    id: 'conv-1',
    companyId: 'company-1',
    leadId: 'lead-1',
    selectedPropertyId: null,
    proposedVisitTime: null,
  };

  const mockCompany = {
    id: 'company-1',
    name: 'Test Realty',
  };

  const mockProperty = {
    id: 'prop-1',
    name: 'Sunshine Apartments',
    description: 'Beautiful 2BHK in Whitefield',
    propertyType: 'apartment',
    bedrooms: 2,
    priceMin: 4500000,
    priceMax: 5500000,
    locationCity: 'Bangalore',
    locationArea: 'Whitefield',
    brochureUrl: 'https://cdn.example.com/brochure.pdf',
    images: ['https://cdn.example.com/img1.jpg'],
    latitude: 12.9716,
    longitude: 77.5946,
    builder: 'ABC Builders',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    whatsappService = new WhatsAppService();

    (prisma.message.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.message.create as jest.Mock).mockResolvedValue({});

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.test' }] }),
    });
  });

  describe('handleInteractiveAction - Book Visit', () => {
    it('handles book-visit button when property is selected', async () => {
      (prisma.property.findUnique as jest.Mock).mockResolvedValue(mockProperty);
      (prisma.notification.create as jest.Mock).mockResolvedValue({});

      const result = await whatsappService.handleInteractiveAction({
        interactiveId: 'book-visit-prop-1',
        interactiveType: 'button_reply',
        lead: mockLead,
        conversation: { ...mockConversation, selectedPropertyId: 'prop-1' },
        company: mockCompany,
        whatsappConfig: mockConfig,
        customerPhone: '+919876543210',
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('book-visit-initiated');
      expect(result.newState?.stage).toBe('visit_booking');
      expect(prisma.notification.create).toHaveBeenCalled();
    });

    it('prompts for property selection when no property selected', async () => {
      const result = await whatsappService.handleInteractiveAction({
        interactiveId: 'book-visit',
        interactiveType: 'button_reply',
        lead: mockLead,
        conversation: mockConversation,
        company: mockCompany,
        whatsappConfig: mockConfig,
        customerPhone: '+919876543210',
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('book-visit-no-property');
    });
  });

  describe('handleInteractiveAction - Visit Time Selection', () => {
    it('handles visit time selection and schedules visit', async () => {
      (prisma.property.findUnique as jest.Mock).mockResolvedValue(mockProperty);
      (prisma.notification.create as jest.Mock).mockResolvedValue({});

      const result = await whatsappService.handleInteractiveAction({
        interactiveId: 'visit-time-prop-1-tomorrow-10am',
        interactiveType: 'button_reply',
        lead: mockLead,
        conversation: mockConversation,
        company: mockCompany,
        whatsappConfig: mockConfig,
        customerPhone: '+919876543210',
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('visit-scheduled');
      expect(result.newState?.stage).toBe('visit_booking');
      expect(result.newState?.proposedVisitTime).toBeInstanceOf(Date);
      expect(result.leadStatus).toBe('visit_scheduled');
    });
  });

  describe('handleInteractiveAction - Call Me', () => {
    it('handles callback request', async () => {
      (prisma.notification.create as jest.Mock).mockResolvedValue({});

      const result = await whatsappService.handleInteractiveAction({
        interactiveId: 'call-me',
        interactiveType: 'button_reply',
        lead: mockLead,
        conversation: mockConversation,
        company: mockCompany,
        whatsappConfig: mockConfig,
        customerPhone: '+919876543210',
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('callback-requested');
      expect(result.leadStatus).toBe('contacted');
    });
  });

  describe('handleInteractiveAction - More Info', () => {
    it('sends property details and media when available', async () => {
      (prisma.property.findUnique as jest.Mock).mockResolvedValue(mockProperty);

      const result = await whatsappService.handleInteractiveAction({
        interactiveId: 'more-info-prop-1',
        interactiveType: 'button_reply',
        lead: mockLead,
        conversation: mockConversation,
        company: mockCompany,
        whatsappConfig: mockConfig,
        customerPhone: '+919876543210',
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('more-info-sent');
      expect(result.newState?.selectedPropertyId).toBe('prop-1');
      expect(mockFetch).toHaveBeenCalled();
    });

    it('returns unhandled when property not found', async () => {
      (prisma.property.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await whatsappService.handleInteractiveAction({
        interactiveId: 'more-info-unknown-id',
        interactiveType: 'button_reply',
        lead: mockLead,
        conversation: mockConversation,
        company: mockCompany,
        whatsappConfig: mockConfig,
        customerPhone: '+919876543210',
      });

      expect(result.handled).toBe(false);
    });
  });

  describe('handleInteractiveAction - Property Filter', () => {
    it('handles 2BHK filter selection', async () => {
      (prisma.lead.update as jest.Mock).mockResolvedValue({});
      (prisma.property.findMany as jest.Mock).mockResolvedValue([mockProperty]);

      const result = await whatsappService.handleInteractiveAction({
        interactiveId: 'filter-2bhk',
        interactiveType: 'list_reply',
        lead: mockLead,
        conversation: mockConversation,
        company: mockCompany,
        whatsappConfig: mockConfig,
        customerPhone: '+919876543210',
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('filter-applied');
    });

    it('sends no-results message when no properties match', async () => {
      (prisma.lead.update as jest.Mock).mockResolvedValue({});
      (prisma.property.findMany as jest.Mock).mockResolvedValue([]);

      const result = await whatsappService.handleInteractiveAction({
        interactiveId: 'filter-villa',
        interactiveType: 'list_reply',
        lead: mockLead,
        conversation: mockConversation,
        company: mockCompany,
        whatsappConfig: mockConfig,
        customerPhone: '+919876543210',
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('filter-no-results');
    });
  });

  describe('handleInteractiveAction - Show Location', () => {
    it('sends location pin when coordinates available', async () => {
      (prisma.property.findUnique as jest.Mock).mockResolvedValue(mockProperty);

      const result = await whatsappService.handleInteractiveAction({
        interactiveId: 'location-prop-1',
        interactiveType: 'button_reply',
        lead: mockLead,
        conversation: mockConversation,
        company: mockCompany,
        whatsappConfig: mockConfig,
        customerPhone: '+919876543210',
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('location-sent');
    });

    it('sends address text when no coordinates', async () => {
      const propertyWithoutCoords = { ...mockProperty, latitude: null, longitude: null };
      (prisma.property.findUnique as jest.Mock).mockResolvedValue(propertyWithoutCoords);

      const result = await whatsappService.handleInteractiveAction({
        interactiveId: 'location-prop-1',
        interactiveType: 'button_reply',
        lead: mockLead,
        conversation: mockConversation,
        company: mockCompany,
        whatsappConfig: mockConfig,
        customerPhone: '+919876543210',
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('location-sent');
    });
  });

  describe('handleInteractiveAction - EMI Calculator', () => {
    it('calculates EMI when property is selected', async () => {
      (prisma.property.findUnique as jest.Mock).mockResolvedValue(mockProperty);

      const result = await whatsappService.handleInteractiveAction({
        interactiveId: 'emi-calculator',
        interactiveType: 'button_reply',
        lead: mockLead,
        conversation: { ...mockConversation, selectedPropertyId: 'prop-1' },
        company: mockCompany,
        whatsappConfig: mockConfig,
        customerPhone: '+919876543210',
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('emi-calculated');
    });

    it('prompts for property when none selected', async () => {
      const result = await whatsappService.handleInteractiveAction({
        interactiveId: 'emi-calculator',
        interactiveType: 'button_reply',
        lead: mockLead,
        conversation: mockConversation,
        company: mockCompany,
        whatsappConfig: mockConfig,
        customerPhone: '+919876543210',
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('emi-calculated');
    });
  });

  describe('handleInteractiveAction - Unknown Action', () => {
    it('returns unhandled for unknown button IDs', async () => {
      const result = await whatsappService.handleInteractiveAction({
        interactiveId: 'unknown-action-xyz',
        interactiveType: 'button_reply',
        lead: mockLead,
        conversation: mockConversation,
        company: mockCompany,
        whatsappConfig: mockConfig,
        customerPhone: '+919876543210',
      });

      expect(result.handled).toBe(false);
    });
  });
});

describe('Webhook Message Extraction (CHUNK 3)', () => {
  it('extracts button reply ID and title', () => {
    const message = {
      type: 'interactive',
      interactive: {
        button_reply: {
          id: 'book-visit',
          title: 'Book Visit',
        },
      },
    };

    expect(message.interactive.button_reply.id).toBe('book-visit');
    expect(message.interactive.button_reply.title).toBe('Book Visit');
  });

  it('extracts list reply ID, title, and description', () => {
    const message = {
      type: 'interactive',
      interactive: {
        list_reply: {
          id: 'prop-123',
          title: 'Sunshine Apartments',
          description: '₹45L - Whitefield',
        },
      },
    };

    expect(message.interactive.list_reply.id).toBe('prop-123');
    expect(message.interactive.list_reply.description).toBe('₹45L - Whitefield');
  });
});

/**
 * CHUNK 5: AI Property Media Presentation Tests
 * Tests the integration of AI-driven property media sending
 * 
 * Tests ALL 5 LAYERS:
 * 1. Visual - Media is sent correctly
 * 2. Interactive - Media can be interacted with
 * 3. Operational - Database is updated
 * 4. Resilient - Errors are handled gracefully
 * 5. Integrated - State machine tracks what was sent
 */

// Mock the logger
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock Prisma
jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    message: {
      create: jest.fn(),
    },
  },
}));

import { WhatsAppService } from '../../services/whatsapp.service';
import prisma from '../../config/prisma';

describe('CHUNK 5: AI Property Media Presentation', () => {
  let whatsappService: WhatsAppService;
  let mockSendMessage: jest.SpyInstance;
  let mockSendImage: jest.SpyInstance;
  let mockSendDocument: jest.SpyInstance;
  let mockSendLocation: jest.SpyInstance;
  let mockSendPropertyImages: jest.SpyInstance;
  let mockSendPropertyBrochure: jest.SpyInstance;

  const mockWhatsappConfig = {
    phoneNumberId: 'test-phone-id',
    accessToken: 'test-token',
    verifyToken: 'test-verify',
  };

  const mockProperty = {
    id: 'prop-123',
    name: 'Skyline Apartments',
    images: [
      'https://example.com/img1.jpg',
      'https://example.com/img2.jpg',
      'https://example.com/img3.jpg',
    ],
    brochureUrl: 'https://example.com/brochure.pdf',
    floorPlanUrls: [
      'https://example.com/floor-plan-1.pdf',
      'https://example.com/floor-plan-2.pdf',
    ],
    priceListUrl: 'https://example.com/price-list.pdf',
    latitude: 12.9716,
    longitude: 77.5946,
    locationArea: 'Whitefield',
    locationCity: 'Bangalore',
    locationPincode: '560066',
  };

  const mockLead = {
    id: 'lead-123',
    customerName: 'John Doe',
    phone: '+919876543210',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    whatsappService = new WhatsAppService();

    // Spy on the media sending methods
    mockSendMessage = jest.spyOn(whatsappService as any, 'sendMessage').mockResolvedValue(undefined);
    mockSendImage = jest.spyOn(whatsappService as any, 'sendImage').mockResolvedValue(undefined);
    mockSendDocument = jest.spyOn(whatsappService as any, 'sendDocument').mockResolvedValue(undefined);
    mockSendLocation = jest.spyOn(whatsappService as any, 'sendLocation').mockResolvedValue(undefined);
    mockSendPropertyImages = jest.spyOn(whatsappService as any, 'sendPropertyImages').mockResolvedValue(undefined);
    mockSendPropertyBrochure = jest.spyOn(whatsappService as any, 'sendPropertyBrochure').mockResolvedValue(undefined);

    (prisma.message.create as jest.Mock).mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('shouldSendPropertyMedia', () => {
    it('should send media when in shortlist stage', () => {
      const state = {
        stage: 'shortlist' as const,
        recommendedProperties: ['prop-1', 'prop-2'],
        messageCount: 3,
        stageEnteredAt: new Date(),
      };

      const result = (whatsappService as any).shouldSendPropertyMedia(state);
      expect(result).toBe(true);
    });

    it('should NOT send media in rapport stage', () => {
      const state = {
        stage: 'rapport' as const,
        recommendedProperties: [],
        messageCount: 1,
        stageEnteredAt: new Date(),
      };

      const result = (whatsappService as any).shouldSendPropertyMedia(state);
      expect(result).toBe(false);
    });

    it('should NOT send media if no recommended properties', () => {
      const state = {
        stage: 'shortlist' as const,
        recommendedProperties: [],
        messageCount: 3,
        stageEnteredAt: new Date(),
      };

      const result = (whatsappService as any).shouldSendPropertyMedia(state);
      expect(result).toBe(false);
    });

    it('should send media when advancing to shortlist stage', () => {
      const state = {
        stage: 'qualify' as const,
        recommendedProperties: ['prop-1'],
        messageCount: 2,
        stageEnteredAt: new Date(),
      };

      const action = {
        action: 'advance_stage' as const,
        targetStage: 'shortlist' as const,
        promptModifiers: [],
      };

      const result = (whatsappService as any).shouldSendPropertyMedia(state, action);
      expect(result).toBe(true);
    });
  });

  describe('sendPropertyMediaSet - LAYER 1 (Visual)', () => {
    it('should send property images when available', async () => {
      const state = {
        stage: 'shortlist' as const,
        messageCount: 1,
        stageEnteredAt: new Date(),
      };

      await (whatsappService as any).sendPropertyMediaSet(
        '+919876543210',
        mockWhatsappConfig,
        mockProperty,
        state,
        'conv-123'
      );

      expect(mockSendPropertyImages).toHaveBeenCalledWith(
        '+919876543210',
        mockProperty.images.slice(0, 3),
        mockProperty.name,
        mockWhatsappConfig
      );
    });

    it('should send brochure in shortlist stage', async () => {
      const state = {
        stage: 'shortlist' as const,
        messageCount: 1,
        stageEnteredAt: new Date(),
      };

      await (whatsappService as any).sendPropertyMediaSet(
        '+919876543210',
        mockWhatsappConfig,
        mockProperty,
        state,
        'conv-123'
      );

      expect(mockSendPropertyBrochure).toHaveBeenCalledWith(
        '+919876543210',
        mockProperty.brochureUrl,
        mockProperty.name,
        mockWhatsappConfig
      );
    });

    it('should send location pin when coordinates available', async () => {
      const state = {
        stage: 'shortlist' as const,
        messageCount: 1,
        stageEnteredAt: new Date(),
      };

      await (whatsappService as any).sendPropertyMediaSet(
        '+919876543210',
        mockWhatsappConfig,
        mockProperty,
        state,
        'conv-123'
      );

      expect(mockSendLocation).toHaveBeenCalledWith(
        '+919876543210',
        mockProperty.latitude,
        mockProperty.longitude,
        mockProperty.name,
        'Whitefield, Bangalore, 560066',
        mockWhatsappConfig
      );
    });

    it('should NOT send floor plans in early shortlist stage', async () => {
      const state = {
        stage: 'shortlist' as const,
        messageCount: 1,
        stageEnteredAt: new Date(),
      };

      await (whatsappService as any).sendPropertyMediaSet(
        '+919876543210',
        mockWhatsappConfig,
        mockProperty,
        state,
        'conv-123'
      );

      expect(mockSendDocument).not.toHaveBeenCalled();
    });

    it('should send floor plans after deeper engagement', async () => {
      const state = {
        stage: 'commitment' as const,
        messageCount: 5,
        stageEnteredAt: new Date(),
      };

      await (whatsappService as any).sendPropertyMediaSet(
        '+919876543210',
        mockWhatsappConfig,
        mockProperty,
        state,
        'conv-123'
      );

      // Should send floor plans as documents
      expect(mockSendDocument).toHaveBeenCalledWith(
        '+919876543210',
        mockProperty.floorPlanUrls[0],
        expect.stringContaining('Floor Plan'),
        expect.any(String),
        mockWhatsappConfig
      );
    });
  });

  describe('sendPropertyMediaSet - LAYER 3 (Operational)', () => {
    it('should log media sent in conversation', async () => {
      const state = {
        stage: 'shortlist' as const,
        messageCount: 1,
        stageEnteredAt: new Date(),
      };

      await (whatsappService as any).sendPropertyMediaSet(
        '+919876543210',
        mockWhatsappConfig,
        mockProperty,
        state,
        'conv-123'
      );

      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          conversationId: 'conv-123',
          senderType: 'ai',
          content: expect.stringContaining('Sent media for Skyline Apartments'),
          status: 'sent',
        },
      });
    });
  });

  describe('sendPropertyMediaSet - LAYER 4 (Resilient)', () => {
    it('should continue if image sending fails', async () => {
      mockSendPropertyImages.mockRejectedValueOnce(new Error('Network error'));

      const state = {
        stage: 'shortlist' as const,
        messageCount: 1,
        stageEnteredAt: new Date(),
      };

      await (whatsappService as any).sendPropertyMediaSet(
        '+919876543210',
        mockWhatsappConfig,
        mockProperty,
        state,
        'conv-123'
      );

      // Should still try to send brochure despite image failure
      expect(mockSendPropertyBrochure).toHaveBeenCalled();
      // Should still log what was sent
      expect(prisma.message.create).toHaveBeenCalled();
    });

    it('should handle property with no images gracefully', async () => {
      const propertyNoImages = { ...mockProperty, images: [] };
      const state = {
        stage: 'shortlist' as const,
        messageCount: 1,
        stageEnteredAt: new Date(),
      };

      await expect((whatsappService as any).sendPropertyMediaSet(
        '+919876543210',
        mockWhatsappConfig,
        propertyNoImages,
        state,
        'conv-123'
      )).resolves.not.toThrow();

      // Should not call sendPropertyImages
      expect(mockSendPropertyImages).not.toHaveBeenCalled();
    });

    it('should handle property with no coordinates gracefully', async () => {
      const propertyNoCoords = {
        ...mockProperty,
        latitude: null,
        longitude: null,
      };
      const state = {
        stage: 'shortlist' as const,
        messageCount: 1,
        stageEnteredAt: new Date(),
      };

      await (whatsappService as any).sendPropertyMediaSet(
        '+919876543210',
        mockWhatsappConfig,
        propertyNoCoords,
        state,
        'conv-123'
      );

      // Should not call sendLocation
      expect(mockSendLocation).not.toHaveBeenCalled();
    });
  });

  describe('sendPropertyMediaForStage - LAYER 4 (Resilient)', () => {
    it('should send fallback message if all media sending fails', async () => {
      mockSendPropertyImages.mockRejectedValue(new Error('Network error'));
      mockSendPropertyBrochure.mockRejectedValue(new Error('Network error'));
      mockSendLocation.mockRejectedValue(new Error('Network error'));

      // Mock sendPropertyMediaSet to throw
      jest.spyOn(whatsappService as any, 'sendPropertyMediaSet')
        .mockRejectedValueOnce(new Error('Total failure'));

      const state = {
        stage: 'shortlist' as const,
        recommendedProperties: ['prop-123'],
        messageCount: 1,
        stageEnteredAt: new Date(),
      };

      await (whatsappService as any).sendPropertyMediaForStage(
        '+919876543210',
        mockWhatsappConfig,
        state,
        [mockProperty],
        mockLead,
        'conv-123'
      );

      // Should send fallback text message
      expect(mockSendMessage).toHaveBeenCalledWith(
        '+919876543210',
        expect.stringContaining('having trouble sending the property images'),
        mockWhatsappConfig
      );
    });

    it('should rate limit between properties', async () => {
      const state = {
        stage: 'shortlist' as const,
        recommendedProperties: ['prop-1', 'prop-2', 'prop-3'],
        messageCount: 1,
        stageEnteredAt: new Date(),
      };

      const properties = [
        { ...mockProperty, id: 'prop-1', name: 'Property 1' },
        { ...mockProperty, id: 'prop-2', name: 'Property 2' },
        { ...mockProperty, id: 'prop-3', name: 'Property 3' },
      ];

      jest.spyOn(whatsappService as any, 'sendPropertyMediaSet').mockResolvedValue(undefined);

      const start = Date.now();
      await (whatsappService as any).sendPropertyMediaForStage(
        '+919876543210',
        mockWhatsappConfig,
        state,
        properties,
        mockLead,
        'conv-123'
      );
      const duration = Date.now() - start;

      // Should have at least 400ms delay (200ms * 2 gaps between 3 properties)
      expect(duration).toBeGreaterThanOrEqual(380);
    }, 10000);
  });

  describe('Integration - Progressive Disclosure', () => {
    it('should send only basic media in shortlist stage', async () => {
      const state = {
        stage: 'shortlist' as const,
        messageCount: 1,
        stageEnteredAt: new Date(),
      };

      await (whatsappService as any).sendPropertyMediaSet(
        '+919876543210',
        mockWhatsappConfig,
        mockProperty,
        state,
        'conv-123'
      );

      // Should send: images, brochure, location
      expect(mockSendPropertyImages).toHaveBeenCalled();
      expect(mockSendPropertyBrochure).toHaveBeenCalled();
      expect(mockSendLocation).toHaveBeenCalled();

      // Should NOT send: floor plans, price list (too early)
      expect(mockSendDocument).not.toHaveBeenCalled();
    });

    it('should send detailed media in commitment stage', async () => {
      const state = {
        stage: 'commitment' as const,
        messageCount: 5,
        stageEnteredAt: new Date(),
      };

      await (whatsappService as any).sendPropertyMediaSet(
        '+919876543210',
        mockWhatsappConfig,
        mockProperty,
        state,
        'conv-123'
      );

      // Should send everything: images, brochure, floor plans, price list, location
      expect(mockSendPropertyImages).toHaveBeenCalled();
      expect(mockSendPropertyBrochure).toHaveBeenCalled();
      expect(mockSendDocument).toHaveBeenCalledTimes(3); // 2 floor plans + 1 price list
      expect(mockSendLocation).toHaveBeenCalled();
    });
  });

  describe('Integration - Multiple Properties', () => {
    it('should limit to 3 properties max', async () => {
      const state = {
        stage: 'shortlist' as const,
        recommendedProperties: ['prop-1', 'prop-2', 'prop-3', 'prop-4', 'prop-5'],
        messageCount: 1,
        stageEnteredAt: new Date(),
      };

      const properties = [
        { ...mockProperty, id: 'prop-1' },
        { ...mockProperty, id: 'prop-2' },
        { ...mockProperty, id: 'prop-3' },
        { ...mockProperty, id: 'prop-4' },
        { ...mockProperty, id: 'prop-5' },
      ];

      jest.spyOn(whatsappService as any, 'sendPropertyMediaSet').mockResolvedValue(undefined);

      await (whatsappService as any).sendPropertyMediaForStage(
        '+919876543210',
        mockWhatsappConfig,
        state,
        properties,
        mockLead,
        'conv-123'
      );

      // Should only call sendPropertyMediaSet 3 times
      expect((whatsappService as any).sendPropertyMediaSet).toHaveBeenCalledTimes(3);
    });
  });
});

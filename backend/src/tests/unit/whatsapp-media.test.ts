/**
 * CHUNK 2: WhatsApp Media Sending - Unit Tests
 * 
 * These tests verify the WhatsApp service media sending methods work correctly.
 * Note: These are unit tests that mock the fetch API, not integration tests with the real WhatsApp API.
 */

import { WhatsAppService } from '../../services/whatsapp.service';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock logger - needs to match actual logger structure (default export)
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock config with proper nested structure
jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    whatsapp: {
      apiUrl: 'https://graph.facebook.com/v17.0',
    },
  },
}));

// Mock prisma (not used in these tests but required by the service)
jest.mock('../../config/prisma', () => ({
  default: {
    company: { findMany: jest.fn() },
    lead: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), groupBy: jest.fn() },
    conversation: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    message: { create: jest.fn(), findMany: jest.fn() },
    notification: { create: jest.fn() },
    aiSetting: { findUnique: jest.fn() },
    property: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
  },
}));

// Mock AI service
jest.mock('../../services/ai.service', () => ({
  aiService: {
    generateResponse: jest.fn(),
  },
}));

describe('WhatsApp Service - Rich Media (CHUNK 2)', () => {
  let whatsappService: WhatsAppService;
  const mockConfig = {
    phoneNumberId: '123456789',
    accessToken: 'test-access-token',
    verifyToken: 'test-verify-token',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    whatsappService = new WhatsAppService();
  });

  describe('sendImage', () => {
    it('sends image successfully with caption', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.123' }] }),
      });

      const result = await whatsappService.sendImage(
        '+919876543210',
        'https://cdn.example.com/image.jpg',
        'Property exterior view',
        mockConfig
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('wamid.123');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.type).toBe('image');
      expect(callBody.image.link).toBe('https://cdn.example.com/image.jpg');
      expect(callBody.image.caption).toBe('Property exterior view');
    });

    it('sends image without caption', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.456' }] }),
      });

      const result = await whatsappService.sendImage(
        '+919876543210',
        'https://cdn.example.com/image.jpg',
        null,
        mockConfig
      );

      expect(result.success).toBe(true);
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.image.caption).toBeUndefined();
    });

    it('fails with invalid URL (not HTTPS)', async () => {
      const result = await whatsappService.sendImage(
        '+919876543210',
        'http://insecure.com/image.jpg',
        'Caption',
        mockConfig
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Image URL must be HTTPS');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('fails with missing config', async () => {
      const result = await whatsappService.sendImage(
        '+919876543210',
        'https://cdn.example.com/image.jpg',
        'Caption',
        { phoneNumberId: '', accessToken: '', verifyToken: '' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Missing WhatsApp configuration');
    });

    it('handles API error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Invalid request',
      });

      const result = await whatsappService.sendImage(
        '+919876543210',
        'https://cdn.example.com/image.jpg',
        'Caption',
        mockConfig
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('API Error: 400');
    });
  });

  describe('sendDocument', () => {
    it('sends PDF document successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.789' }] }),
      });

      const result = await whatsappService.sendDocument(
        '+919876543210',
        'https://cdn.example.com/brochure.pdf',
        'Property_Brochure.pdf',
        'Download the full brochure',
        mockConfig
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('wamid.789');
      
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.type).toBe('document');
      expect(callBody.document.link).toBe('https://cdn.example.com/brochure.pdf');
      expect(callBody.document.filename).toBe('Property_Brochure.pdf');
      expect(callBody.document.caption).toBe('Download the full brochure');
    });

    it('uses default filename if not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.abc' }] }),
      });

      const result = await whatsappService.sendDocument(
        '+919876543210',
        'https://cdn.example.com/doc.pdf',
        '',
        null,
        mockConfig
      );

      expect(result.success).toBe(true);
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.document.filename).toBe('document.pdf');
    });

    it('fails with non-HTTPS URL', async () => {
      const result = await whatsappService.sendDocument(
        '+919876543210',
        'http://insecure.com/doc.pdf',
        'doc.pdf',
        null,
        mockConfig
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Document URL must be HTTPS');
    });
  });

  describe('sendLocation', () => {
    it('sends location pin successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.loc1' }] }),
      });

      const result = await whatsappService.sendLocation(
        '+919876543210',
        12.9716,
        77.5946,
        'Sunshine Apartments',
        '123 Main Street, Whitefield, Bangalore',
        mockConfig
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('wamid.loc1');
      
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.type).toBe('location');
      expect(callBody.location.latitude).toBe(12.9716);
      expect(callBody.location.longitude).toBe(77.5946);
      expect(callBody.location.name).toBe('Sunshine Apartments');
      expect(callBody.location.address).toBe('123 Main Street, Whitefield, Bangalore');
    });

    it('fails with invalid latitude (> 90)', async () => {
      const result = await whatsappService.sendLocation(
        '+919876543210',
        91,
        77.5946,
        'Test',
        'Address',
        mockConfig
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid coordinates');
    });

    it('fails with invalid longitude (< -180)', async () => {
      const result = await whatsappService.sendLocation(
        '+919876543210',
        12.9716,
        -181,
        'Test',
        'Address',
        mockConfig
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid coordinates');
    });
  });

  describe('sendInteractiveButtons', () => {
    it('sends buttons successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.btn1' }] }),
      });

      const buttons = [
        { id: 'book-visit', title: 'Book Visit' },
        { id: 'call-me', title: 'Call Me' },
        { id: 'more-info', title: 'More Info' },
      ];

      const result = await whatsappService.sendInteractiveButtons(
        '+919876543210',
        'Would you like to visit this property?',
        buttons,
        'Property Interest',
        'Reply to continue',
        mockConfig
      );

      expect(result.success).toBe(true);
      
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.type).toBe('interactive');
      expect(callBody.interactive.type).toBe('button');
      expect(callBody.interactive.action.buttons).toHaveLength(3);
      expect(callBody.interactive.action.buttons[0].reply.id).toBe('book-visit');
      expect(callBody.interactive.action.buttons[0].reply.title).toBe('Book Visit');
    });

    it('fails with more than 3 buttons', async () => {
      const buttons = [
        { id: '1', title: 'One' },
        { id: '2', title: 'Two' },
        { id: '3', title: 'Three' },
        { id: '4', title: 'Four' },
      ];

      const result = await whatsappService.sendInteractiveButtons(
        '+919876543210',
        'Body text',
        buttons,
        null,
        null,
        mockConfig
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Must have 1-3 buttons');
    });

    it('fails with empty buttons array', async () => {
      const result = await whatsappService.sendInteractiveButtons(
        '+919876543210',
        'Body text',
        [],
        null,
        null,
        mockConfig
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Must have 1-3 buttons');
    });

    it('truncates long button titles to 20 chars', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.trunc' }] }),
      });

      const buttons = [
        { id: 'test', title: 'This is a very long button title that exceeds the limit' },
      ];

      await whatsappService.sendInteractiveButtons(
        '+919876543210',
        'Body',
        buttons,
        null,
        null,
        mockConfig
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.interactive.action.buttons[0].reply.title.length).toBeLessThanOrEqual(20);
    });
  });

  describe('sendInteractiveList', () => {
    it('sends list successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.list1' }] }),
      });

      const sections = [
        {
          title: 'Under 50 Lakhs',
          rows: [
            { id: 'prop-1', title: 'Sunshine Apartments', description: '₹45L - Whitefield' },
            { id: 'prop-2', title: 'Green Valley', description: '₹48L - Marathahalli' },
          ],
        },
        {
          title: '50L - 70L',
          rows: [
            { id: 'prop-3', title: 'Lake View Residency', description: '₹62L - Bellandur' },
          ],
        },
      ];

      const result = await whatsappService.sendInteractiveList(
        '+919876543210',
        'I found 3 properties matching your criteria:',
        'View Properties',
        sections,
        'Property Options',
        'Select to know more',
        mockConfig
      );

      expect(result.success).toBe(true);
      
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.type).toBe('interactive');
      expect(callBody.interactive.type).toBe('list');
      expect(callBody.interactive.action.sections).toHaveLength(2);
      expect(callBody.interactive.action.sections[0].rows).toHaveLength(2);
    });

    it('fails with more than 10 total rows', async () => {
      const sections = [
        {
          title: 'All Properties',
          rows: Array(11).fill({ id: 'prop', title: 'Property', description: 'Desc' })
            .map((r, i) => ({ ...r, id: `prop-${i}` })),
        },
      ];

      const result = await whatsappService.sendInteractiveList(
        '+919876543210',
        'Body',
        'Button',
        sections,
        null,
        null,
        mockConfig
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Maximum 10 rows allowed');
    });

    it('fails with empty sections', async () => {
      const result = await whatsappService.sendInteractiveList(
        '+919876543210',
        'Body',
        'Button',
        [],
        null,
        null,
        mockConfig
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Must have at least one section');
    });
  });

  describe('sendPropertyImages', () => {
    it('sends up to 3 images', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.img' }] }),
      });

      const images = [
        'https://cdn.example.com/img1.jpg',
        'https://cdn.example.com/img2.jpg',
        'https://cdn.example.com/img3.jpg',
        'https://cdn.example.com/img4.jpg', // Should be skipped
        'https://cdn.example.com/img5.jpg', // Should be skipped
      ];

      const result = await whatsappService.sendPropertyImages(
        '+919876543210',
        images,
        'Sunshine Apartments',
        mockConfig
      );

      expect(result.success).toBe(true);
      expect(result.sent).toBe(3);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('first image includes property name caption', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.img' }] }),
      });

      await whatsappService.sendPropertyImages(
        '+919876543210',
        ['https://cdn.example.com/img.jpg'],
        'My Property',
        mockConfig
      );

      const firstCallBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(firstCallBody.image.caption).toBe('📸 My Property');
    });

    it('handles partial failures', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [{ id: 'wamid.1' }] }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => 'Server error',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [{ id: 'wamid.3' }] }),
        });

      const result = await whatsappService.sendPropertyImages(
        '+919876543210',
        ['https://a.com/1.jpg', 'https://b.com/2.jpg', 'https://c.com/3.jpg'],
        'Test',
        mockConfig
      );

      expect(result.success).toBe(false);
      expect(result.sent).toBe(2);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('sendPropertyBrochure', () => {
    it('sends brochure with formatted filename', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.brochure' }] }),
      });

      const result = await whatsappService.sendPropertyBrochure(
        '+919876543210',
        'https://cdn.example.com/brochure.pdf',
        'Sunshine Apartments - Phase 2',
        mockConfig
      );

      expect(result.success).toBe(true);
      
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.document.filename).toBe('Sunshine_Apartments___Phase_2_Brochure.pdf');
      expect(callBody.document.caption).toBe('📋 Brochure - Sunshine Apartments - Phase 2');
    });

    it('fails if no brochure URL', async () => {
      const result = await whatsappService.sendPropertyBrochure(
        '+919876543210',
        '',
        'Test Property',
        mockConfig
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('No brochure URL provided');
    });
  });
});

/**
 * CHUNK 4: Geocoding Service Tests
 * Tests for:
 * - Address geocoding with Nominatim (OpenStreetMap)
 * - Address building from property data
 * - Cache functionality
 * - Error handling
 */

// Mock the logger first
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock the config
jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    geocoding: {
      provider: 'nominatim',
      googleApiKey: '',
      nominatimUserAgent: 'InvestoApp/1.0',
      cacheEnabled: true,
      cacheTtlSeconds: 86400,
    },
  },
}));

// Mock fetch globally
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// Import after mocks are set up
import {
  geocodingService,
  buildAddressFromProperty,
  clearGeocodeCache,
  getGeocodeStats,
} from '../../services/geocoding.service';

describe('Geocoding Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearGeocodeCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('buildAddressFromProperty', () => {
    it('should build full address with all components', () => {
      const address = buildAddressFromProperty({
        locationArea: 'Whitefield',
        locationCity: 'Bangalore',
        locationPincode: '560066',
      });
      expect(address).toBe('Whitefield, Bangalore, 560066, India');
    });

    it('should build address with city and area only', () => {
      const address = buildAddressFromProperty({
        locationArea: 'Whitefield',
        locationCity: 'Bangalore',
      });
      expect(address).toBe('Whitefield, Bangalore, India');
    });

    it('should build address with city only', () => {
      const address = buildAddressFromProperty({
        locationCity: 'Bangalore',
      });
      expect(address).toBe('Bangalore, India');
    });

    it('should return null for empty input', () => {
      const address = buildAddressFromProperty({});
      expect(address).toBeNull();
    });

    it('should return null for null/undefined inputs', () => {
      const address = buildAddressFromProperty({
        locationArea: null,
        locationCity: undefined,
        locationPincode: null,
      });
      expect(address).toBeNull();
    });

    it('should handle whitespace-only inputs', () => {
      const address = buildAddressFromProperty({
        locationArea: '   ',
        locationCity: '   ',
      });
      expect(address).toBeNull();
    });

    it('should use pincode with city when area is missing', () => {
      const address = buildAddressFromProperty({
        locationCity: 'Bangalore',
        locationPincode: '560066',
      });
      expect(address).toBe('Bangalore, 560066, India');
    });
  });

  describe('geocodeAddress (Nominatim)', () => {
    it('should geocode a valid address successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            lat: '12.9716',
            lon: '77.5946',
            display_name: 'Whitefield, Bangalore, Karnataka, India',
            importance: 0.85,
          },
        ],
      });

      const result = await geocodingService.geocodeAddress('Whitefield, Bangalore, India');

      expect(result).not.toBeNull();
      expect(result!.latitude).toBeCloseTo(12.9716, 4);
      expect(result!.longitude).toBeCloseTo(77.5946, 4);
      expect(result!.formattedAddress).toBe('Whitefield, Bangalore, Karnataka, India');
      expect(result!.confidence).toBe('high');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toContain('nominatim.openstreetmap.org');
    });

    it('should return null for address not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const result = await geocodingService.geocodeAddress('NonExistentPlace123456');

      expect(result).toBeNull();
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await geocodingService.geocodeAddress('Whitefield, Bangalore');

      expect(result).toBeNull();
    });

    it('should handle non-OK HTTP responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });

      const result = await geocodingService.geocodeAddress('Whitefield, Bangalore');

      expect(result).toBeNull();
    });

    it('should cache results for repeated queries', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            lat: '12.9716',
            lon: '77.5946',
            display_name: 'Whitefield, Bangalore',
            importance: 0.8,
          },
        ],
      });

      // First call - hits API
      const result1 = await geocodingService.geocodeAddress('Whitefield, Bangalore');
      expect(result1).not.toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const result2 = await geocodingService.geocodeAddress('Whitefield, Bangalore');
      expect(result2).not.toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1); // Still 1, cache hit

      // Core values should match (source may differ)
      expect(result1!.latitude).toBe(result2!.latitude);
      expect(result1!.longitude).toBe(result2!.longitude);
      expect(result2!.source).toBe('cache');
    });

    it('should normalize address for cache key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            lat: '12.9716',
            lon: '77.5946',
            display_name: 'Whitefield',
            importance: 0.7,
          },
        ],
      });

      // First call
      await geocodingService.geocodeAddress('  Whitefield, Bangalore  ');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Normalized equivalent - should use cache
      await geocodingService.geocodeAddress('whitefield, bangalore');
      expect(mockFetch).toHaveBeenCalledTimes(1); // Cache hit
    });

    it('should set correct confidence based on importance', async () => {
      // High importance
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ lat: '12.9', lon: '77.5', display_name: 'Test', importance: 0.9 }],
      });
      let result = await geocodingService.geocodeAddress('HighConf');
      expect(result!.confidence).toBe('high');

      clearGeocodeCache();

      // Medium importance
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ lat: '12.9', lon: '77.5', display_name: 'Test', importance: 0.5 }],
      });
      result = await geocodingService.geocodeAddress('MedConf');
      expect(result!.confidence).toBe('medium');

      clearGeocodeCache();

      // Low importance
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ lat: '12.9', lon: '77.5', display_name: 'Test', importance: 0.2 }],
      });
      result = await geocodingService.geocodeAddress('LowConf');
      expect(result!.confidence).toBe('low');
    });
  });

  describe('getGeocodeStats', () => {
    it('should return cache statistics', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [{ lat: '12.9', lon: '77.5', display_name: 'Test', importance: 0.8 }],
      });

      // Make some requests
      await geocodingService.geocodeAddress('Address1');
      await geocodingService.geocodeAddress('Address2');
      await geocodingService.geocodeAddress('Address1'); // Cache hit

      const stats = getGeocodeStats();
      expect(stats.size).toBe(2);
      expect(stats.enabled).toBe(true);
    });
  });

  describe('clearGeocodeCache', () => {
    it('should clear all cached results', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [{ lat: '12.9', lon: '77.5', display_name: 'Test', importance: 0.8 }],
      });

      await geocodingService.geocodeAddress('TestAddress');
      expect(getGeocodeStats().size).toBe(1);

      clearGeocodeCache();
      expect(getGeocodeStats().size).toBe(0);

      // Next call should hit API again
      await geocodingService.geocodeAddress('TestAddress');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty address string', async () => {
      const result = await geocodingService.geocodeAddress('');
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle whitespace-only address', async () => {
      const result = await geocodingService.geocodeAddress('   ');
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle special characters in address', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ lat: '12.9', lon: '77.5', display_name: 'Test', importance: 0.7 }],
      });

      // Address with special characters
      await geocodingService.geocodeAddress('MG Road, #123, Near Temple');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      // URL should be properly encoded - URLSearchParams uses + for space
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('nominatim.openstreetmap.org');
      expect(calledUrl).toContain('%23123'); // # is encoded as %23
    });

    it('should handle very long addresses', async () => {
      const longAddress = 'A'.repeat(500) + ', Bangalore, India';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ lat: '12.9', lon: '77.5', display_name: 'Test', importance: 0.7 }],
      });

      const result = await geocodingService.geocodeAddress(longAddress);
      expect(result).not.toBeNull();
    });

    it('should handle malformed API response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ lat: 'not-a-number', lon: '77.5' }],
      });

      const result = await geocodingService.geocodeAddress('Test Address');

      // Should handle NaN gracefully
      expect(result!.latitude).toBeNaN();
    });
  });
});

describe('Integration: Property Route Geocoding', () => {
  // These tests would require mocking the full Express app
  // For now, we test the geocoding service integration points

  it('should support geocoding workflow for property creation', async () => {
    // Simulate property creation workflow
    const propertyData = {
      locationArea: 'Electronic City',
      locationCity: 'Bangalore',
      locationPincode: '560100',
    };

    // Build address
    const address = buildAddressFromProperty(propertyData);
    expect(address).toBe('Electronic City, Bangalore, 560100, India');

    // Mock geocoding
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          lat: '12.8390',
          lon: '77.6774',
          display_name: 'Electronic City, Bangalore, Karnataka, India',
          importance: 0.8,
        },
      ],
    });

    // Geocode
    const coords = await geocodingService.geocodeAddress(address!);
    expect(coords).not.toBeNull();
    expect(coords!.latitude).toBeCloseTo(12.839, 3);
    expect(coords!.longitude).toBeCloseTo(77.6774, 3);
  });

  it('should handle properties with missing location gracefully', async () => {
    const propertyData = {
      locationArea: null,
      locationCity: null,
      locationPincode: null,
    };

    const address = buildAddressFromProperty(propertyData);
    expect(address).toBeNull();

    // Should not attempt geocoding
    // (route handler would skip geocoding for null address)
  });
});

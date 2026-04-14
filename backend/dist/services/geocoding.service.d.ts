/**
 * Geocoding Service
 *
 * Converts addresses to latitude/longitude coordinates.
 * Supports multiple providers:
 * - Google Maps Geocoding API (requires API key)
 * - Nominatim (OpenStreetMap, free, no API key required)
 *
 * Features:
 * - In-memory caching to reduce API calls
 * - Graceful fallback on errors
 * - Rate limiting for Nominatim (1 req/sec as per terms)
 */
export interface GeocodingResult {
    latitude: number;
    longitude: number;
    formattedAddress?: string;
    confidence?: 'high' | 'medium' | 'low';
    source: 'google' | 'nominatim' | 'cache';
}
/**
 * Geocode an address to coordinates.
 *
 * @param address - Full address string (e.g., "Whitefield, Bangalore, Karnataka, India")
 * @returns Geocoding result with lat/long, or null if geocoding fails
 *
 * @example
 * const result = await geocodeAddress("Whitefield, Bangalore, Karnataka 560066");
 * // { latitude: 12.9698, longitude: 77.7500, confidence: 'high', source: 'google' }
 */
export declare function geocodeAddress(address: string): Promise<GeocodingResult | null>;
/**
 * Build a full address string from property components.
 * Used to construct a geocodable address from property fields.
 * Returns null if no valid address components are available.
 */
export declare function buildAddressFromProperty(property: {
    locationArea?: string | null;
    locationCity?: string | null;
    locationPincode?: string | null;
    name?: string;
}): string | null;
/**
 * Clear geocoding cache (for testing)
 */
export declare function clearGeocodeCache(): void;
/**
 * Get cache stats (for monitoring)
 */
export declare function getGeocodeStats(): {
    size: number;
    enabled: boolean;
};
export declare const geocodingService: {
    geocodeAddress: typeof geocodeAddress;
    buildAddressFromProperty: typeof buildAddressFromProperty;
    clearGeocodeCache: typeof clearGeocodeCache;
    getGeocodeStats: typeof getGeocodeStats;
};
//# sourceMappingURL=geocoding.service.d.ts.map
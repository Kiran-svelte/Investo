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

import config from '../config';
import logger from '../config/logger';

export interface GeocodingResult {
  latitude: number;
  longitude: number;
  formattedAddress?: string;
  confidence?: 'high' | 'medium' | 'low';
  source: 'google' | 'nominatim' | 'cache';
}

interface CacheEntry {
  result: GeocodingResult;
  timestamp: number;
}

// In-memory cache for geocoding results
const geocodeCache = new Map<string, CacheEntry>();

// Rate limiter for Nominatim (1 request per second)
let lastNominatimCall = 0;

/**
 * Normalize address for cache key generation
 */
function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/[^\w\s,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check cache for existing result
 */
function getCachedResult(address: string): GeocodingResult | null {
  if (!config.geocoding.cacheEnabled) return null;

  const key = normalizeAddress(address);
  const entry = geocodeCache.get(key);
  
  if (!entry) return null;

  const ageMs = Date.now() - entry.timestamp;
  const ttlMs = config.geocoding.cacheTtlSeconds * 1000;

  if (ageMs > ttlMs) {
    geocodeCache.delete(key);
    return null;
  }

  return { ...entry.result, source: 'cache' };
}

/**
 * Store result in cache
 */
function cacheResult(address: string, result: GeocodingResult): void {
  if (!config.geocoding.cacheEnabled) return;

  const key = normalizeAddress(address);
  geocodeCache.set(key, {
    result,
    timestamp: Date.now(),
  });

  // Limit cache size to prevent memory issues
  if (geocodeCache.size > 10000) {
    // Remove oldest entries
    const entries = Array.from(geocodeCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = entries.slice(0, 1000);
    toDelete.forEach(([key]) => geocodeCache.delete(key));
  }
}

/**
 * Geocode using Google Maps API
 */
async function geocodeWithGoogle(address: string): Promise<GeocodingResult | null> {
  const apiKey = config.geocoding.googleApiKey;
  if (!apiKey) {
    logger.warn('Google Maps API key not configured');
    return null;
  }

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', address);
    url.searchParams.set('key', apiKey);
    // Bias results to India for real estate context
    url.searchParams.set('region', 'in');

    const response = await fetch(url.toString());
    
    if (!response.ok) {
      logger.error('Google Geocoding API error', { status: response.status });
      return null;
    }

    const data = await response.json() as {
      status: string;
      results: Array<{
        geometry: {
          location: { lat: number; lng: number };
          location_type: string;
        };
        formatted_address: string;
      }>;
    };

    if (data.status !== 'OK' || !data.results.length) {
      logger.info('Google Geocoding no results', { status: data.status, address });
      return null;
    }

    const result = data.results[0];
    const locationType = result.geometry.location_type;

    // Map Google's location_type to confidence
    const confidenceMap: Record<string, 'high' | 'medium' | 'low'> = {
      'ROOFTOP': 'high',
      'RANGE_INTERPOLATED': 'medium',
      'GEOMETRIC_CENTER': 'medium',
      'APPROXIMATE': 'low',
    };

    return {
      latitude: result.geometry.location.lat,
      longitude: result.geometry.location.lng,
      formattedAddress: result.formatted_address,
      confidence: confidenceMap[locationType] || 'medium',
      source: 'google',
    };
  } catch (err: any) {
    logger.error('Google Geocoding failed', { error: err.message });
    return null;
  }
}

/**
 * Geocode using Nominatim (OpenStreetMap)
 * Free service, but requires rate limiting (1 req/sec)
 */
async function geocodeWithNominatim(address: string): Promise<GeocodingResult | null> {
  // Rate limit: wait at least 1 second between requests
  const now = Date.now();
  const timeSinceLastCall = now - lastNominatimCall;
  if (timeSinceLastCall < 1000) {
    await new Promise(resolve => setTimeout(resolve, 1000 - timeSinceLastCall));
  }
  lastNominatimCall = Date.now();

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', address);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('addressdetails', '1');
    // Bias to India
    url.searchParams.set('countrycodes', 'in');

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': config.geocoding.nominatimUserAgent,
      },
    });

    if (!response.ok) {
      logger.error('Nominatim API error', { status: response.status });
      return null;
    }

    const data = await response.json() as Array<{
      lat: string;
      lon: string;
      display_name: string;
      importance: number;
    }>;

    if (!data.length) {
      logger.info('Nominatim no results', { address });
      return null;
    }

    const result = data[0];
    
    // Map Nominatim importance (0-1) to confidence
    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (result.importance > 0.7) confidence = 'high';
    else if (result.importance > 0.4) confidence = 'medium';

    return {
      latitude: parseFloat(result.lat),
      longitude: parseFloat(result.lon),
      formattedAddress: result.display_name,
      confidence,
      source: 'nominatim',
    };
  } catch (err: any) {
    logger.error('Nominatim Geocoding failed', { error: err.message });
    return null;
  }
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
export async function geocodeAddress(address: string): Promise<GeocodingResult | null> {
  if (!address || address.trim().length < 3) {
    return null;
  }

  // Check cache first
  const cached = getCachedResult(address);
  if (cached) {
    logger.debug('Geocoding cache hit', { address: address.substring(0, 50) });
    return cached;
  }

  let result: GeocodingResult | null = null;

  // Try configured provider first
  if (config.geocoding.provider === 'google') {
    result = await geocodeWithGoogle(address);
    // Fallback to Nominatim if Google fails
    if (!result) {
      result = await geocodeWithNominatim(address);
    }
  } else {
    // Default: Nominatim (free, no API key required)
    result = await geocodeWithNominatim(address);
    // Fallback to Google if configured and Nominatim fails
    if (!result && config.geocoding.googleApiKey) {
      result = await geocodeWithGoogle(address);
    }
  }

  // Cache successful results
  if (result) {
    cacheResult(address, result);
    logger.info('Geocoding success', {
      address: address.substring(0, 50),
      lat: result.latitude,
      lng: result.longitude,
      source: result.source,
    });
  } else {
    logger.warn('Geocoding failed for address', { address: address.substring(0, 100) });
  }

  return result;
}

/**
 * Build a full address string from property components.
 * Used to construct a geocodable address from property fields.
 * Returns null if no valid address components are available.
 */
export function buildAddressFromProperty(property: {
  locationArea?: string | null;
  locationCity?: string | null;
  locationPincode?: string | null;
  name?: string;
}): string | null {
  const parts: string[] = [];

  // Only add non-empty, non-whitespace components
  if (property.locationArea?.trim()) parts.push(property.locationArea.trim());
  if (property.locationCity?.trim()) parts.push(property.locationCity.trim());
  if (property.locationPincode?.trim()) parts.push(property.locationPincode.trim());
  
  // Return null if no valid address parts
  if (parts.length === 0) return null;
  
  // Add India for better geocoding accuracy
  parts.push('India');

  return parts.join(', ');
}

/**
 * Clear geocoding cache (for testing)
 */
export function clearGeocodeCache(): void {
  geocodeCache.clear();
}

/**
 * Get cache stats (for monitoring)
 */
export function getGeocodeStats(): { size: number; enabled: boolean } {
  return {
    size: geocodeCache.size,
    enabled: config.geocoding.cacheEnabled,
  };
}

export const geocodingService = {
  geocodeAddress,
  buildAddressFromProperty,
  clearGeocodeCache,
  getGeocodeStats,
};

import { createPropertySchema } from '../../models/validation';

describe('Validation: Property Rich Media Fields (CHUNK 1)', () => {
  describe('Floor Plan URLs', () => {
    it('valid floor plan URLs array passes', () => {
      const data = {
        name: 'Test Property',
        floor_plan_urls: [
          'https://cdn.example.com/floorplan1.pdf',
          'https://cdn.example.com/floorplan2.jpg',
        ],
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('floor plan URL array max 10 items enforced', () => {
      const data = {
        name: 'Test Property',
        floor_plan_urls: Array(11).fill('https://cdn.example.com/floorplan.pdf'),
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('floor plan URL must be valid URL', () => {
      const data = {
        name: 'Test Property',
        floor_plan_urls: ['not-a-valid-url'],
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('empty floor plan URLs array is valid', () => {
      const data = {
        name: 'Test Property',
        floor_plan_urls: [],
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('omitting floor_plan_urls is valid (optional)', () => {
      const data = {
        name: 'Test Property',
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('Price List URL', () => {
    it('valid price list URL passes', () => {
      const data = {
        name: 'Test Property',
        price_list_url: 'https://cdn.example.com/pricelist.pdf',
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('invalid price list URL fails', () => {
      const data = {
        name: 'Test Property',
        price_list_url: 'not-a-url',
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('null price list URL is valid', () => {
      const data = {
        name: 'Test Property',
        price_list_url: null,
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('price list URL max 500 chars enforced', () => {
      const data = {
        name: 'Test Property',
        price_list_url: 'https://cdn.example.com/' + 'a'.repeat(500),
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('Latitude', () => {
    it('valid latitude passes (positive)', () => {
      const data = {
        name: 'Test Property',
        latitude: 12.9716,
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('valid latitude passes (negative)', () => {
      const data = {
        name: 'Test Property',
        latitude: -33.8688,
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('latitude > 90 fails', () => {
      const data = {
        name: 'Test Property',
        latitude: 91,
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('latitude < -90 fails', () => {
      const data = {
        name: 'Test Property',
        latitude: -91,
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('latitude = 0 is valid (equator)', () => {
      const data = {
        name: 'Test Property',
        latitude: 0,
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('null latitude is valid', () => {
      const data = {
        name: 'Test Property',
        latitude: null,
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('Longitude', () => {
    it('valid longitude passes (positive)', () => {
      const data = {
        name: 'Test Property',
        longitude: 77.5946,
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('valid longitude passes (negative)', () => {
      const data = {
        name: 'Test Property',
        longitude: -122.4194,
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('longitude > 180 fails', () => {
      const data = {
        name: 'Test Property',
        longitude: 181,
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('longitude < -180 fails', () => {
      const data = {
        name: 'Test Property',
        longitude: -181,
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('longitude = 0 is valid (prime meridian)', () => {
      const data = {
        name: 'Test Property',
        longitude: 0,
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('null longitude is valid', () => {
      const data = {
        name: 'Test Property',
        longitude: null,
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('Images Array', () => {
    it('valid images array passes', () => {
      const data = {
        name: 'Test Property',
        images: [
          'https://cdn.example.com/image1.jpg',
          'https://cdn.example.com/image2.png',
        ],
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('images array max 10 items enforced', () => {
      const data = {
        name: 'Test Property',
        images: Array(11).fill('https://cdn.example.com/image.jpg'),
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('Brochure URL', () => {
    it('valid brochure URL passes', () => {
      const data = {
        name: 'Test Property',
        brochure_url: 'https://cdn.example.com/brochure.pdf',
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('invalid brochure URL fails', () => {
      const data = {
        name: 'Test Property',
        brochure_url: 'not-a-url',
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('Full Property with All Rich Media Fields', () => {
    it('property with all rich media fields passes validation', () => {
      const data = {
        name: 'Sunshine Apartments',
        builder: 'Prime Developers',
        location_city: 'Bangalore',
        location_area: 'Whitefield',
        location_pincode: '560066',
        price_min: 4500000,
        price_max: 6500000,
        bedrooms: 3,
        property_type: 'apartment',
        amenities: ['Gym', 'Pool', 'Parking'],
        description: 'Luxury 3BHK apartments',
        rera_number: 'PRM/KA/RERA/1251/446/PR/171116/001933',
        status: 'available',
        images: [
          'https://cdn.example.com/exterior.jpg',
          'https://cdn.example.com/interior.jpg',
        ],
        brochure_url: 'https://cdn.example.com/brochure.pdf',
        floor_plan_urls: [
          'https://cdn.example.com/floorplan-2bhk.pdf',
          'https://cdn.example.com/floorplan-3bhk.pdf',
        ],
        price_list_url: 'https://cdn.example.com/pricelist.pdf',
        latitude: 12.9698,
        longitude: 77.7499,
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.floor_plan_urls).toHaveLength(2);
        expect(result.data.latitude).toBe(12.9698);
        expect(result.data.longitude).toBe(77.7499);
      }
    });

    it('backward compatibility: property without new fields passes', () => {
      const data = {
        name: 'Legacy Property',
        builder: 'Old Builder',
        location_city: 'Mumbai',
        price_min: 3000000,
        property_type: 'villa',
        status: 'available',
      };
      const result = createPropertySchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });
});

/**
 * Canonical property import / CSV mapping fields for the Indian real-estate market.
 * Used by bulk CSV import, spreadsheet import, and column alias auto-detection.
 */

export type PropertyImportFieldType =
  | 'string'
  | 'number'
  | 'currency'
  | 'boolean'
  | 'amenities';

export interface PropertyImportFieldDef {
  key: string;
  label: string;
  group: string;
  type: PropertyImportFieldType;
  /** Extra header fragments (lowercase) that should map to this field. */
  aliases?: string[];
}

/** Virtual mapping target: single price column → min & max. */
export const PRICE_SINGLE_FIELD = 'price_single' as const;

export const PROPERTY_IMPORT_FIELD_GROUPS = [
  'Identity & project',
  'Location',
  'Size & areas',
  'Pricing & costs',
  'Unit details',
  'Plot & land',
  'Villa features',
  'Commercial',
  'Legal & Indian market',
  'Media & visits',
  'General',
] as const;

export const PROPERTY_IMPORT_FIELDS: PropertyImportFieldDef[] = [
  // Identity & project
  { key: 'project_name', label: 'Project / development name', group: 'Identity & project', type: 'string', aliases: ['project', 'development name', 'society name', 'layout name'] },
  { key: 'unit_label', label: 'Unit / flat / plot number', group: 'Identity & project', type: 'string', aliases: ['unit label', 'unit no', 'unit number', 'flat no', 'flat number', 'plot no', 'plot number', 'shop no', 'villa no', 'villa number'] },
  { key: 'name', label: 'Property / listing name', group: 'Identity & project', type: 'string', aliases: ['property name', 'listing name', 'title'] },
  { key: 'builder', label: 'Builder / developer', group: 'Identity & project', type: 'string', aliases: ['developer', 'developer name', 'builder name'] },
  { key: 'property_type', label: 'Property type', group: 'Identity & project', type: 'string', aliases: ['type', 'unit type', 'asset type'] },
  { key: 'society_name', label: 'Society / apartment name', group: 'Identity & project', type: 'string', aliases: ['apartment name', 'complex name', 'community name'] },

  // Location
  { key: 'location_city', label: 'City', group: 'Location', type: 'string', aliases: ['city', 'town', 'district'] },
  { key: 'location_area', label: 'Locality / area', group: 'Location', type: 'string', aliases: ['area', 'locality', 'neighbourhood', 'neighborhood', 'sector', 'zone', 'micro market'] },
  { key: 'location_pincode', label: 'Pincode', group: 'Location', type: 'string', aliases: ['pincode', 'pin code', 'zip', 'postal code'] },
  { key: 'latitude', label: 'Latitude', group: 'Location', type: 'number', aliases: ['lat'] },
  { key: 'longitude', label: 'Longitude', group: 'Location', type: 'number', aliases: ['lng', 'long'] },
  { key: 'nearby_landmarks', label: 'Nearby landmarks', group: 'Location', type: 'string', aliases: ['landmarks', 'nearby', 'connectivity', 'landmark'] },

  // Size & areas
  { key: 'bhk', label: 'BHK configuration', group: 'Size & areas', type: 'string', aliases: ['configuration', 'config', 'bhk config'] },
  { key: 'bedrooms', label: 'Bedrooms (count)', group: 'Size & areas', type: 'number', aliases: ['bedroom', 'bed', 'beds', 'no of bedrooms'] },
  { key: 'carpet_area_sqft', label: 'Carpet area (sq ft)', group: 'Size & areas', type: 'number', aliases: ['carpet area', 'carpet sqft', 'carpet sq ft', 'carpet'] },
  { key: 'built_up_area_sqft', label: 'Built-up area (sq ft)', group: 'Size & areas', type: 'number', aliases: ['built up area', 'builtup area', 'built up sqft', 'bua'] },
  { key: 'super_built_up_sqft', label: 'Super built-up area (sq ft)', group: 'Size & areas', type: 'number', aliases: ['super built up', 'super builtup', 'sbua', 'super area'] },
  { key: 'plot_area_sqft', label: 'Plot area (sq ft)', group: 'Size & areas', type: 'number', aliases: ['plot area', 'plot sqft', 'land area', 'site area'] },
  { key: 'commercial_area_sqft', label: 'Commercial / leasable area (sq ft)', group: 'Size & areas', type: 'number', aliases: ['commercial area', 'saleable area', 'leasable area', 'shop area'] },
  { key: 'balconies', label: 'Balconies', group: 'Size & areas', type: 'string', aliases: ['balcony', 'no of balconies'] },
  { key: 'plot_dimensions', label: 'Plot dimensions (e.g. 30x40)', group: 'Size & areas', type: 'string', aliases: ['dimensions', 'plot size', 'site dimensions'] },

  // Pricing & costs
  { key: 'price', label: 'Price (single value)', group: 'Pricing & costs', type: 'currency', aliases: ['total price', 'all inclusive price', 'ticket size'] },
  { key: 'price_min', label: 'Price (min)', group: 'Pricing & costs', type: 'currency', aliases: ['price from', 'min price', 'starting price', 'base price'] },
  { key: 'price_max', label: 'Price (max)', group: 'Pricing & costs', type: 'currency', aliases: ['price to', 'max price', 'price upto', 'price up to'] },
  { key: 'price_per_sqft', label: 'Price per sq ft', group: 'Pricing & costs', type: 'currency', aliases: ['rate per sqft', 'rate sqft', 'psf', 'per sqft'] },
  { key: 'price_per_cent', label: 'Price per cent', group: 'Pricing & costs', type: 'currency', aliases: ['rate per cent', 'per cent', 'lakh per cent'] },
  { key: 'maintenance_monthly', label: 'Maintenance (monthly)', group: 'Pricing & costs', type: 'currency', aliases: ['maintenance', 'maintenance charges', 'monthly maintenance', 'society charges'] },
  { key: 'maintenance_per_sqft', label: 'Maintenance per sq ft', group: 'Pricing & costs', type: 'number', aliases: ['maintenance psf', 'maint per sqft'] },
  { key: 'maintenance_fee', label: 'Maintenance fee (general)', group: 'Pricing & costs', type: 'string', aliases: ['maintenance fee'] },
  { key: 'expected_rent_monthly', label: 'Expected rent (monthly)', group: 'Pricing & costs', type: 'currency', aliases: ['expected rent', 'monthly rent', 'rental income'] },
  { key: 'roi_percentage', label: 'ROI / yield (%)', group: 'Pricing & costs', type: 'number', aliases: ['roi', 'yield', 'return'] },
  { key: 'gst_applicable', label: 'GST applicable', group: 'Pricing & costs', type: 'string', aliases: ['gst', 'gst rate'] },
  { key: 'payment_plan', label: 'Payment plan', group: 'Pricing & costs', type: 'string', aliases: ['payment schedule', 'installment plan', 'clp'] },
  { key: 'booking_amount', label: 'Booking amount', group: 'Pricing & costs', type: 'currency', aliases: ['token amount', 'booking advance', 'eoi amount'] },
  { key: 'stamp_duty_note', label: 'Stamp duty note', group: 'Pricing & costs', type: 'string', aliases: ['stamp duty'] },
  { key: 'registration_charges', label: 'Registration charges', group: 'Pricing & costs', type: 'string', aliases: ['registration fee', 'reg charges'] },
  { key: 'floor_rise_charges', label: 'Floor rise charges', group: 'Pricing & costs', type: 'string', aliases: ['floor rise', 'plc charges', 'preferential location charges'] },

  // Unit details
  { key: 'facing', label: 'Facing direction', group: 'Unit details', type: 'string', aliases: ['direction', 'orientation'] },
  { key: 'vastu_facing', label: 'Vastu facing', group: 'Unit details', type: 'string', aliases: ['vastu', 'vastu compliant'] },
  { key: 'floor_number', label: 'Floor number', group: 'Unit details', type: 'string', aliases: ['floor', 'floor no', 'level'] },
  { key: 'total_floors', label: 'Total floors in building', group: 'Unit details', type: 'string', aliases: ['total floor', 'building floors', 'g plus'] },
  { key: 'tower_name', label: 'Tower / block name', group: 'Unit details', type: 'string', aliases: ['tower', 'block', 'wing', 'phase'] },
  { key: 'possession_date', label: 'Possession date / timeline', group: 'Unit details', type: 'string', aliases: ['possession', 'handover', 'ready to move', 'completion date'] },
  { key: 'parking', label: 'Parking', group: 'Unit details', type: 'string', aliases: ['car parking', 'parking slots', 'parking type'] },
  { key: 'furnishing_status', label: 'Furnishing status', group: 'Unit details', type: 'string', aliases: ['furnishing', 'furnished', 'semi furnished', 'unfurnished'] },
  { key: 'age_of_property', label: 'Age of property', group: 'Unit details', type: 'string', aliases: ['property age', 'year built', 'construction year'] },
  { key: 'lift_available', label: 'Lift available', group: 'Unit details', type: 'boolean', aliases: ['lift', 'elevator'] },
  { key: 'power_backup', label: 'Power backup', group: 'Unit details', type: 'string', aliases: ['backup power', 'dg backup', 'generator'] },

  // Plot & land
  { key: 'is_corner_plot', label: 'Corner plot', group: 'Plot & land', type: 'boolean', aliases: ['corner plot', 'corner'] },
  { key: 'road_width_ft', label: 'Road width (ft)', group: 'Plot & land', type: 'number', aliases: ['road width', 'approach road'] },
  { key: 'road_frontage_ft', label: 'Road frontage (ft)', group: 'Plot & land', type: 'number', aliases: ['frontage', 'road frontage', 'shop frontage'] },
  { key: 'is_gated', label: 'Gated community / layout', group: 'Plot & land', type: 'boolean', aliases: ['gated', 'gated community', 'gated layout'] },
  { key: 'approvals', label: 'Approvals (DTCP/BDA/RERA)', group: 'Plot & land', type: 'string', aliases: ['approval', 'layout approval', 'authority approval'] },
  { key: 'construction_allowed', label: 'Construction allowed', group: 'Plot & land', type: 'string', aliases: ['construction type', 'building permission'] },
  { key: 'legal_status', label: 'Legal / title status', group: 'Plot & land', type: 'string', aliases: ['title status', 'title clarity', 'legal clear'] },

  // Villa features
  { key: 'has_garden', label: 'Private garden', group: 'Villa features', type: 'boolean', aliases: ['garden', 'private garden', 'landscaped garden'] },
  { key: 'has_pool', label: 'Pool (private / community)', group: 'Villa features', type: 'boolean', aliases: ['pool', 'swimming pool', 'private pool'] },
  { key: 'has_servant_room', label: 'Servant room / quarter', group: 'Villa features', type: 'boolean', aliases: ['servant room', 'servant quarter', 'maids room'] },
  { key: 'modification_allowed', label: 'Structural modifications allowed', group: 'Villa features', type: 'string', aliases: ['modifications', 'customization'] },

  // Commercial
  { key: 'shutters_included', label: 'Shutters / fit-out level', group: 'Commercial', type: 'string', aliases: ['fit out', 'fitout', 'shell type', 'bare shell', 'warm shell'] },
  { key: 'has_3phase_power', label: '3-phase power', group: 'Commercial', type: 'boolean', aliases: ['3 phase', 'three phase', '3phase power'] },
  { key: 'footfall_description', label: 'Footfall / catchment', group: 'Commercial', type: 'string', aliases: ['footfall', 'catchment', 'traffic'] },

  // Legal & Indian market
  { key: 'rera_number', label: 'RERA registration number', group: 'Legal & Indian market', type: 'string', aliases: ['rera', 'rera no', 'rera id', 'rera registration'] },
  { key: 'khata_type', label: 'Khata type (A / B / E)', group: 'Legal & Indian market', type: 'string', aliases: ['khata', 'a khata', 'b khata', 'e khata', 'bbmp khata'] },
  { key: 'water_source', label: 'Water source', group: 'Legal & Indian market', type: 'string', aliases: ['water supply', 'bwssb', 'kaveri', 'borewell', 'cmc water'] },

  // Media & visits
  { key: 'brochure_url', label: 'Brochure URL', group: 'Media & visits', type: 'string', aliases: ['brochure', 'brochure link', 'pdf url'] },
  { key: 'hero_image_url', label: 'Hero / main image URL', group: 'Media & visits', type: 'string', aliases: ['image url', 'main image', 'photo url', 'thumbnail'] },
  { key: 'visit_timings', label: 'Site visit timings', group: 'Media & visits', type: 'string', aliases: ['visit hours', 'site visit', 'office hours'] },

  // General
  { key: 'status', label: 'Availability status', group: 'General', type: 'string', aliases: ['availability', 'available', 'inventory status'] },
  { key: 'description', label: 'Description / remarks', group: 'General', type: 'string', aliases: ['remarks', 'notes', 'details', 'highlights'] },
  { key: 'amenities', label: 'Amenities / facilities', group: 'General', type: 'amenities', aliases: ['features', 'facilities', 'clubhouse amenities'] },
];

/** Fields that can be selected in column mapping (excludes virtual price_single). */
export const PROPERTY_TARGET_FIELDS = PROPERTY_IMPORT_FIELDS.map((f) => f.key) as readonly string[];

export type PropertyTargetField = typeof PROPERTY_TARGET_FIELDS[number];

export const PROPERTY_IMPORT_FIELD_LABELS: Record<string, string> = Object.fromEntries(
  PROPERTY_IMPORT_FIELDS.map((f) => [f.key, f.label]),
);

export const PROPERTY_IMPORT_FIELDS_BY_GROUP: Record<string, PropertyImportFieldDef[]> =
  PROPERTY_IMPORT_FIELD_GROUPS.reduce((acc, group) => {
    acc[group] = PROPERTY_IMPORT_FIELDS.filter((f) => f.group === group);
    return acc;
  }, {} as Record<string, PropertyImportFieldDef[]>);

/** Build alias table: normalised header fragment → target field key. */
export function buildPropertyImportColumnAliases(): Record<string, string> {
  const aliases: Record<string, string> = {
    rate: PRICE_SINGLE_FIELD,
    'single price': PRICE_SINGLE_FIELD,
    'all inclusive price': 'price',
  };

  for (const field of PROPERTY_IMPORT_FIELDS) {
    const keyNormalised = field.key.replace(/_/g, ' ');
    aliases[keyNormalised] = field.key;
    aliases[field.key.replace(/_/g, '')] = field.key;

    for (const extra of field.aliases ?? []) {
      aliases[extra.toLowerCase()] = field.key;
    }
  }

  return aliases;
}

/** Identity fields — at least one must be mapped for a valid import. */
export const PROPERTY_IDENTITY_TARGET_FIELDS = ['name', 'unit_label', 'project_name'] as const;

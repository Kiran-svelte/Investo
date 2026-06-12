/**
 * Property import / CSV column mapping fields — Indian real-estate market.
 * Keep in sync with backend/src/constants/property-import-fields.constants.ts
 */

export const BULK_IMPORT_PRICE_SINGLE_FIELD = 'price_single' as const;

export const BULK_IMPORT_FIELD_GROUPS = [
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

export interface BulkImportFieldDef {
  key: string;
  label: string;
  group: typeof BULK_IMPORT_FIELD_GROUPS[number];
}

export const BULK_IMPORT_FIELDS: BulkImportFieldDef[] = [
  { key: 'project_name', label: 'Project / development name', group: 'Identity & project' },
  { key: 'unit_label', label: 'Unit / flat / plot number', group: 'Identity & project' },
  { key: 'name', label: 'Property / listing name', group: 'Identity & project' },
  { key: 'builder', label: 'Builder / developer', group: 'Identity & project' },
  { key: 'property_type', label: 'Property type', group: 'Identity & project' },
  { key: 'society_name', label: 'Society / apartment name', group: 'Identity & project' },

  { key: 'location_city', label: 'City', group: 'Location' },
  { key: 'location_area', label: 'Locality / area', group: 'Location' },
  { key: 'location_pincode', label: 'Pincode', group: 'Location' },
  { key: 'latitude', label: 'Latitude', group: 'Location' },
  { key: 'longitude', label: 'Longitude', group: 'Location' },
  { key: 'nearby_landmarks', label: 'Nearby landmarks', group: 'Location' },

  { key: 'bhk', label: 'BHK configuration', group: 'Size & areas' },
  { key: 'bedrooms', label: 'Bedrooms (count)', group: 'Size & areas' },
  { key: 'carpet_area_sqft', label: 'Carpet area (sq ft)', group: 'Size & areas' },
  { key: 'built_up_area_sqft', label: 'Built-up area (sq ft)', group: 'Size & areas' },
  { key: 'super_built_up_sqft', label: 'Super built-up area (sq ft)', group: 'Size & areas' },
  { key: 'plot_area_sqft', label: 'Plot area (sq ft)', group: 'Size & areas' },
  { key: 'commercial_area_sqft', label: 'Commercial / leasable area (sq ft)', group: 'Size & areas' },
  { key: 'balconies', label: 'Balconies', group: 'Size & areas' },
  { key: 'plot_dimensions', label: 'Plot dimensions (e.g. 30x40)', group: 'Size & areas' },

  { key: 'price', label: 'Price (single value)', group: 'Pricing & costs' },
  { key: BULK_IMPORT_PRICE_SINGLE_FIELD, label: 'Price → min & max (same column)', group: 'Pricing & costs' },
  { key: 'price_min', label: 'Price (min)', group: 'Pricing & costs' },
  { key: 'price_max', label: 'Price (max)', group: 'Pricing & costs' },
  { key: 'price_per_sqft', label: 'Price per sq ft', group: 'Pricing & costs' },
  { key: 'price_per_cent', label: 'Price per cent', group: 'Pricing & costs' },
  { key: 'maintenance_monthly', label: 'Maintenance (monthly)', group: 'Pricing & costs' },
  { key: 'maintenance_per_sqft', label: 'Maintenance per sq ft', group: 'Pricing & costs' },
  { key: 'maintenance_fee', label: 'Maintenance fee (general)', group: 'Pricing & costs' },
  { key: 'expected_rent_monthly', label: 'Expected rent (monthly)', group: 'Pricing & costs' },
  { key: 'roi_percentage', label: 'ROI / yield (%)', group: 'Pricing & costs' },
  { key: 'gst_applicable', label: 'GST applicable', group: 'Pricing & costs' },
  { key: 'payment_plan', label: 'Payment plan', group: 'Pricing & costs' },
  { key: 'booking_amount', label: 'Booking amount', group: 'Pricing & costs' },
  { key: 'stamp_duty_note', label: 'Stamp duty note', group: 'Pricing & costs' },
  { key: 'registration_charges', label: 'Registration charges', group: 'Pricing & costs' },
  { key: 'floor_rise_charges', label: 'Floor rise / PLC charges', group: 'Pricing & costs' },

  { key: 'facing', label: 'Facing direction', group: 'Unit details' },
  { key: 'vastu_facing', label: 'Vastu facing', group: 'Unit details' },
  { key: 'floor_number', label: 'Floor number', group: 'Unit details' },
  { key: 'total_floors', label: 'Total floors in building', group: 'Unit details' },
  { key: 'tower_name', label: 'Tower / block name', group: 'Unit details' },
  { key: 'possession_date', label: 'Possession date / timeline', group: 'Unit details' },
  { key: 'parking', label: 'Parking', group: 'Unit details' },
  { key: 'furnishing_status', label: 'Furnishing status', group: 'Unit details' },
  { key: 'age_of_property', label: 'Age of property', group: 'Unit details' },
  { key: 'lift_available', label: 'Lift available', group: 'Unit details' },
  { key: 'power_backup', label: 'Power backup', group: 'Unit details' },

  { key: 'is_corner_plot', label: 'Corner plot', group: 'Plot & land' },
  { key: 'road_width_ft', label: 'Road width (ft)', group: 'Plot & land' },
  { key: 'road_frontage_ft', label: 'Road frontage (ft)', group: 'Plot & land' },
  { key: 'is_gated', label: 'Gated community / layout', group: 'Plot & land' },
  { key: 'approvals', label: 'Approvals (DTCP/BDA/RERA)', group: 'Plot & land' },
  { key: 'construction_allowed', label: 'Construction allowed', group: 'Plot & land' },
  { key: 'legal_status', label: 'Legal / title status', group: 'Plot & land' },

  { key: 'has_garden', label: 'Private garden', group: 'Villa features' },
  { key: 'has_pool', label: 'Pool (private / community)', group: 'Villa features' },
  { key: 'has_servant_room', label: 'Servant room / quarter', group: 'Villa features' },
  { key: 'modification_allowed', label: 'Structural modifications allowed', group: 'Villa features' },

  { key: 'shutters_included', label: 'Shutters / fit-out level', group: 'Commercial' },
  { key: 'has_3phase_power', label: '3-phase power', group: 'Commercial' },
  { key: 'footfall_description', label: 'Footfall / catchment', group: 'Commercial' },

  { key: 'rera_number', label: 'RERA registration number', group: 'Legal & Indian market' },
  { key: 'khata_type', label: 'Khata type (A / B / E)', group: 'Legal & Indian market' },
  { key: 'water_source', label: 'Water source (BWSSB / borewell)', group: 'Legal & Indian market' },

  { key: 'brochure_url', label: 'Brochure URL', group: 'Media & visits' },
  { key: 'hero_image_url', label: 'Hero / main image URL', group: 'Media & visits' },
  { key: 'visit_timings', label: 'Site visit timings', group: 'Media & visits' },

  { key: 'status', label: 'Availability status', group: 'General' },
  { key: 'description', label: 'Description / remarks', group: 'General' },
  { key: 'amenities', label: 'Amenities / facilities', group: 'General' },
];

export const BULK_IMPORT_TARGET_FIELD_LABELS: Record<string, string> = {
  ...Object.fromEntries(BULK_IMPORT_FIELDS.map((f) => [f.key, f.label])),
  skip: '— Skip this column —',
};

export const BULK_IMPORT_FIELDS_BY_GROUP: Record<string, BulkImportFieldDef[]> =
  BULK_IMPORT_FIELD_GROUPS.reduce((acc, group) => {
    acc[group] = BULK_IMPORT_FIELDS.filter((f) => f.group === group);
    return acc;
  }, {} as Record<string, BulkImportFieldDef[]>);

/** Flat list for backwards compatibility (excludes skip). */
export const BULK_IMPORT_COLUMN_TARGET_OPTIONS = [
  ...BULK_IMPORT_FIELDS.map((f) => f.key),
  'skip',
] as const;

/** Labels for property import mapping review (includes all import fields). */
export const PROPERTY_IMPORT_FIELD_LABELS: Record<string, string> = BULK_IMPORT_TARGET_FIELD_LABELS;

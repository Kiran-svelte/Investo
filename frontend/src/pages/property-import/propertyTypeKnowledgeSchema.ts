import type { PropertyImportFormValues } from './propertyImport.utils';

export type PropertyKnowledgeType = 'apartment' | 'villa' | 'plot' | 'commercial';

export const PROPERTY_KNOWLEDGE_TYPES: PropertyKnowledgeType[] = [
  'apartment',
  'villa',
  'plot',
  'commercial',
];

export interface TypeKnowledgeFieldDef {
  key: string;
  prompt: string;
  helpText: string;
  options: string[];
  allowCustom: boolean;
  customPlaceholder?: string;
  formField?: keyof PropertyImportFormValues;
}

const OTHER = 'Other (type my own answer)';

function field(
  key: string,
  prompt: string,
  helpText: string,
  options: string[],
  extra?: Partial<TypeKnowledgeFieldDef>,
): TypeKnowledgeFieldDef {
  return {
    key,
    prompt,
    helpText,
    options: [...options, OTHER],
    allowCustom: true,
    ...extra,
  };
}

export const APARTMENT_KNOWLEDGE_FIELDS: TypeKnowledgeFieldDef[] = [
  field('carpet_area_sqft', 'What is the carpet area (sq ft)?', 'Typical size buyers ask about for apartments.', ['Under 900 sq ft', '900–1200 sq ft', '1200–1600 sq ft', '1600+ sq ft']),
  field('bhk', 'How many BHK configurations?', 'Unit mix for matching buyer requests.', ['1 BHK', '2 BHK', '3 BHK', '2 & 3 BHK mix', '4 BHK'], { formField: 'bedrooms' }),
  field('price', 'What is the price range for this project?', 'Use brochure pricing only.', ['Under ₹50 L', '₹50 L – ₹1 Cr', '₹1 – ₹2 Cr', '₹2 Cr+'], { formField: 'price_min' }),
  field('floor_number', 'Typical floor levels available?', 'Helps answer high-floor vs low-floor queries.', ['Low rise (G+4)', 'Mid rise (5–12)', 'High rise (13+)']),
  field('tower_name', 'Tower or block names?', 'Name buyers may refer to on site visits.', ['Single tower', 'Tower A / B', 'Multiple blocks']),
  field('possession_date', 'When is possession expected?', 'Only dates you can confirm from brochure.', ['Ready to move', 'Within 6 months', 'Within 12 months', 'Under construction']),
  field('maintenance_fee', 'Monthly maintenance charges?', 'Per sq ft or flat monthly fee from brochure.', ['Under ₹3/sqft', '₹3–5/sqft', '₹5+/sqft', 'Not disclosed yet']),
  field('facing', 'Common facing directions?', 'East/north etc. as listed in brochure.', ['East', 'West', 'North', 'South', 'Mixed']),
  field('parking', 'Parking included?', 'Covered/open slots per unit.', ['1 covered', '2 covered', 'Open parking', 'Paid extra']),
  field('amenities', 'Key amenities to highlight?', 'Clubhouse, pool, security — facts only.', ['Clubhouse & pool', 'Security & parking', 'Green spaces', 'Sports & kids'], { formField: 'amenities' }),
];

export const PLOT_KNOWLEDGE_FIELDS: TypeKnowledgeFieldDef[] = [
  field('plot_area_sqft', 'Plot area (sq ft or cents)?', 'Size buyers compare across layouts.', ['Under 1200 sq ft', '1200–2400 sq ft', '30×40', '40×60', '50×80']),
  field('price_per_cent', 'Price per cent or per sq ft?', 'From official rate sheet only.', ['Under ₹15 L/cent', '₹15–25 L/cent', '₹25 L+/cent']),
  field('is_corner_plot', 'Corner plots available?', 'Yes/no for layout preference.', ['Yes', 'No', 'Some units only']),
  field('road_width_ft', 'Internal road width (ft)?', 'Important for plot buyers.', ['30 ft', '40 ft', '50 ft+']),
  field('is_gated', 'Gated community?', 'Layout security from brochure.', ['Fully gated', 'Partially gated', 'Open layout']),
  field('approvals', 'Approvals in place?', 'BDA/DTCP/RERA as applicable.', ['DTCP approved', 'BDA approved', 'RERA registered layout', 'Pending']),
  field('construction_allowed', 'Construction allowed on plot?', 'What buyers can build.', ['Individual villa', 'Row house', 'Apartment block (if any)', 'Not allowed']),
  field('plot_dimensions', 'Common plot dimensions?', 'Standard sizes in this layout.', ['30×40', '40×60', '50×80', 'Odd sizes']),
  field('facing', 'Preferred plot facing?', 'East/north etc. as listed.', ['East', 'North', 'West', 'South']),
  field('legal_status', 'Legal / title status?', 'Title clarity for buyers.', ['Clear title', 'Conversion done', 'Loan available', 'Verify with lawyer']),
];

export const VILLA_KNOWLEDGE_FIELDS: TypeKnowledgeFieldDef[] = [
  field('plot_area_sqft', 'Plot area per villa (sq ft)?', 'Land area per unit.', ['Under 2000 sq ft', '2000–3000 sq ft', '3000+ sq ft']),
  field('built_up_area_sqft', 'Built-up area (sq ft)?', 'Constructed area per villa.', ['Under 2000', '2000–3500', '3500+']),
  field('bhk', 'Villa BHK sizes?', 'Configurations available.', ['3 BHK', '4 BHK', '3 & 4 BHK mix', '5 BHK'], { formField: 'bedrooms' }),
  field('has_garden', 'Private garden?', 'Outdoor space per villa.', ['Yes', 'No', 'Optional upgrade']),
  field('has_pool', 'Private or community pool?', 'Pool availability.', ['Private pool', 'Community pool', 'No pool']),
  field('has_servant_room', 'Servant room / quarter?', 'Staff quarter if any.', ['Yes', 'No']),
  field('price', 'Price range per villa?', 'From brochure pricing only.', ['Under ₹1 Cr', '₹1–2 Cr', '₹2–4 Cr', '₹4 Cr+'], { formField: 'price_min' }),
  field('maintenance_fee', 'Maintenance / society charges?', 'Monthly or annual charges.', ['Under ₹5k/month', '₹5–10k/month', '₹10k+/month']),
  field('possession_date', 'Possession timeline?', 'Only confirmed dates.', ['Ready to move', 'Within 6 months', 'Within 12 months', 'Under construction']),
  field('modification_allowed', 'Structural modifications allowed?', 'Buyer customization rules.', ['Yes with approval', 'Limited', 'Not allowed']),
];

export const COMMERCIAL_KNOWLEDGE_FIELDS: TypeKnowledgeFieldDef[] = [
  field('commercial_area_sqft', 'Leasable / saleable area (sq ft)?', 'Carpet or super built-up area.', ['Under 500', '500–1500', '1500–5000', '5000+']),
  field('price', 'Price or ticket size?', 'Sale or lease ticket size.', ['Under ₹50 L', '₹50 L – ₹2 Cr', '₹2 Cr+'], { formField: 'price_min' }),
  field('floor_number', 'Floor level?', 'Which floors are available.', ['Ground', 'First', 'Multi-floor building', 'Full building']),
  field('road_frontage_ft', 'Road frontage (ft)?', 'Visibility for retail.', ['Under 20 ft', '20–40 ft', '40+ ft']),
  field('expected_rent', 'Expected monthly rent?', 'If lease — from brochure only.', ['Under ₹50k', '₹50k–₹1.5 L', '₹1.5 L+']),
  field('roi_percentage', 'Expected ROI / yield?', 'Do not guarantee returns.', ['6–8%', '8–10%', '10%+', 'Not guaranteed']),
  field('gst_applicable', 'GST applicable?', 'Tax treatment if known.', ['Yes 18%', 'Exempt / old stock', 'Consult CA']),
  field('shutters_included', 'Shutters / fit-outs included?', 'Fit-out level.', ['Bare shell', 'Warm shell', 'Fully fitted']),
  field('has_3phase_power', '3-phase power available?', 'Power load for commercial use.', ['Yes', 'No', 'Upgrade possible']),
  field('footfall_description', 'Footfall / catchment?', 'Who walks past this asset.', ['High street', 'Mall anchor', 'IT park vicinity', 'Residential catchment']),
];

export const ANYTHING_ELSE_FIELD: TypeKnowledgeFieldDef = {
  key: 'anything_else',
  prompt: 'Is there anything else to add to AI knowledge?',
  helpText: 'Optional facts for WhatsApp — payment plans, nearby landmarks, visit timings, etc.',
  options: ['Nothing else', OTHER],
  allowCustom: true,
  customPlaceholder: 'Type anything buyers should know…',
};

export function getKnowledgeFieldsForType(propertyType: string): TypeKnowledgeFieldDef[] {
  const normalized = propertyType.trim().toLowerCase();
  switch (normalized) {
    case 'apartment':
      return APARTMENT_KNOWLEDGE_FIELDS;
    case 'plot':
      return PLOT_KNOWLEDGE_FIELDS;
    case 'villa':
      return VILLA_KNOWLEDGE_FIELDS;
    case 'commercial':
      return COMMERCIAL_KNOWLEDGE_FIELDS;
    default:
      return [];
  }
}

export function questionIdForField(key: string): string {
  return `tk_${key}`;
}

export { OTHER as TYPE_KNOWLEDGE_CUSTOM_OPTION };

function readDraftKnowledge(draftData?: Record<string, unknown> | null): Record<string, string> {
  if (!draftData || typeof draftData !== 'object') {
    return {};
  }
  const raw = draftData.type_knowledge ?? draftData.typeKnowledge;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim()) {
      out[key] = value.trim();
    }
  }
  return out;
}

function readSourceRecord(draftData?: Record<string, unknown> | null): Record<string, unknown> {
  if (!draftData || typeof draftData !== 'object') {
    return {};
  }
  const mapping = draftData.import_mapping ?? draftData.importMapping;
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    return {};
  }
  const source = (mapping as Record<string, unknown>).source_record ?? (mapping as Record<string, unknown>).sourceRecord;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return {};
  }
  return source as Record<string, unknown>;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s-]+/g, '_');
}

function valueFromRecord(record: Record<string, unknown>, key: string): string {
  const candidates = [
    key,
    normalizeKey(key),
    key.replace(/_/g, ''),
  ];
  for (const candidate of candidates) {
    const raw = record[candidate];
    if (raw !== null && raw !== undefined && String(raw).trim()) {
      return String(raw).trim();
    }
  }
  return '';
}

function formValueForField(
  formValues: PropertyImportFormValues,
  field: TypeKnowledgeFieldDef,
): string {
  if (field.key === 'bhk' && formValues.bedrooms.trim()) {
    return formValues.bedrooms.trim();
  }
  if (field.key === 'price' && formValues.price_min.trim() && formValues.price_max.trim()) {
    return `${formValues.price_min}-${formValues.price_max}`;
  }
  if (field.formField) {
    const v = formValues[field.formField];
    if (typeof v === 'string' && v.trim()) {
      return v.trim();
    }
  }
  return '';
}

export function isTypeKnowledgeFieldFilled(
  field: TypeKnowledgeFieldDef,
  formValues: PropertyImportFormValues,
  draftData?: Record<string, unknown> | null,
): boolean {
  if (field.key === 'anything_else') {
    const tk = readDraftKnowledge(draftData);
    if (tk.anything_else?.trim()) {
      return true;
    }
    const skipped = tk.anything_else_skipped === 'true' || tk.anything_else === 'Nothing else';
    return skipped;
  }

  const formVal = formValueForField(formValues, field);
  if (formVal) {
    return true;
  }

  const tk = readDraftKnowledge(draftData);
  if (tk[field.key]?.trim()) {
    return true;
  }

  if (draftData && typeof draftData === 'object') {
    const direct = draftData[field.key] ?? draftData[normalizeKey(field.key)];
    if (direct !== null && direct !== undefined && String(direct).trim()) {
      return true;
    }
  }

  const source = readSourceRecord(draftData);
  if (valueFromRecord(source, field.key)) {
    return true;
  }

  if (formValues.description.trim().length >= 40) {
    const desc = formValues.description.toLowerCase();
    const tokens: Record<string, RegExp> = {
      possession_date: /possession|handover|ready to move|dec 20|jan 20|q[1-4]/i,
      bhk: /\b[1-4]\s*bhk\b/i,
      facing: /\b(east|west|north|south)\s*facing\b/i,
      amenities: /\b(pool|gym|clubhouse|parking|security)\b/i,
      is_gated: /\bgated\b/i,
      is_corner_plot: /\bcorner\s*plot\b/i,
      has_pool: /\bpool\b/i,
      has_garden: /\bgarden\b/i,
      gst_applicable: /\bgst\b/i,
      has_3phase_power: /\b3\s*phase\b/i,
    };
    const pattern = tokens[field.key];
    if (pattern?.test(desc)) {
      return true;
    }
  }

  return false;
}

export function readTypeKnowledgeAnswers(draftData?: Record<string, unknown> | null): Record<string, string> {
  return readDraftKnowledge(draftData);
}

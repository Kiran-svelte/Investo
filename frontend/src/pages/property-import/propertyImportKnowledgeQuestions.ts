import type { PropertyImportFormValues } from './propertyImport.utils';
import { assessProjectKnowledgeGaps } from './assessProjectKnowledgeGaps';
import type { PropertyImportMappingMetadata } from './propertyImport.utils';
import {
  deriveMaxBhkFromUnits,
  parseUnitConfigurations,
  parseUnitMixAnswer,
  type UnitConfigurationRow,
} from './propertyImportUnitConfig';

export interface MarketingKnowledgeQuestion {
  id: string;
  prompt: string;
  helpText: string;
  options: string[];
  allowCustom: boolean;
  customPlaceholder?: string;
  /** Form field to set when a preset option is chosen */
  formField?: keyof PropertyImportFormValues;
  /** Stored in draft_data.ai_marketing_answers */
  answerKey?: string;
}

const CUSTOM_OPTION = 'Other (type my own answer)';

export const KNOWLEDGE_QUESTION_POOL: MarketingKnowledgeQuestion[] = [
  {
    id: 'property_type',
    prompt: 'What type of property is this project?',
    helpText: 'The AI uses this to match buyer requests (BHK, villa, plot, etc.).',
    options: ['Apartment', 'Villa', 'Plot', 'Commercial', CUSTOM_OPTION],
    allowCustom: true,
    formField: 'property_type',
  },
  {
    id: 'unit_mix',
    prompt: 'What BHK / unit types does this apartment project include?',
    helpText: 'List the unit mix so WhatsApp AI can quote the right inventory (not a single bedroom count).',
    options: ['2 BHK only', '2 & 3 BHK', '2, 3 & 4 BHK', 'Multiple sizes (describe)', CUSTOM_OPTION],
    allowCustom: true,
    answerKey: 'unit_mix',
  },
  {
    id: 'villa_unit_mix',
    prompt: 'What villa sizes and how many of each?',
    helpText: 'Example: 5 villas — mix of 3BHK and 4BHK. The AI needs counts per type.',
    options: ['Mostly 3 BHK villas', 'Mix of 3 & 4 BHK', '2, 3 & 4 BHK mix', 'Multiple sizes (describe)', CUSTOM_OPTION],
    allowCustom: true,
    answerKey: 'unit_mix',
  },
  {
    id: 'location_focus',
    prompt: 'What location should buyers remember for this project?',
    helpText: 'City, area, or landmark — only facts from your brochure.',
    options: ['City center', 'Suburb / township', 'Near IT corridor', 'Highway / expressway access', CUSTOM_OPTION],
    allowCustom: true,
    answerKey: 'location_focus',
  },
  {
    id: 'builder_trust',
    prompt: 'Who is the builder or developer?',
    helpText: 'Helps the AI sound credible; use the legal name from RERA or brochure.',
    options: ['Listed developer', 'Established regional builder', 'New launch brand', CUSTOM_OPTION],
    allowCustom: true,
    formField: 'builder',
  },
  {
    id: 'target_buyer',
    prompt: 'Who is the ideal buyer for this project?',
    helpText: 'Helps the AI tailor tone and benefits on WhatsApp.',
    options: ['End-user families', 'First-time homebuyers', 'Investors', 'NRI buyers', CUSTOM_OPTION],
    allowCustom: true,
    answerKey: 'target_buyer',
  },
  {
    id: 'possession',
    prompt: 'When is possession or handover expected?',
    helpText: 'Only state dates you are sure about — the AI will not invent timelines.',
    options: ['Ready to move', 'Within 6 months', 'Within 12 months', 'Under construction (no fixed date yet)', CUSTOM_OPTION],
    allowCustom: true,
    answerKey: 'possession_timeline',
  },
  {
    id: 'payment_plan',
    prompt: 'What payment plan can you honestly offer?',
    helpText: 'EMI and discounts must match your real offer.',
    options: ['Full payment', 'Construction-linked plan', 'Bank loan / EMI assistance', 'Flexible payment schedule', CUSTOM_OPTION],
    allowCustom: true,
    answerKey: 'payment_plan',
  },
  {
    id: 'key_highlight',
    prompt: 'What is the #1 selling point buyers should know?',
    helpText: 'One clear fact the AI can repeat (location, price value, builder, amenities).',
    options: ['Prime location / connectivity', 'Competitive pricing', 'Trusted builder', 'Amenities & lifestyle', CUSTOM_OPTION],
    allowCustom: true,
    answerKey: 'key_selling_point',
  },
  {
    id: 'amenities_focus',
    prompt: 'Which amenities should the AI mention most?',
    helpText: 'Pick what is actually in the brochure or on site.',
    options: ['Clubhouse & pool', 'Security & parking', 'Green / open spaces', 'Kids & sports facilities', CUSTOM_OPTION],
    allowCustom: true,
    answerKey: 'amenities_focus',
  },
];

/** @deprecated Use KNOWLEDGE_QUESTION_POOL */
export const MARKETING_KNOWLEDGE_QUESTIONS = KNOWLEDGE_QUESTION_POOL;

function readMarketingAnswers(draftData?: Record<string, unknown> | null): Record<string, string> {
  if (!draftData || typeof draftData !== 'object') {
    return {};
  }
  const raw = draftData.ai_marketing_answers ?? draftData.aiMarketingAnswers;
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

export function getMissingMarketingQuestions(
  formValues: PropertyImportFormValues,
  draftData?: Record<string, unknown> | null,
  mappingMetadata?: PropertyImportMappingMetadata,
): MarketingKnowledgeQuestion[] {
  return assessProjectKnowledgeGaps(formValues, draftData, mappingMetadata);
}

function mergeUnitConfigurations(
  existing: UnitConfigurationRow[],
  incoming: UnitConfigurationRow[],
): UnitConfigurationRow[] {
  if (incoming.length === 0) {
    return existing;
  }
  const byBhk = new Map<number, UnitConfigurationRow>();
  for (const row of existing) {
    byBhk.set(row.bhk, row);
  }
  for (const row of incoming) {
    const prior = byBhk.get(row.bhk);
    byBhk.set(row.bhk, prior ? { ...prior, count: prior.count + row.count } : row);
  }
  return [...byBhk.values()].sort((a, b) => a.bhk - b.bhk);
}

export function applyMarketingAnswer(
  formValues: PropertyImportFormValues,
  draftData: Record<string, unknown> | null | undefined,
  question: MarketingKnowledgeQuestion,
  selectedOption: string,
  customText: string,
): { formValues: PropertyImportFormValues; draftData: Record<string, unknown> } {
  const useCustom = selectedOption === CUSTOM_OPTION || selectedOption.startsWith('Other');
  const answer = (useCustom ? customText : selectedOption).trim();

  const nextForm = { ...formValues };
  const baseDraft = draftData && typeof draftData === 'object' ? { ...draftData } : {};
  const marketing = readMarketingAnswers(baseDraft);

  if (question.formField === 'property_type') {
    const normalized = answer.toLowerCase();
    if (['apartment', 'villa', 'plot', 'commercial'].includes(normalized)) {
      nextForm.property_type = normalized;
    } else {
      nextForm.property_type = answer;
    }
  }

  if (question.formField === 'builder' && answer) {
    nextForm.builder = answer;
  }

  if (question.id === 'location_focus' && answer) {
    if (!nextForm.location_area.trim()) {
      nextForm.location_area = answer;
    }
    if (!nextForm.location_city.trim() && /bengaluru|bangalore|mumbai|pune|hyderabad|chennai|delhi|ncr/i.test(answer)) {
      const cityMatch = answer.match(/bengaluru|bangalore|mumbai|pune|hyderabad|chennai|delhi|ncr/i);
      if (cityMatch) {
        nextForm.location_city = cityMatch[0].replace(/bangalore/i, 'Bengaluru');
      }
    }
  }

  if ((question.id === 'unit_mix' || question.id === 'villa_unit_mix') && answer) {
    const parsed = parseUnitMixAnswer(answer);
    const existing = parseUnitConfigurations(baseDraft);
    const merged = mergeUnitConfigurations(existing, parsed);
    const maxBhk = deriveMaxBhkFromUnits(merged);
    if (maxBhk != null && !nextForm.bedrooms.trim()) {
      nextForm.bedrooms = String(maxBhk);
    }
    return {
      formValues: nextForm,
      draftData: {
        ...baseDraft,
        unit_configurations: merged,
        single_unit_mode: false,
        ai_marketing_answers: {
          ...marketing,
          ...(question.answerKey ? { [question.answerKey]: answer } : {}),
        },
      },
    };
  }

  if (question.id === 'amenities_focus' && answer) {
    const existing = formValues.amenities.trim();
    nextForm.amenities = existing ? `${existing}, ${answer}` : answer;
  }

  if (question.answerKey) {
    marketing[question.answerKey] = answer;
  }

  return {
    formValues: nextForm,
    draftData: {
      ...baseDraft,
      ai_marketing_answers: marketing,
    },
  };
}

export { CUSTOM_OPTION };

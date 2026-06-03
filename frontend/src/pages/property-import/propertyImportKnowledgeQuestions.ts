import type { PropertyImportFormValues } from './propertyImport.utils';

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

export const MARKETING_KNOWLEDGE_QUESTIONS: MarketingKnowledgeQuestion[] = [
  {
    id: 'property_type',
    prompt: 'What type of property is this project?',
    helpText: 'The AI uses this to match buyer requests (BHK, villa, plot, etc.).',
    options: ['Apartment', 'Villa', 'Plot', 'Commercial', CUSTOM_OPTION],
    allowCustom: true,
    formField: 'property_type',
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

function isFilled(value: string | undefined | null): boolean {
  return Boolean(value && String(value).trim());
}

export function getMissingMarketingQuestions(
  formValues: PropertyImportFormValues,
  draftData?: Record<string, unknown> | null,
): MarketingKnowledgeQuestion[] {
  const answers = readMarketingAnswers(draftData);
  const missing: MarketingKnowledgeQuestion[] = [];

  for (const question of MARKETING_KNOWLEDGE_QUESTIONS) {
    if (question.formField === 'property_type' && isFilled(formValues.property_type)) {
      continue;
    }
    if (question.formField === 'amenities' && isFilled(formValues.amenities)) {
      continue;
    }
    if (question.answerKey && isFilled(answers[question.answerKey])) {
      continue;
    }
    if (question.id === 'amenities_focus' && isFilled(formValues.amenities)) {
      continue;
    }
    missing.push(question);
  }

  return missing;
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

export function mergeMarketingAnswersIntoDraftData(
  formValues: PropertyImportFormValues,
  existingDraftData?: Record<string, unknown> | null,
): Record<string, unknown> {
  const base = existingDraftData && typeof existingDraftData === 'object' ? { ...existingDraftData } : {};
  const existing = readMarketingAnswers(base);
  return {
    ...base,
    ai_marketing_answers: {
      ...existing,
      ...(base.ai_marketing_answers as Record<string, string> | undefined),
    },
  };
}

export { CUSTOM_OPTION };

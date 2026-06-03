import type { PropertyImportFormValues } from './propertyImport.utils';
import { assessProjectKnowledgeGaps, type MarketingKnowledgeQuestion } from './assessProjectKnowledgeGaps';
import type { PropertyImportMappingMetadata } from './propertyImport.utils';
import { TYPE_KNOWLEDGE_CUSTOM_OPTION } from './propertyTypeKnowledgeSchema';

export type { MarketingKnowledgeQuestion } from './assessProjectKnowledgeGaps';

/** @deprecated Use assessProjectKnowledgeGaps — kept for imports */
export const KNOWLEDGE_QUESTION_POOL: MarketingKnowledgeQuestion[] = [];

/** @deprecated */
export const MARKETING_KNOWLEDGE_QUESTIONS = KNOWLEDGE_QUESTION_POOL;

export function getMissingMarketingQuestions(
  formValues: PropertyImportFormValues,
  draftData?: Record<string, unknown> | null,
  mappingMetadata?: PropertyImportMappingMetadata,
): MarketingKnowledgeQuestion[] {
  return assessProjectKnowledgeGaps(formValues, draftData, mappingMetadata);
}

function readTypeKnowledge(draftData: Record<string, unknown>): Record<string, string> {
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

function priceUnitMultiplier(unit: string | null | undefined, fallbackUnit?: string): number {
  const normalized = (unit || fallbackUnit || '').trim().toLowerCase();
  if (normalized === 'cr' || normalized === 'crore') {
    return 10000000;
  }
  if (normalized === 'l' || normalized === 'lakh') {
    return 100000;
  }
  if (normalized === 'k') {
    return 1000;
  }
  return 1;
}

function parsePriceRange(answer: string): { min?: string; max?: string } {
  const normalized = answer
    .toLowerCase()
    .replace(/₹/g, 'rs')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const matches = Array.from(normalized.matchAll(/(\d+(?:\.\d+)?)\s*(cr|crore|l|lakh|k)?/g));
  if (matches.length === 0) {
    return {};
  }

  const fallbackUnit = [...matches].reverse().find((match) => match[2])?.[2];
  const values = matches
    .map((match) => Number(match[1]) * priceUnitMultiplier(match[2], fallbackUnit))
    .filter(Number.isFinite);

  if (values.length === 0) {
    return {};
  }

  if (/^under\b/.test(normalized)) {
    return { max: String(Math.round(values[0])) };
  }

  if (/\+$/.test(normalized)) {
    return { min: String(Math.round(values[0])) };
  }

  if (values.length >= 2) {
    const [a, b] = values;
    return { min: String(Math.round(Math.min(a, b))), max: String(Math.round(Math.max(a, b))) };
  }

  return { min: String(Math.round(values[0])), max: String(Math.round(values[0])) };
}

export function applyMarketingAnswer(
  formValues: PropertyImportFormValues,
  draftData: Record<string, unknown> | null | undefined,
  question: MarketingKnowledgeQuestion,
  selectedOption: string,
  customText: string,
): { formValues: PropertyImportFormValues; draftData: Record<string, unknown> } {
  const useCustom =
    selectedOption === TYPE_KNOWLEDGE_CUSTOM_OPTION || selectedOption.startsWith('Other');
  const answer = (useCustom ? customText : selectedOption).trim();
  const key = question.typeKnowledgeKey ?? question.answerKey ?? question.id.replace(/^tk_/, '');

  const nextForm = { ...formValues };
  const baseDraft = draftData && typeof draftData === 'object' ? { ...draftData } : {};
  const typeKnowledge = readTypeKnowledge(baseDraft);

  if (key === 'anything_else') {
    if (selectedOption === 'Nothing else' && !customText.trim()) {
      typeKnowledge.anything_else_skipped = 'true';
      typeKnowledge.anything_else = 'Nothing else';
    } else if (answer) {
      typeKnowledge.anything_else = answer;
      delete typeKnowledge.anything_else_skipped;
    }
    return {
      formValues: nextForm,
      draftData: { ...baseDraft, type_knowledge: typeKnowledge },
    };
  }

  if (answer) {
    typeKnowledge[key] = answer;
    (baseDraft as Record<string, unknown>)[key] = answer;
  }

  if (key === 'bhk' && answer) {
    const bhkMatch = answer.match(/(\d+)/);
    if (bhkMatch) {
      nextForm.bedrooms = bhkMatch[1];
    }
  }

  if (key === 'price' && answer) {
    const range = parsePriceRange(answer);
    if (range.min) {
      nextForm.price_min = range.min;
    }
    if (range.max) {
      nextForm.price_max = range.max;
    }
  }

  if (question.formField === 'amenities' && answer) {
    const existing = formValues.amenities.trim();
    nextForm.amenities = existing ? `${existing}, ${answer}` : answer;
  }

  return {
    formValues: nextForm,
    draftData: {
      ...baseDraft,
      type_knowledge: typeKnowledge,
    },
  };
}

export const CUSTOM_OPTION = TYPE_KNOWLEDGE_CUSTOM_OPTION;

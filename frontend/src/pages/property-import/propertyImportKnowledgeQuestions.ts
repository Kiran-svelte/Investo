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

function parsePriceRange(answer: string): { min?: string; max?: string } {
  const nums = answer.match(/[\d.]+/g)?.map((n) => Number(n.replace(/,/g, ''))).filter(Number.isFinite) ?? [];
  if (nums.length >= 2) {
    const [a, b] = nums;
    return { min: String(Math.min(a, b)), max: String(Math.max(a, b)) };
  }
  if (nums.length === 1) {
    return { min: String(nums[0]), max: String(nums[0]) };
  }
  return {};
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

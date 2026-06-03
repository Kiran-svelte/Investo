import type { PropertyImportMappingMetadata } from './propertyImport.utils';
import type { PropertyImportFormValues } from './propertyImport.utils';
import type { MarketingKnowledgeQuestion } from './propertyImportKnowledgeQuestions';
import { KNOWLEDGE_QUESTION_POOL } from './propertyImportKnowledgeQuestions';
import {
  hasValidUnitInventory,
  parseUnitConfigurations,
  propertyTypeUsesUnitConfig,
  readSingleUnitMode,
} from './propertyImportUnitConfig';

function isFilled(value: string | undefined | null): boolean {
  return Boolean(value && String(value).trim());
}

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

function descriptionIsSubstantial(description: string): boolean {
  return description.trim().length >= 80;
}

function descriptionMentionsPossession(description: string): boolean {
  const text = description.toLowerCase();
  return /ready to move|possession|handover|under construction|dec 20|jan 20|q[1-4]\s*20\d{2}/i.test(text);
}

function hasLocation(formValues: PropertyImportFormValues): boolean {
  return isFilled(formValues.location_city) || isFilled(formValues.location_area);
}

function hasPriceRange(formValues: PropertyImportFormValues): boolean {
  return isFilled(formValues.price_min) && isFilled(formValues.price_max);
}

function extractionLooksWeak(
  formValues: PropertyImportFormValues,
  draftData?: Record<string, unknown> | null,
  mappingMetadata?: PropertyImportMappingMetadata,
): boolean {
  const missingCore =
    !isFilled(formValues.name)
    || !hasLocation(formValues)
    || !hasPriceRange(formValues)
    || !isFilled(formValues.builder);

  if (missingCore) {
    return true;
  }

  const lowConfidenceCount = mappingMetadata?.field_mappings.filter((row) => {
    const parsed = Number(row.confidence);
    return row.confidence.trim() && Number.isFinite(parsed) && parsed < 0.65;
  }).length ?? 0;

  if (lowConfidenceCount >= 2) {
    return true;
  }

  const reviewHints = draftData?.import_review ?? draftData?.importReview;
  if (reviewHints && typeof reviewHints === 'object' && !Array.isArray(reviewHints)) {
    const status = (reviewHints as Record<string, unknown>).status;
    if (status === 'needs_review') {
      return true;
    }
  }

  return false;
}

function needsUnitInventoryQuestion(
  formValues: PropertyImportFormValues,
  draftData?: Record<string, unknown> | null,
): boolean {
  const propertyType = formValues.property_type.trim().toLowerCase();
  if (!propertyTypeUsesUnitConfig(propertyType)) {
    return false;
  }

  const units = parseUnitConfigurations(draftData);
  const singleUnit = readSingleUnitMode(draftData);
  return !hasValidUnitInventory({
    propertyType,
    bedrooms: formValues.bedrooms,
    unitConfigurations: units,
    singleUnitMode: singleUnit,
  });
}

function questionById(id: string): MarketingKnowledgeQuestion | undefined {
  return KNOWLEDGE_QUESTION_POOL.find((q) => q.id === id);
}

export function assessProjectKnowledgeGaps(
  formValues: PropertyImportFormValues,
  draftData?: Record<string, unknown> | null,
  mappingMetadata?: PropertyImportMappingMetadata,
): MarketingKnowledgeQuestion[] {
  const answers = readMarketingAnswers(draftData);
  const weakExtraction = extractionLooksWeak(formValues, draftData, mappingMetadata);
  const gaps: MarketingKnowledgeQuestion[] = [];

  if (!isFilled(formValues.property_type)) {
    const q = questionById('property_type');
    if (q) {
      gaps.push(q);
    }
  }

  if (needsUnitInventoryQuestion(formValues, draftData)) {
    const propertyType = formValues.property_type.trim().toLowerCase();
    const unitQuestionId = propertyType === 'villa' ? 'villa_unit_mix' : 'unit_mix';
    const q = questionById(unitQuestionId) ?? questionById('unit_mix');
    if (q) {
      gaps.push(q);
    }
  }

  if (!hasLocation(formValues) && weakExtraction) {
    const q = questionById('location_focus');
    if (q) {
      gaps.push(q);
    }
  }

  if (!isFilled(formValues.builder) && weakExtraction) {
    const q = questionById('builder_trust');
    if (q) {
      gaps.push(q);
    }
  }

  if (!isFilled(answers.target_buyer) && !descriptionIsSubstantial(formValues.description)) {
    const q = questionById('target_buyer');
    if (q) {
      gaps.push(q);
    }
  }

  if (!isFilled(answers.possession_timeline) && !descriptionMentionsPossession(formValues.description)) {
    const q = questionById('possession');
    if (q) {
      gaps.push(q);
    }
  }

  if (!isFilled(answers.payment_plan)) {
    const q = questionById('payment_plan');
    if (q) {
      gaps.push(q);
    }
  }

  if (!isFilled(answers.key_selling_point) && !descriptionIsSubstantial(formValues.description)) {
    const q = questionById('key_highlight');
    if (q) {
      gaps.push(q);
    }
  }

  if (!isFilled(formValues.amenities) && !isFilled(answers.amenities_focus)) {
    const q = questionById('amenities_focus');
    if (q) {
      gaps.push(q);
    }
  }

  return gaps;
}

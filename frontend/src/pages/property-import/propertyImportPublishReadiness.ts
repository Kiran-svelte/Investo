import type { PropertyImportDraft } from '../../services/propertyImport';
import type { PropertyImportFormValues } from './propertyImport.utils';
import { getMissingMarketingQuestions, type MarketingKnowledgeQuestion } from './propertyImportKnowledgeQuestions';

export interface PublishReadinessResult {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  missingQuestions: MarketingKnowledgeQuestion[];
}

export function getPublishReadiness(input: {
  formValues: PropertyImportFormValues;
  draft: PropertyImportDraft | null;
  isUploading: boolean;
  activeUploadCount: number;
}): PublishReadinessResult {
  const { formValues, draft, isUploading, activeUploadCount } = input;
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!draft?.id) {
    blockers.push('Create a draft and upload at least one brochure or image.');
  }

  if (isUploading || activeUploadCount > 0) {
    blockers.push('Wait until all file uploads finish.');
  }

  if (draft && draft.extractionStatus !== 'extracted') {
    blockers.push('Wait for brochure extraction to finish (status must be Extracted).');
  }

  if (draft && !['review_ready', 'publish_ready', 'published'].includes(draft.status)) {
    blockers.push(`Draft must be ready for review (current status: ${draft.status}).`);
  }

  if (!formValues.name.trim()) {
    blockers.push('Property name is required.');
  }

  if (!formValues.property_type.trim()) {
    blockers.push('Property type is required (apartment, villa, plot, or commercial).');
  }

  if (!formValues.price_min.trim() || !formValues.price_max.trim()) {
    blockers.push('Price min and Price max (₹) are required for this project.');
  } else if (Number(formValues.price_min) > Number(formValues.price_max)) {
    blockers.push('Price min cannot be greater than price max.');
  }

  if (!formValues.location_city.trim() && !formValues.location_area.trim()) {
    warnings.push('Add at least a city or area so the AI can answer location questions.');
  }

  if (!formValues.builder.trim()) {
    warnings.push('Builder / developer name helps the AI sound credible to buyers.');
  }

  if (!formValues.rera_number.trim()) {
    warnings.push('RERA number is recommended for legal trust on WhatsApp.');
  }

  if (!formValues.description.trim()) {
    warnings.push('A short project description improves AI answers.');
  }

  if (!formValues.amenities.trim()) {
    warnings.push('List key amenities so the AI can highlight them honestly.');
  }

  const missingQuestions = getMissingMarketingQuestions(formValues, draft?.draftData);

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    missingQuestions,
  };
}

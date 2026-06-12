import type { PropertyImportDraft } from '../../services/propertyImport';
import type { PropertyImportFormValues } from './propertyImport.utils';
import { getMissingMarketingQuestions, type MarketingKnowledgeQuestion } from './propertyImportKnowledgeQuestions';
import { getPropertyImportReviewMetadata, isImageAutoImportFlow } from './propertyImport.utils';

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
  const draftData = draft?.draftData;

  if (!draft?.id) {
    blockers.push('Create a draft and upload a brochure, image, or CRM spreadsheet.');
  }

  if (isUploading || activeUploadCount > 0) {
    blockers.push('Wait until all file uploads finish.');
  }

  if (draft && draft.extractionStatus !== 'extracted') {
    blockers.push('Wait for brochure extraction to finish.');
  }

  if (!formValues.property_type.trim()) {
    blockers.push('Choose a property type (apartment, villa, plot, or commercial).');
  }

  if (!formValues.name.trim()) {
    blockers.push('Add a project name (from brochure or type it in).');
  }

  const hasMedia = (draft?.mediaAssets?.length ?? 0) > 0;
  const hasUnits = (draft?.units?.length ?? 0) > 0;
  if (draft && !hasMedia && !hasUnits) {
    blockers.push('Upload at least one brochure, image, or import spreadsheet rows.');
  }

  const review = getPropertyImportReviewMetadata(draftData);
  if (review.status === 'needs_review') {
    blockers.push('Confirm extracted field mapping before publishing.');
  }

  const missingQuestions = isImageAutoImportFlow(draftData)
    ? []
    : getMissingMarketingQuestions(formValues, draftData);

  if (missingQuestions.length > 0) {
    blockers.push('Answer the remaining AI knowledge questions.');
  }

  if (!formValues.location_city.trim() && !formValues.location_area.trim()) {
    warnings.push('Add city or area when you know it. This helps location matching on WhatsApp.');
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    missingQuestions,
  };
}

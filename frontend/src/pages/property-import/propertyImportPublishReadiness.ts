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
  const draftData = draft?.draftData;

  if (!draft?.id) {
    blockers.push('Create a draft and upload at least one brochure or image.');
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
  if (draft && !hasMedia) {
    blockers.push('Upload at least one brochure or image.');
  }

  const missingQuestions = getMissingMarketingQuestions(formValues, draftData);

  if (missingQuestions.length > 0) {
    warnings.push(
      `${missingQuestions.length} AI knowledge question(s) still open — answer them for better WhatsApp replies.`,
    );
  }

  if (!formValues.location_city.trim() && !formValues.location_area.trim()) {
    warnings.push('Add city or area when you know it — helps location matching on WhatsApp.');
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    missingQuestions,
  };
}

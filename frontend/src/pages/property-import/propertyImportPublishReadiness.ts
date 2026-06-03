import type { PropertyImportDraft } from '../../services/propertyImport';
import type { PropertyImportFormValues } from './propertyImport.utils';
import { getPropertyImportMappingMetadata } from './propertyImport.utils';
import { getMissingMarketingQuestions, type MarketingKnowledgeQuestion } from './propertyImportKnowledgeQuestions';
import {
  hasValidUnitInventory,
  parseUnitConfigurations,
  propertyTypeUsesUnitConfig,
  readSingleUnitMode,
  serializeUnitConfigurations,
} from './propertyImportUnitConfig';

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
  const mappingMetadata = getPropertyImportMappingMetadata(draftData);

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
    blockers.push('Add a property name.');
  }

  if (!formValues.property_type.trim()) {
    blockers.push('Choose a property type (apartment, villa, plot, or commercial).');
  }

  if (!formValues.price_min.trim() || !formValues.price_max.trim()) {
    blockers.push('Enter both minimum and maximum project price (₹).');
  } else if (Number(formValues.price_min) > Number(formValues.price_max)) {
    blockers.push('Minimum price cannot be higher than maximum price.');
  }

  const unitRowsFromForm = serializeUnitConfigurations(formValues.unit_configurations);
  const singleUnit = formValues.single_unit_mode || readSingleUnitMode(draftData);
  const unitRows = unitRowsFromForm.length > 0 ? unitRowsFromForm : parseUnitConfigurations(draftData);

  if (!hasValidUnitInventory({
    propertyType: formValues.property_type,
    bedrooms: formValues.bedrooms,
    unitConfigurations: unitRows,
    singleUnitMode: singleUnit,
  })) {
    if (propertyTypeUsesUnitConfig(formValues.property_type)) {
      blockers.push(
        'Add at least one unit type row (BHK + count), or enable single-unit mode and enter bedrooms.',
      );
    } else if (!formValues.bedrooms.trim()) {
      warnings.push('Add bedrooms (BHK) or unit rows so the AI can match buyer size requests.');
    }
  }

  if (!formValues.location_city.trim() && !formValues.location_area.trim()) {
    warnings.push('Add a city or area so the AI can answer location questions.');
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

  const missingQuestions = getMissingMarketingQuestions(formValues, draftData, mappingMetadata);

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    missingQuestions,
  };
}

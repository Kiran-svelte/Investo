import type { PropertyImportFormValues } from './propertyImport.utils';
import type { PropertyImportMappingMetadata } from './propertyImport.utils';
import {
  ANYTHING_ELSE_FIELD,
  getKnowledgeFieldsForType,
  isTypeKnowledgeFieldFilled,
  questionIdForField,
  type TypeKnowledgeFieldDef,
} from './propertyTypeKnowledgeSchema';

export interface MarketingKnowledgeQuestion {
  id: string;
  prompt: string;
  helpText: string;
  options: string[];
  allowCustom: boolean;
  customPlaceholder?: string;
  formField?: keyof PropertyImportFormValues;
  answerKey?: string;
  /** snake_case key in draft_data.type_knowledge */
  typeKnowledgeKey?: string;
}

function fieldToQuestion(field: TypeKnowledgeFieldDef): MarketingKnowledgeQuestion {
  return {
    id: questionIdForField(field.key),
    prompt: field.prompt,
    helpText: field.helpText,
    options: field.options,
    allowCustom: field.allowCustom,
    customPlaceholder: field.customPlaceholder,
    formField: field.formField,
    answerKey: field.key,
    typeKnowledgeKey: field.key,
  };
}

export function assessProjectKnowledgeGaps(
  formValues: PropertyImportFormValues,
  draftData?: Record<string, unknown> | null,
  _mappingMetadata?: PropertyImportMappingMetadata,
): MarketingKnowledgeQuestion[] {
  if (draftData?.import_flow_mode === 'image_auto') {
    return [];
  }
  const propertyType = formValues.property_type.trim().toLowerCase();
  if (!propertyType) {
    return [];
  }

  const fields = getKnowledgeFieldsForType(propertyType);
  const gaps: MarketingKnowledgeQuestion[] = [];

  for (const field of fields) {
    if (!isTypeKnowledgeFieldFilled(field, formValues, draftData)) {
      gaps.push(fieldToQuestion(field));
    }
  }

  if (!isTypeKnowledgeFieldFilled(ANYTHING_ELSE_FIELD, formValues, draftData)) {
    gaps.push(fieldToQuestion(ANYTHING_ELSE_FIELD));
  }

  return gaps;
}

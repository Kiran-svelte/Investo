import { CheckCircle2, Sparkles } from 'lucide-react';
import {
  getPropertyImportMappingMetadata,
  getPropertyImportReviewMetadata,
  type PropertyImportFormValues,
} from './propertyImport.utils';

const FIELD_LABELS: Record<string, string> = {
  name: 'Project name',
  builder: 'Builder',
  location_city: 'City',
  location_area: 'Area',
  location_pincode: 'Pincode',
  price_min: 'Price min',
  price_max: 'Price max',
  bedrooms: 'Bedrooms',
  property_type: 'Property type',
  description: 'Description',
  rera_number: 'RERA number',
  status: 'Status',
  amenities: 'Amenities',
};

interface PropertyImportMappingReviewProps {
  formValues: PropertyImportFormValues;
  draftData?: Record<string, unknown> | null;
  disabled?: boolean;
  onConfirm: () => void;
  onFieldChange: (targetField: string, value: string) => void;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return String(value);
}

export default function PropertyImportMappingReview({
  formValues,
  draftData,
  disabled = false,
  onConfirm,
  onFieldChange,
}: PropertyImportMappingReviewProps) {
  const mapping = getPropertyImportMappingMetadata(draftData);
  const review = getPropertyImportReviewMetadata(draftData);
  const sourceRecord = (draftData?.import_mapping as Record<string, unknown> | undefined)?.source_record
    ?? (draftData?.importMapping as Record<string, unknown> | undefined)?.source_record;

  const fields = mapping.field_mappings.length > 0
    ? mapping.field_mappings
    : review.confidence_hints.map((hint) => ({
        source_field: hint.source_field || hint.field,
        target_field: hint.field,
        confidence: String(hint.confidence),
        required: false,
        label: FIELD_LABELS[hint.field] || hint.field,
        notes: hint.note || '',
      }));

  if (fields.length === 0) {
    return null;
  }

  const readTargetValue = (targetField: string): string => {
    const key = targetField as keyof PropertyImportFormValues;
    if (key in formValues && typeof formValues[key] === 'string') {
      return formValues[key] as string;
    }
    const fromSource = sourceRecord && typeof sourceRecord === 'object'
      ? (sourceRecord as Record<string, unknown>)[targetField]
      : null;
    return formatValue(fromSource);
  };

  return (
    <div className="mt-6 rounded-xl border border-amber-100 bg-amber-50/60 p-4">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div>
          <h3 className="text-sm font-semibold text-amber-950">Review extracted fields</h3>
          <p className="mt-1 text-xs text-amber-900/90">
            Confirm each value looks correct before continuing to AI knowledge questions.
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-3">
        {fields.map((field) => {
          const target = field.target_field || field.source_field;
          const label = field.label || FIELD_LABELS[target] || target;
          const confidence = field.confidence ? Number(field.confidence) : null;
          const lowConfidence = confidence !== null && confidence < 0.75;

          return (
            <li
              key={`${field.source_field}-${target}`}
              className={`rounded-lg border bg-surface-elevated p-3 ${lowConfidence ? 'border-amber-300' : 'border-surface-border'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink-primary">{label}</span>
                {confidence !== null && (
                  <span className={`text-xs ${lowConfidence ? 'text-amber-800' : 'text-ink-muted'}`}>
                    {Math.round(confidence * 100)}% confidence
                  </span>
                )}
              </div>
              {field.notes ? (
                <p className="mt-1 text-xs text-ink-muted">{field.notes}</p>
              ) : null}
              <input
                type="text"
                value={readTargetValue(target)}
                disabled={disabled}
                onChange={(e) => onFieldChange(target, e.target.value)}
                className="mt-2 w-full rounded-lg border border-surface-border-strong px-3 py-2 text-sm disabled:bg-surface-subtle"
              />
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        disabled={disabled || review.status === 'approved'}
        onClick={onConfirm}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        <CheckCircle2 className="h-4 w-4" />
        Looks correct — confirm mapping
      </button>
    </div>
  );
}

import { CheckCircle2, MapPin } from 'lucide-react';
import type { PropertyImportFormValues } from './propertyImport.utils';

const COMMON_INDIAN_CITIES = [
  'Bengaluru',
  'Bangalore',
  'Mumbai',
  'Pune',
  'Hyderabad',
  'Chennai',
  'Delhi',
  'Noida',
  'Gurugram',
  'Kolkata',
  'Ahmedabad',
  'Jaipur',
  'Kochi',
  'Chandigarh',
  'Indore',
  'Lucknow',
  'Goa',
] as const;

type LocationField = 'location_city' | 'location_area' | 'location_pincode';

export interface PropertyImportLocationFieldsProps {
  values: Pick<PropertyImportFormValues, LocationField>;
  disabled?: boolean;
  isSaving?: boolean;
  onChange: (field: LocationField, value: string) => void;
  onBlur?: (field: LocationField, value: string) => void;
}

export function hasPropertyImportLocation(
  values: Pick<PropertyImportFormValues, 'location_city' | 'location_area'>,
): boolean {
  return Boolean(values.location_city.trim() || values.location_area.trim());
}

export default function PropertyImportLocationFields({
  values,
  disabled = false,
  isSaving = false,
  onChange,
  onBlur,
}: PropertyImportLocationFieldsProps) {
  const locationReady = hasPropertyImportLocation(values);

  return (
    <div
      className={`mt-4 rounded-xl border p-4 ${
        locationReady
          ? 'border-emerald-200 bg-emerald-50/50'
          : 'border-amber-200 bg-amber-50/60'
      }`}
    >
      <div className="flex items-start gap-2">
        <MapPin className={`mt-0.5 h-5 w-5 shrink-0 ${locationReady ? 'text-emerald-700' : 'text-amber-700'}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink-primary">Property location</h3>
            {locationReady && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Saved for WhatsApp matching
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            City or locality helps buyers find this project when they ask on WhatsApp (e.g. &quot;2 BHK in Whitefield&quot;).
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-ink-secondary">
          City
          <input
            type="text"
            list="property-import-city-suggestions"
            value={values.location_city}
            disabled={disabled}
            onChange={(e) => onChange('location_city', e.target.value)}
            onBlur={(e) => onBlur?.('location_city', e.target.value)}
            placeholder="e.g. Bengaluru"
            className="mt-1 w-full rounded-lg border border-surface-border-strong px-3 py-2 text-sm disabled:bg-surface-subtle"
          />
        </label>
        <label className="block text-sm font-medium text-ink-secondary">
          Area / locality
          <input
            type="text"
            value={values.location_area}
            disabled={disabled}
            onChange={(e) => onChange('location_area', e.target.value)}
            onBlur={(e) => onBlur?.('location_area', e.target.value)}
            placeholder="e.g. Whitefield, Sarjapur Road"
            className="mt-1 w-full rounded-lg border border-surface-border-strong px-3 py-2 text-sm disabled:bg-surface-subtle"
          />
        </label>
        <label className="block text-sm font-medium text-ink-secondary sm:col-span-2">
          Pincode <span className="font-normal text-ink-muted">(optional)</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={values.location_pincode}
            disabled={disabled}
            onChange={(e) => onChange('location_pincode', e.target.value.replace(/\D/g, '').slice(0, 6))}
            onBlur={(e) => onBlur?.('location_pincode', e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="e.g. 560066"
            className="mt-1 w-full max-w-xs rounded-lg border border-surface-border-strong px-3 py-2 text-sm disabled:bg-surface-subtle"
          />
        </label>
      </div>

      <datalist id="property-import-city-suggestions">
        {COMMON_INDIAN_CITIES.map((city) => (
          <option key={city} value={city} />
        ))}
      </datalist>

      {isSaving && (
        <p className="mt-2 text-xs text-ink-muted">Saving location…</p>
      )}
    </div>
  );
}

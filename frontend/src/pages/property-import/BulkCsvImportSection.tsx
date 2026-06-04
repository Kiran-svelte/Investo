/**
 * BulkCsvImportSection
 *
 * Self-contained UI for the CSV/Excel bulk property import wizard.
 * Rendered when the admin selects "Bulk Upload" mode in PropertyImportSimplePage.
 *
 * 3-step wizard:
 *   Step 0 – Upload (.csv/.xlsx drag-drop)
 *   Step 1 – Map columns (header → target field)
 *   Step 2 – Review counts & publish all
 *
 * All async logic lives in useBulkCsvImport — this component is pure rendering.
 */

import React, { useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FileSpreadsheet,
  Loader2,
  Send,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { useBulkCsvImport } from './use-bulk-csv-import';
import {
  BULK_IMPORT_ACCEPTED_EXTENSIONS,
  BULK_IMPORT_ACCEPTED_MIME_TYPES,
  BULK_IMPORT_COLUMN_TARGET_OPTIONS,
  BULK_IMPORT_PREVIEW_ROW_COUNT,
  BULK_IMPORT_STEPS,
  BULK_IMPORT_TARGET_FIELD_LABELS,
  BULK_IMPORT_MAX_FILE_SIZE_LABEL,
} from '../../constants/bulk-csv-import.constants';

interface BulkCsvImportSectionProps {
  /** Property type pre-selected in the parent wizard step 1. */
  defaultPropertyType?: 'villa' | 'apartment' | 'plot' | 'commercial' | 'other';
  /** Called when publish succeeds so the parent can navigate away. */
  onPublishSuccess: (publishedCount: number) => void;
}

/** Returns a short human label for a target field key. */
function fieldLabel(field: string): string {
  return BULK_IMPORT_TARGET_FIELD_LABELS[field] ?? field;
}

/** Renders the step indicator at the top of the wizard. */
function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <nav className="flex items-center gap-1 text-xs" aria-label="Bulk import steps">
      {BULK_IMPORT_STEPS.map((label, index) => {
        const isDone = index < currentStep;
        const isCurrent = index === currentStep;

        return (
          <React.Fragment key={label}>
            {index > 0 && (
              <ChevronRight className="h-3 w-3 shrink-0 text-ink-muted" aria-hidden="true" />
            )}
            <span
              className={`rounded px-2 py-0.5 font-medium ${
                isCurrent
                  ? 'bg-brand-600 text-white'
                  : isDone
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-surface-muted text-ink-muted'
              }`}
            >
              {isDone ? '✓ ' : ''}{label}
            </span>
          </React.Fragment>
        );
      })}
    </nav>
  );
}

/** Renders the file upload drop zone for step 0. */
function UploadStep({
  isLoading,
  onFileSelected,
}: {
  isLoading: boolean;
  onFileSelected: (file: File) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      onFileSelected(file);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
    }
    e.target.value = '';
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink-primary">Upload your property spreadsheet</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Export from your builder Excel, CRM, or price list. We'll read it and map columns automatically.
        </p>
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-label="Drop your CSV or Excel file here, or click to browse"
        className="rounded-2xl border-2 border-dashed border-brand-300 bg-brand-50/40 p-10 text-center transition-colors hover:border-brand-500 hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-400"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            fileInputRef.current?.click();
          }
        }}
      >
        {isLoading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-10 w-10 animate-spin text-brand-600" aria-hidden="true" />
            <p className="text-sm font-medium text-brand-800">Parsing your file…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <FileSpreadsheet className="h-12 w-12 text-brand-500" aria-hidden="true" />
            <div>
              <p className="font-semibold text-ink-primary">Drop your file here</p>
              <p className="mt-1 text-sm text-ink-muted">or click to browse</p>
            </div>
            <p className="text-xs text-ink-faint">
              .csv or .xlsx · max {BULK_IMPORT_MAX_FILE_SIZE_LABEL}
            </p>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        id="bulk-import-file-input"
        type="file"
        accept={`${BULK_IMPORT_ACCEPTED_EXTENSIONS},${BULK_IMPORT_ACCEPTED_MIME_TYPES.join(',')}`}
        className="hidden"
        onChange={handleInputChange}
        aria-label="Choose a CSV or Excel file"
      />

      <div className="rounded-xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm text-violet-900">
        <Sparkles className="mr-2 inline h-4 w-4" aria-hidden="true" />
        <strong>Tip:</strong> Export columns like Property Name, Price (Cr), BHK, City, Area.
        We'll auto-detect them — you can fix the mapping before publishing.
      </div>
    </div>
  );
}

/** Renders the column mapping editor for step 1. */
function MappingStep({
  headers,
  previewRows,
  columnMapping,
  projectName,
  propertyType,
  isLoading,
  autoDetectedHeaders,
  onUpdateMapping,
  onProjectNameChange,
  onPropertyTypeChange,
  onConfirm,
}: {
  headers: string[];
  previewRows: Array<Record<string, string>>;
  columnMapping: Record<string, string>;
  projectName: string;
  propertyType: string;
  isLoading: boolean;
  autoDetectedHeaders: string[];
  onUpdateMapping: (header: string, targetField: string) => void;
  onProjectNameChange: (name: string) => void;
  onPropertyTypeChange: (type: 'villa' | 'apartment' | 'plot' | 'commercial' | 'other') => void;
  onConfirm: () => void;
}) {
  const autoDetectedSet = new Set(autoDetectedHeaders);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-ink-primary">Map columns to property fields</h2>
        <p className="mt-1 text-sm text-ink-muted">
          We've auto-detected the mapping below. Adjust any mismatches, then confirm.
        </p>
      </div>

      {/* Project metadata */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="bulk-project-name" className="block text-sm font-medium text-ink-secondary">
            Project / development name
          </label>
          <input
            id="bulk-project-name"
            type="text"
            value={projectName}
            onChange={(e) => onProjectNameChange(e.target.value)}
            placeholder="Lake Vista Villas"
            className="mt-1 w-full rounded-lg border border-surface-border-strong px-3 py-2 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>

        <div>
          <label htmlFor="bulk-property-type" className="block text-sm font-medium text-ink-secondary">
            Default property type
          </label>
          <select
            id="bulk-property-type"
            value={propertyType}
            onChange={(e) => onPropertyTypeChange(e.target.value as 'villa' | 'apartment' | 'plot' | 'commercial' | 'other')}
            className="mt-1 w-full rounded-lg border border-surface-border-strong px-3 py-2 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            <option value="apartment">Apartment</option>
            <option value="villa">Villa</option>
            <option value="plot">Plot</option>
            <option value="commercial">Commercial</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {/* Column mapping table */}
      <div className="overflow-x-auto rounded-xl border border-surface-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-ink-secondary">Column in your file</th>
              <th className="px-3 py-2 text-left font-medium text-ink-secondary">Maps to field</th>
              <th className="hidden px-3 py-2 text-left font-medium text-ink-secondary sm:table-cell">
                Sample value
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {headers.map((header) => {
              const isAutoDetected = autoDetectedSet.has(header);
              const currentTarget = columnMapping[header] ?? 'skip';
              const sampleValue = previewRows[0]?.[header] ?? '';

              return (
                <tr key={header} className="bg-surface-elevated hover:bg-surface-muted/50">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink-primary">{header}</span>
                      {isAutoDetected && currentTarget !== 'skip' && (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                          Auto
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <select
                      id={`bulk-col-${header.replace(/\s+/g, '-')}`}
                      aria-label={`Map column ${header} to field`}
                      value={currentTarget}
                      onChange={(e) => onUpdateMapping(header, e.target.value)}
                      className={`w-full rounded-lg border px-2 py-1.5 text-sm focus:ring-2 focus:ring-brand-100 ${
                        currentTarget === 'skip'
                          ? 'border-surface-border text-ink-muted'
                          : 'border-brand-300 bg-brand-50 text-ink-primary'
                      }`}
                    >
                      {BULK_IMPORT_COLUMN_TARGET_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {fieldLabel(option)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="hidden px-3 py-2.5 text-ink-muted sm:table-cell">
                    <span className="truncate">{sampleValue || '—'}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Preview table */}
      {previewRows.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-ink-secondary">
            First {Math.min(previewRows.length, BULK_IMPORT_PREVIEW_ROW_COUNT)} rows preview
          </p>
          <div className="overflow-x-auto rounded-xl border border-surface-border">
            <table className="w-full text-xs">
              <thead className="bg-surface-muted">
                <tr>
                  {headers.map((h) => (
                    <th key={h} className="px-2 py-1.5 text-left font-medium text-ink-secondary whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {previewRows.slice(0, BULK_IMPORT_PREVIEW_ROW_COUNT).map((row, index) => (
                  <tr key={index} className="bg-surface-elevated">
                    {headers.map((h) => (
                      <td key={h} className="max-w-[120px] truncate px-2 py-1.5 text-ink-secondary">
                        {row[h] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <button
        type="button"
        id="bulk-import-confirm-mapping"
        disabled={isLoading || !projectName.trim()}
        onClick={onConfirm}
        className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
        {isLoading ? 'Validating…' : 'Confirm mapping'}
      </button>
    </div>
  );
}

/** Renders the review summary and publish CTA for step 2. */
function ReviewStep({
  confirmResult,
  publishResult,
  isLoading,
  onPublish,
  onReset,
}: {
  confirmResult: {
    draft_id: string;
    row_count: number;
    valid_count: number;
    invalid_count: number;
  };
  publishResult: { published_count: number; skipped_invalid_count: number; knowledge_indexed_count: number } | null;
  isLoading: boolean;
  onPublish: () => void;
  onReset: () => void;
}) {
  const hasErrors = confirmResult.invalid_count > 0;

  if (publishResult) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" aria-hidden="true" />
          <h2 className="mt-3 text-xl font-bold text-emerald-900">
            {publishResult.published_count} {publishResult.published_count === 1 ? 'property' : 'properties'} published!
          </h2>
          <p className="mt-1 text-sm text-emerald-700">
            WhatsApp AI has been updated with the new catalog.
            {publishResult.skipped_invalid_count > 0 && (
              <> {publishResult.skipped_invalid_count} row(s) with errors were skipped.</>
            )}
          </p>
          <div className="mt-3 flex justify-center gap-2 text-xs text-emerald-800">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            {publishResult.knowledge_indexed_count} / {publishResult.published_count} AI knowledge entries indexed
          </div>
        </div>
        <button
          type="button"
          id="bulk-import-upload-another"
          onClick={onReset}
          className="text-sm font-medium text-brand-600 underline hover:text-brand-800"
        >
          Upload another spreadsheet
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-ink-primary">Review & publish</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Check the summary below, then publish all valid rows to the catalog at once.
        </p>
      </div>

      {/* Counts summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-surface-border bg-surface-elevated p-4 text-center">
          <p className="text-2xl font-bold text-ink-primary">{confirmResult.row_count}</p>
          <p className="mt-1 text-xs text-ink-muted">Total rows</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
          <p className="text-2xl font-bold text-emerald-700">{confirmResult.valid_count}</p>
          <p className="mt-1 text-xs text-emerald-700">Ready to publish</p>
        </div>
        {hasErrors && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{confirmResult.invalid_count}</p>
            <p className="mt-1 text-xs text-red-600">Have errors (skipped)</p>
          </div>
        )}
      </div>

      {hasErrors && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mr-2 inline h-4 w-4" aria-hidden="true" />
          {confirmResult.invalid_count} row(s) failed validation (e.g. missing property name or invalid price).
          They will be skipped. Only {confirmResult.valid_count} valid row(s) will be published.
        </div>
      )}

      <div className="rounded-xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm text-violet-900">
        <Sparkles className="mr-2 inline h-4 w-4" aria-hidden="true" />
        Publishing will index all properties into the WhatsApp AI knowledge base instantly.
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          id="bulk-import-publish"
          disabled={isLoading || confirmResult.valid_count === 0}
          onClick={onPublish}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {isLoading
            ? 'Publishing…'
            : `Publish ${confirmResult.valid_count} ${confirmResult.valid_count === 1 ? 'property' : 'properties'}`}
        </button>
        <button
          type="button"
          id="bulk-import-start-over"
          disabled={isLoading}
          onClick={onReset}
          className="rounded-xl border border-surface-border px-4 py-2.5 text-sm font-medium text-ink-secondary hover:bg-surface-muted disabled:opacity-50"
        >
          Start over
        </button>
      </div>
    </div>
  );
}

export default function BulkCsvImportSection({
  defaultPropertyType = 'apartment',
  onPublishSuccess,
}: BulkCsvImportSectionProps) {
  const {
    wizardStep,
    isLoading,
    errorMessage,
    parseResult,
    columnMapping,
    projectName,
    propertyType,
    confirmResult,
    publishResult,
    handleFileSelected,
    updateColumnMapping,
    setProjectName,
    setPropertyType,
    handleConfirmMapping,
    handlePublish,
    handleReset,
    clearError,
    autoDetectedHeaders,
  } = useBulkCsvImport(defaultPropertyType);

  // When publish succeeds, call the parent callback.
  const handlePublishAndNotify = async () => {
    await handlePublish();
  };

  // Watch for publish success and notify parent.
  React.useEffect(() => {
    if (publishResult?.published_count) {
      onPublishSuccess(publishResult.published_count);
    }
  }, [publishResult, onPublishSuccess]);

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <StepIndicator currentStep={wizardStep} />

      {/* Error banner */}
      {errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">{errorMessage}</span>
          <button
            type="button"
            onClick={clearError}
            aria-label="Dismiss error"
            className="shrink-0 text-red-500 hover:text-red-700"
          >
            ×
          </button>
        </div>
      )}

      {/* Step panels */}
      {wizardStep === 0 && (
        <UploadStep
          isLoading={isLoading}
          onFileSelected={handleFileSelected}
        />
      )}

      {wizardStep === 1 && parseResult && (
        <MappingStep
          headers={parseResult.headers}
          previewRows={parseResult.previewRows}
          columnMapping={columnMapping}
          projectName={projectName}
          propertyType={propertyType}
          isLoading={isLoading}
          autoDetectedHeaders={autoDetectedHeaders}
          onUpdateMapping={updateColumnMapping}
          onProjectNameChange={setProjectName}
          onPropertyTypeChange={setPropertyType}
          onConfirm={() => void handleConfirmMapping()}
        />
      )}

      {wizardStep === 2 && confirmResult && (
        <ReviewStep
          confirmResult={confirmResult}
          publishResult={publishResult}
          isLoading={isLoading}
          onPublish={() => void handlePublishAndNotify()}
          onReset={handleReset}
        />
      )}
    </div>
  );
}

import { Loader2 } from 'lucide-react';

interface BatchProgress {
  phase?: string;
  units_total?: number;
  units_ready?: number;
  units_published?: number;
  message?: string;
}

interface PropertyImportBatchProgressProps {
  draftData?: Record<string, unknown> | null;
  unitsCount?: number;
  extractionStatus?: string;
  draftStatus?: string;
  isPublishing?: boolean;
}

function readBatchProgress(draftData?: Record<string, unknown> | null): BatchProgress | null {
  const raw = draftData?.batch_progress ?? draftData?.batchProgress;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  return raw as BatchProgress;
}

export default function PropertyImportBatchProgress({
  draftData,
  unitsCount = 0,
  extractionStatus,
  draftStatus,
  isPublishing = false,
}: PropertyImportBatchProgressProps) {
  const batch = readBatchProgress(draftData);
  const total = batch?.units_total ?? unitsCount;
  const published = batch?.units_published ?? 0;
  const isExtracting = extractionStatus === 'queued' || extractionStatus === 'processing' || draftStatus === 'extracting';

  if (!isExtracting && total === 0 && !isPublishing && !batch?.message) {
    return null;
  }

  const message = isPublishing
    ? `Publishing ${total > 1 ? `${total} properties` : 'property'}…`
    : isExtracting
      ? 'Extracting brochure…'
      : batch?.message
        || (total > 1 ? `${total} villas loaded` : total === 1 ? '1 unit loaded' : 'Processing…');

  const percent = isPublishing && total > 0
    ? Math.round((published / total) * 100)
    : isExtracting
      ? 40
      : total > 0
        ? 100
        : 0;

  return (
    <div className="mt-4 rounded-lg border border-brand-100 bg-brand-50/70 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-brand-900">
        {(isExtracting || isPublishing) && <Loader2 className="h-4 w-4 animate-spin" />}
        {message}
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-brand-100">
        <div
          className="h-full rounded-full bg-brand-600 transition-all duration-500"
          style={{ width: `${Math.min(100, Math.max(8, percent))}%` }}
        />
      </div>
      {total > 1 && !isExtracting && (
        <p className="mt-1 text-xs text-brand-800/90">
          {published > 0 ? `${published} of ${total} published` : `${total} units ready for review`}
        </p>
      )}
    </div>
  );
}

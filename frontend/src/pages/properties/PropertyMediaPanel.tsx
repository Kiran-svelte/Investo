import React, { useRef, useState } from 'react';
import { ImageIcon, Loader2, Plus, RefreshCw, Trash2, FileText } from 'lucide-react';
import api from '../../services/api';
import { attachPropertyMedia, type PropertyMediaRole } from '../../services/propertyProjects';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

type PropertyMediaPanelProps = {
  propertyId: string;
  projectId: string | null | undefined;
  propertyName: string;
  images: string[];
  brochureUrl: string | null;
  canManage: boolean;
  onUpdated: (patch: { images?: string[]; brochure_url?: string | null }) => void;
};

function isImageUrl(url: string): boolean {
  return /\.(jpe?g|png|webp)(\?|$)/i.test(url) || url.includes('/image');
}

export default function PropertyMediaPanel({
  propertyId,
  projectId,
  propertyName,
  images,
  brochureUrl,
  canManage,
  onUpdated,
}: PropertyMediaPanelProps) {
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const brochureInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uploadViaProject = async (file: File, mediaRole: PropertyMediaRole) => {
    if (!projectId) {
      throw new Error('Assign this property to a project before uploading screenshots or brochures.');
    }
    return attachPropertyMedia(projectId, propertyId, file, mediaRole);
  };

  const patchProperty = async (payload: Record<string, unknown>) => {
    const res = await api.put(`/properties/${propertyId}`, payload);
    const body = res.data as { data?: { images?: string[] | string; brochure_url?: string | null } };
    applyPropertyRow(body.data);
  };

  const parseImagesField = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as string[];
      } catch {
        return [];
      }
    }
    return [];
  };

  const applyPropertyRow = (row?: { images?: string[] | string; brochure_url?: string | null }) => {
    if (!row) return;
    onUpdated({
      images: parseImagesField(row.images),
      brochure_url: row.brochure_url ?? null,
    });
  };

  const applyAttachResult = (result: Awaited<ReturnType<typeof attachPropertyMedia>>) => {
    if (result.property) {
      applyPropertyRow(result.property);
      return;
    }
    if (result.media_role === 'brochure') {
      onUpdated({ brochure_url: result.public_url });
    } else {
      onUpdated({ images: [...images, result.public_url] });
    }
  };

  const handleDeleteImage = async (url: string) => {
    setBusy('delete-image');
    setError(null);
    try {
      const next = images.filter((img) => img !== url);
      await patchProperty({ images: next });
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Could not remove screenshot'));
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteBrochure = async () => {
    setBusy('delete-brochure');
    setError(null);
    try {
      await patchProperty({ brochure_url: null });
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Could not remove brochure'));
    } finally {
      setBusy(null);
    }
  };

  const handleUpload = async (file: File, mediaRole: PropertyMediaRole, replaceUrl?: string) => {
    setBusy(mediaRole);
    setError(null);
    try {
      if (replaceUrl) {
        const without = images.filter((img) => img !== replaceUrl);
        await patchProperty({ images: without });
      }
      const result = await uploadViaProject(file, mediaRole);
      applyAttachResult(result);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Upload failed'));
    } finally {
      setBusy(null);
      setReplaceIndex(null);
    }
  };

  const onScreenshotPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const replaceUrl = replaceIndex != null ? images[replaceIndex] : undefined;
    void handleUpload(file, 'screenshot', replaceUrl);
  };

  const onBrochurePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void handleUpload(file, 'brochure');
  };

  const openReplace = (index: number) => {
    setReplaceIndex(index);
    replaceInputRef.current?.click();
  };

  return (
    <section className="rounded-lg border border-surface-border bg-surface-subtle/40 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-primary">Photos &amp; brochure</h3>
        {canManage && projectId && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!!busy}
              onClick={() => screenshotInputRef.current?.click()}
              className="investo-btn-secondary text-xs py-1.5 px-2.5"
            >
              {busy === 'screenshot' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Add screenshot
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => brochureInputRef.current?.click()}
              className="investo-btn-secondary text-xs py-1.5 px-2.5"
            >
              {busy === 'brochure' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
              {brochureUrl ? 'Replace brochure' : 'Add brochure'}
            </button>
          </div>
        )}
      </div>

      {!projectId && canManage && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
          Move this listing into a project to upload screenshots from here, or use{' '}
          <strong>Screenshot / brochure</strong> on the project header.
        </p>
      )}

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5" role="alert">
          {error}
        </p>
      )}

      {images.length === 0 && !brochureUrl ? (
        <div className="flex flex-col items-center justify-center py-8 text-ink-faint">
          <ImageIcon className="h-10 w-10 mb-2" />
          <p className="text-sm">No screenshots yet for {propertyName}</p>
          {canManage && projectId && (
            <button
              type="button"
              onClick={() => screenshotInputRef.current?.click()}
              className="mt-2 text-sm text-brand-700 underline"
            >
              Upload first screenshot
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {images.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {images.map((url, index) => (
                <div key={`${url}-${index}`} className="relative group rounded-lg overflow-hidden border bg-white">
                  {isImageUrl(url) ? (
                    <img
                      src={url}
                      alt={`${propertyName} screenshot ${index + 1}`}
                      className="w-full h-28 object-cover"
                    />
                  ) : (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-28 items-center justify-center text-xs text-brand-700 underline px-2"
                    >
                      Open file
                    </a>
                  )}
                  {canManage && (
                    <div className="absolute inset-x-0 bottom-0 flex gap-1 bg-black/60 p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        title="Replace screenshot"
                        disabled={!!busy}
                        onClick={() => openReplace(index)}
                        className="flex-1 flex items-center justify-center gap-1 rounded bg-white/90 py-1 text-[10px] font-medium text-ink-primary"
                      >
                        <RefreshCw className="h-3 w-3" /> Replace
                      </button>
                      <button
                        type="button"
                        title="Delete screenshot"
                        disabled={!!busy}
                        onClick={() => void handleDeleteImage(url)}
                        className="flex items-center justify-center rounded bg-red-600/90 p-1 text-white"
                      >
                        {busy === 'delete-image' ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {brochureUrl && (
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-sm">
              <a href={brochureUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline truncate">
                Brochure (PDF)
              </a>
              {canManage && (
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void handleDeleteBrochure()}
                  className="shrink-0 rounded p-1 text-red-600 hover:bg-red-50"
                  title="Remove brochure"
                >
                  {busy === 'delete-brochure' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <input
        ref={screenshotInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={onScreenshotPick}
      />
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={onScreenshotPick}
      />
      <input
        ref={brochureInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={onBrochurePick}
      />
    </section>
  );
}

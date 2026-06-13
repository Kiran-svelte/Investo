import React, { useEffect, useMemo, useState } from 'react';
import { FileText, ImageIcon, Loader2, X } from 'lucide-react';
import {
  attachPropertyMedia,
  type PropertyMediaRole,
} from '../../services/propertyProjects';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

export interface PropertyMediaAssignTarget {
  id: string;
  name: string;
  property_type: string | null;
  bedrooms: number | null;
}

interface PropertyMediaAssignModalProps {
  open: boolean;
  projectId: string;
  projectName: string;
  file: File | null;
  properties: PropertyMediaAssignTarget[];
  onClose: () => void;
  onSuccess: (message: string) => void;
}

function inferDefaultRole(file: File): PropertyMediaRole {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    return 'brochure';
  }
  return 'screenshot';
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(file.name);
}

function propertyLabel(p: PropertyMediaAssignTarget): string {
  const parts = [p.name];
  const meta = [
    p.bedrooms != null ? `${p.bedrooms} BHK` : null,
    p.property_type,
  ].filter(Boolean);
  if (meta.length > 0) parts.push(`(${meta.join(' · ')})`);
  return parts.join(' ');
}

export default function PropertyMediaAssignModal({
  open,
  projectId,
  projectName,
  file,
  properties,
  onClose,
  onSuccess,
}: PropertyMediaAssignModalProps) {
  const [propertyId, setPropertyId] = useState('');
  const [mediaRole, setMediaRole] = useState<PropertyMediaRole>('screenshot');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !file) {
      setPropertyId('');
      setMediaRole('screenshot');
      setError(null);
      setPreviewUrl(null);
      return;
    }

    setMediaRole(inferDefaultRole(file));
    setPropertyId(properties.length === 1 ? properties[0].id : '');

    if (isImageFile(file)) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }

    setPreviewUrl(null);
    return undefined;
  }, [open, file, properties]);

  const sortedProperties = useMemo(
    () => [...properties].sort((a, b) => a.name.localeCompare(b.name)),
    [properties],
  );

  if (!open || !file) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!propertyId) {
      setError('Choose which property this file belongs to.');
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const result = await attachPropertyMedia(projectId, propertyId, file, mediaRole);
      const propertyName =
        sortedProperties.find((p) => p.id === propertyId)?.name ?? 'property';
      const roleLabel = mediaRole === 'brochure' ? 'Brochure' : 'Screenshot';
      onSuccess(
        `${roleLabel} "${file.name}" attached to ${propertyName}${
          result.knowledge_indexed ? ' — AI knowledge updated.' : '.'
        }`,
      );
      onClose();
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string } } };
      setError(getApiErrorMessage(ax, 'Failed to upload media'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={uploading ? undefined : onClose}
    >
      <div
        className="investo-modal-panel w-full sm:max-w-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="property-media-assign-title"
      >
        <div className="flex items-center justify-between border-b p-4">
          <div>
            <h2 id="property-media-assign-title" className="text-lg font-semibold text-ink-primary">
              Attach to a property
            </h2>
            <p className="text-xs text-ink-muted">
              Project: {projectName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className="rounded p-1 hover:bg-surface-subtle disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 p-4">
          <div className="flex items-start gap-3 rounded-lg border bg-surface-elevated/60 p-3">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt=""
                className="h-16 w-16 shrink-0 rounded-md object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-white">
                {mediaRole === 'brochure' ? (
                  <FileText className="h-8 w-8 text-brand-600" />
                ) : (
                  <ImageIcon className="h-8 w-8 text-brand-600" />
                )}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink-primary">{file.name}</p>
              <p className="text-xs text-ink-muted">
                {Math.max(1, Math.round(file.size / 1024))} KB
              </p>
            </div>
          </div>

          {sortedProperties.length === 0 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              No listings in this project yet. Import or publish properties first, then attach
              screenshots and brochures to the right unit.
            </p>
          ) : (
            <>
              <div>
                <label htmlFor="property-media-target" className="mb-1 block text-sm font-medium text-ink-secondary">
                  Which property is this for?
                </label>
                <select
                  id="property-media-target"
                  value={propertyId}
                  onChange={(e) => setPropertyId(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  required
                >
                  <option value="">Select a property…</option>
                  {sortedProperties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {propertyLabel(p)}
                    </option>
                  ))}
                </select>
              </div>

              <fieldset>
                <legend className="mb-2 text-sm font-medium text-ink-secondary">Use as</legend>
                <div className="flex flex-wrap gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="media_role"
                      value="screenshot"
                      checked={mediaRole === 'screenshot'}
                      onChange={() => setMediaRole('screenshot')}
                      disabled={!isImageFile(file)}
                    />
                    Screenshot / hero image
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="media_role"
                      value="brochure"
                      checked={mediaRole === 'brochure'}
                      onChange={() => setMediaRole('brochure')}
                      disabled={file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)}
                    />
                    Brochure (PDF)
                  </label>
                </div>
              </fieldset>
            </>
          )}

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={uploading}
              className="rounded-lg border px-4 py-2 text-sm hover:bg-surface-muted disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading || sortedProperties.length === 0 || !propertyId}
              className="investo-btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
            >
              {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
              Upload & attach
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

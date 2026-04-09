import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  FileText,
  Image as ImageIcon,
  Loader2,
  ListFilter,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Video,
} from 'lucide-react';
import {
  cancelPropertyImportDraft,
  confirmPropertyImportUpload,
  createPropertyImportDraft,
  getPropertyImportDraft,
  inferPropertyImportAssetType,
  isPropertyImportMimeTypeSupported,
  publishPropertyImportDraft,
  registerPropertyImportUpload,
  retryPropertyImportDraft,
  savePropertyImportDraft,
  uploadPropertyImportFile,
  type PropertyImportAssetType,
  type PropertyImportDraft,
  PROPERTY_IMPORT_ASSET_TYPE_LABELS,
  PROPERTY_IMPORT_SUPPORTED_MIME_TYPES,
} from '../../services/propertyImport';
import {
  PROPERTY_IMPORT_DEFAULT_FORM_VALUES,
  PROPERTY_IMPORT_PROPERTY_TYPES,
  PROPERTY_IMPORT_STAGE_ORDER,
  createPropertyImportFormValues,
  getPropertyImportMappingMetadata,
  getPropertyImportMediaLabel,
  getPropertyImportStage,
  getPropertyImportReviewMetadata,
  isPropertyImportTerminalStatus,
  serializePropertyImportFormValues,
  type PropertyImportFieldMappingFormValue,
  type PropertyImportFormValues,
} from './propertyImport.utils';

type DraftUploadStatus = 'pending' | 'registering' | 'uploading' | 'confirming' | 'done' | 'failed';

interface DraftUploadItem {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  assetType: PropertyImportAssetType;
  progress: number;
  status: DraftUploadStatus;
  error: string | null;
  mediaId: string | null;
}

const SUPPORTED_FILE_LABELS = ['JPEG', 'PNG', 'WebP', 'PDF', 'MP4'];
const DEFAULT_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_FILE_SIZE_BYTES = (() => {
  const raw = (import.meta as any).env?.VITE_PROPERTY_UPLOAD_MAX_BYTES as string | undefined;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_FILE_SIZE_BYTES;
})();

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(1)} KB`;
  }

  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(1)} MB`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data as { error?: string; message?: string } | undefined;
    return payload?.error || payload?.message || error.message || fallback;
  }

  if (error instanceof Error) {
    return error.message || fallback;
  }

  return fallback;
}

function getStatusToneClasses(tone: string): string {
  switch (tone) {
    case 'active':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'complete':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'warning':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'danger':
      return 'bg-red-50 text-red-700 border-red-200';
    default:
      return 'bg-gray-50 text-gray-700 border-gray-200';
  }
}

function getProgressWidthClass(percent: number): string {
  if (percent <= 0) return 'w-0';
  if (percent < 10) return 'w-[10%]';
  if (percent < 20) return 'w-[20%]';
  if (percent < 30) return 'w-[30%]';
  if (percent < 40) return 'w-[40%]';
  if (percent < 50) return 'w-[50%]';
  if (percent < 60) return 'w-[60%]';
  if (percent < 70) return 'w-[70%]';
  if (percent < 80) return 'w-[80%]';
  if (percent < 90) return 'w-[90%]';
  return 'w-full';
}

function getStepToneClasses(tone: string, isCurrent: boolean, isCompleted: boolean): string {
  if (isCurrent) {
    return 'border-blue-500 bg-blue-50 text-blue-700';
  }

  if (isCompleted) {
    return 'border-emerald-500 bg-emerald-50 text-emerald-700';
  }

  switch (tone) {
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'danger':
      return 'border-red-200 bg-red-50 text-red-700';
    default:
      return 'border-gray-200 bg-white text-gray-500';
  }
}

function getMediaIcon(assetType: PropertyImportAssetType) {
  switch (assetType) {
    case 'brochure':
      return <FileText className="h-4 w-4" />;
    case 'video':
      return <Video className="h-4 w-4" />;
    default:
      return <ImageIcon className="h-4 w-4" />;
  }
}

function parseUploadError(error: unknown): string {
  return getErrorMessage(error, 'Upload failed');
}

export default function PropertyImportPage() {
  const navigate = useNavigate();
  const { draftId: routeDraftId } = useParams();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canManageProperties = user?.role === 'super_admin' || user?.role === 'company_admin';
  const [draft, setDraft] = useState<PropertyImportDraft | null>(null);
  const [formValues, setFormValues] = useState<PropertyImportFormValues>(PROPERTY_IMPORT_DEFAULT_FORM_VALUES);
  const [isDirty, setIsDirty] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(Boolean(routeDraftId));
  const [pageError, setPageError] = useState('');
  const [uploadItems, setUploadItems] = useState<DraftUploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [markPublishReady, setMarkPublishReady] = useState(false);
  const [retryReason, setRetryReason] = useState('');

  const stage = useMemo(() => getPropertyImportStage(draft), [draft]);
  const mappingMetadata = useMemo(() => getPropertyImportMappingMetadata(draft?.draftData), [draft?.draftData]);
  const reviewMetadata = useMemo(() => getPropertyImportReviewMetadata(draft?.draftData), [draft?.draftData]);
  const lowConfidenceHints = useMemo(() => {
    const threshold = Number(mappingMetadata.review_settings.confidence_threshold || 0.75);
    return reviewMetadata.confidence_hints.filter((hint) => Number.isFinite(threshold) ? hint.confidence < threshold : true);
  }, [mappingMetadata.review_settings.confidence_threshold, reviewMetadata.confidence_hints]);

  const syncApprovalState = useCallback((nextDraft: PropertyImportDraft | null, forceReset = false) => {
    if (!nextDraft) {
      setMarkPublishReady(false);
      return;
    }

    const nextReview = getPropertyImportReviewMetadata(nextDraft.draftData);
    const shouldApprove = nextDraft.status === 'publish_ready' || nextDraft.status === 'published' || nextReview.status === 'approved';

    if (shouldApprove) {
      setMarkPublishReady(true);
      return;
    }

    if (forceReset) {
      setMarkPublishReady(false);
    }
  }, []);

  const currentStageIndex = useMemo(() => {
    if (!draft) {
      return 0;
    }

    if (draft.status === 'failed') {
      return -1;
    }

    if (draft.status === 'cancelled') {
      return -2;
    }

    if (draft.status === 'published') {
      return PROPERTY_IMPORT_STAGE_ORDER.length - 1;
    }

    if (draft.status === 'review_ready') {
      return 3;
    }

    if (draft.status === 'publish_ready') {
      return 4;
    }

    if (draft.status === 'extracting') {
      return draft.extractionStatus === 'queued' ? 1 : 2;
    }

    return 0;
  }, [draft]);

  const syncFormFromDraft = useCallback((draftData: Record<string, unknown> | null | undefined) => {
    setFormValues(createPropertyImportFormValues(draftData));
    setIsDirty(false);
  }, []);

  const loadDraft = useCallback(
    async (draftToLoad: string, silent = false) => {
      if (!silent) {
        setLoadingDraft(true);
      }

      try {
        const nextDraft = await getPropertyImportDraft(draftToLoad);
        setDraft(nextDraft);
        syncApprovalState(nextDraft, !silent);
        if (!isDirty) {
          syncFormFromDraft(nextDraft.draftData);
        }
        setPageError('');
      } catch (error) {
        setPageError(getErrorMessage(error, 'Failed to load the import draft'));
      } finally {
        if (!silent) {
          setLoadingDraft(false);
        }
      }
    },
    [isDirty, syncApprovalState, syncFormFromDraft],
  );

  useEffect(() => {
    if (!routeDraftId) {
      setDraft(null);
      setMarkPublishReady(false);
      setPageError('');
      setLoadingDraft(false);
      syncFormFromDraft(null);
      return;
    }

    void loadDraft(routeDraftId);
  }, [loadDraft, routeDraftId, syncFormFromDraft]);

  useEffect(() => {
    if (draft && !isDirty) {
      setFormValues(createPropertyImportFormValues(draft.draftData));
    }
  }, [draft, isDirty]);

  useEffect(() => {
    if (!routeDraftId || !draft || isPropertyImportTerminalStatus(draft.status)) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadDraft(routeDraftId, true);
    }, 5000);

    return () => window.clearInterval(interval);
  }, [draft, loadDraft, routeDraftId]);

  const updateField = (name: keyof PropertyImportFormValues, value: string) => {
    setFormValues((current) => ({ ...current, [name]: value }));
    setIsDirty(true);
  };

  const updateMappingField = (
    index: number,
    name: keyof PropertyImportFieldMappingFormValue,
    value: string | boolean,
  ) => {
    setFormValues((current) => ({
      ...current,
      mapping_field_mappings: current.mapping_field_mappings.map((item, itemIndex) => (
        itemIndex === index ? { ...item, [name]: value } as PropertyImportFieldMappingFormValue : item
      )),
    }));
    setIsDirty(true);
  };

  const addMappingRow = () => {
    setFormValues((current) => ({
      ...current,
      mapping_field_mappings: [
        ...current.mapping_field_mappings,
        {
          source_field: '',
          target_field: '',
          confidence: '',
          required: false,
          label: '',
          notes: '',
        },
      ],
    }));
    setIsDirty(true);
  };

  const removeMappingRow = (index: number) => {
    setFormValues((current) => ({
      ...current,
      mapping_field_mappings: current.mapping_field_mappings.filter((_, itemIndex) => itemIndex !== index),
    }));
    setIsDirty(true);
  };

  const applyDraftUpdate = (nextDraft: PropertyImportDraft) => {
    setDraft(nextDraft);
    syncApprovalState(nextDraft, true);
    syncFormFromDraft(nextDraft.draftData);
  };

  const persistDraft = useCallback(
    async (nextMarkPublishReady: boolean) => {
      if (!draft?.id) {
        return null;
      }

      setIsSaving(true);
      try {
        const saved = await savePropertyImportDraft(draft.id, {
          draft_data: serializePropertyImportFormValues(formValues, draft.draftData),
          review_notes: formValues.review_notes.trim() || null,
          mark_publish_ready: nextMarkPublishReady,
        });
        applyDraftUpdate(saved);
        setMarkPublishReady(nextMarkPublishReady);
        setPageError('');
        return saved;
      } catch (error) {
        setPageError(getErrorMessage(error, 'Failed to save import changes'));
        return null;
      } finally {
        setIsSaving(false);
      }
    },
    [draft?.id, formValues],
  );

  const ensureDraftExists = useCallback(async () => {
    if (draft?.id) {
      return draft.id;
    }

    const created = await createPropertyImportDraft({
      draft_data: serializePropertyImportFormValues(formValues),
      max_retries: 3,
    });

    setDraft(created);
    syncFormFromDraft(created.draftData);
    setPageError('');
    return created.id;
  }, [draft?.id, formValues, syncFormFromDraft]);

  const processFiles = useCallback(async (selectedFiles: File[]) => {
    if (!canManageProperties) {
      setPageError('You do not have permission to import properties.');
      return;
    }

    if (selectedFiles.length === 0) {
      return;
    }

    const invalidFiles = selectedFiles.filter((file) => !isPropertyImportMimeTypeSupported(file.type));
    if (invalidFiles.length > 0) {
      setPageError(`Unsupported file type: ${invalidFiles[0].name}. Supported types are ${SUPPORTED_FILE_LABELS.join(', ')}.`);
      return;
    }

    const queue = selectedFiles.map((file) => ({
      id: crypto.randomUUID(),
      file,
    }));

    setIsUploading(true);
    setUploadItems(queue.map(({ id, file }) => ({
      id,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      assetType: inferPropertyImportAssetType(file),
      progress: 0,
      status: 'pending',
      error: null,
      mediaId: null,
    })));

    let draftIdForUpload = draft?.id || '';

    try {
      if (!draftIdForUpload) {
        draftIdForUpload = await ensureDraftExists();
        navigate(`/properties/import/${draftIdForUpload}`, { replace: true });
      }

      for (const { id, file } of queue) {
        if (file.size > MAX_FILE_SIZE_BYTES) {
          setUploadItems((items) => items.map((entry) => (
            entry.id === id
              ? { ...entry, status: 'failed', error: `File exceeds the ${formatFileSize(MAX_FILE_SIZE_BYTES)} limit.` }
              : entry
          )));
          setPageError(`File "${file.name}" is too large. The maximum file size is ${formatFileSize(MAX_FILE_SIZE_BYTES)}.`);
          continue;
        }

        setUploadItems((items) => items.map((entry) => {
          if (entry.id !== id) {
            return entry;
          }

          return { ...entry, status: 'registering', error: null, progress: 0, mediaId: null };
        }));

        const registered = await registerPropertyImportUpload(draftIdForUpload, {
          file_name: file.name,
          mime_type: file.type,
          file_size: file.size,
          asset_type: inferPropertyImportAssetType(file),
        });

        setUploadItems((items) => items.map((entry) => {
          if (entry.id !== id) {
            return entry;
          }

          return {
            ...entry,
            status: 'uploading',
            mediaId: registered.media.id,
          };
        }));

        await uploadPropertyImportFile(
          registered.upload.upload_url,
          file,
          registered.upload.content_type,
          ({ percent }) => {
            setUploadItems((items) => items.map((entry) => {
              if (entry.id !== id) {
                return entry;
              }

              return { ...entry, progress: percent };
            }));
          },
        );

        setUploadItems((items) => items.map((entry) => {
          if (entry.id !== id) {
            return entry;
          }

          return { ...entry, status: 'confirming', progress: 100 };
        }));

        const confirmed = await confirmPropertyImportUpload(draftIdForUpload, registered.upload.upload_token);
        applyDraftUpdate(confirmed.draft);

        setUploadItems((items) => items.map((entry) => {
          if (entry.id !== id) {
            return entry;
          }

          return { ...entry, status: 'done', progress: 100, mediaId: confirmed.media.id };
        }));
      }

      await loadDraft(draftIdForUpload, true);
      setPageError('');
    } catch (error) {
      setPageError(parseUploadError(error));
      setUploadItems((items) => items.map((item) => (
        item.status === 'done'
          ? item
          : { ...item, status: 'failed', error: parseUploadError(error) }
      )));
    } finally {
      setIsUploading(false);
    }
  }, [applyDraftUpdate, canManageProperties, draft?.id, ensureDraftExists, loadDraft, navigate]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    await processFiles(files);
  };

  const handleSave = async () => {
    const saved = await persistDraft(markPublishReady);
    if (saved) {
      setIsDirty(false);
    }
  };

  const handlePublish = async () => {
    if (!draft?.id) {
      return;
    }

    setIsPublishing(true);
    try {
      const persistedReview = getPropertyImportReviewMetadata(draft.draftData);
      const isDraftMarkedReady =
        draft.status === 'publish_ready' ||
        draft.status === 'published' ||
        persistedReview.status === 'approved';

      if (isDirty || markPublishReady !== isDraftMarkedReady) {
        const saved = await savePropertyImportDraft(draft.id, {
          draft_data: serializePropertyImportFormValues(formValues, draft.draftData),
          review_notes: formValues.review_notes.trim() || null,
          mark_publish_ready: markPublishReady,
        });
        applyDraftUpdate(saved);
        setPageError('');
      }

      const published = await publishPropertyImportDraft(draft.id, {});
      setDraft(published.draft);
      syncFormFromDraft(published.draft.draftData);
      setPageError('');
      navigate('/properties', { replace: true });
    } catch (error) {
      setPageError(getErrorMessage(error, 'Failed to publish import draft'));
    } finally {
      setIsPublishing(false);
    }
  };

  const handleRetry = async () => {
    if (!draft?.id) {
      return;
    }

    setIsRetrying(true);
    try {
      await retryPropertyImportDraft(draft.id, { reason: retryReason.trim() || null });
      await loadDraft(draft.id, true);
      setRetryReason('');
      setPageError('');
    } catch (error) {
      setPageError(getErrorMessage(error, 'Failed to retry the draft'));
    } finally {
      setIsRetrying(false);
    }
  };

  const handleCancel = async () => {
    if (!draft?.id) {
      return;
    }

    const confirmed = window.confirm('Cancel this media import? Pending uploads and extraction jobs will be stopped.');
    if (!confirmed) {
      return;
    }

    setIsCancelling(true);
    try {
      const cancelled = await cancelPropertyImportDraft(draft.id, { reason: null });
      setDraft(cancelled);
      syncFormFromDraft(cancelled.draftData);
      setPageError('');
      navigate('/properties', { replace: true });
    } catch (error) {
      setPageError(getErrorMessage(error, 'Failed to cancel the draft'));
    } finally {
      setIsCancelling(false);
    }
  };

  const activeUploads = uploadItems.filter((item) => item.status !== 'done');
  const completedUploads = uploadItems.filter((item) => item.status === 'done');

  if (!canManageProperties) {
    return (
      <div className="p-4 md:p-6">
        <div className="mx-auto max-w-2xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 text-red-600">
            <ShieldCheck className="h-5 w-5" />
            <span className="text-sm font-semibold uppercase tracking-wide">Access restricted</span>
          </div>
          <h1 className="mt-3 text-2xl font-bold text-gray-900">Property media import</h1>
          <p className="mt-2 text-sm text-gray-600">
            Your role does not have permission to create or publish property imports.
          </p>
          <button
            type="button"
            onClick={() => navigate('/properties')}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to properties
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => navigate('/properties')}
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to properties
          </button>
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
              <Sparkles className="h-3.5 w-3.5" />
              Media import workflow
            </div>
            <h1 className="mt-3 text-3xl font-bold text-gray-900">Import from media</h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-600">
              Upload property photos, brochures, or walkthrough videos through the browser.
              The backend registers each asset, stores it through presigned upload URLs, and
              processes extraction asynchronously.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-60"
          >
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {draft ? 'Add more media' : 'Create draft and upload'}
          </button>
          <button
            type="button"
            onClick={() => void loadDraft(routeDraftId || draft?.id || '', true)}
            disabled={!routeDraftId && !draft?.id}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh status
          </button>
        </div>
      </div>

      {pageError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{pageError}</span>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 text-white shadow-sm">
            <div className="p-6 md:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${getStatusToneClasses(stage.tone)}`}>
                    {stage.tone === 'complete' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}
                    {stage.label}
                  </div>
                  <h2 className="mt-3 text-2xl font-bold tracking-tight">{draft ? 'Current import draft' : 'Start a new import draft'}</h2>
                  <p className="mt-2 max-w-2xl text-sm text-slate-200">{stage.description}</p>
                </div>
                {draft && (
                  <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-slate-100 backdrop-blur">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-300">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Tenant scoped
                    </div>
                    <p className="mt-1 font-medium">Draft {draft.id.slice(0, 8)}</p>
                    <p className="text-xs text-slate-300">Retries {draft.retryCount}/{draft.maxRetries}</p>
                  </div>
                )}
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-300">Draft status</p>
                  <p className="mt-1 text-lg font-semibold capitalize">{draft?.status || 'Not created'}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-300">Extraction</p>
                  <p className="mt-1 text-lg font-semibold capitalize">{draft?.extractionStatus || 'pending_upload'}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-300">Media assets</p>
                  <p className="mt-1 text-lg font-semibold">{draft?.mediaAssets.length || 0} files</p>
                </div>
              </div>
            </div>

            <div className="border-t border-white/10 bg-white/5 px-6 py-5 md:px-7">
              <div className="grid gap-3 md:grid-cols-6">
                {PROPERTY_IMPORT_STAGE_ORDER.map((step, index) => {
                  const isCompleted = currentStageIndex > index || draft?.status === 'published';
                  const isCurrent = currentStageIndex === index;
                  const stepTitleMap: Partial<Record<(typeof PROPERTY_IMPORT_STAGE_ORDER)[number], string>> = {
                    upload: 'Upload',
                    queue: 'Queue',
                    extract: 'Extract',
                    review: 'Review',
                    publish: 'Publish',
                    published: 'Live',
                  };

                  const stepDescriptionMap: Partial<Record<(typeof PROPERTY_IMPORT_STAGE_ORDER)[number], string>> = {
                    upload: 'Register and upload files',
                    queue: 'Confirm storage objects',
                    extract: 'Worker processes media',
                    review: 'Review extracted data',
                    publish: 'Publish when ready',
                    published: 'Property is live',
                  };

                  return (
                    <div key={step} className={`rounded-xl border p-3 text-sm ${getStepToneClasses(stage.tone, isCurrent, isCompleted)}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold">{stepTitleMap[step] ?? step}</p>
                        {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : <CircleDashed className="h-4 w-4" />}
                      </div>
                      <p className="mt-1 text-xs opacity-80">{stepDescriptionMap[step] ?? step}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Upload media</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Select multiple files. The draft is created through the backend before uploads begin.
                </p>
              </div>
              <div className="hidden items-center gap-2 rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 md:inline-flex">
                <Sparkles className="h-3.5 w-3.5 text-blue-500" />
                No direct R2 credentials are exposed
              </div>
            </div>

            <div
              className="mt-5 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 p-6 text-center transition-colors hover:border-blue-300 hover:bg-blue-50/60"
              onDragOver={(event) => event.preventDefault()}
              onDrop={async (event) => {
                event.preventDefault();
                await processFiles(Array.from(event.dataTransfer.files));
              }}
            >
              <Upload className="mx-auto h-10 w-10 text-blue-500" />
              <p className="mt-3 text-sm font-medium text-gray-900">Drag and drop files here</p>
              <p className="mt-1 text-sm text-gray-500">
                Supported files: {SUPPORTED_FILE_LABELS.join(', ')}
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Upload className="h-4 w-4" />
                Browse files
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={PROPERTY_IMPORT_SUPPORTED_MIME_TYPES.join(',')}
                multiple
                aria-label="Select property media files"
                title="Select property media files"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            {activeUploads.length > 0 && (
              <div className="mt-5 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <p className="font-medium text-gray-700">Upload queue</p>
                  <p className="text-gray-500">{completedUploads.length} complete, {activeUploads.length} active</p>
                </div>
                <div className="space-y-3">
                  {uploadItems.map((item) => (
                    <div key={`${item.fileName}-${item.fileSize}-${item.mimeType}`} className="rounded-xl border border-gray-200 bg-white p-4">
                      <div className="flex items-start gap-3">
                        <div className="rounded-lg bg-gray-100 p-2 text-gray-500">{getMediaIcon(item.assetType)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium text-gray-900">{item.fileName}</p>
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{PROPERTY_IMPORT_ASSET_TYPE_LABELS[item.assetType]}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusToneClasses(getPropertyImportMediaLabel(item.status === 'failed' ? 'failed' : item.status === 'done' ? 'extracted' : 'queued_for_extraction').tone)}`}>
                              {item.status}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-gray-500">{formatFileSize(item.fileSize)} · {item.mimeType}</p>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className={`h-full rounded-full ${item.status === 'failed' ? 'bg-red-500' : item.status === 'done' ? 'bg-emerald-500' : 'bg-blue-500'} ${getProgressWidthClass(Math.min(100, item.progress))}`}
                            />
                          </div>
                        </div>
                      </div>
                      {item.error && <p className="mt-3 text-sm text-red-600">{item.error}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Imported media</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Track upload, queue, extraction, and retry status for each asset.
                </p>
              </div>
              {draft && (
                <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${getStatusToneClasses(stage.tone)}`}>
                  {stage.label}
                </div>
              )}
            </div>

            {loadingDraft ? (
              <div className="flex items-center justify-center py-10 text-gray-500">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Loading draft...
              </div>
            ) : draft?.mediaAssets.length ? (
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {draft.mediaAssets.map((media) => {
                  const mediaStatus = getPropertyImportMediaLabel(media.status);
                  return (
                    <div key={media.id} className="rounded-xl border border-gray-200 p-4">
                      <div className="flex items-start gap-3">
                        <div className="rounded-lg bg-gray-100 p-2 text-gray-600">{getMediaIcon(media.assetType)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium text-gray-900">{media.fileName}</p>
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusToneClasses(mediaStatus.tone)}`}>
                              {mediaStatus.label}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-gray-500">
                            {PROPERTY_IMPORT_ASSET_TYPE_LABELS[media.assetType]} · {formatFileSize(media.fileSize)}
                          </p>
                          <p className="mt-2 text-xs text-gray-500">{mediaStatus.description}</p>
                          {media.failureReason && <p className="mt-2 text-sm text-red-600">{media.failureReason}</p>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-5 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-sm text-gray-500">
                No uploaded media yet. Start by selecting files above.
              </div>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Review draft details</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Edit the extracted data before marking the draft ready to publish.
                </p>
              </div>
              {draft?.status === 'published' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Published
                </span>
              )}
            </div>

            {(lowConfidenceHints.length > 0 || reviewMetadata.status === 'needs_review') && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">
                      Review required before publishing
                    </p>
                    <p className="text-sm text-amber-800">
                      Low-confidence mapping fields are still present. Confirm the mapping profile, then approve publishing explicitly.
                    </p>
                    {lowConfidenceHints.length > 0 && (
                      <ul className="space-y-1 text-sm text-amber-800">
                        {lowConfidenceHints.map((hint) => (
                          <li key={`${hint.field}-${hint.source_field || 'source'}`}>
                            <span className="font-medium">{hint.field}</span> is at {Math.round(hint.confidence * 100)}% confidence{hint.source_field ? ` from ${hint.source_field}` : ''}.
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Property name"
                value={formValues.name}
                onChange={(value) => updateField('name', value)}
                placeholder="Sunrise Residences"
                disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
                required
                className="sm:col-span-2"
              />
              <Field
                label="Builder / developer"
                value={formValues.builder}
                onChange={(value) => updateField('builder', value)}
                placeholder="Acme Builders"
                disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
              />
              <SelectField
                label="Property type"
                value={formValues.property_type}
                onChange={(value) => updateField('property_type', value)}
                options={PROPERTY_IMPORT_PROPERTY_TYPES.map((option) => ({ value: option, label: option }))}
                disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
              />
              <Field
                label="City"
                value={formValues.location_city}
                onChange={(value) => updateField('location_city', value)}
                placeholder="Bengaluru"
                disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
              />
              <Field
                label="Area"
                value={formValues.location_area}
                onChange={(value) => updateField('location_area', value)}
                placeholder="Whitefield"
                disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
              />
              <Field
                label="Pincode"
                value={formValues.location_pincode}
                onChange={(value) => updateField('location_pincode', value)}
                placeholder="560066"
                disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
              />
              <Field
                label="Bedrooms"
                value={formValues.bedrooms}
                onChange={(value) => updateField('bedrooms', value)}
                placeholder="3"
                inputMode="numeric"
                disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
              />
              <SelectField
                label="Status"
                value={formValues.status}
                onChange={(value) => updateField('status', value as PropertyImportFormValues['status'])}
                options={[
                  { value: 'available', label: 'available' },
                  { value: 'sold', label: 'sold' },
                  { value: 'upcoming', label: 'upcoming' },
                ]}
                disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
              />
              <Field
                label="Price min (₹)"
                value={formValues.price_min}
                onChange={(value) => updateField('price_min', value)}
                placeholder="8500000"
                inputMode="numeric"
                disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
              />
              <Field
                label="Price max (₹)"
                value={formValues.price_max}
                onChange={(value) => updateField('price_max', value)}
                placeholder="12500000"
                inputMode="numeric"
                disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
              />
              <Field
                label="RERA number"
                value={formValues.rera_number}
                onChange={(value) => updateField('rera_number', value)}
                placeholder="PRM/KA/RERA/1251/446/PR/011223/006123"
                disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
                className="sm:col-span-2"
              />
              <TextAreaField
                label="Amenities"
                value={formValues.amenities}
                onChange={(value) => updateField('amenities', value)}
                placeholder="Pool, Gym, Clubhouse"
                disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
                className="sm:col-span-2"
              />
              <TextAreaField
                label="Description"
                value={formValues.description}
                onChange={(value) => updateField('description', value)}
                placeholder="Short property summary..."
                disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
                className="sm:col-span-2"
              />
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                    <ListFilter className="h-3.5 w-3.5" />
                    Mapping profile
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    Save company-specific source mappings and review thresholds with the draft so future imports can reuse the same structure.
                  </p>
                </div>
                <div className="text-xs text-slate-500">
                  Source type: <span className="font-medium text-slate-700">{mappingMetadata.source_type}</span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="Mapping source type"
                  value={formValues.mapping_source_type}
                  onChange={(value) => updateField('mapping_source_type', value)}
                  placeholder="brochure, ocr, manual"
                  disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
                />
                <Field
                  label="Profile name"
                  value={formValues.mapping_profile_name}
                  onChange={(value) => updateField('mapping_profile_name', value)}
                  placeholder="Default brochure import"
                  disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
                />
                <Field
                  label="Confidence threshold"
                  value={formValues.mapping_confidence_threshold}
                  onChange={(value) => updateField('mapping_confidence_threshold', value)}
                  placeholder="0.75"
                  inputMode="decimal"
                  disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
                />
                <Field
                  label="Low-confidence threshold"
                  value={formValues.mapping_low_confidence_threshold}
                  onChange={(value) => updateField('mapping_low_confidence_threshold', value)}
                  placeholder="0.55"
                  inputMode="decimal"
                  disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
                />
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={formValues.mapping_require_human_review}
                    onChange={(event) => {
                      setFormValues((current) => ({
                        ...current,
                        mapping_require_human_review: event.target.checked,
                      }));
                      setIsDirty(true);
                    }}
                    disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Require human review for this mapping profile
                </label>
              </div>

              <div className="mt-4 space-y-3">
                {formValues.mapping_field_mappings.map((mappingRow, index) => (
                  <div key={`${mappingRow.source_field || 'mapping'}-${index}`} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">Field mapping {index + 1}</p>
                      <button
                        type="button"
                        onClick={() => removeMappingRow(index)}
                        disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
                        className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field
                        label="Source field"
                        value={mappingRow.source_field}
                        onChange={(value) => updateMappingField(index, 'source_field', value)}
                        placeholder="title"
                        disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
                      />
                      <Field
                        label="Target field"
                        value={mappingRow.target_field}
                        onChange={(value) => updateMappingField(index, 'target_field', value)}
                        placeholder="name"
                        disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
                      />
                      <Field
                        label="Confidence"
                        value={mappingRow.confidence}
                        onChange={(value) => updateMappingField(index, 'confidence', value)}
                        placeholder="0.82"
                        inputMode="decimal"
                        disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
                      />
                      <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={mappingRow.required}
                          onChange={(event) => updateMappingField(index, 'required', event.target.checked)}
                          disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        Required
                      </label>
                      <Field
                        label="Label"
                        value={mappingRow.label}
                        onChange={(value) => updateMappingField(index, 'label', value)}
                        placeholder="Property title"
                        disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
                      />
                      <Field
                        label="Notes"
                        value={mappingRow.notes}
                        onChange={(value) => updateMappingField(index, 'notes', value)}
                        placeholder="Optional hint or rule"
                        disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
                      />
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addMappingRow}
                  disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                >
                  <ListFilter className="h-4 w-4" />
                  Add mapping row
                </button>
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                <p className="font-medium text-slate-900">Review status</p>
                <p className="mt-1 text-slate-600">
                  {reviewMetadata.status === 'approved'
                    ? 'This draft is approved for publishing.'
                    : reviewMetadata.status === 'needs_review'
                      ? 'This draft still needs human review before it can be published.'
                      : 'No review is currently required for this mapping profile.'}
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={markPublishReady}
                  onChange={(event) => setMarkPublishReady(event.target.checked)}
                  disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Approve this review and mark the draft ready to publish
              </label>
              <p className="mt-2 text-xs text-gray-500">
                Publishing stays blocked until you explicitly approve the review.
              </p>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700">Review notes</label>
              <textarea
                value={formValues.review_notes}
                onChange={(event) => {
                  updateField('review_notes', event.target.value);
                }}
                rows={4}
                disabled={!!draft && isPropertyImportTerminalStatus(draft.status)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                placeholder="Add notes for the reviewer or publishing handoff"
              />
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!draft?.id || isSaving || (draft ? isPropertyImportTerminalStatus(draft.status) : false)}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save review
              </button>
              <button
                type="button"
                onClick={() => void handlePublish()}
                disabled={!draft?.id || isPublishing || !markPublishReady || (!draft || isPropertyImportTerminalStatus(draft.status))}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {isPublishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Publish property
              </button>
            </div>
          </section>

          {draft?.status === 'failed' && (
            <section className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-red-600" />
                <div>
                  <h3 className="text-lg font-semibold text-red-900">Import failed</h3>
                  <p className="mt-1 text-sm text-red-700">
                    Retry the extraction after fixing the source files or updating the draft details.
                  </p>
                </div>
              </div>
              <textarea
                value={retryReason}
                onChange={(event) => setRetryReason(event.target.value)}
                rows={3}
                className="mt-4 w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="Optional retry reason"
              />
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleRetry()}
                  disabled={isRetrying}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {isRetrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Retry extraction
                </button>
                <button
                  type="button"
                  onClick={() => void handleCancel()}
                  disabled={isCancelling}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
                >
                  {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Cancel draft
                </button>
              </div>
            </section>
          )}

          {draft?.status === 'cancelled' && (
            <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900">Import cancelled</h3>
              <p className="mt-1 text-sm text-gray-600">
                This draft is terminal. Start a new import from the properties page when you are ready.
              </p>
            </section>
          )}

          {draft?.status === 'published' && draft.publishedProperty && (
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
                <div>
                  <h3 className="text-lg font-semibold text-emerald-900">Property published</h3>
                  <p className="mt-1 text-sm text-emerald-700">
                    The draft was published successfully and is now available in the catalog.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigate('/properties')}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Open properties
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  className?: string;
}

function Field({ label, value, onChange, placeholder, disabled, required, inputMode, className }: FieldProps) {
  return (
    <label className={`block ${className || ''}`}>
      <span className="mb-1 block text-sm font-medium text-gray-700">
        {label}{required ? ' *' : ''}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        inputMode={inputMode}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
      />
    </label>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  className?: string;
}

function SelectField({ label, value, onChange, options, disabled, className }: SelectFieldProps) {
  return (
    <label className={`block ${className || ''}`}>
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
      >
        <option value="">Select</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface TextAreaFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

function TextAreaField({ label, value, onChange, placeholder, disabled, className }: TextAreaFieldProps) {
  return (
    <label className={`block ${className || ''}`}>
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={3}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
      />
    </label>
  );
}

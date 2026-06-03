import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import { dashboardPath, getRoleCapabilities } from '../../config/navigation.config';
import {
  ArrowLeft,
  AlertTriangle,
  Building2,
  CheckCircle2,
  FileSpreadsheet,
  Home,
  LandPlot,
  Loader2,
  Send,
  ShieldCheck,
  Sparkles,
  Store,
  Upload,
} from 'lucide-react';
import {
  confirmPropertyImportUpload,
  createPropertyImportDraft,
  deferPropertyImportKnowledge,
  getPropertyImportDraft,
  inferPropertyImportAssetType,
  isPropertyImportMimeTypeSupported,
  publishPropertyImportDraft,
  cancelPropertyImportDraft,
  normalizePropertyImportDraft,
  registerPropertyImportUpload,
  savePropertyImportDraft,
  uploadPropertyImportFile,
  type PropertyImportDraft,
  PROPERTY_IMPORT_SUPPORTED_MIME_TYPES,
} from '../../services/propertyImport';
import BulkCsvImportSection from './BulkCsvImportSection';
import {
  PROPERTY_IMPORT_DEFAULT_FORM_VALUES,
  createPropertyImportFormValues,
  isPropertyImportTerminalStatus,
  serializePropertyImportFormValues,
  type PropertyImportFormValues,
} from './propertyImport.utils';
import { PROPERTY_KNOWLEDGE_TYPES, type PropertyKnowledgeType } from './propertyTypeKnowledgeSchema';
import { getPublishReadiness } from './propertyImportPublishReadiness';
import PropertyImportKnowledgeWizard from './PropertyImportKnowledgeWizard';
import PropertyImportMappingReview from './PropertyImportMappingReview';
import PropertyImportBatchProgress from './PropertyImportBatchProgress';
import PropertyImportSpreadsheetPanel from './PropertyImportSpreadsheetPanel';
import PropertyUnitConfigurationEditor from './PropertyUnitConfigurationEditor';
import RemoveCancelButton from '../../components/actions/RemoveCancelButton';
import { getPropertyImportReviewMetadata } from './propertyImport.utils';
import { clearPropertyKnowledgeGateCache } from '../../utils/propertyKnowledgeGateCache';
import {
  embeddingHealthMessage,
  getSystemHealth,
  isOpenAiEmbeddingsReady,
  type SystemHealth,
} from '../../services/health';

const SUPPORTED_FILE_LABELS = ['JPEG', 'PNG', 'WebP', 'PDF', 'CSV', 'Excel'];
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/** Import mode: 'ai' = brochure AI extraction, 'bulk' = CSV/Excel batch upload. */
type ImportMode = 'ai' | 'bulk';

const TYPE_CARDS: Array<{
  type: PropertyKnowledgeType;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  { type: 'apartment', label: 'Apartment', description: 'Flats & towers', icon: <Building2 className="h-8 w-8" /> },
  { type: 'villa', label: 'Villa', description: 'Villas & townhouses', icon: <Home className="h-8 w-8" /> },
  { type: 'plot', label: 'Plot', description: 'Plots & land', icon: <LandPlot className="h-8 w-8" /> },
  { type: 'commercial', label: 'Commercial', description: 'Shops & offices', icon: <Store className="h-8 w-8" /> },
];

const SIMPLE_STEPS = ['Type', 'Upload', 'Review', 'Knowledge', 'Publish'] as const;

type DraftUploadStatus = 'pending' | 'registering' | 'uploading' | 'confirming' | 'done' | 'failed';

interface DraftUploadItem {
  id: string;
  fileName: string;
  status: DraftUploadStatus;
  error: string | null;
}

function sanitizeUserFacingError(message: string): string {
  if (/embedding api failed/i.test(message) || /invalid_api_key/i.test(message) || /incorrect api key/i.test(message)) {
    return 'OpenAI API key on the server is invalid or expired. Ask your admin to update OPENAI_API_KEY in Render, then try publishing again.';
  }
  if (/sk-proj-/i.test(message) || /sk-[a-z0-9]{8,}/i.test(message)) {
    return 'Server configuration error. Contact support to fix the OpenAI API key.';
  }
  return message;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data as { error?: string; message?: string } | undefined;
    const raw = payload?.error || payload?.message || error.message || fallback;
    return sanitizeUserFacingError(raw);
  }
  if (error instanceof Error) {
    return sanitizeUserFacingError(error.message || fallback);
  }
  return fallback;
}

export default function PropertyImportSimplePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const gateReason = (location.state as { knowledgeGateReason?: string } | null)?.knowledgeGateReason;
  const { draftId: routeDraftId } = useParams();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const knowledgeSectionRef = useRef<HTMLElement | null>(null);

  const canManageProperties = getRoleCapabilities(user?.role).canUploadProperties;
  const [importMode, setImportMode] = useState<ImportMode>('ai');
  const [draft, setDraft] = useState<PropertyImportDraft | null>(null);
  const [formValues, setFormValues] = useState<PropertyImportFormValues>(PROPERTY_IMPORT_DEFAULT_FORM_VALUES);
  const [loadingDraft, setLoadingDraft] = useState(Boolean(routeDraftId));
  const [pageError, setPageError] = useState('');
  const [uploadItems, setUploadItems] = useState<DraftUploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isCancellingDraft, setIsCancellingDraft] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [embeddingHealth, setEmbeddingHealth] = useState<SystemHealth | null>(null);
  const [embeddingHealthLoading, setEmbeddingHealthLoading] = useState(false);

  const loadEmbeddingHealth = useCallback(async () => {
    setEmbeddingHealthLoading(true);
    try {
      setEmbeddingHealth(await getSystemHealth());
    } catch {
      setEmbeddingHealth(null);
    } finally {
      setEmbeddingHealthLoading(false);
    }
  }, []);

  const openAiEmbeddingsReady = isOpenAiEmbeddingsReady(embeddingHealth);
  const embeddingHealthFailed =
    embeddingHealth?.dependencies?.property_knowledge_embeddings?.status === 'error';

  const publishReadiness = useMemo(
    () => getPublishReadiness({
      formValues,
      draft,
      isUploading,
      activeUploadCount: uploadItems.filter((i) => i.status !== 'done').length,
    }),
    [formValues, draft, isUploading, uploadItems],
  );

  const mappingReview = useMemo(
    () => getPropertyImportReviewMetadata(draft?.draftData),
    [draft?.draftData],
  );

  const unitsCount = draft?.units?.length ?? 0;

  const activeStepIndex = useMemo(() => {
    if (!formValues.property_type.trim()) {
      return 0;
    }
    const hasMedia = (draft?.mediaAssets?.length ?? 0) > 0;
    const spreadsheetReady = unitsCount > 0 && draft?.extractionStatus === 'extracted';
    if (!hasMedia && !spreadsheetReady) {
      return 1;
    }
    if (draft?.extractionStatus !== 'extracted' && !spreadsheetReady) {
      return 1;
    }
    if (mappingReview.status === 'needs_review') {
      return 2;
    }
    if (publishReadiness.missingQuestions.length > 0) {
      return 3;
    }
    return 4;
  }, [
    formValues.property_type,
    draft,
    publishReadiness.missingQuestions.length,
    mappingReview.status,
    unitsCount,
  ]);

  const syncFormFromDraft = useCallback((draftData: Record<string, unknown> | null | undefined) => {
    setFormValues(createPropertyImportFormValues(draftData));
  }, []);

  const loadDraft = useCallback(async (id: string, silent = false) => {
    if (!silent) {
      setLoadingDraft(true);
    }
    try {
      const next = await getPropertyImportDraft(id);
      setDraft(normalizePropertyImportDraft(next));
      syncFormFromDraft(next.draftData);
      setPageError('');
    } catch (error) {
      setPageError(getErrorMessage(error, 'Failed to load draft'));
    } finally {
      if (!silent) {
        setLoadingDraft(false);
      }
    }
  }, [syncFormFromDraft]);

  useEffect(() => {
    if (!routeDraftId) {
      setDraft(null);
      syncFormFromDraft(null);
      setLoadingDraft(false);
      return;
    }
    void loadDraft(routeDraftId);
  }, [loadDraft, routeDraftId, syncFormFromDraft]);

  useEffect(() => {
    if (!routeDraftId || !draft || isPropertyImportTerminalStatus(draft.status)) {
      return;
    }
    if (publishReadiness.missingQuestions.length > 0 && draft.extractionStatus === 'extracted') {
      return;
    }
    const interval = window.setInterval(() => void loadDraft(routeDraftId, true), 5000);
    return () => window.clearInterval(interval);
  }, [draft, loadDraft, routeDraftId, publishReadiness.missingQuestions.length]);

  const handleConfirmMapping = async () => {
    if (!draft?.id) {
      return;
    }
    const nextDraftData = {
      ...(draft.draftData || {}),
      import_review: {
        ...mappingReview,
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        approved_at: new Date().toISOString(),
      },
    };
    setIsSaving(true);
    try {
      const saved = await savePropertyImportDraft(draft.id, {
        draft_data: nextDraftData,
        review_notes: 'Mapping confirmed by reviewer',
        mark_publish_ready: false,
      });
      applyDraftUpdate(saved);
    } catch (error) {
      setPageError(getErrorMessage(error, 'Failed to confirm mapping'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleMappingFieldChange = (targetField: string, value: string) => {
    setFormValues((current) => ({
      ...current,
      [targetField]: value,
    } as PropertyImportFormValues));
  };

  useEffect(() => {
    if (activeStepIndex < 3) {
      return;
    }
    void loadEmbeddingHealth();
    const interval = window.setInterval(() => void loadEmbeddingHealth(), 30000);
    return () => window.clearInterval(interval);
  }, [activeStepIndex, loadEmbeddingHealth]);

  const applyDraftUpdate = (nextDraft: PropertyImportDraft) => {
    const normalized = normalizePropertyImportDraft(nextDraft);
    setDraft(normalized);
    syncFormFromDraft(normalized.draftData);
  };

  const handleDeferKnowledge = useCallback(async () => {
    if (!draft?.id) {
      return;
    }
    setIsSaving(true);
    try {
      const saved = await deferPropertyImportKnowledge(draft.id);
      applyDraftUpdate(saved);
      const companyId = typeof user?.company_id === 'string' ? user.company_id : '';
      if (companyId) {
        clearPropertyKnowledgeGateCache(companyId);
      }
      navigate(dashboardPath('/properties'), { replace: true });
    } catch (error) {
      setPageError(getErrorMessage(error, 'Failed to defer knowledge step'));
    } finally {
      setIsSaving(false);
    }
  }, [draft?.id, navigate, user?.company_id]);

  const persistDraft = async (
    nextFormValues = formValues,
    nextDraftData: Record<string, unknown> | null | undefined = draft?.draftData,
    options?: { syncFormFromServer?: boolean },
  ) => {
    if (!draft?.id) {
      return null;
    }
    setIsSaving(true);
    try {
      const saved = await savePropertyImportDraft(draft.id, {
        draft_data: serializePropertyImportFormValues(nextFormValues, nextDraftData),
        review_notes: null,
        mark_publish_ready: publishReadiness.ready,
      });
      if (options?.syncFormFromServer !== false) {
        applyDraftUpdate(saved);
      } else {
        setDraft(normalizePropertyImportDraft(saved));
      }
      return saved;
    } catch (error) {
      setPageError(getErrorMessage(error, 'Failed to save'));
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  const selectPropertyType = async (type: PropertyKnowledgeType) => {
    const nextForm = { ...formValues, property_type: type };
    setFormValues(nextForm);
    setPageError('');

    if (draft?.id) {
      setIsSaving(true);
      try {
        const saved = await savePropertyImportDraft(draft.id, {
          draft_data: serializePropertyImportFormValues(nextForm, draft.draftData),
          review_notes: null,
          mark_publish_ready: false,
        });
        applyDraftUpdate(saved);
      } catch (error) {
        setPageError(getErrorMessage(error, 'Failed to save property type'));
      } finally {
        setIsSaving(false);
      }
      return;
    }

    setIsSaving(true);
    try {
      const created = await createPropertyImportDraft({
        draft_data: serializePropertyImportFormValues(nextForm),
        max_retries: 3,
      });
      applyDraftUpdate(created);
      navigate(dashboardPath(`/properties/import/${created.id}`), { replace: true });
    } catch (error) {
      setPageError(getErrorMessage(error, 'Failed to create draft'));
    } finally {
      setIsSaving(false);
    }
  };

  const processFiles = async (files: File[]) => {
    if (!canManageProperties || files.length === 0) {
      return;
    }
    if (!formValues.property_type.trim()) {
      setPageError('Choose a property type first.');
      return;
    }

    const invalid = files.filter((f) => !isPropertyImportMimeTypeSupported(f.type));
    if (invalid.length > 0) {
      setPageError(`Unsupported file: ${invalid[0].name}`);
      return;
    }

    let draftId = draft?.id;
    if (!draftId) {
      const created = await createPropertyImportDraft({
        draft_data: serializePropertyImportFormValues(formValues),
        max_retries: 3,
      });
      applyDraftUpdate(created);
      draftId = created.id;
      navigate(dashboardPath(`/properties/import/${draftId}`), { replace: true });
    }

    setIsUploading(true);
    const queue = files.map((file) => ({ id: crypto.randomUUID(), file }));
    setUploadItems(queue.map(({ id, file }) => ({
      id,
      fileName: file.name,
      status: 'pending',
      error: null,
    })));

    try {
      for (const { id, file } of queue) {
        if (file.size > MAX_FILE_SIZE_BYTES) {
          setUploadItems((items) => items.map((e) => (
            e.id === id ? { ...e, status: 'failed', error: 'File too large' } : e
          )));
          continue;
        }

        setUploadItems((items) => items.map((e) => (e.id === id ? { ...e, status: 'registering' } : e)));

        const registered = await registerPropertyImportUpload(draftId, {
          file_name: file.name,
          mime_type: file.type,
          file_size: file.size,
          asset_type: inferPropertyImportAssetType(file),
        });

        setUploadItems((items) => items.map((e) => (e.id === id ? { ...e, status: 'uploading' } : e)));

        await uploadPropertyImportFile(
          registered.upload.upload_url,
          file,
          registered.upload.content_type,
          () => {},
          registered.upload.fallback_upload_url,
        );

        setUploadItems((items) => items.map((e) => (e.id === id ? { ...e, status: 'confirming' } : e)));

        const confirmed = await confirmPropertyImportUpload(draftId, registered.upload.upload_token);
        if (confirmed.draft) {
          applyDraftUpdate(confirmed.draft);
        }

        setUploadItems((items) => items.map((e) => (e.id === id ? { ...e, status: 'done' } : e)));
      }

      await loadDraft(draftId, true);
    } catch (error) {
      setPageError(getErrorMessage(error, 'Upload failed'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleKnowledgeUpdate = (next: { formValues: PropertyImportFormValues; draftData: Record<string, unknown> }) => {
    setFormValues(next.formValues);
    if (draft) {
      setDraft({ ...draft, draftData: next.draftData });
    }
  };

  const handlePublish = async () => {
    if (!draft?.id || !publishReadiness.ready) {
      setPageError(publishReadiness.blockers[0] || 'Not ready to publish');
      return;
    }

    let health: SystemHealth | null = null;
    try {
      health = await getSystemHealth();
      setEmbeddingHealth(health);
    } catch {
      setPageError('Could not reach server health check. Try again in a moment.');
      return;
    }
    if (!isOpenAiEmbeddingsReady(health)) {
      setPageError(
        embeddingHealthMessage(health)
          || 'OpenAI embeddings are not ready on the server. Update OPENAI_API_KEY on Render and redeploy.',
      );
      return;
    }

    setIsPublishing(true);
    try {
      await savePropertyImportDraft(draft.id, {
        draft_data: serializePropertyImportFormValues(formValues, draft.draftData),
        review_notes: null,
        mark_publish_ready: true,
      });

      const published = await publishPropertyImportDraft(draft.id, {});
      if (!published.knowledge_indexed) {
        setPageError('Published but AI knowledge indexing failed. Check OpenAI or database.');
        applyDraftUpdate(published.draft);
        return;
      }
      const companyId = typeof user?.company_id === 'string' ? user.company_id : '';
      if (companyId) {
        clearPropertyKnowledgeGateCache(companyId);
      }
      navigate(dashboardPath('/properties'), { replace: true });
    } catch (error) {
      setPageError(getErrorMessage(error, 'Publish failed'));
    } finally {
      setIsPublishing(false);
    }
  };

  if (!canManageProperties) {
    return (
      <div className="p-6">
        <p className="text-sm text-ink-secondary">Only company admins can import properties.</p>
      </div>
    );
  }

  return (
    <div className="investo-page mx-auto max-w-3xl space-y-6">
      <button
        type="button"
        onClick={() => navigate(dashboardPath('/properties'))}
        className="inline-flex items-center gap-2 text-sm text-ink-secondary hover:text-ink-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to properties
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-primary">Add a property</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Pick type, upload brochure, answer a few questions, then go live on WhatsApp AI.
          </p>
        </div>
        {draft?.id && !isPropertyImportTerminalStatus(draft.status) && (
          <RemoveCancelButton
            variant="delete"
            label="Cancel import"
            loading={isCancellingDraft}
            onClick={() => {
              if (!draft.id) return;
              if (!confirm('Cancel this import? The draft and uploads will be removed.')) return;
              setIsCancellingDraft(true);
              void cancelPropertyImportDraft(draft.id, { reason: 'Cancelled by user' })
                .then(() => navigate(dashboardPath('/properties'), { replace: true }))
                .catch((error) => setPageError(getErrorMessage(error, 'Failed to cancel import')))
                .finally(() => setIsCancellingDraft(false));
            }}
          />
        )}
      </div>

      {/* Mode switcher */}
      {!routeDraftId && (
        <div
          className="flex gap-2 rounded-xl border border-surface-border bg-surface-muted p-1"
          role="tablist"
          aria-label="Import mode"
        >
          <button
            id="import-mode-ai"
            type="button"
            role="tab"
            aria-selected={importMode === 'ai'}
            onClick={() => setImportMode('ai')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              importMode === 'ai'
                ? 'bg-surface-elevated shadow-sm text-ink-primary'
                : 'text-ink-muted hover:text-ink-secondary'
            }`}
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            AI Brochure Import
          </button>
          <button
            id="import-mode-bulk"
            type="button"
            role="tab"
            aria-selected={importMode === 'bulk'}
            onClick={() => setImportMode('bulk')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              importMode === 'bulk'
                ? 'bg-surface-elevated shadow-sm text-ink-primary'
                : 'text-ink-muted hover:text-ink-secondary'
            }`}
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            Bulk CSV / Excel
          </button>
        </div>
      )}

      {/* AI brochure mode — existing 4-step flow */}
      {(importMode === 'ai' || Boolean(routeDraftId)) && (
        <>
          <nav className="investo-scroll-x flex gap-2 pb-1">
            {SIMPLE_STEPS.map((label, index) => {
              const done = index < activeStepIndex;
              const current = index === activeStepIndex;
              return (
                <div
                  key={label}
                  className={`min-w-[4.5rem] flex-1 flex-shrink-0 rounded-lg border px-2 py-2 text-center text-[10px] font-semibold sm:min-w-0 sm:px-3 sm:text-xs ${
                    current
                      ? 'border-brand-500 bg-brand-50 text-brand-800'
                      : done
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-surface-border bg-surface-muted text-ink-muted'
                  }`}
                >
                  {done ? <CheckCircle2 className="mx-auto mb-1 h-4 w-4" /> : null}
                  {label}
                </div>
              );
            })}
          </nav>

          {pageError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="mr-2 inline h-4 w-4" />
              {pageError}
            </div>
          )}

          {activeStepIndex === 0 && (
            <section className="rounded-2xl border border-surface-border bg-surface-elevated p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-ink-primary">Step 1 - Property type</h2>
              <p className="mt-1 text-sm text-ink-muted">Choose one. Questions in step 3 depend on this.</p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {TYPE_CARDS.map((card) => (
                  <button
                    key={card.type}
                    type="button"
                    disabled={isSaving}
                    onClick={() => void selectPropertyType(card.type)}
                    className={`flex flex-col items-center gap-3 rounded-xl border-2 p-6 text-center transition-colors hover:border-brand-400 hover:bg-brand-50 ${
                      formValues.property_type === card.type
                        ? 'border-brand-500 bg-brand-50'
                        : 'border-surface-border'
                    }`}
                  >
                    <span className="text-brand-700">{card.icon}</span>
                    <span className="font-semibold text-ink-primary">{card.label}</span>
                    <span className="text-xs text-ink-muted">{card.description}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {activeStepIndex === 1 && (
            <section className="rounded-2xl border border-surface-border bg-surface-elevated p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-ink-primary">Step 2 - Upload brochure</h2>
              <p className="mt-1 text-sm text-ink-muted">
                PDF, images, or CRM spreadsheet. We extract facts automatically - {SUPPORTED_FILE_LABELS.join(', ')}.
              </p>
              <PropertyImportBatchProgress
                draftData={draft?.draftData}
                unitsCount={unitsCount}
                extractionStatus={draft?.extractionStatus}
                draftStatus={draft?.status}
                isPublishing={isPublishing}
              />
              {draft?.extractionStatus === 'extracted' ? (
                <p className="mt-3 flex items-center gap-2 text-sm text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  Extraction complete ({draft.mediaAssets?.length ?? 0} file(s)
                  {unitsCount > 0 ? `, ${unitsCount} unit(s)` : ''})
                </p>
              ) : draft?.extractionStatus === 'queued' || draft?.extractionStatus === 'processing' || draft?.status === 'extracting' ? (
                <p className="mt-3 flex items-center gap-2 text-sm text-brand-800">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Extracting brochure...
                </p>
              ) : null}

              <div
                className="mt-4 rounded-xl border-2 border-dashed border-surface-border bg-surface-muted p-8 text-center"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void processFiles(Array.from(e.dataTransfer.files));
                }}
              >
                <Upload className="mx-auto h-10 w-10 text-brand-600" />
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {isUploading ? 'Uploading...' : 'Choose files'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={PROPERTY_IMPORT_SUPPORTED_MIME_TYPES.join(',')}
                  className="hidden"
                  onChange={(e) => {
                    void processFiles(Array.from(e.target.files || []));
                    e.target.value = '';
                  }}
                />
              </div>

              {uploadItems.length > 0 && (
                <ul className="mt-4 space-y-2 text-sm text-ink-secondary">
                  {uploadItems.map((item) => (
                    <li key={item.id}>
                      {item.fileName} - {item.status}
                      {item.error ? ` (${item.error})` : ''}
                    </li>
                  ))}
                </ul>
              )}

              <label className="mt-4 block text-sm font-medium text-ink-secondary">
                Project name
                <input
                  value={formValues.name}
                  onChange={(e) => setFormValues((f) => ({ ...f, name: e.target.value }))}
                  onBlur={() => void persistDraft()}
                  className="mt-1 w-full rounded-lg border border-surface-border-strong px-3 py-2 text-sm"
                  placeholder="From brochure or type here"
                />
              </label>

              {draft?.id && (
                <PropertyImportSpreadsheetPanel
                  draftId={draft.id}
                  projectName={formValues.name}
                  propertyType={formValues.property_type}
                  disabled={isUploading || isSaving}
                  onImported={(next) => applyDraftUpdate(next)}
                  onError={(message) => setPageError(message)}
                />
              )}

              {unitsCount > 1 && (
                <div className="mt-4">
                  <PropertyUnitConfigurationEditor
                    propertyType={formValues.property_type}
                    rows={formValues.unit_configurations}
                    singleUnitMode={formValues.single_unit_mode}
                    bedrooms={formValues.bedrooms}
                    disabled={isSaving}
                    onRowsChange={(rows) => setFormValues((f) => ({ ...f, unit_configurations: rows }))}
                    onSingleUnitModeChange={(enabled) => setFormValues((f) => ({ ...f, single_unit_mode: enabled }))}
                    onBedroomsChange={(value) => setFormValues((f) => ({ ...f, bedrooms: value }))}
                  />
                </div>
              )}
            </section>
          )}

          {activeStepIndex === 2 && mappingReview.status === 'needs_review' && (
            <section className="rounded-2xl border border-surface-border bg-surface-elevated p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-ink-primary">Step 3 - Review extraction</h2>
              <p className="mt-1 text-sm text-ink-muted">
                Confirm AI-extracted fields before knowledge questions.
              </p>
              <PropertyImportMappingReview
                formValues={formValues}
                draftData={draft?.draftData}
                disabled={isSaving}
                onConfirm={() => void handleConfirmMapping()}
                onFieldChange={handleMappingFieldChange}
              />
              {unitsCount > 0 && (
                <p className="mt-4 text-sm text-brand-800">
                  {unitsCount} villa(s) / unit(s) loaded from brochure or spreadsheet.
                </p>
              )}
            </section>
          )}

          {activeStepIndex === 3 && publishReadiness.missingQuestions.length > 0 && (
            <section
              ref={knowledgeSectionRef}
              className="investo-card-pad border border-violet-200 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-ink-primary">Step 4 - AI knowledge</h2>
                  <p className="mt-1 text-sm text-ink-muted">
                    Answer what is missing so WhatsApp AI can reply accurately.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void handleDeferKnowledge()}
                  className="text-sm font-medium text-ink-secondary underline hover:text-ink-primary disabled:opacity-50"
                >
                  Finish later
                </button>
              </div>
              <div className="mt-4">
                {publishReadiness.missingQuestions.length > 0 && (
                  <p className="mb-3 text-xs text-violet-800">
                    {publishReadiness.missingQuestions.length} question(s) remaining for WhatsApp AI.
                  </p>
                )}
                <PropertyImportKnowledgeWizard
                  key={`knowledge-${draft?.id ?? 'new'}-${formValues.property_type}-${publishReadiness.missingQuestions.map((q) => q.id).join('-')}`}
                  inline
                  questions={publishReadiness.missingQuestions}
                  formValues={formValues}
                  draftData={draft?.draftData}
                  onComplete={(next) => {
                    handleKnowledgeUpdate(next);
                    void persistDraft(next.formValues, next.draftData).then(() => {
                      const companyId = typeof user?.company_id === 'string' ? user.company_id : '';
                      if (companyId) {
                        clearPropertyKnowledgeGateCache(companyId);
                      }
                    });
                  }}
                  onStepAnswer={(next) => {
                    handleKnowledgeUpdate(next);
                    void persistDraft(next.formValues, next.draftData, { syncFormFromServer: false });
                  }}
                />
              </div>
            </section>
          )}

          {activeStepIndex === 3 && publishReadiness.missingQuestions.length === 0 && draft?.extractionStatus === 'extracted' && (
            <section className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-900">
              <Sparkles className="mr-2 inline h-4 w-4" />
              AI knowledge complete. Ready to go live.
            </section>
          )}

          {activeStepIndex === 4 && draft?.extractionStatus === 'extracted' && (
            <section className="rounded-2xl border border-surface-border bg-surface-elevated p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-ink-primary">Step 5 - Ready to go</h2>
              <PropertyImportBatchProgress
                draftData={draft?.draftData}
                unitsCount={unitsCount}
                extractionStatus={draft?.extractionStatus}
                draftStatus={draft?.status}
                isPublishing={isPublishing}
              />
              {unitsCount > 1 && (
                <p className="mt-2 text-sm text-brand-800">
                  Publishing will create {unitsCount} properties in your catalog.
                </p>
              )}
              <div
                className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                  openAiEmbeddingsReady
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : embeddingHealthFailed
                      ? 'border-red-200 bg-red-50 text-red-800'
                      : 'border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p>
                    {embeddingHealthLoading
                      ? 'Checking OpenAI indexing…'
                      : embeddingHealthMessage(embeddingHealth)}
                  </p>
                  <button
                    type="button"
                    onClick={() => void loadEmbeddingHealth()}
                    className="shrink-0 text-xs font-medium underline"
                  >
                    Recheck
                  </button>
                </div>
              </div>
              {publishReadiness.warnings.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm text-amber-800">
                  {publishReadiness.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              {publishReadiness.blockers.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm text-red-700">
                  {publishReadiness.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                disabled={
                  !publishReadiness.ready
                  || isPublishing
                  || loadingDraft
                  || embeddingHealthLoading
                  || embeddingHealthFailed
                  || !openAiEmbeddingsReady
                }
                onClick={() => void handlePublish()}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 sm:w-auto"
              >
                {isPublishing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                Ready to go
              </button>
              <p className="mt-2 flex items-center gap-1 text-xs text-ink-muted">
                <ShieldCheck className="h-3.5 w-3.5" />
                Publishes to catalog and indexes WhatsApp AI knowledge.
              </p>
            </section>
          )}

          {import.meta.env.DEV && PROPERTY_KNOWLEDGE_TYPES.length > 0 && (
            <p className="text-xs text-ink-faint">Draft: {draft?.id?.slice(0, 8) ?? 'none'}</p>
          )}
        </>
      )}

      {gateReason && (importMode === 'ai' || Boolean(routeDraftId)) && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
          <Sparkles className="mr-2 inline h-4 w-4" />
          {gateReason}
        </div>
      )}

      {importMode === 'bulk' && !routeDraftId && (
        <section className="rounded-2xl border border-surface-border bg-surface-elevated p-6 shadow-sm">
          <BulkCsvImportSection
            defaultPropertyType="apartment"
            onPublishSuccess={() => navigate(dashboardPath('/properties'), { replace: true })}
          />
        </section>
      )}
    </div>
  );
}

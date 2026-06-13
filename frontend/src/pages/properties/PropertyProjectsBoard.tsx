import React, { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FolderPlus,
  GripVertical,
  FileSpreadsheet,
  ImageIcon,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { dashboardPath } from '../../config/navigation.config';
import {
  assignPropertyToProject,
  createPropertyProject,
  deletePropertyProject,
  deletePropertyProjectFile,
  listProjectFiles,
  uploadProjectFile,
  type PropertyProject,
  type PropertyProjectFile,
} from '../../services/propertyProjects';
import type { PropertyImportDraftSummary } from '../../services/propertyImport';
import RemoveCancelButton from '../../components/actions/RemoveCancelButton';
import { stashBulkImportFile } from '../../utils/bulk-import-pending-file';
import useConfirmDialog from '../../hooks/useConfirmDialog';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import PropertyMediaAssignModal from './PropertyMediaAssignModal';

function isSpreadsheetFile(file: File): boolean {
  return (
    /\.(csv|xlsx)$/i.test(file.name) ||
    file.type.includes('csv') ||
    file.type.includes('spreadsheet') ||
    file.type.includes('excel')
  );
}

function isPropertyMediaFile(file: File): boolean {
  return (
    file.type.startsWith('image/') ||
    file.type === 'application/pdf' ||
    /\.(jpe?g|png|webp|pdf)$/i.test(file.name)
  );
}

export interface BoardProperty {
  id: string;
  name: string;
  builder: string | null;
  location_city: string | null;
  location_area: string | null;
  price_min: number | null;
  price_max: number | null;
  bedrooms: number | null;
  property_type: string | null;
  status: string;
  project_id?: string | null;
}

interface PropertyProjectsBoardProps {
  properties: BoardProperty[];
  projects: PropertyProject[];
  unassignedCount: number;
  importDrafts: PropertyImportDraftSummary[];
  canManage: boolean;
  canUpload: boolean;
  formatPrice: (min: number | null, max: number | null) => string;
  onRefresh: () => void;
  onPropertyClick: (p: BoardProperty) => void;
  onEdit: (p: BoardProperty) => void;
  onDelete: (id: string) => void;
  onCancelDraft: (draftId: string, name: string) => void;
  cancellingDraftId: string | null;
  deletingId: string | null;
}

const UNASSIGNED_KEY = '__unassigned__';

export default function PropertyProjectsBoard({
  properties,
  projects,
  unassignedCount,
  importDrafts,
  canManage,
  canUpload,
  formatPrice,
  onRefresh,
  onPropertyClick,
  onEdit,
  onDelete,
  onCancelDraft,
  cancellingDraftId,
  deletingId,
}: PropertyProjectsBoardProps) {
  const navigate = useNavigate();
  const { confirm, Dialog } = useConfirmDialog();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [dragPropertyId, setDragPropertyId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [projectFiles, setProjectFiles] = useState<Record<string, PropertyProjectFile[]>>({});
  const [uploadingFile, setUploadingFile] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetProject, setUploadTargetProject] = useState<string | null>(null);
  const [mediaAssignState, setMediaAssignState] = useState<{
    projectId: string;
    projectName: string;
    file: File;
  } | null>(null);
  const [uploadNotice, setUploadNotice] = useState<Record<string, string>>({});
  const [boardError, setBoardError] = useState<string | null>(null);

  const byProject = useCallback(
    (projectId: string | null) =>
      properties.filter((p) => (projectId ? p.project_id === projectId : !p.project_id)),
    [properties],
  );

  const draftsByProject = useCallback(
    (projectId: string | null) =>
      importDrafts.filter((d) =>
        projectId ? d.project_id === projectId : !d.project_id,
      ),
    [importDrafts],
  );

  const handleCreateProject = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      setBoardError(null);
      await createPropertyProject({ name });
      setNewName('');
      onRefresh();
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string } } };
      setBoardError(getApiErrorMessage(ax, 'Failed to create project'));
    } finally {
      setCreating(false);
    }
  };

  const handleDrop = async (targetKey: string) => {
    if (!dragPropertyId || !canManage) return;
    const projectId = targetKey === UNASSIGNED_KEY ? null : targetKey;
    setAssigning(true);
    try {
      setBoardError(null);
      await assignPropertyToProject(dragPropertyId, projectId);
      onRefresh();
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string } } };
      setBoardError(getApiErrorMessage(ax, 'Failed to move property'));
    } finally {
      setAssigning(false);
      setDragPropertyId(null);
      setDropTarget(null);
    }
  };

  const loadFiles = async (projectId: string) => {
    try {
      const files = await listProjectFiles(projectId);
      setProjectFiles((prev) => ({ ...prev, [projectId]: files }));
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string } } };
      setUploadNotice((prev) => ({
        ...prev,
        [projectId]: getApiErrorMessage(ax, 'Could not load attached files.'),
      }));
      setProjectFiles((prev) => ({ ...prev, [projectId]: [] }));
    }
  };

  const toggleProject = (projectId: string) => {
    setExpandedProject((cur) => (cur === projectId ? null : projectId));
    if (!projectFiles[projectId]) void loadFiles(projectId);
  };

  const handleFilePick = (projectId: string) => {
    setUploadTargetProject(projectId);
    fileInputRef.current?.click();
  };

  const handleMediaPick = (projectId: string) => {
    setUploadTargetProject(projectId);
    mediaInputRef.current?.click();
  };

  const onMediaSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const projectId = uploadTargetProject;
    e.target.value = '';
    setUploadTargetProject(null);
    if (!file || !projectId) return;

    const project = projects.find((p) => p.id === projectId);
    if (!isPropertyMediaFile(file)) {
      setBoardError('Use JPEG, PNG, WebP for screenshots or PDF for brochures.');
      return;
    }

    setBoardError(null);
    setMediaAssignState({
      projectId,
      projectName: project?.name ?? 'Project',
      file,
    });
  };

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const projectId = uploadTargetProject;
    e.target.value = '';
    if (!file || !projectId) return;

    const project = projects.find((p) => p.id === projectId);

    if (isSpreadsheetFile(file)) {
      setUploadingFile(projectId);
      try {
        await stashBulkImportFile(file, {
          projectId,
          projectName: project?.name,
        });
        const q = new URLSearchParams({
          projectId,
          autoBulk: '1',
          ...(project?.name ? { projectName: project.name } : {}),
        });
        navigate(dashboardPath(`/properties/import?${q.toString()}`));
      } catch {
        setBoardError('Could not open the import wizard. Use Import here and upload the same file.');
      } finally {
        setUploadingFile(null);
        setUploadTargetProject(null);
      }
      return;
    }

    setUploadingFile(projectId);
    try {
      setBoardError(null);
      await uploadProjectFile(projectId, file);
      setExpandedProject(projectId);
      setUploadNotice((prev) => ({
        ...prev,
        [projectId]: `"${file.name}" attached under Files (reference only — use Import here to create listings).`,
      }));
      await loadFiles(projectId);
      onRefresh();
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string } } };
      setBoardError(getApiErrorMessage(ax, 'Failed to upload file'));
    } finally {
      setUploadingFile(null);
      setUploadTargetProject(null);
    }
  };

  const renderPropertyCard = (property: BoardProperty) => (
    <div
      key={property.id}
      draggable={canManage}
      onDragStart={() => setDragPropertyId(property.id)}
      onDragEnd={() => setDragPropertyId(null)}
      onClick={() => onPropertyClick(property)}
      className={`rounded-lg border bg-white p-3 shadow-sm transition-shadow hover:shadow-md ${
        dragPropertyId === property.id ? 'opacity-50' : ''
      } ${canManage ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
    >
      <div className="flex items-start gap-2">
        {canManage && <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink-primary">{property.name}</p>
          <p className="text-xs text-ink-muted">{formatPrice(property.price_min, property.price_max)}</p>
          <p className="text-xs text-ink-faint capitalize">
            {[property.bedrooms ? `${property.bedrooms} BHK` : null, property.property_type]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-1" onClick={(ev) => ev.stopPropagation()}>
            <button
              type="button"
              onClick={() => onEdit(property)}
              className="rounded p-1 text-xs text-brand-700 hover:bg-brand-50"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(property.id)}
              disabled={deletingId === property.id}
              className="rounded p-1 text-xs text-red-600 hover:bg-red-50"
            >
              {deletingId === property.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Del'}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const renderDropZone = (
    key: string,
    title: string,
    subtitle: string,
    children: React.ReactNode,
    headerActions?: React.ReactNode,
  ) => {
    const isOver = dropTarget === key;
    return (
      <section
        onDragOver={(e) => {
          e.preventDefault();
          setDropTarget(key);
        }}
        onDragLeave={() => setDropTarget((t) => (t === key ? null : t))}
        onDrop={(e) => {
          e.preventDefault();
          void handleDrop(key);
        }}
        className={`rounded-xl border-2 border-dashed p-4 transition-colors ${
          isOver ? 'border-brand-500 bg-brand-50/50' : 'border-surface-border bg-surface-elevated/60'
        }`}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-ink-primary">{title}</h3>
            <p className="text-xs text-ink-muted">{subtitle}</p>
          </div>
          {headerActions}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
      </section>
    );
  };

  const sections: Array<{ key: string; project: PropertyProject | null }> = [
    { key: UNASSIGNED_KEY, project: null },
    ...projects.map((p) => ({ key: p.id, project: p })),
  ];

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => void onFileSelected(e)}
      />
      <input
        ref={mediaInputRef}
        type="file"
        className="hidden"
        accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
        onChange={onMediaSelected}
      />

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-border bg-white p-3">
          <FolderPlus className="h-5 w-5 text-brand-600" />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New project name (e.g. Palm Villas Phase 2)"
            className="min-w-[200px] flex-1 rounded-lg border px-3 py-2 text-sm"
            onKeyDown={(e) => e.key === 'Enter' && void handleCreateProject()}
          />
          <button
            type="button"
            onClick={() => void handleCreateProject()}
            disabled={creating || !newName.trim()}
            className="investo-btn-primary text-sm"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create project
          </button>
        </div>
      )}

      {boardError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {boardError}
        </div>
      )}

      {assigning && (
        <p className="text-sm text-brand-700 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Moving property…
        </p>
      )}

      {sections.map(({ key, project }) => {
        const propsInZone = byProject(project?.id ?? null);
        const draftsInZone = draftsByProject(project?.id ?? null);
        const count = project ? project.property_count : unassignedCount;

        const headerActions = canUpload ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                navigate(
                  dashboardPath(
                    project
                      ? `/properties/import?projectId=${project.id}`
                      : '/properties/import',
                  ),
                )
              }
              className="investo-btn-secondary text-xs"
            >
              <Upload className="h-3.5 w-3.5" /> Import here
            </button>
            {project && canManage && (
              <>
                <button
                  type="button"
                  onClick={() => handleFilePick(project.id)}
                  disabled={uploadingFile === project.id}
                  className="investo-btn-secondary text-xs"
                >
                  {uploadingFile === project.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                  )}
                  Import CSV
                </button>
                <button
                  type="button"
                  onClick={() => handleMediaPick(project.id)}
                  className="investo-btn-secondary text-xs"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  Screenshot / brochure
                </button>
                <button
                  type="button"
                  onClick={() => toggleProject(project.id)}
                  className="text-xs text-ink-muted underline"
                >
                  {expandedProject === project.id ? 'Hide files' : 'Files'}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const confirmed = await confirm(
                      'Delete project?',
                      `Delete "${project.name}"? Properties will move to Unassigned.`,
                      { confirmLabel: 'Delete' },
                    );
                    if (!confirmed) return;
                    try {
                      setBoardError(null);
                      await deletePropertyProject(project.id);
                      onRefresh();
                    } catch (err: unknown) {
                      const ax = err as { response?: { data?: { error?: string } } };
                      setBoardError(getApiErrorMessage(ax, 'Failed to delete project'));
                    }
                  }}
                  className="rounded p-1.5 text-red-600 hover:bg-red-50"
                  title="Delete project"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        ) : undefined;

        return (
          <div key={key}>
            {renderDropZone(
              key,
              project ? project.name : 'Unassigned',
              project
                ? `${count} propert${count === 1 ? 'y' : 'ies'} · drag listings here`
                : `${count} not in any project · drag here to unassign`,
              <>
                {draftsInZone.map((draft) => (
                  <div
                    key={draft.id}
                    className="rounded-lg border border-violet-200 bg-violet-50/80 p-3 text-sm"
                  >
                    <button
                      type="button"
                      className="w-full text-left font-medium text-violet-900"
                      onClick={() => navigate(dashboardPath(`/properties/import/${draft.id}`))}
                    >
                      Draft: {draft.name}
                    </button>
                    {canUpload && (
                      <RemoveCancelButton
                        variant="delete"
                        label="Remove"
                        loading={cancellingDraftId === draft.id}
                        onClick={() => onCancelDraft(draft.id, draft.name)}
                      />
                    )}
                  </div>
                ))}
                {propsInZone.length === 0 && draftsInZone.length === 0 ? (
                  <p className="col-span-full py-6 text-center text-sm text-ink-faint">
                    {canManage ? 'Drop properties here or import into this project' : 'Empty'}
                  </p>
                ) : (
                  propsInZone.map(renderPropertyCard)
                )}
              </>,
              headerActions,
            )}
            {project && uploadNotice[project.id] && (
              <p className="mt-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">
                {uploadNotice[project.id]}
              </p>
            )}
            {project && expandedProject === project.id && (
              <ul className="mt-2 space-y-1 rounded-lg border bg-white p-3 text-sm">
                {(projectFiles[project.id] ?? []).length === 0 ? (
                  <li className="text-ink-faint">No extra files yet. Upload CSV or Excel reference sheets.</li>
                ) : (
                  projectFiles[project.id].map((f) => (
                    <li key={f.id} className="flex justify-between items-center gap-2">
                      <span>{f.file_name}</span>
                      <span className="flex items-center gap-2 text-xs text-ink-faint">
                        {f.file_size ? `${Math.round(f.file_size / 1024)} KB` : ''}
                        {canManage && (
                          <button
                            type="button"
                            className="p-1 text-red-600 hover:bg-red-50 rounded"
                            title="Delete file"
                            onClick={async () => {
                              const confirmed = await confirm(
                                'Delete file?',
                                `Delete "${f.file_name}" from this project?`,
                                { confirmLabel: 'Delete' },
                              );
                              if (!confirmed) return;
                              try {
                                await deletePropertyProjectFile(project.id, f.id);
                                setProjectFiles((prev) => ({
                                  ...prev,
                                  [project.id]: (prev[project.id] ?? []).filter(
                                    (row) => row.id !== f.id,
                                  ),
                                }));
                              } catch (err: unknown) {
                                const ax = err as { response?: { data?: { error?: string } } };
                                setBoardError(getApiErrorMessage(ax, 'Failed to delete file'));
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
        );
      })}
      <PropertyMediaAssignModal
        open={mediaAssignState !== null}
        projectId={mediaAssignState?.projectId ?? ''}
        projectName={mediaAssignState?.projectName ?? ''}
        file={mediaAssignState?.file ?? null}
        properties={
          mediaAssignState
            ? byProject(mediaAssignState.projectId).map((p) => ({
                id: p.id,
                name: p.name,
                property_type: p.property_type,
                bedrooms: p.bedrooms,
              }))
            : []
        }
        onClose={() => setMediaAssignState(null)}
        onSuccess={(message) => {
          if (mediaAssignState) {
            setUploadNotice((prev) => ({
              ...prev,
              [mediaAssignState.projectId]: message,
            }));
          }
          onRefresh();
        }}
      />
      {Dialog}
    </div>
  );
}

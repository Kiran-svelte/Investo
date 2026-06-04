const BULK_IMPORT_PENDING_KEY = 'investo_bulk_import_pending';

export interface BulkImportPendingMeta {
  projectId?: string;
  projectName?: string;
}

/** Stash a spreadsheet in sessionStorage so the bulk import wizard can pick it up. */
export function stashBulkImportFile(file: File, meta: BulkImportPendingMeta = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
      sessionStorage.setItem(
        BULK_IMPORT_PENDING_KEY,
        JSON.stringify({
          ...meta,
          name: file.name,
          type: file.type || (file.name.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv'),
          base64,
        }),
      );
      resolve();
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/** Read and clear stashed spreadsheet for auto-upload in bulk import wizard. */
export function takeBulkImportPendingFile(): (BulkImportPendingMeta & { file: File }) | null {
  const raw = sessionStorage.getItem(BULK_IMPORT_PENDING_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(BULK_IMPORT_PENDING_KEY);
  try {
    const parsed = JSON.parse(raw) as {
      name: string;
      type: string;
      base64: string;
      projectId?: string;
      projectName?: string;
    };
    const bin = atob(parsed.base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], parsed.name, { type: parsed.type || 'text/csv' });
    return {
      file,
      projectId: parsed.projectId,
      projectName: parsed.projectName,
    };
  } catch {
    return null;
  }
}

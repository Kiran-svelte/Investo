import axios from 'axios';
import api from '../services/api';

export interface GreetingMediaItem {
  id: string;
  kind: 'image' | 'document';
  url: string;
  mimeType: string;
  fileName?: string;
  caption?: string;
}

const MAX_GREETING_MEDIA = 2;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const BROCHURE_MIMES = new Set(['application/pdf']);

export function inferGreetingAssetType(file: File): 'image' | 'brochure' | null {
  if (IMAGE_MIMES.has(file.type)) return 'image';
  if (BROCHURE_MIMES.has(file.type)) return 'brochure';
  return null;
}

export function canAddGreetingMedia(currentCount: number): boolean {
  return currentCount < MAX_GREETING_MEDIA;
}

export async function uploadGreetingMediaFile(file: File): Promise<GreetingMediaItem> {
  const assetType = inferGreetingAssetType(file);
  if (!assetType) {
    throw new Error('Use JPG, PNG, WebP, or PDF only');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('File must be 20 MB or smaller');
  }

  const registerRes = await api.post('/ai-settings/greeting-media/upload-url', {
    file_name: file.name,
    mime_type: file.type,
    file_size: file.size,
    asset_type: assetType,
  });

  const upload = registerRes.data?.data;
  if (!upload?.uploadUrl || !upload?.publicUrl) {
    throw new Error('Upload registration failed');
  }

  await axios.put(upload.uploadUrl, file, {
    headers: { 'Content-Type': upload.contentType || file.type },
  });

  return {
    id: crypto.randomUUID(),
    kind: assetType === 'brochure' ? 'document' : 'image',
    url: upload.publicUrl,
    mimeType: file.type,
    fileName: file.name,
  };
}

export async function testGreetingMedia(items?: GreetingMediaItem[]): Promise<{
  success: boolean;
  items: Array<{ id: string; url: string; ok: boolean; status: number; kind: string; error?: string }>;
}> {
  const response = await api.post('/ai-settings/greeting-media/test', items ? { items } : {});
  return response.data;
}

import type { WhatsAppComponent } from '../types/whatsapp-turn.types';

export type GreetingMediaItem = {
  id: string;
  kind: 'image' | 'document';
  url: string;
  mimeType: string;
  fileName?: string;
  caption?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeKind(value: unknown, mimeType: string): 'image' | 'document' | null {
  if (value === 'image' || value === 'document') return value;
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'document';
  return null;
}

/** Parse persisted greeting media JSON from ai_settings. */
export function parseGreetingMediaItems(raw: unknown): GreetingMediaItem[] {
  if (!Array.isArray(raw)) return [];

  const items: GreetingMediaItem[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    const url = typeof entry.url === 'string' ? entry.url.trim() : '';
    const mimeType = typeof entry.mimeType === 'string'
      ? entry.mimeType.trim()
      : typeof entry.mime_type === 'string'
        ? entry.mime_type.trim()
        : '';
    if (!url.startsWith('https://') || !mimeType) continue;

    const kind = normalizeKind(entry.kind, mimeType);
    if (!kind) continue;

    const id = typeof entry.id === 'string' && entry.id.trim()
      ? entry.id.trim()
      : url;

    items.push({
      id,
      kind,
      url,
      mimeType,
      fileName: typeof entry.fileName === 'string' ? entry.fileName : undefined,
      caption: typeof entry.caption === 'string' ? entry.caption : undefined,
    });
  }

  return items.slice(0, 2);
}

/** Brochure first, then hero image — matches buyer turn media priority. */
export function buildGreetingMediaComponents(raw: unknown): WhatsAppComponent[] {
  const parsed = parseGreetingMediaItems(raw);
  if (!parsed.length) return [];

  const sorted = [...parsed].sort((a, b) => {
    if (a.kind === 'document' && b.kind !== 'document') return -1;
    if (b.kind === 'document' && a.kind !== 'document') return 1;
    return 0;
  });

  return sorted.slice(0, 2).map((item) => ({
    kind: 'media' as const,
    url: item.url,
    mime: item.mimeType,
    caption: item.caption,
  }));
}

export function shouldAttachGreetingMedia(input: {
  isReturning: boolean;
  hasActiveVisit: boolean;
  greetingMedia: unknown;
}): boolean {
  void input.isReturning;
  if (input.hasActiveVisit) return false;
  return parseGreetingMediaItems(input.greetingMedia).length > 0;
}

export function mergeGreetingMediaComponents(
  greetingMedia: unknown,
  components: WhatsAppComponent[],
  options: { isReturning: boolean; hasActiveVisit: boolean },
): WhatsAppComponent[] {
  if (!shouldAttachGreetingMedia({ ...options, greetingMedia })) {
    return components;
  }
  return [...buildGreetingMediaComponents(greetingMedia), ...components];
}

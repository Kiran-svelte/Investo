/** Coerce unknown API payloads to arrays — prevents `.length` / `.map` render crashes. */
export function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

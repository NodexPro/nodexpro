/** PostgREST / Supabase client may type embedded relations as T or T[]; normalize to one row. */
export function supabaseEmbedOne<T>(rel: T | T[] | null | undefined): T | null {
  if (rel == null) return null;
  return Array.isArray(rel) ? rel[0] ?? null : rel;
}

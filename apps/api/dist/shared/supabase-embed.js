/** PostgREST / Supabase client may type embedded relations as T or T[]; normalize to one row. */
export function supabaseEmbedOne(rel) {
    if (rel == null)
        return null;
    return Array.isArray(rel) ? rel[0] ?? null : rel;
}

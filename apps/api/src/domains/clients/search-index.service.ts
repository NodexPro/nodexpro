import { supabaseAdmin } from '../../db/client.js';

const ENTITY_TYPE_CLIENT = 'client';

/**
 * Build normalized search text: lowercase, collapse spaces, no special chars.
 */
export function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build searchable text for a client (display_name, legal_name, tax_id, external_code, email, phone).
 * Sensitive fields included for indexing; access to raw data still gated by permissions.
 */
export function buildClientSearchText(client: {
  display_name: string;
  legal_name?: string | null;
  tax_id: string;
  external_code?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
}): string {
  const parts = [
    client.display_name,
    client.legal_name ?? '',
    client.tax_id,
    client.external_code ?? '',
    client.email ?? '',
    client.phone ?? '',
    client.website ?? '',
  ].filter(Boolean);
  return parts.join(' ');
}

/**
 * Upsert entity_search_index for a client. Sync strategy: called from service layer on create/update/archive.
 */
export async function upsertClientSearchIndex(
  organizationId: string,
  clientId: string,
  searchText: string
): Promise<void> {
  const normalized = normalizeSearchText(searchText);
  await supabaseAdmin
    .from('entity_search_index')
    .upsert(
      {
        organization_id: organizationId,
        entity_type: ENTITY_TYPE_CLIENT,
        entity_id: clientId,
        search_text: searchText,
        normalized_search_text: normalized,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,entity_type,entity_id' }
    );
}

/**
 * Add contact text to search index for client (append to existing or create).
 * Call after contact add/update; we re-build client + all contacts text.
 */
export async function refreshClientSearchIndexWithContacts(
  organizationId: string,
  clientId: string,
  clientSearchText: string,
  contactTexts: string[]
): Promise<void> {
  const combined = [clientSearchText, ...contactTexts].filter(Boolean).join(' ');
  await upsertClientSearchIndex(organizationId, clientId, combined);
}

/**
 * Tenant-bound search. Returns entity_type + entity_id for matching clients.
 * Archived clients excluded by default (caller filters or we add is_archived join).
 */
export async function searchClients(
  organizationId: string,
  query: string,
  options: { includeArchived?: boolean } = {}
): Promise<{ entityId: string }[]> {
  const norm = normalizeSearchText(query);
  if (!norm) return [];

  let q = supabaseAdmin
    .from('entity_search_index')
    .select('entity_id')
    .eq('organization_id', organizationId)
    .eq('entity_type', ENTITY_TYPE_CLIENT)
    .ilike('normalized_search_text', `%${norm}%`);

  if (!options.includeArchived) {
    const { data: clientIds } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('is_archived', false);
    const ids = (clientIds ?? []).map((c: { id: string }) => c.id);
    if (ids.length === 0) return [];
    q = q.in('entity_id', ids);
  }

  const { data } = await q.limit(50);
  return (data ?? []).map((r: { entity_id: string }) => ({ entityId: r.entity_id }));
}

/**
 * Search clients and return full client rows in one query (avoids N+1).
 */
export async function searchClientsWithData(
  organizationId: string,
  query: string,
  options: { includeArchived?: boolean; includeSensitive?: boolean } = {}
): Promise<Record<string, unknown>[]> {
  const entityIds = await searchClients(organizationId, query, { includeArchived: options.includeArchived });
  if (entityIds.length === 0) return [];

  const ids = entityIds.map((e) => e.entityId);
  // tax_id visible to all clients:read (Owner/Admin/Staff/Viewer)
  const selectCols = 'id, tax_id, client_type, display_name, legal_name, status, lifecycle_state, is_archived, created_at';

  const { data } = await supabaseAdmin
    .from('clients')
    .select(selectCols)
    .eq('organization_id', organizationId)
    .in('id', ids);

  return (data ?? []) as unknown as Record<string, unknown>[];
}

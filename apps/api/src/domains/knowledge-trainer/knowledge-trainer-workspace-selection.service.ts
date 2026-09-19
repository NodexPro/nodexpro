import { supabaseAdmin } from '../../db/client.js';
import { isSupabaseMissingTableError } from '../../shared/supabase-errors.js';
import { badRequest } from '../../shared/errors.js';

const TABLE = 'legal_ingestion_owner_workspace_selection';

function throwIfWorkspaceSchemaMissing(error: unknown): void {
  if (error && isSupabaseMissingTableError(error)) {
    throw badRequest('Owner workspace selection schema is not applied. Migration 645 is required on DEV.');
  }
}

export async function loadOwnerWorkspaceSelectedDocumentId(countryCode: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('selected_document_id')
    .eq('country_code', countryCode)
    .maybeSingle();
  if (error && isSupabaseMissingTableError(error)) return null;
  if (error) throw error;
  const id = data?.selected_document_id ? String(data.selected_document_id) : '';
  return id || null;
}

export async function persistOwnerWorkspaceSelectedDocument(params: {
  countryCode: string;
  documentId: string;
  actorUserId: string;
}): Promise<void> {
  const { error } = await supabaseAdmin.from(TABLE).upsert(
    {
      country_code: params.countryCode,
      selected_document_id: params.documentId,
      updated_by: params.actorUserId,
    },
    { onConflict: 'country_code' },
  );
  throwIfWorkspaceSchemaMissing(error);
  if (error) throw error;
}

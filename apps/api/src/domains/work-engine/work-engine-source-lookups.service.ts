/**
 * Work Engine-owned lookups for other modules.
 * Callers must not query work_items directly.
 */
import { supabaseAdmin } from '../../db/client.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';

export const INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE = 'invoice_collection_followup';

export async function loadWorkItemClientIdsForOrg(
  orgId: string,
  workItemIds: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!workItemIds.length) return out;
  const { data, error } = await supabaseAdmin
    .from('work_items')
    .select('id, client_id')
    .eq('org_id', orgId)
    .in('id', workItemIds);
  throwIfSupabaseError(error, 'workEngineLoadWorkItemClientIds');
  for (const r of data ?? []) {
    const row = r as { id: string; client_id?: string | null };
    out.set(String(row.id), row.client_id ?? null);
  }
  return out;
}

export async function loadActiveCollectionWorkItemForSource(params: {
  orgId: string;
  moduleKey: string;
  sourceEntityType: string;
  sourceEntityId: string;
  workType?: string;
}): Promise<{ work_item_id: string; work_state: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('work_items')
    .select('id, work_state')
    .eq('org_id', params.orgId)
    .eq('module_key', params.moduleKey)
    .eq('work_type', params.workType ?? INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE)
    .eq('source_entity_type', params.sourceEntityType)
    .eq('source_entity_id', params.sourceEntityId)
    .not('work_state', 'in', '(done,archived)')
    .order('updated_at', { ascending: false })
    .limit(1);
  throwIfSupabaseError(error, 'workEngineLoadActiveCollectionWorkItem');
  const row = data?.[0] as { id?: string; work_state?: string } | undefined;
  if (!row?.id) return null;
  return { work_item_id: String(row.id), work_state: String(row.work_state ?? '') };
}

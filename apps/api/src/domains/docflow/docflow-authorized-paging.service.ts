import { supabaseAdmin } from '../../db/client.js';
import {
  chunkIds,
  type AuthorizedInboxClient,
  type AuthorizedTaskThread,
} from './docflow-authorized-paging.pure.js';

/** Clients of the Stage 5.1 allow-list only (org-scoped, non-archived). Bounded by the grant list. */
export async function loadAuthorizedInboxClients(
  orgId: string,
  allowedClientIds: readonly string[],
): Promise<AuthorizedInboxClient[]> {
  const out: AuthorizedInboxClient[] = [];
  for (const chunk of chunkIds(allowedClientIds, 100)) {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('id, display_name, status, phone, email')
      .eq('organization_id', orgId)
      .eq('is_archived', false)
      .in('id', chunk);
    if (error) throw error;
    for (const r of data ?? []) {
      const row = r as Record<string, unknown>;
      out.push({
        client_id: String(row.id),
        display_name: row.display_name == null ? null : String(row.display_name),
        status: row.status == null ? null : String(row.status),
        phone: row.phone == null ? null : String(row.phone),
        email: row.email == null ? null : String(row.email),
      });
    }
  }
  return out;
}

/** Threads of authorized clients only. */
export async function loadAuthorizedThreads(
  orgId: string,
  allowedClientIds: readonly string[],
): Promise<AuthorizedTaskThread[]> {
  const out: AuthorizedTaskThread[] = [];
  for (const chunk of chunkIds(allowedClientIds, 100)) {
    const { data, error } = await supabaseAdmin
      .from('client_message_threads')
      .select('id, client_id, module_key, thread_type, thread_status, deadline_at, assigned_user_id, updated_at')
      .eq('org_id', orgId)
      .in('client_id', chunk);
    if (error) throw error;
    for (const r of data ?? []) {
      const row = r as Record<string, unknown>;
      out.push({
        thread_id: String(row.id),
        client_id: String(row.client_id),
        module_key: String(row.module_key ?? ''),
        thread_type: String(row.thread_type ?? ''),
        thread_status: String(row.thread_status ?? ''),
        deadline_at: row.deadline_at == null ? null : String(row.deadline_at),
        assigned_user_id: row.assigned_user_id == null ? null : String(row.assigned_user_id),
        updated_at: row.updated_at == null ? null : String(row.updated_at),
      });
    }
  }
  return out;
}

export function activityByClientFromThreads(threads: readonly AuthorizedTaskThread[]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const t of threads) {
    const prev = map.get(t.client_id) ?? null;
    if (t.updated_at && (!prev || new Date(t.updated_at).getTime() > new Date(prev).getTime())) {
      map.set(t.client_id, t.updated_at);
    } else if (!map.has(t.client_id)) {
      map.set(t.client_id, prev);
    }
  }
  return map;
}

/** Unread office messages per authorized client (same SQL as the office KPI). */
export async function loadAuthorizedUnreadTotal(orgId: string, allowedClientIds: readonly string[]): Promise<number> {
  let total = 0;
  for (const chunk of chunkIds(allowedClientIds, 100)) {
    const { data, error } = await supabaseAdmin.rpc('docflow_office_unread_messages_for_clients', {
      p_org_id: orgId,
      p_client_ids: chunk,
    });
    if (error) throw error;
    for (const row of data ?? []) total += Number((row as { unread_count?: number | string }).unread_count) || 0;
  }
  return total;
}

/** Draft counts over authorized clients only (same status semantics as the office KPI RPC). */
export async function loadAuthorizedDraftCounts(
  orgId: string,
  allowedClientIds: readonly string[],
): Promise<{ drafts: number; pending: number }> {
  let drafts = 0;
  let pending = 0;
  for (const chunk of chunkIds(allowedClientIds, 100)) {
    const { data, error } = await supabaseAdmin
      .from('communication_draft_messages')
      .select('status')
      .eq('org_id', orgId)
      .in('status', ['draft', 'approved'])
      .in('client_id', chunk);
    if (error) throw error;
    for (const r of data ?? []) {
      const st = String((r as { status?: string }).status ?? '');
      if (st === 'draft') drafts += 1;
      pending += 1;
    }
  }
  return { drafts, pending };
}

/** Widget drafts: allow-list applied in the query BEFORE ordering/limit, merged across chunks. */
export async function loadAuthorizedWidgetDraftRows(
  orgId: string,
  allowedClientIds: readonly string[],
  limit: number,
): Promise<Record<string, unknown>[]> {
  const merged: Record<string, unknown>[] = [];
  for (const chunk of chunkIds(allowedClientIds, 100)) {
    const { data, error } = await supabaseAdmin
      .from('communication_draft_messages')
      .select('*')
      .eq('org_id', orgId)
      .in('status', ['draft', 'approved'])
      .in('client_id', chunk)
      .order('generated_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    merged.push(...((data ?? []) as Record<string, unknown>[]));
  }
  merged.sort((a, b) => {
    const ta = new Date(String(a.generated_at ?? 0)).getTime() || 0;
    const tb = new Date(String(b.generated_at ?? 0)).getTime() || 0;
    return tb - ta;
  });
  return merged.slice(0, limit);
}

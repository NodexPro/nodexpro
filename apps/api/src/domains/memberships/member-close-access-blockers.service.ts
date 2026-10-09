/**
 * Stage 5.6 — operational responsibilities that must be reassigned BEFORE a member's access closes.
 *
 * Closing access never deletes history. It must also never silently orphan live work:
 *  - clients where the member is the responsible handler (client_operational_profiles)
 *  - open ToDos assigned to the member (client_operations_todos, completed_at is null)
 *
 * Reassignment stays in the existing Client Operations commands (assign_client_handler, ToDo
 * reassign). The frontend does not clean anything up.
 */

import { supabaseAdmin } from '../../db/client.js';
import { conflict } from '../../shared/errors.js';
import { hasCloseAccessBlockers, type CloseAccessBlockers } from './users-roles.pure.js';

function chunkIds<T>(ids: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

const HANDLER_ID_PAGE = 1000;
const HANDLER_ID_MAX = 10000;

async function countHandlerClients(orgId: string, userId: string): Promise<number> {
  const ids: string[] = [];
  for (let from = 0; from < HANDLER_ID_MAX; from += HANDLER_ID_PAGE) {
    const { data, error } = await supabaseAdmin
      .from('client_operational_profiles')
      .select('client_id')
      .eq('organization_id', orgId)
      .eq('assigned_handler_user_id', userId)
      .order('client_id', { ascending: true })
      .range(from, from + HANDLER_ID_PAGE - 1);
    if (error) throw new Error(error.message ?? 'Failed to load handler responsibilities');
    const page = (data ?? []).map((row) => String((row as { client_id: string }).client_id));
    ids.push(...page);
    if (page.length < HANDLER_ID_PAGE) break;
  }
  if (ids.length === 0) return 0;
  // Archived clients no longer carry live responsibility.
  let live = 0;
  for (const chunk of chunkIds(ids, 200)) {
    const { count, error } = await supabaseAdmin
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('is_archived', false)
      .in('id', chunk);
    if (error) throw new Error(error.message ?? 'Failed to count handler clients');
    live += count ?? 0;
  }
  return live;
}

async function countOpenTodos(orgId: string, userId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('client_operations_todos')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('assigned_to_user_id', userId)
    .is('completed_at', null);
  if (error) throw new Error(error.message ?? 'Failed to count open ToDos');
  return count ?? 0;
}

export async function loadCloseAccessBlockers(orgId: string, userId: string): Promise<CloseAccessBlockers> {
  const [handler_client_count, open_todo_count] = await Promise.all([
    countHandlerClients(orgId, userId),
    countOpenTodos(orgId, userId),
  ]);
  return { handler_client_count, open_todo_count };
}

/** Backend-owned conflict. Details carry only counts — no client names or task text. */
export async function assertNoCloseAccessBlockers(orgId: string, userId: string): Promise<void> {
  const blockers = await loadCloseAccessBlockers(orgId, userId);
  if (!hasCloseAccessBlockers(blockers)) return;
  throw conflict(
    'This employee still has responsibilities. Reassign their clients and open tasks before closing access.',
    'MEMBER_HAS_ACTIVE_RESPONSIBILITIES',
    { ...blockers },
  );
}

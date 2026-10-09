import { supabaseAdmin } from '../../db/client.js';
import { notFound } from '../../shared/errors.js';
import type { RequestContext } from '../../shared/context.js';
import {
  assertCanAccessClientFromContext,
  authorizedClientIdsForViewer,
} from '../client-operations/organization-client-access.js';
import { type IncomeRequestIds, incomeRequestHasResourceIds } from './income-request-resource-ids.pure.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function representedClientsOf(
  table: 'income_document_drafts' | 'income_documents' | 'income_customers',
  orgId: string,
  ids: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const valid = ids.filter((id) => UUID_RE.test(id));
  if (!valid.length) return out;
  const { data, error } = await supabaseAdmin
    .from(table)
    .select('id, represented_client_id')
    .eq('organization_id', orgId)
    .in('id', valid);
  if (error) throw error;
  for (const r of data ?? []) {
    const row = r as { id: string; represented_client_id?: string | null };
    out.set(String(row.id), row.represented_client_id ? String(row.represented_client_id) : null);
  }
  return out;
}

/**
 * Router-level Income guard. Owner/Admin and ALL-access members skip resource lookups (their
 * handlers keep the existing org-scoped not-found behaviour). Restricted Staff/Viewer:
 *  - every explicit client id passes Stage 5.1,
 *  - every draft / issued document / customer / work item id must resolve to an authorized client
 *    (client-less rows keep the existing organization semantics),
 *  - an id that does not exist in the organization is also reported as not found (no enumeration).
 */
export async function assertIncomeRequestClientAccess(ctx: RequestContext, ids: IncomeRequestIds): Promise<void> {
  if (!ctx.organizationId || !incomeRequestHasResourceIds(ids)) return;
  const orgId = ctx.organizationId;

  for (const clientId of ids.client_ids) await assertCanAccessClientFromContext(ctx, clientId);

  const hasResourceIds =
    ids.draft_ids.length +
      ids.income_document_ids.length +
      ids.income_customer_ids.length +
      ids.work_item_ids.length +
      ids.reminder_candidate_ids.length >
    0;
  if (!hasResourceIds) return;

  const allow = await authorizedClientIdsForViewer({
    organizationId: orgId,
    userId: ctx.user.id,
    roleCode: ctx.membership?.roleCode,
  });
  if (allow === null) return;
  const allowSet = new Set(allow);

  const check = (clientId: string | null | undefined, label: string) => {
    if (clientId && !allowSet.has(clientId)) throw notFound(`${label} not found`);
  };

  const [drafts, docs, customers] = await Promise.all([
    representedClientsOf('income_document_drafts', orgId, ids.draft_ids),
    representedClientsOf('income_documents', orgId, ids.income_document_ids),
    representedClientsOf('income_customers', orgId, ids.income_customer_ids),
  ]);
  for (const id of ids.draft_ids) {
    if (UUID_RE.test(id) && !drafts.has(id)) throw notFound('Draft not found');
    check(drafts.get(id), 'Draft');
  }
  for (const id of ids.income_document_ids) {
    if (UUID_RE.test(id) && !docs.has(id)) throw notFound('Document not found');
    check(docs.get(id), 'Document');
  }
  for (const id of ids.income_customer_ids) {
    if (UUID_RE.test(id) && !customers.has(id)) throw notFound('Customer not found');
    check(customers.get(id), 'Customer');
  }

  // Reminder candidates resolve to a client through their work item.
  const candidateWorkItemIds: string[] = [];
  const candidateIds = ids.reminder_candidate_ids.filter((id) => UUID_RE.test(id));
  if (candidateIds.length) {
    const { data, error } = await supabaseAdmin
      .from('work_reminder_candidates')
      .select('id, work_item_id')
      .eq('org_id', orgId)
      .in('id', candidateIds);
    if (error) throw error;
    const byId = new Map((data ?? []).map((r) => [String((r as { id: string }).id), String((r as { work_item_id: string }).work_item_id)]));
    for (const id of candidateIds) {
      const wi = byId.get(id);
      if (!wi) throw notFound('Reminder candidate not found');
      candidateWorkItemIds.push(wi);
    }
  }

  const workItemIds = [...ids.work_item_ids.filter((id) => UUID_RE.test(id)), ...candidateWorkItemIds];
  if (workItemIds.length) {
    const { data, error } = await supabaseAdmin
      .from('work_items')
      .select('id, client_id')
      .eq('org_id', orgId)
      .in('id', workItemIds);
    if (error) throw error;
    const byId = new Map((data ?? []).map((r) => [String((r as { id: string }).id), (r as { client_id?: string | null }).client_id ?? null]));
    for (const id of workItemIds) {
      if (!byId.has(id)) throw notFound('Work item not found');
      check(byId.get(id), 'Work item');
    }
  }
}

/**
 * After a tax-invoice credit is issued: invalidate stale reminder candidates
 * and close collection when remaining receivable is zero.
 */

import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE } from './work-engine-collection-reminder.pure.js';
import type { WorkItemRow } from './work-engine.types.js';

export async function reconcileCollectionAfterTaxInvoiceCredit(params: {
  orgId: string;
  sourceInvoiceId: string;
  creditDocumentId: string;
  remainingReceivable: number;
  actorUserId: string | null;
}): Promise<void> {
  const { data: invoice, error: invoiceErr } = await supabaseAdmin
    .from('income_documents')
    .select('represented_client_id')
    .eq('organization_id', params.orgId)
    .eq('id', params.sourceInvoiceId)
    .maybeSingle();
  if (invoiceErr) throw invoiceErr;
  const clientId = (invoice as { represented_client_id: string | null } | null)?.represented_client_id;
  if (!clientId) return;

  const { data: workItem, error: workErr } = await supabaseAdmin
    .from('work_items')
    .select('*')
    .eq('org_id', params.orgId)
    .eq('client_id', clientId)
    .eq('module_key', 'income')
    .eq('work_type', INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE)
    .eq('source_entity_id', params.sourceInvoiceId)
    .not('work_state', 'in', '(done,archived)')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (workErr) throw workErr;
  const current = workItem as WorkItemRow | null;
  if (!current) return;

  const nowIso = new Date().toISOString();
  const { data: cancelled, error: cancelErr } = await supabaseAdmin
    .from('work_reminder_candidates')
    .update({
      status: 'cancelled',
      cancelled_by_user_id: params.actorUserId,
      cancelled_at: nowIso,
    })
    .eq('org_id', params.orgId)
    .eq('work_item_id', current.id)
    .in('status', [
      'pending_review',
      'edited',
      'approved',
      'sending',
      'snoozed',
      'delivery_failed',
    ])
    .select('id');
  if (cancelErr) throw cancelErr;
  for (const row of cancelled ?? []) {
    await writeAudit({
      organizationId: params.orgId,
      actorUserId: params.actorUserId,
      moduleCode: 'work_engine',
      entityType: 'work_reminder_candidate',
      entityId: String((row as { id: string }).id),
      action: AUDIT_ACTIONS.REMINDER_CANDIDATE_CANCELLED,
      payload: {
        work_item_id: current.id,
        reason: 'tax_invoice_credit_issued',
        credit_document_id: params.creditDocumentId,
        remaining_receivable: params.remainingReceivable,
      },
    });
  }

  if (params.remainingReceivable > 0.005) return;
  if (current.work_state === 'done' || current.work_state === 'archived') return;

  const newVersion = current.version + 1;
  const { error: closeErr } = await supabaseAdmin
    .from('work_items')
    .update({ work_state: 'done', version: newVersion })
    .eq('org_id', params.orgId)
    .eq('id', current.id)
    .eq('version', current.version);
  if (closeErr) throw closeErr;

  await supabaseAdmin.from('work_transitions').insert({
    org_id: params.orgId,
    work_item_id: current.id,
    from_state: current.work_state,
    to_state: 'done',
    transition_kind: 'automation',
    action_code: 'collection_followup_auto_closed_credited',
    actor_type: params.actorUserId ? 'user' : 'system',
    actor_user_id: params.actorUserId,
    reason_text: null,
    metadata_json: {
      credit_document_id: params.creditDocumentId,
      remaining_receivable: params.remainingReceivable,
    },
    expected_version: current.version,
    resulting_version: newVersion,
  });
}

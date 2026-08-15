/**
 * INV-4B — collection reminder candidate scan.
 *
 * Active invoice_collection_followup work items → batch AB debt truth →
 * filter still-open overdue → ensure waiting_client SLA → evaluate reminders
 * (Country Pack waiting_client cadence) idempotently.
 *
 * Creates pending_review candidates only — never sends, approves, or closes.
 */

import { supabaseAdmin } from '../../db/client.js';
import { sumPostedAllocationsForIncomeDocuments } from '../accounting-base/accounting-base-income-payment-case.read.js';
import { resolveIncomeInvoiceOriginalAmount } from '../accounting-base/accounting-base-income-payment.pure.js';
import { loadIssuedCreditAmountsByInvoice } from '../income/income-document-tax-invoice-credit.service.js';
import { composeCollectibleAfterCredit } from '../income/income-document-tax-invoice-credit.pure.js';
import {
  backendTodayIsoDate,
  resolveIncomeOverdueCollectionIntake,
} from '../income/invoice-lifecycle.pure.js';
import {
  COLLECTION_REMINDER_SCAN_MAX_PAGES,
  COLLECTION_REMINDER_SCAN_PAGE_SIZE,
  INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE,
  shouldCreateCollectionReminderCandidate,
} from './work-engine-collection-reminder.pure.js';
import {
  recomputeWorkItemSlaStatus,
  startWaitingClientObligationIfAbsent,
} from './work-engine.sla.service.js';

export type CollectionReminderScanSummary = {
  work_items_scanned: number;
  pages: number;
  open_overdue_eligible: number;
  skipped_resolved_debt: number;
  sla_started: number;
  reminders_created: number;
  reminder_dedup_hits: number;
  errors: number;
};

type CollectionWorkItemRow = {
  id: string;
  org_id: string;
  client_id: string | null;
  work_type: string;
  work_state: string;
  source_entity_id: string;
  source_entity_type: string;
};

type IncomeDocSlice = {
  id: string;
  document_status: string;
  document_type: string;
  due_date: string | null;
  totals_snapshot_json: Record<string, unknown> | null;
  represented_client_id: string | null;
};

export async function scanCollectionReminderCandidatesForOrg(params: {
  orgId: string;
  actorUserId?: string | null;
  todayIso?: string;
  now?: Date;
  dryRun?: boolean;
  pageSize?: number;
  maxPages?: number;
}): Promise<CollectionReminderScanSummary> {
  const todayIso = params.todayIso ?? backendTodayIsoDate(params.now);
  const pageSize = params.pageSize ?? COLLECTION_REMINDER_SCAN_PAGE_SIZE;
  const maxPages = params.maxPages ?? COLLECTION_REMINDER_SCAN_MAX_PAGES;
  const dryRun = params.dryRun === true;

  const summary: CollectionReminderScanSummary = {
    work_items_scanned: 0,
    pages: 0,
    open_overdue_eligible: 0,
    skipped_resolved_debt: 0,
    sla_started: 0,
    reminders_created: 0,
    reminder_dedup_hits: 0,
    errors: 0,
  };

  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await supabaseAdmin
      .from('work_items')
      .select(
        'id, org_id, client_id, work_type, work_state, source_entity_id, source_entity_type',
      )
      .eq('org_id', params.orgId)
      .eq('module_key', 'income')
      .eq('work_type', INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE)
      .not('work_state', 'in', '(done,archived)')
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw error;

    const rows = (data ?? []) as CollectionWorkItemRow[];
    if (rows.length === 0) break;

    summary.pages += 1;
    summary.work_items_scanned += rows.length;

    const documentIds = Array.from(
      new Set(
        rows
          .map((r) => String(r.source_entity_id ?? '').trim())
          .filter((id) => id.length > 0),
      ),
    );

    const docById = new Map<string, IncomeDocSlice>();
    if (documentIds.length > 0) {
      const { data: docs, error: docErr } = await supabaseAdmin
        .from('income_documents')
        .select(
          'id, document_status, document_type, due_date, totals_snapshot_json, represented_client_id',
        )
        .eq('organization_id', params.orgId)
        .in('id', documentIds);
      if (docErr) throw docErr;
      for (const d of (docs ?? []) as IncomeDocSlice[]) {
        docById.set(String(d.id), d);
      }
    }

    const [paidMap, creditedMap] = await Promise.all([
      sumPostedAllocationsForIncomeDocuments(params.orgId, documentIds),
      loadIssuedCreditAmountsByInvoice(params.orgId, documentIds),
    ]);

    const eligibleItems: CollectionWorkItemRow[] = [];
    for (const item of rows) {
      const docId = String(item.source_entity_id ?? '').trim();
      const doc = docById.get(docId);
      if (!doc) {
        summary.skipped_resolved_debt += 1;
        continue;
      }
      if (
        item.client_id &&
        doc.represented_client_id &&
        item.client_id !== doc.represented_client_id
      ) {
        summary.skipped_resolved_debt += 1;
        continue;
      }

      const paid = paidMap.get(docId) ?? 0;
      const original = resolveIncomeInvoiceOriginalAmount(doc.totals_snapshot_json);
      const collectible = composeCollectibleAfterCredit({
        originalAmount: original,
        creditedAmount: creditedMap.get(docId) ?? 0,
        allocatedPayments: paid,
      });
      const intake = resolveIncomeOverdueCollectionIntake({
        documentStatus: doc.document_status,
        documentType: doc.document_type,
        dueDate: doc.due_date,
        originalAmount: collectible.net_invoice_amount,
        paidAmount: paid,
        todayIso,
      });

      if (
        !shouldCreateCollectionReminderCandidate({
          workType: item.work_type,
          workState: item.work_state,
          stillOpenOverdue: intake.eligible,
        })
      ) {
        summary.skipped_resolved_debt += 1;
        continue;
      }

      summary.open_overdue_eligible += 1;
      eligibleItems.push(item);
    }

    for (const item of eligibleItems) {
      if (dryRun) continue;
      try {
        const started = await startWaitingClientObligationIfAbsent({
          orgId: params.orgId,
          workItemId: item.id,
          sourceTransitionId: null,
          actorUserId: params.actorUserId ?? null,
          workType: item.work_type,
        });
        if (started) summary.sla_started += 1;

        const outcome = await recomputeWorkItemSlaStatus(params.orgId, item.id, {
          actorUserId: params.actorUserId ?? null,
          auditOnStatusChange: true,
          collectionDebtPrechecked: true,
        });
        summary.reminders_created += outcome.reminders.created_candidate_ids.length;
        summary.reminder_dedup_hits += outcome.reminders.dedup_hits;
      } catch {
        summary.errors += 1;
      }
    }

    if (rows.length < pageSize) break;
  }

  return summary;
}

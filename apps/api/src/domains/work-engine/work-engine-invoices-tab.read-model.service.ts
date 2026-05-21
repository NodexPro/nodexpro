/**
 * INC-8 — Work Engine Invoices tab aggregate (operational Excel-like table).
 *
 * NOT Income module homepage. Single read model; no frontend stitching.
 * Money columns are reference display from income_documents snapshots only.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { forbidden } from '../../shared/errors.js';
import { buildAccountantWorkspaceTabs } from './work-engine.read-models.service.js';
import { buildWorkEngineInvoicesDocumentCreationEntrypoint } from './work-engine-invoices-document-creation.builders.js';
import type { WorkEngineInvoicesDocumentCreationEntrypoint } from './work-engine-invoices-document-creation.builders.js';
import {
  amountReferenceFromTotalsSnapshot,
  customerDisplayFromSnapshot,
  isOverdueByDueDate,
} from '../income/income-work-engine-bridge.pure.js';

export type WorkEngineInvoicesTabColumnType = 'text' | 'money_reference' | 'date' | 'status';

export type WorkEngineInvoicesTabColumn = {
  key: string;
  label: string;
  type: WorkEngineInvoicesTabColumnType;
};

export type WorkEngineInvoicesTabRow = Record<string, string | number | null>;

export type WorkEngineInvoicesTabAggregate = {
  aggregate_key: 'work_engine_invoices_tab_aggregate';
  org_id: string;
  workspace_tabs: ReturnType<typeof buildAccountantWorkspaceTabs>;
  title: string;
  description: string;
  table_model: {
    columns: WorkEngineInvoicesTabColumn[];
    rows: WorkEngineInvoicesTabRow[];
    empty_state: { visible: boolean; title: string; description: string | null };
  };
  summary: {
    rows_count: number;
    sum_paid_reference: number;
    avg_paid_reference: number;
    currency: string;
  };
  filters: [];
  allowed_actions: string[];
  document_creation_entrypoint: WorkEngineInvoicesDocumentCreationEntrypoint;
  gaps: string[];
};

export const WORK_ENGINE_INVOICES_TAB_COLUMNS: WorkEngineInvoicesTabColumn[] = [
  { key: 'client_name', label: 'לקוח', type: 'text' },
  { key: 'amount_due_reference', label: 'סכום לתשלום', type: 'money_reference' },
  { key: 'amount_paid_reference', label: 'שולם', type: 'money_reference' },
  { key: 'renewal_date', label: 'תאריך חידוש', type: 'date' },
  { key: 'quote_sent_date', label: 'הצעת מחיר נשלחה', type: 'date' },
  { key: 'approval_status', label: 'אישור', type: 'status' },
  { key: 'invoice_sent_date', label: 'חשבונית נשלחה', type: 'date' },
  { key: 'due_date', label: 'תאריך לתשלום', type: 'date' },
  { key: 'collection_status', label: 'סטטוס', type: 'status' },
  { key: 'invoice_paid_date', label: 'תאריך תשלום', type: 'date' },
  { key: 'invoice_number', label: 'מספר חשבונית', type: 'text' },
  { key: 'comments', label: 'הערות', type: 'text' },
];

function collectionStatusLabel(dueDate: string | null, todayIso: string): string {
  if (!dueDate) return 'ללא תאריך לתשלום';
  if (isOverdueByDueDate(dueDate, todayIso)) return 'באיחור';
  return 'פתוח';
}

export async function buildWorkEngineInvoicesTabAggregate(params: {
  ctx: RequestContext;
}): Promise<WorkEngineInvoicesTabAggregate> {
  const orgId = params.ctx.organizationId!;
  if (!orgId) throw forbidden('Organization context required');

  const todayIso = new Date().toISOString().slice(0, 10);

  const { data: docs, error } = await supabaseAdmin
    .from('income_documents')
    .select(
      'id, represented_client_id, document_number, document_type, issue_date, due_date, currency, customer_snapshot_json, totals_snapshot_json',
    )
    .eq('organization_id', orgId)
    .eq('document_status', 'issued')
    .not('represented_client_id', 'is', null)
    .order('issue_date', { ascending: false })
    .limit(500);
  if (error) throw error;

  const clientIds = [
    ...new Set(
      (docs ?? [])
        .map((d) => (d as { represented_client_id: string | null }).represented_client_id)
        .filter((id): id is string => !!id),
    ),
  ];

  const clientNameById = new Map<string, string>();
  if (clientIds.length > 0) {
    const { data: clients, error: cErr } = await supabaseAdmin
      .from('clients')
      .select('id, display_name')
      .eq('organization_id', orgId)
      .in('id', clientIds);
    if (cErr) throw cErr;
    for (const c of clients ?? []) {
      const row = c as { id: string; display_name: string };
      clientNameById.set(row.id, row.display_name);
    }
  }

  const rows: WorkEngineInvoicesTabRow[] = [];
  let sumPaidReference = 0;
  let paidCount = 0;
  let currency = 'ILS';

  for (const raw of docs ?? []) {
    const d = raw as {
      id: string;
      represented_client_id: string;
      document_number: string;
      document_type: string;
      issue_date: string;
      due_date: string | null;
      currency: string;
      customer_snapshot_json: Record<string, unknown>;
      totals_snapshot_json: Record<string, unknown> | null;
    };
    currency = d.currency || currency;
    const amountDue = amountReferenceFromTotalsSnapshot(d.totals_snapshot_json);
    const amountPaid: number | null = null;
    if (amountPaid != null) {
      sumPaidReference += amountPaid;
      paidCount += 1;
    }
    const clientName =
      clientNameById.get(d.represented_client_id) ??
      customerDisplayFromSnapshot(d.customer_snapshot_json) ??
      '—';

    rows.push({
      income_document_id: d.id,
      client_name: clientName,
      amount_due_reference: amountDue,
      amount_paid_reference: amountPaid,
      renewal_date: null,
      quote_sent_date: d.document_type === 'quote' ? d.issue_date : null,
      approval_status: null,
      invoice_sent_date: d.issue_date,
      due_date: d.due_date,
      collection_status: collectionStatusLabel(d.due_date, todayIso),
      invoice_paid_date: null,
      invoice_number: d.document_number,
      comments: null,
    });
  }

  const avgPaidReference = paidCount > 0 ? Math.round((sumPaidReference / paidCount) * 100) / 100 : 0;

  return {
    aggregate_key: 'work_engine_invoices_tab_aggregate',
    org_id: orgId,
    workspace_tabs: buildAccountantWorkspaceTabs('invoices'),
    title: 'חשבוניות',
    description: 'מעקב גבייה ותשלומים',
    table_model: {
      columns: WORK_ENGINE_INVOICES_TAB_COLUMNS,
      rows,
      empty_state: {
        visible: rows.length === 0,
        title: 'אין חשבוניות להצגה',
        description: 'מסמכים שהונפקו במצב נציג משרד יופיעו כאן.',
      },
    },
    summary: {
      rows_count: rows.length,
      sum_paid_reference: sumPaidReference,
      avg_paid_reference: avgPaidReference,
      currency,
    },
    filters: [],
    allowed_actions: ['view_invoices_tab', 'open_income_document_wizard'],
    document_creation_entrypoint: await buildWorkEngineInvoicesDocumentCreationEntrypoint(params.ctx),
    gaps: [
      'income.invoice_paid — payment status not implemented (INC-8)',
      'income.invoice_partially_paid — not implemented',
      'income.payment_failed — not implemented',
      'amount_paid_reference — awaiting payment pipeline',
      'self_mode_documents_excluded — requires represented_client_id',
    ],
  };
}

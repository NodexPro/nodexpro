/**
 * INV-2A — invoice_lifecycle_aggregate composer.
 * Composes Income + Delivery + Accounting Base + Work Engine. No lifecycle storage.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import {
  isSupportedIncomePaymentDocumentType,
  resolveIncomeInvoiceOriginalAmount,
} from '../accounting-base/accounting-base-income-payment.pure.js';
import { sumPostedAllocationsForIncomeDocument } from '../accounting-base/accounting-base-income-payment-case.read.js';
import { loadIssuedCreditAmountsByInvoice } from './income-document-tax-invoice-credit.service.js';
import { composeCollectibleAfterCredit } from './income-document-tax-invoice-credit.pure.js';
import { listAttempts } from '../delivery/delivery.runtime.js';
import {
  INCOME_WORK_ENGINE_ENTITY_TYPE,
  INCOME_WORK_ENGINE_SOURCE_MODULE,
} from './income-work-engine-bridge.pure.js';
import { assertRowMatchesIssuerScope, reqUuid } from './income.guards.js';
import { incomeWorkspacePermissionsFromContext } from './income-issuer-context.service.js';
import { loadActiveIncomeIssuerScope } from './income-issuer-scope.service.js';
import { resolveIncomeDocumentEmailSendEligibility } from './income-document-email-delivery.read-model.pure.js';
import { INCOME_COMMAND_SEND_DOCUMENT_BY_EMAIL } from './income.types.js';
import { INCOME_COMMAND_RECORD_DOCUMENT_PAYMENT } from './income-document-payment.pure.js';
import {
  backendTodayIsoDate,
  composeInvoiceLifecycleDeliveryDimension,
  composeInvoiceLifecycleDueDimension,
  composeInvoiceLifecyclePaymentState,
  type LifecycleDeliveryAttemptSlice,
} from './invoice-lifecycle.pure.js';
import {
  INVOICE_LIFECYCLE_AGGREGATE_KEY,
  type InvoiceLifecycleAggregate,
  type InvoiceLifecycleAllowedAction,
} from './invoice-lifecycle.types.js';
import { composeInvoiceLifecycleRibbon } from './invoice-lifecycle-ribbon.pure.js';
import { composeInvoiceLifecycleHealth } from './invoice-lifecycle-health.pure.js';

const ACTIVE_COLLECTION_WORK_TYPE = 'invoice_collection_followup';

type IssuedLifecycleDocumentRow = {
  id: string;
  organization_id: string;
  issuer_business_id: string;
  represented_client_id: string | null;
  document_type: string;
  document_number: string;
  document_status: string;
  issue_date: string | null;
  due_date: string | null;
  source_draft_id: string | null;
  totals_snapshot_json: Record<string, unknown> | null;
  pdf_render_status: string | null;
  pdf_asset_id: string | null;
};

async function loadLastPaymentAt(
  organizationId: string,
  incomeDocumentId: string,
): Promise<string | null> {
  const { data: allocRows, error: allocErr } = await supabaseAdmin
    .from('accounting_payment_allocations')
    .select('payment_id')
    .eq('organization_id', organizationId)
    .eq('source_module', 'income')
    .eq('source_entity_id', incomeDocumentId)
    .eq('status', 'posted')
    .is('reversal_of_allocation_id', null);
  throwIfSupabaseError(allocErr, 'invoiceLifecycleLoadAllocations');
  const paymentIds = Array.from(
    new Set((allocRows ?? []).map((r) => String((r as { payment_id: string }).payment_id)).filter(Boolean)),
  );
  if (paymentIds.length === 0) return null;

  const { data: payRows, error: payErr } = await supabaseAdmin
    .from('accounting_payments')
    .select('payment_date')
    .eq('organization_id', organizationId)
    .in('id', paymentIds)
    .order('payment_date', { ascending: false })
    .limit(1);
  throwIfSupabaseError(payErr, 'invoiceLifecycleLoadLastPayment');
  const date = (payRows?.[0] as { payment_date?: string } | undefined)?.payment_date;
  return date && String(date).trim() ? String(date).trim() : null;
}

async function loadActiveCollectionWorkItem(params: {
  orgId: string;
  incomeDocumentId: string;
}): Promise<{ work_item_id: string; work_state: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('work_items')
    .select('id, work_state')
    .eq('org_id', params.orgId)
    .eq('module_key', INCOME_WORK_ENGINE_SOURCE_MODULE)
    .eq('work_type', ACTIVE_COLLECTION_WORK_TYPE)
    .eq('source_entity_type', INCOME_WORK_ENGINE_ENTITY_TYPE)
    .eq('source_entity_id', params.incomeDocumentId)
    .not('work_state', 'in', '(done,archived)')
    .order('updated_at', { ascending: false })
    .limit(1);
  throwIfSupabaseError(error, 'invoiceLifecycleLoadCollectionWorkItem');
  const row = data?.[0] as { id?: string; work_state?: string } | undefined;
  if (!row?.id) return null;
  return { work_item_id: String(row.id), work_state: String(row.work_state ?? '') };
}

function buildAllowedActions(params: {
  permissions: ReturnType<typeof incomeWorkspacePermissionsFromContext>;
  document: IssuedLifecycleDocumentRow;
  remainingBalance: number;
  hasAccountingPaymentWrite: boolean;
}): InvoiceLifecycleAllowedAction[] {
  const actions: InvoiceLifecycleAllowedAction[] = [
    {
      action_key: 'view_income_document',
      label: 'צפייה במסמך',
      enabled: params.permissions.view,
      command: null,
      reason: params.permissions.view ? null : 'אין הרשאת צפייה',
      source_module: 'income',
    },
  ];

  const emailElig = resolveIncomeDocumentEmailSendEligibility({
    permissions: params.permissions,
    representedClientId: params.document.represented_client_id,
    documentStatus: params.document.document_status,
    pdfRenderStatus: String(params.document.pdf_render_status ?? ''),
    pdfAssetId: params.document.pdf_asset_id,
  });
  actions.push({
    action_key: 'send_income_document_by_email',
    label: 'שליחה במייל',
    enabled: emailElig.enabled,
    command: INCOME_COMMAND_SEND_DOCUMENT_BY_EMAIL,
    reason: emailElig.disabled_reason,
    source_module: 'delivery',
  });

  const canRecord =
    params.hasAccountingPaymentWrite &&
    params.document.document_status === 'issued' &&
    isSupportedIncomePaymentDocumentType(params.document.document_type) &&
    params.remainingBalance > 0;
  let recordReason: string | null = null;
  if (!params.hasAccountingPaymentWrite) {
    recordReason = 'חסרה הרשאה לרישום תשלום';
  } else if (!isSupportedIncomePaymentDocumentType(params.document.document_type)) {
    recordReason = 'סוג מסמך אינו נתמך לרישום תשלום';
  } else if (params.remainingBalance <= 0) {
    recordReason = 'החשבונית כבר שולמה במלואה';
  }
  actions.push({
    action_key: 'record_payment',
    label: 'רישום תשלום',
    enabled: canRecord,
    command: INCOME_COMMAND_RECORD_DOCUMENT_PAYMENT,
    reason: recordReason,
    source_module: 'accounting_base',
  });

  return actions;
}

/**
 * Official INV-2A read: one invoice → composed lifecycle dimensions.
 * Route: GET /api/v1/income/aggregates/invoice-lifecycle?income_document_id=
 */
export async function buildInvoiceLifecycleAggregate(params: {
  ctx: RequestContext;
  incomeDocumentId: string;
  /** Test seam — defaults to backend today. */
  todayIso?: string;
}): Promise<InvoiceLifecycleAggregate> {
  const scope = await loadActiveIncomeIssuerScope(params.ctx);
  if (!scope.permissions.view) throw forbidden('income.view required');

  const incomeDocumentId = reqUuid(params.incomeDocumentId, 'income_document_id');
  const todayIso = params.todayIso ?? backendTodayIsoDate();

  const { data: docRaw, error: docErr } = await supabaseAdmin
    .from('income_documents')
    .select(
      'id, organization_id, issuer_business_id, represented_client_id, document_type, document_number, document_status, issue_date, due_date, source_draft_id, totals_snapshot_json, pdf_render_status, pdf_asset_id',
    )
    .eq('organization_id', scope.org_id)
    .eq('id', incomeDocumentId)
    .maybeSingle();
  throwIfSupabaseError(docErr, 'invoiceLifecycleLoadDocument');
  if (!docRaw) throw notFound('Income document not found');

  const document = docRaw as IssuedLifecycleDocumentRow;
  assertRowMatchesIssuerScope(scope, {
    organization_id: document.organization_id,
    issuer_business_id: document.issuer_business_id,
    represented_client_id: document.represented_client_id,
  });

  if (document.document_status !== 'issued') {
    throw badRequest('invoice_lifecycle_aggregate supports issued documents only in INV-2A');
  }

  const [paidAmount, creditedMap, deliveryAttempts, collectionItem, lastPaymentAt] = await Promise.all([
    sumPostedAllocationsForIncomeDocument(scope.org_id, document.id),
    loadIssuedCreditAmountsByInvoice(scope.org_id, [document.id]),
    listAttempts({
      organizationId: scope.org_id,
      sourceModule: 'income',
      sourceEntityType: 'income_document',
      sourceEntityId: document.id,
      limit: 200,
    }),
    loadActiveCollectionWorkItem({ orgId: scope.org_id, incomeDocumentId: document.id }),
    loadLastPaymentAt(scope.org_id, document.id),
  ]);

  const originalAmount = resolveIncomeInvoiceOriginalAmount(document.totals_snapshot_json);
  const collectible = composeCollectibleAfterCredit({
    originalAmount,
    creditedAmount: creditedMap.get(document.id) ?? 0,
    allocatedPayments: paidAmount,
  });
  const paymentState = composeInvoiceLifecyclePaymentState(
    collectible.net_invoice_amount,
    paidAmount,
  );

  const attemptSlices: LifecycleDeliveryAttemptSlice[] = deliveryAttempts.map((a) => ({
    channel: a.channel,
    result: a.result,
    sentAt: a.sentAt,
    createdAt: a.createdAt,
  }));
  const delivery = composeInvoiceLifecycleDeliveryDimension(attemptSlices);

  const due = composeInvoiceLifecycleDueDimension({
    documentStatus: document.document_status,
    documentType: document.document_type,
    dueDate: document.due_date,
    remainingBalance: collectible.remaining_receivable,
    paymentStateKey: collectible.payment_state_key,
    todayIso,
  });

  const permissions = incomeWorkspacePermissionsFromContext(params.ctx);
  const hasAccountingPaymentWrite = (params.ctx.membership?.permissions ?? []).includes(
    'accounting_base.payment.write',
  );

  const collectionActive = collectionItem != null;

  const documentDim = {
    document_type: document.document_type,
    document_number: document.document_number,
    document_state_key: 'issued' as const,
    issue_date: document.issue_date,
    due_date: document.due_date,
    source_draft_id: document.source_draft_id,
  };
  const paymentDim = {
    original_amount: originalAmount,
    paid_amount: paidAmount,
    remaining_balance: paymentState.remaining_balance,
    state_key: paymentState.payment_state_key,
    last_payment_at: lastPaymentAt,
    financial_source: 'accounting_base' as const,
  };
  const finalizationDim = { state_key: 'open' as const };

  const collectionDim = {
    active: collectionActive,
    work_item_id: collectionItem?.work_item_id ?? null,
    work_state: collectionItem?.work_state ?? null,
    // INV-2A: expose identity/state only; WE queue aggregate owns full action eligibility.
    next_actions: [] as InvoiceLifecycleAggregate['collection']['next_actions'],
  };

  return {
    aggregate_key: INVOICE_LIFECYCLE_AGGREGATE_KEY,
    income_document_id: document.id,
    organization_id: document.organization_id,
    represented_client_id: document.represented_client_id,
    document: documentDim,
    delivery,
    payment: paymentDim,
    due,
    collection: collectionDim,
    finalization: finalizationDim,
    lifecycle_ribbon: composeInvoiceLifecycleRibbon({
      document: documentDim,
      delivery,
      payment: paymentDim,
      due,
      finalization: finalizationDim,
    }),
    health: composeInvoiceLifecycleHealth({
      income_document_id: document.id,
      payment: paymentDim,
      delivery,
      due,
      collection: collectionDim,
    }),
    allowed_actions: buildAllowedActions({
      permissions,
      document,
      remainingBalance: paymentState.remaining_balance,
      hasAccountingPaymentWrite,
    }),
    meta: {
      generated_at: new Date().toISOString(),
      composers: ['income', 'delivery', 'accounting_base', 'work_engine'],
    },
  };
}

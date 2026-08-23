/**
 * Work Engine invoices tab — client documents by type/year aggregate.
 * Single explicit read model for the documents-by-type modal.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { logAggregatePayloadBreakdown } from '../../shared/aggregate-payload-metrics.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import {
  issueYearFromIso,
  ledgerAmountFromTotalsSnapshot,
  formatLedgerMoneyReference,
} from '../income/income-client-income-ledger-card.pure.js';
import { formatMoneyReference } from '../income/income-document-draft-lines.pure.js';
import {
  formatIncomeCalendarDateHe,
  formatIncomeDueDateDisplayHe,
  resolveIncomeDocumentSemanticDates,
} from '../income/income-document-semantic-dates.pure.js';
import { incomeDocumentDownloadPath } from '../income/income-document-pdf.service.js';
import {
  buildIncomeIssuedDocumentPdfAction,
  buildIncomeIssuedDocumentViewAction,
} from '../income/income-document-view-action.pure.js';
import { buildIncomeDocumentEmailDeliveryBlock } from '../income/income-document-email-delivery.read-model.pure.js';
import { buildIncomeDocumentDocflowDeliveryBlock } from '../income/income-document-docflow-delivery.read-model.pure.js';
import {
  loadEmailAttemptCountsByDocumentIds,
  loadDocflowAttemptCountsByDocumentIds,
  isDocflowEntitledForOrg,
  loadRepresentedClientDocflowPortalActive,
} from '../income/income-document-email-delivery.read-model.service.js';
import { incomeWorkspacePermissionsFromContext } from '../income/income-issuer-context.service.js';
import {
  belongsToOfficeClientRow,
  excludeSelfModeActingFilter,
  officeClientDocumentsOrFilter,
} from '../income/income-client-document-management-panel.pure.js';
import { customerDisplayFromSnapshot } from '../income/income-work-engine-bridge.pure.js';
import {
  paymentTermsKeyFromUnknown,
  resolveIncomeDueDateFromDocument,
  type IncomeCustomerPaymentTermsKey,
} from '../income/income-customer-payment-terms.pure.js';
import { loadIncomeCustomerPaymentTermsByIds } from '../income/income-recipient.service.js';
import { resolveIncomeInvoiceOriginalAmount } from '../accounting-base/accounting-base-income-payment.pure.js';
import { sumPostedAllocationsForIncomeDocuments } from '../accounting-base/accounting-base-income-payment-case.read.js';
import {
  buildIncomeDocumentRecordPaymentForm,
  resolvePaymentStateIcon,
} from '../income/income-document-payment.pure.js';
import {
  buildConversionTargetOptions,
  buildPreliminaryEditAction,
  INCOME_COMMAND_BEGIN_EDIT_PRELIMINARY_DOCUMENT,
  INCOME_COMMAND_CANCEL_PRELIMINARY_DOCUMENT,
  INCOME_COMMAND_CONVERT_DOCUMENT_TO_DRAFT,
  isIncomeConversionSourceType,
  resolveConversionStateKey,
} from '../income/income-document-conversion.pure.js';
import {
  buildPreliminaryLifecycleStatusDetail,
  buildPreliminaryReopenAction,
  INCOME_COMMAND_REOPEN_PRELIMINARY_DOCUMENT,
  linkedDocumentRefFromIssuedTarget,
  preliminaryLifecycleLabel,
  resolvePreliminaryLifecycleState,
} from '../income/income-document-preliminary-lifecycle.pure.js';
import {
  WORK_ENGINE_INVOICES_CLIENT_DOCUMENTS_BY_TYPE_AGGREGATE_KEY,
  type IncomeClientDocumentTypeCounterKey,
  type IncomeDocumentType,
  type IncomeWorkspacePermissions,
  type WorkEngineDocumentCancelAction,
  type WorkEngineDocumentConvertAction,
  type WorkEngineDocumentCreditAction,
  type WorkEngineDocumentEditAction,
  type WorkEngineDocumentReopenAction,
  type WorkEngineInvoicesClientDocumentsByTypeAggregate,
  type WorkEngineInvoicesClientDocumentsByTypeRow,
} from '../income/income.types.js';
import {
  buildTaxInvoiceCreditAction,
  loadIssuedCreditAmountsByInvoice,
} from '../income/income-document-tax-invoice-credit.read.js';
import { composeCollectibleAfterCredit } from '../income/income-document-tax-invoice-credit.pure.js';
import { INCOME_COMMAND_BEGIN_TAX_INVOICE_CREDIT } from '../income/income-document-tax-invoice-credit.pure.js';
import { findAvailableDocumentType, resolveAvailableDocumentTypes } from '../income/income-document-types.resolver.js';
import { loadActiveIncomeIssuerScope } from '../income/income-issuer-scope.service.js';

const ISSUED_DOCUMENT_TYPES: IncomeDocumentType[] = [
  'quote',
  'deal_invoice',
  'tax_invoice',
  'tax_invoice_receipt',
  'receipt',
  'credit_tax_invoice',
];

const DOCUMENT_TYPE_LABELS: Record<IncomeDocumentType, string> = {
  quote: 'הצעת מחיר',
  deal_invoice: 'חשבון עסקה',
  tax_invoice: 'חשבונית מס',
  tax_invoice_receipt: 'חשבונית מס/קבלה',
  receipt: 'קבלה',
  credit_tax_invoice: 'זיכוי',
};

const COUNTER_LABELS: Record<IncomeClientDocumentTypeCounterKey, string> = {
  quote: 'הצעת מחיר',
  deal_invoice: 'חשבון עסקה',
  tax_invoice: 'חשבונית מס',
  tax_invoice_receipt: 'חשבונית מס/קבלה',
  receipt: 'קבלה',
  credit_tax_invoice: 'זיכוי',
  draft: 'טיוטות',
};

const ISSUED_TABLE_COLUMNS = [
  { key: 'document_number', label: 'מספר מסמך' },
  { key: 'issue_date_display', label: 'תאריך מסמך' },
  { key: 'customer_display_name', label: 'לקוח' },
  { key: 'amount_display', label: 'סכום' },
  { key: 'status_label', label: 'סטטוס' },
  { key: 'view', label: 'צפייה' },
];

/** Quote / Deal Invoice: edit / convert / cancel / view live in one compact actions cell. */
const PRELIMINARY_ISSUED_TABLE_COLUMNS = [
  { key: 'document_number', label: 'מספר מסמך' },
  { key: 'issue_date_display', label: 'תאריך מסמך' },
  { key: 'customer_display_name', label: 'לקוח' },
  { key: 'amount_display', label: 'סכום' },
  { key: 'status_label', label: 'סטטוס' },
  { key: 'actions', label: 'פעולות' },
];

const TAX_INVOICE_TABLE_COLUMNS = [
  { key: 'document_number', label: 'מספר מסמך' },
  { key: 'issue_date_display', label: 'תאריך מסמך' },
  { key: 'customer_display_name', label: 'לקוח' },
  { key: 'amount_display', label: 'סכום' },
  { key: 'due_date_display', label: 'תאריך לתשלום' },
  { key: 'payment_state', label: 'סטטוס תשלום' },
  { key: 'actions', label: 'פעולות' },
];

const DRAFT_TABLE_COLUMNS = [
  { key: 'document_type_label', label: 'סוג מסמך' },
  { key: 'created_at_display', label: 'נוצר בתאריך' },
  { key: 'customer_display_name', label: 'לקוח' },
  { key: 'amount_display', label: 'סכום' },
  { key: 'status_label', label: 'סטטוס' },
  { key: 'edit', label: 'עריכה' },
];

function formatDateDisplay(iso: string | null | undefined): string {
  return formatIncomeCalendarDateHe(iso);
}

function resolveSelectedYear(availableYears: number[], requestedYear: number | null): number {
  const currentYear = new Date().getFullYear();
  if (requestedYear != null && availableYears.includes(requestedYear)) return requestedYear;
  if (availableYears.includes(currentYear)) return currentYear;
  return availableYears[0] ?? currentYear;
}

function yearFromTimestamp(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return issueYearFromIso(iso.length >= 10 ? iso.slice(0, 10) : iso);
}

function assertAccess(ctx: RequestContext): void {
  const perms = incomeWorkspacePermissionsFromContext(ctx);
  if (!perms.view) throw forbidden('income.view required');
  if (!perms.issue_on_behalf) throw forbidden('income.issue_on_behalf required');
}

function parseDocumentTypeKey(raw: string): IncomeClientDocumentTypeCounterKey {
  const key = String(raw ?? '').trim() as IncomeClientDocumentTypeCounterKey;
  if (!key || !(key in COUNTER_LABELS)) {
    throw badRequest('document_type_key is invalid');
  }
  return key;
}

function amountDisplayFromDraftPreview(
  preview: Record<string, unknown> | null | undefined,
  currency: string,
): string {
  if (preview && typeof preview === 'object') {
    const display = preview.grand_total_display;
    if (display != null && String(display).trim()) return String(display);
    const ref = preview.grand_total_reference;
    if (ref != null && Number.isFinite(Number(ref))) {
      return formatMoneyReference(Number(ref), currency);
    }
  }
  return '—';
}

async function loadRepresentedClient(orgId: string, clientId: string) {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id, display_name, is_archived')
    .eq('organization_id', orgId)
    .eq('id', clientId)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadDocumentsByTypeRepresentedClient');
  const row = data as { id: string; display_name: string; is_archived: boolean } | null;
  if (!row || row.is_archived) throw notFound('Office client not found');
  return row;
}

async function loadCustomerNames(orgId: string, representedClientId: string): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin
    .from('income_customers')
    .select('id, display_name')
    .eq('organization_id', orgId)
    .eq('represented_client_id', representedClientId)
    .eq('status', 'active')
    .limit(5000);
  throwIfSupabaseError(error, 'loadDocumentsByTypeCustomers');
  const map = new Map<string, string>();
  for (const raw of data ?? []) {
    const row = raw as { id: string; display_name: string };
    map.set(row.id, row.display_name);
  }
  return map;
}

async function resolveCreditTypeEnabled(ctx: RequestContext, orgId: string): Promise<boolean> {
  try {
    const scope = await loadActiveIncomeIssuerScope(ctx);
    const { available_document_types } = await resolveAvailableDocumentTypes(orgId, scope);
    return Boolean(findAvailableDocumentType(available_document_types, 'credit_tax_invoice')?.enabled);
  } catch {
    return true;
  }
}

async function loadConversionCountsBySource(
  orgId: string,
  sourceIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const id of sourceIds) out.set(id, 0);
  if (sourceIds.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from('income_document_conversions')
    .select('source_document_id')
    .eq('organization_id', orgId)
    .in('source_document_id', sourceIds);
  throwIfSupabaseError(error, 'loadConversionCountsBySource', {
    migrationHint: '158_income_document_conversion_and_preliminary_cancel.sql',
  });
  for (const row of data ?? []) {
    const id = String((row as { source_document_id: string }).source_document_id);
    out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

async function loadLinkedDocumentsByIds(
  orgId: string,
  documentIds: string[],
): Promise<
  Map<
    string,
    { id: string; document_number: string | null; document_type: string }
  >
> {
  const unique = [...new Set(documentIds.filter(Boolean))];
  const out = new Map<
    string,
    { id: string; document_number: string | null; document_type: string }
  >();
  if (unique.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select('id, document_number, document_type')
    .eq('organization_id', orgId)
    .in('id', unique);
  throwIfSupabaseError(error, 'loadLinkedDocumentsByIds');
  for (const row of data ?? []) {
    const typed = row as {
      id: string;
      document_number: string | null;
      document_type: string;
    };
    out.set(typed.id, typed);
  }
  return out;
}

type SourceDraftDueDateContext = {
  due_date: string | null;
  document_date: string | null;
  payment_terms_json: Record<string, unknown> | null;
  income_customer_id: string | null;
};

async function loadSourceDraftDueDateContext(
  orgId: string,
  draftIds: string[],
): Promise<Map<string, SourceDraftDueDateContext>> {
  const unique = [...new Set(draftIds.filter(Boolean))];
  const out = new Map<string, SourceDraftDueDateContext>();
  if (unique.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from('income_document_drafts')
    .select('id, due_date, document_date, payment_terms_json, income_customer_id')
    .eq('organization_id', orgId)
    .in('id', unique);
  throwIfSupabaseError(error, 'loadSourceDraftDueDateContext');
  for (const row of data ?? []) {
    const typed = row as SourceDraftDueDateContext & { id: string };
    out.set(String(typed.id), {
      due_date: typed.due_date,
      document_date: typed.document_date,
      payment_terms_json: typed.payment_terms_json,
      income_customer_id: typed.income_customer_id,
    });
  }
  return out;
}

async function loadIssuedDocumentCandidates(params: {
  ctx: RequestContext;
  orgId: string;
  representedClientId: string;
  documentType: IncomeDocumentType;
  canView: boolean;
  permissions: IncomeWorkspacePermissions;
}): Promise<Array<WorkEngineInvoicesClientDocumentsByTypeRow & { year: number | null }>> {
  const preliminaryType = isIncomeConversionSourceType(params.documentType);
  let query = supabaseAdmin
    .from('income_documents')
    .select(
      'id, represented_client_id, issuer_business_id, acting_mode, document_number, document_type, document_status, issue_date, due_date, currency, totals_snapshot_json, customer_snapshot_json, pdf_render_status, pdf_asset_id, pdf_render_error, created_at, source_draft_id, income_customer_id, preliminary_lifecycle_state, preliminary_closed_by_downstream_document_id',
    )
    .eq('organization_id', params.orgId)
    .or(excludeSelfModeActingFilter())
    .eq('document_type', params.documentType)
    .or(officeClientDocumentsOrFilter(params.representedClientId))
    .order('issue_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(5000);

  // Quote / deal: include cancelled (מבוטל) in same type tile history. Tax/etc: issued only.
  if (preliminaryType) {
    query = query.in('document_status', ['issued', 'cancelled_future']);
  } else {
    query = query.eq('document_status', 'issued');
  }

  const { data, error } = await query;
  throwIfSupabaseError(error, 'loadDocumentsByTypeIssued');

  const filtered = (data ?? []).filter((raw) =>
    belongsToOfficeClientRow(
      raw as {
        represented_client_id: string | null;
        issuer_business_id: string;
        acting_mode: string;
      },
      params.representedClientId,
    ),
  );

  const documentIds = filtered.map((raw) => String((raw as { id: string }).id));
  const includePayment = params.documentType === 'tax_invoice';
  const perms = params.ctx.membership?.permissions ?? [];
  const canPaymentWrite = perms.includes('accounting_base.payment.write');
  const canIncomeIssue = perms.includes('income.issue');
  const canEdit = params.permissions.edit;
  const missingDue = includePayment
    ? filtered.filter((raw) => !(raw as { due_date: string | null }).due_date)
    : [];
  const missingDueDraftIds = missingDue
    .map((raw) => String((raw as { source_draft_id?: string | null }).source_draft_id ?? ''))
    .filter(Boolean);
  const missingDueCustomerIds = missingDue
    .map((raw) => String((raw as { income_customer_id?: string | null }).income_customer_id ?? ''))
    .filter(Boolean);

  const linkedDownstreamIds = preliminaryType
    ? filtered
        .map((raw) =>
          String(
            (raw as { preliminary_closed_by_downstream_document_id?: string | null })
              .preliminary_closed_by_downstream_document_id ?? '',
          ),
        )
        .filter(Boolean)
    : [];

  const [
    emailAttemptCounts,
    docflowAttemptCounts,
    docflowEntitled,
    portalActive,
    allocatedByDoc,
    conversionCounts,
    creditedByDoc,
    creditTypeEnabled,
    sourceDraftDueById,
    paymentTermsByCustomer,
    linkedDocsById,
  ] = await Promise.all([
    loadEmailAttemptCountsByDocumentIds(params.orgId, documentIds),
    loadDocflowAttemptCountsByDocumentIds(params.orgId, documentIds),
    isDocflowEntitledForOrg(params.orgId),
    loadRepresentedClientDocflowPortalActive(params.orgId, params.representedClientId),
    includePayment
      ? sumPostedAllocationsForIncomeDocuments(params.orgId, documentIds)
      : Promise.resolve(new Map<string, number>()),
    preliminaryType
      ? loadConversionCountsBySource(params.orgId, documentIds)
      : Promise.resolve(new Map<string, number>()),
    includePayment
      ? loadIssuedCreditAmountsByInvoice(params.orgId, documentIds)
      : Promise.resolve(new Map<string, number>()),
    includePayment
      ? resolveCreditTypeEnabled(params.ctx, params.orgId)
      : Promise.resolve(false),
    loadSourceDraftDueDateContext(params.orgId, missingDueDraftIds),
    loadIncomeCustomerPaymentTermsByIds(params.orgId, missingDueCustomerIds),
    preliminaryType
      ? loadLinkedDocumentsByIds(params.orgId, linkedDownstreamIds)
      : Promise.resolve(
          new Map<string, { id: string; document_number: string | null; document_type: string }>(),
        ),
  ]);

  return filtered.map((raw) => {
    const doc = raw as {
      id: string;
      document_number: string;
      document_type: IncomeDocumentType;
      document_status: string;
      issue_date: string;
      due_date: string | null;
      currency: string;
      totals_snapshot_json: Record<string, unknown> | null;
      customer_snapshot_json: Record<string, unknown> | null;
      pdf_render_status: string;
      pdf_asset_id: string | null;
      pdf_render_error: string | null;
      source_draft_id: string | null;
      income_customer_id: string | null;
      preliminary_lifecycle_state: string | null;
      preliminary_closed_by_downstream_document_id: string | null;
    };
    const year = issueYearFromIso(doc.issue_date);
    const sourceDraft = doc.source_draft_id ? sourceDraftDueById.get(doc.source_draft_id) : undefined;
    const paymentTerms: IncomeCustomerPaymentTermsKey | null =
      paymentTermsKeyFromUnknown(sourceDraft?.payment_terms_json) ??
      paymentTermsByCustomer.get(doc.income_customer_id ?? '') ??
      paymentTermsByCustomer.get(sourceDraft?.income_customer_id ?? '') ??
      null;
    const dueDateFromDocument = resolveIncomeDueDateFromDocument({
      storedDueDate: doc.due_date ?? sourceDraft?.due_date ?? null,
      documentDateIso: sourceDraft?.document_date ?? doc.issue_date,
      paymentTerms,
    });
    const semanticDates = resolveIncomeDocumentSemanticDates({
      issue_date: doc.issue_date,
      due_date: dueDateFromDocument,
    });
    const amountRef = ledgerAmountFromTotalsSnapshot(doc.totals_snapshot_json);
    const pdfPath = doc.pdf_asset_id ? incomeDocumentDownloadPath(doc.id) : null;
    const view_action = buildIncomeIssuedDocumentViewAction({
      incomeDocumentId: doc.id,
      canView: params.canView,
    });
    const pdf_action = buildIncomeIssuedDocumentPdfAction({
      incomeDocumentId: doc.id,
      canRetryPdf: params.permissions.issue,
      pdfRenderStatus: doc.pdf_render_status,
      pdfAssetId: doc.pdf_asset_id,
      pdfDownloadPath: pdfPath,
      pdfRenderError: doc.pdf_render_error,
    });
    const canViewDoc = view_action.enabled;

    const allowedActions: string[] = [];
    if (canViewDoc) {
      allowedActions.push('view_document');
      allowedActions.push('open_document');
    }
    if (pdf_action.enabled) {
      allowedActions.push('download_pdf');
    }
    if (pdf_action.retry_command) {
      allowedActions.push(pdf_action.retry_command);
    }

    let payment_state_key: WorkEngineInvoicesClientDocumentsByTypeRow['payment_state_key'] = null;
    let payment_state_label: string | null = null;
    let payment_state_tone: WorkEngineInvoicesClientDocumentsByTypeRow['payment_state_tone'] = null;
    let payment_state_icon: WorkEngineInvoicesClientDocumentsByTypeRow['payment_state_icon'] = null;
    let record_payment_form: WorkEngineInvoicesClientDocumentsByTypeRow['record_payment_form'] = null;
    const due_date_display = formatIncomeDueDateDisplayHe({
      issue_date: doc.issue_date,
      due_date: dueDateFromDocument,
    });

    if (includePayment) {
      const original = resolveIncomeInvoiceOriginalAmount(doc.totals_snapshot_json);
      const allocated = allocatedByDoc.get(doc.id) ?? 0;
      const credited = creditedByDoc.get(doc.id) ?? 0;
      const collectible = composeCollectibleAfterCredit({
        originalAmount: original,
        creditedAmount: credited,
        allocatedPayments: allocated,
      });
      payment_state_key = collectible.payment_state_key;
      payment_state_label = collectible.payment_state_label;
      payment_state_tone = collectible.payment_state_tone;
      payment_state_icon = resolvePaymentStateIcon(collectible.payment_state_key);

      let disabledReason: string | null = null;
      if (!canPaymentWrite) disabledReason = 'חסרה הרשאה לרישום תשלום';
      else if (!canIncomeIssue) disabledReason = 'חסרה הרשאה להפקת מסמך הכנסה';
      else if (collectible.remaining_receivable <= 0) disabledReason = 'אין יתרת גבייה לחשבונית';

      const canRecord =
        canPaymentWrite && canIncomeIssue && collectible.remaining_receivable > 0;
      if (canRecord) allowedActions.push('record_payment');

      record_payment_form = buildIncomeDocumentRecordPaymentForm({
        incomeDocumentId: doc.id,
        currency: doc.currency || 'ILS',
        remainingBalance: collectible.remaining_receivable,
        enabled: canRecord,
        disabledReason,
      });
    }

    const isCancelled = doc.document_status === 'cancelled_future';
    let edit_action: WorkEngineDocumentEditAction | null = null;
    let convert_action: WorkEngineDocumentConvertAction | null = null;
    let cancel_action: WorkEngineDocumentCancelAction | null = null;
    let reopen_action: WorkEngineDocumentReopenAction | null = null;
    let credit_action: WorkEngineDocumentCreditAction | null = null;
    let conversion_state_key: WorkEngineInvoicesClientDocumentsByTypeRow['conversion_state_key'] =
      null;
    let lifecycle_state: WorkEngineInvoicesClientDocumentsByTypeRow['lifecycle_state'] = null;
    let lifecycle_label: string | null = null;
    let status_detail: string | null = null;
    let linked_document: WorkEngineInvoicesClientDocumentsByTypeRow['linked_document'] = null;
    let row_visual_state: WorkEngineInvoicesClientDocumentsByTypeRow['row_visual_state'] = null;

    if (preliminaryType) {
      lifecycle_state = resolvePreliminaryLifecycleState({
        documentType: doc.document_type,
        documentStatus: doc.document_status,
        storedLifecycle: doc.preliminary_lifecycle_state,
      });
      lifecycle_label = preliminaryLifecycleLabel(lifecycle_state);
      const linkedRaw = doc.preliminary_closed_by_downstream_document_id
        ? linkedDocsById.get(doc.preliminary_closed_by_downstream_document_id)
        : null;
      linked_document = linkedRaw
        ? linkedDocumentRefFromIssuedTarget({
            documentId: linkedRaw.id,
            documentNumber: linkedRaw.document_number,
            documentType: linkedRaw.document_type,
          })
        : null;
      status_detail = buildPreliminaryLifecycleStatusDetail({
        lifecycleState: lifecycle_state,
        linked: linked_document,
      });
      row_visual_state = lifecycle_state === 'closed' ? 'muted' : null;

      conversion_state_key = resolveConversionStateKey({
        sourceStatus: doc.document_status,
        conversionCount: conversionCounts.get(doc.id) ?? 0,
      });

      if (lifecycle_state !== 'closed') {
        edit_action = buildPreliminaryEditAction({
          sourceStatus: doc.document_status,
          canEdit,
          lifecycleState: lifecycle_state,
        });
        if (edit_action.enabled) allowedActions.push(INCOME_COMMAND_BEGIN_EDIT_PRELIMINARY_DOCUMENT);

        const targets = buildConversionTargetOptions({
          sourceType: doc.document_type,
          sourceStatus: doc.document_status,
          canEdit,
          lifecycleState: lifecycle_state,
        });
        const convertEnabled = targets.some((t) => t.enabled);
        convert_action = {
          enabled: convertEnabled,
          label: 'הפקת מסמך',
          command: INCOME_COMMAND_CONVERT_DOCUMENT_TO_DRAFT,
          targets,
        };
        if (convertEnabled) allowedActions.push(INCOME_COMMAND_CONVERT_DOCUMENT_TO_DRAFT);

        const cancelEnabled = !isCancelled && canEdit;
        cancel_action = {
          enabled: cancelEnabled,
          label: 'ביטול',
          command: INCOME_COMMAND_CANCEL_PRELIMINARY_DOCUMENT,
          reason_required: false,
          confirmation_title: 'ביטול המסמך',
          confirmation_body:
            'המסמך לא יימחק. הסטטוס ישתנה למבוטל, והמסמך יישאר בהיסטוריה ובביקורת.',
          disabled_reason: isCancelled
            ? 'המסמך כבר מבוטל'
            : canEdit
              ? null
              : 'אין הרשאת עריכה',
        };
        if (cancelEnabled) allowedActions.push(INCOME_COMMAND_CANCEL_PRELIMINARY_DOCUMENT);
      }

      const reopenCandidate = buildPreliminaryReopenAction({
        lifecycleState: lifecycle_state,
        documentStatus: doc.document_status,
        canEdit,
      });
      if (reopenCandidate.enabled) {
        reopen_action = reopenCandidate;
        allowedActions.push(INCOME_COMMAND_REOPEN_PRELIMINARY_DOCUMENT);
      }
    }

    if (params.documentType === 'tax_invoice') {
      const original = resolveIncomeInvoiceOriginalAmount(doc.totals_snapshot_json);
      const credited = creditedByDoc.get(doc.id) ?? 0;
      const remaining = Math.max(0, original - credited);
      credit_action = buildTaxInvoiceCreditAction({
        remainingCreditable: remaining,
        canEdit,
        creditTypeEnabled,
      });
      if (credit_action.enabled) allowedActions.push(INCOME_COMMAND_BEGIN_TAX_INVOICE_CREDIT);
    }

    const email_delivery = buildIncomeDocumentEmailDeliveryBlock({
      incomeDocumentId: doc.id,
      attemptCount: emailAttemptCounts.get(doc.id) ?? 0,
      permissions: params.permissions,
      representedClientId: params.representedClientId,
      documentStatus: isCancelled ? 'cancelled_future' : 'issued',
      pdfRenderStatus: doc.pdf_render_status,
      pdfAssetId: doc.pdf_asset_id,
    });
    const docflow_delivery = buildIncomeDocumentDocflowDeliveryBlock({
      incomeDocumentId: doc.id,
      attemptCount: docflowAttemptCounts.get(doc.id) ?? 0,
      permissions: params.permissions,
      representedClientId: params.representedClientId,
      documentStatus: isCancelled ? 'cancelled_future' : 'issued',
      pdfRenderStatus: doc.pdf_render_status,
      pdfAssetId: doc.pdf_asset_id,
      docflowEntitled,
      portalActive,
    });
    if (email_delivery.action.enabled) {
      allowedActions.push(email_delivery.action.key);
    }
    if (docflow_delivery.action.enabled) {
      allowedActions.push(docflow_delivery.action.key);
    }

    const status_label = isCancelled
      ? 'מבוטל'
      : lifecycle_state === 'closed'
        ? 'סגור'
        : lifecycle_state === 'open' && status_detail
          ? 'פתוח'
          : 'הונפק';

    return {
      row_id: doc.id,
      document_number: doc.document_number,
      document_type_label: DOCUMENT_TYPE_LABELS[doc.document_type],
      issue_date_display: formatDateDisplay(semanticDates.document_date),
      created_at_display: null,
      customer_display_name: customerDisplayFromSnapshot(doc.customer_snapshot_json),
      amount_display:
        amountRef > 0 ? formatLedgerMoneyReference(amountRef, doc.currency || 'ILS') : '—',
      due_date_display,
      status_label,
      payment_state_key,
      payment_state_label,
      payment_state_tone,
      payment_state_icon,
      document_id: doc.id,
      draft_id: null,
      can_view_document: canViewDoc,
      can_edit_draft: false,
      pdf_download_path: pdf_action.pdf_download_path,
      view_action,
      pdf_action,
      email_delivery,
      docflow_delivery,
      record_payment_form,
      edit_action,
      convert_action,
      cancel_action,
      reopen_action,
      credit_action,
      conversion_state_key,
      lifecycle_state,
      lifecycle_label,
      status_detail,
      linked_document,
      row_visual_state,
      allowed_actions: allowedActions,
      year,
    };
  });
}

async function loadDraftCandidates(params: {
  orgId: string;
  representedClientId: string;
  canEdit: boolean;
  customerNames: Map<string, string>;
}): Promise<Array<WorkEngineInvoicesClientDocumentsByTypeRow & { year: number | null }>> {
  const { data, error } = await supabaseAdmin
    .from('income_document_drafts')
    .select(
      'id, represented_client_id, issuer_business_id, acting_mode, document_type, status, income_customer_id, one_time_customer_snapshot_json, draft_totals_preview_json, currency, updated_at, created_at',
    )
    .eq('organization_id', params.orgId)
    .or(excludeSelfModeActingFilter())
    .eq('status', 'draft')
    .not('user_saved_at', 'is', null)
    .or(officeClientDocumentsOrFilter(params.representedClientId))
    .order('updated_at', { ascending: false })
    .limit(5000);
  throwIfSupabaseError(error, 'loadDocumentsByTypeDrafts');

  return (data ?? [])
    .filter((raw) =>
      belongsToOfficeClientRow(
        raw as {
          represented_client_id: string | null;
          issuer_business_id: string;
          acting_mode: string;
        },
        params.representedClientId,
      ),
    )
    .map((raw) => {
    const draft = raw as {
      id: string;
      document_type: IncomeDocumentType | null;
      income_customer_id: string | null;
      one_time_customer_snapshot_json: Record<string, unknown> | null;
      draft_totals_preview_json: Record<string, unknown> | null;
      currency: string | null;
      updated_at: string;
      created_at: string | null;
    };

    const activityAt = draft.updated_at || draft.created_at;
    const year = yearFromTimestamp(activityAt);

    let customerDisplay: string | null = null;
    if (draft.income_customer_id) {
      customerDisplay = params.customerNames.get(draft.income_customer_id) ?? null;
    } else {
      customerDisplay = customerDisplayFromSnapshot(draft.one_time_customer_snapshot_json);
    }

    const docType = draft.document_type;
    const canEditDraft = params.canEdit;

    return {
      row_id: draft.id,
      document_number: null,
      document_type_label: docType ? DOCUMENT_TYPE_LABELS[docType] : '—',
      issue_date_display: null,
      created_at_display: formatDateDisplay(draft.created_at ?? draft.updated_at),
      customer_display_name: customerDisplay,
      amount_display: amountDisplayFromDraftPreview(
        draft.draft_totals_preview_json,
        draft.currency || 'ILS',
      ),
      due_date_display: null,
      status_label: 'טיוטה',
      payment_state_key: null,
      payment_state_label: null,
      payment_state_tone: null,
      payment_state_icon: null,
      document_id: null,
      draft_id: draft.id,
      can_view_document: false,
      can_edit_draft: canEditDraft,
      pdf_download_path: null,
      view_action: null,
      pdf_action: null,
      email_delivery: null,
      docflow_delivery: null,
      record_payment_form: null,
      edit_action: null,
      convert_action: null,
      cancel_action: null,
      reopen_action: null,
      credit_action: null,
      conversion_state_key: null,
      lifecycle_state: null,
      lifecycle_label: null,
      status_detail: null,
      linked_document: null,
      row_visual_state: null,
      allowed_actions: canEditDraft ? ['edit_draft'] : [],
      year,
    };
  });
}

function resolveAvailableYears(
  candidates: Array<{ year: number | null }>,
): number[] {
  const years = new Set<number>();
  for (const candidate of candidates) {
    if (candidate.year != null) years.add(candidate.year);
  }
  return [...years].sort((a, b) => b - a);
}

function filterCandidatesByYear(
  candidates: Array<WorkEngineInvoicesClientDocumentsByTypeRow & { year: number | null }>,
  selectedYear: number,
): WorkEngineInvoicesClientDocumentsByTypeRow[] {
  return candidates
    .filter((candidate) => candidate.year === selectedYear)
    .map(({ year: _ignored, ...row }) => row);
}

export async function buildWorkEngineInvoicesClientDocumentsByTypeAggregate(params: {
  ctx: RequestContext;
  representedClientId: string;
  documentTypeKey: string;
  year?: number | null;
}): Promise<WorkEngineInvoicesClientDocumentsByTypeAggregate> {
  const aggregateStartMs = Date.now();
  const orgId = params.ctx.organizationId;
  if (!orgId) throw forbidden('Organization context required');

  assertAccess(params.ctx);

  const representedClientId = String(params.representedClientId ?? '').trim();
  if (!representedClientId) throw badRequest('represented_client_id is required');

  const documentTypeKey = parseDocumentTypeKey(params.documentTypeKey);
  const perms = incomeWorkspacePermissionsFromContext(params.ctx);
  const client = await loadRepresentedClient(orgId, representedClientId);
  const isDraftMode = documentTypeKey === 'draft';

  let availableYears: number[] = [];
  let rows: WorkEngineInvoicesClientDocumentsByTypeRow[] = [];
  let selectedYear = new Date().getFullYear();

  if (isDraftMode) {
    const customerNames = await loadCustomerNames(orgId, representedClientId);
    const candidates = await loadDraftCandidates({
      orgId,
      representedClientId,
      canEdit: perms.edit,
      customerNames,
    });
    availableYears = resolveAvailableYears(candidates);
    selectedYear = resolveSelectedYear(availableYears, params.year ?? null);
    rows = filterCandidatesByYear(candidates, selectedYear);
  } else {
    const issuedType = documentTypeKey as IncomeDocumentType;
    if (!ISSUED_DOCUMENT_TYPES.includes(issuedType)) {
      throw badRequest('document_type_key is invalid for issued documents');
    }
    const candidates = await loadIssuedDocumentCandidates({
      ctx: params.ctx,
      orgId,
      representedClientId,
      documentType: issuedType,
      canView: perms.view,
      permissions: perms,
    });
    availableYears = resolveAvailableYears(candidates);
    selectedYear = resolveSelectedYear(availableYears, params.year ?? null);
    rows = filterCandidatesByYear(candidates, selectedYear);
  }
  const allowedActions = ['view_invoices_client_documents_by_type'];
  if (isDraftMode && perms.edit) allowedActions.push('edit_income_document_draft');
  if (!isDraftMode && perms.view) allowedActions.push('view_income_document');

  const tableColumns = isDraftMode
    ? DRAFT_TABLE_COLUMNS
    : documentTypeKey === 'tax_invoice'
      ? TAX_INVOICE_TABLE_COLUMNS
      : documentTypeKey === 'quote' || documentTypeKey === 'deal_invoice'
        ? PRELIMINARY_ISSUED_TABLE_COLUMNS
        : ISSUED_TABLE_COLUMNS;

  const response: WorkEngineInvoicesClientDocumentsByTypeAggregate = {
    aggregate_key: WORK_ENGINE_INVOICES_CLIENT_DOCUMENTS_BY_TYPE_AGGREGATE_KEY,
    represented_client_id: representedClientId,
    client_display_name: client.display_name,
    document_type_key: documentTypeKey,
    document_type_label: COUNTER_LABELS[documentTypeKey],
    selected_year: selectedYear,
    available_years: availableYears.length > 0 ? availableYears : [selectedYear],
    is_draft_mode: isDraftMode,
    table_columns: tableColumns,
    rows,
    allowed_actions: allowedActions,
    empty_state: {
      visible: rows.length === 0,
      title: 'אין מסמכים',
      description: null,
    },
  };
  logAggregatePayloadBreakdown(
    WORK_ENGINE_INVOICES_CLIENT_DOCUMENTS_BY_TYPE_AGGREGATE_KEY,
    response as unknown as Record<string, unknown>,
    {
      correlation_id: params.ctx.correlationId ?? null,
      organization_id: orgId,
      duration_ms: Date.now() - aggregateStartMs,
    },
  );
  return response;
}

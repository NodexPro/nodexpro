/**
 * Work Engine invoices tab — client documents by type/year aggregate.
 * Single explicit read model for the documents-by-type modal.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import {
  issueYearFromIso,
  ledgerAmountFromTotalsSnapshot,
  formatLedgerMoneyReference,
} from '../income/income-client-income-ledger-card.pure.js';
import { formatMoneyReference } from '../income/income-document-draft-lines.pure.js';
import { incomeDocumentDownloadPath } from '../income/income-document-pdf.service.js';
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
  WORK_ENGINE_INVOICES_CLIENT_DOCUMENTS_BY_TYPE_AGGREGATE_KEY,
  type IncomeClientDocumentTypeCounterKey,
  type IncomeDocumentType,
  type IncomeWorkspacePermissions,
  type WorkEngineInvoicesClientDocumentsByTypeAggregate,
  type WorkEngineInvoicesClientDocumentsByTypeRow,
} from '../income/income.types.js';

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
  { key: 'issue_date_display', label: 'תאריך' },
  { key: 'customer_display_name', label: 'לקוח' },
  { key: 'amount_display', label: 'סכום' },
  { key: 'status_label', label: 'סטטוס' },
  { key: 'email_delivery', label: '@' },
  { key: 'docflow_delivery', label: 'דוקפלו' },
  { key: 'view', label: 'צפייה' },
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
  if (!iso) return '—';
  const d = iso.length >= 10 ? iso.slice(0, 10) : iso;
  return new Date(d).toLocaleDateString('he-IL');
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

async function loadIssuedDocumentCandidates(params: {
  orgId: string;
  representedClientId: string;
  documentType: IncomeDocumentType;
  canView: boolean;
  permissions: IncomeWorkspacePermissions;
}): Promise<Array<WorkEngineInvoicesClientDocumentsByTypeRow & { year: number | null }>> {
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select(
      'id, represented_client_id, issuer_business_id, acting_mode, document_number, document_type, issue_date, currency, totals_snapshot_json, customer_snapshot_json, pdf_render_status, pdf_asset_id, created_at',
    )
    .eq('organization_id', params.orgId)
    .or(excludeSelfModeActingFilter())
    .eq('document_status', 'issued')
    .eq('document_type', params.documentType)
    .or(officeClientDocumentsOrFilter(params.representedClientId))
    .order('issue_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(5000);
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
  const [emailAttemptCounts, docflowAttemptCounts, docflowEntitled, portalActive] = await Promise.all([
    loadEmailAttemptCountsByDocumentIds(params.orgId, documentIds),
    loadDocflowAttemptCountsByDocumentIds(params.orgId, documentIds),
    isDocflowEntitledForOrg(params.orgId),
    loadRepresentedClientDocflowPortalActive(params.orgId, params.representedClientId),
  ]);

  return filtered.map((raw) => {
    const doc = raw as {
      id: string;
      document_number: string;
      document_type: IncomeDocumentType;
      issue_date: string;
      currency: string;
      totals_snapshot_json: Record<string, unknown> | null;
      customer_snapshot_json: Record<string, unknown> | null;
      pdf_render_status: string;
      pdf_asset_id: string | null;
    };
    const year = issueYearFromIso(doc.issue_date);
    const amountRef = ledgerAmountFromTotalsSnapshot(doc.totals_snapshot_json);
    const canViewDoc =
      params.canView && doc.pdf_render_status === 'rendered' && Boolean(doc.pdf_asset_id);
    const pdfPath = canViewDoc ? incomeDocumentDownloadPath(doc.id) : null;

    return {
      row_id: doc.id,
      document_number: doc.document_number,
      document_type_label: DOCUMENT_TYPE_LABELS[doc.document_type],
      issue_date_display: formatDateDisplay(doc.issue_date),
      created_at_display: null,
      customer_display_name: customerDisplayFromSnapshot(doc.customer_snapshot_json),
      amount_display:
        amountRef > 0 ? formatLedgerMoneyReference(amountRef, doc.currency || 'ILS') : '—',
      status_label: 'הונפק',
      document_id: doc.id,
      draft_id: null,
      can_view_document: canViewDoc,
      can_edit_draft: false,
      pdf_download_path: pdfPath,
      email_delivery: buildIncomeDocumentEmailDeliveryBlock({
        incomeDocumentId: doc.id,
        attemptCount: emailAttemptCounts.get(doc.id) ?? 0,
        permissions: params.permissions,
        representedClientId: params.representedClientId,
        documentStatus: 'issued',
        pdfRenderStatus: doc.pdf_render_status,
        pdfAssetId: doc.pdf_asset_id,
      }),
      docflow_delivery: buildIncomeDocumentDocflowDeliveryBlock({
        incomeDocumentId: doc.id,
        attemptCount: docflowAttemptCounts.get(doc.id) ?? 0,
        permissions: params.permissions,
        representedClientId: params.representedClientId,
        documentStatus: 'issued',
        pdfRenderStatus: doc.pdf_render_status,
        pdfAssetId: doc.pdf_asset_id,
        docflowEntitled,
        portalActive,
      }),
      allowed_actions: canViewDoc ? ['view_document'] : [],
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
      status_label: 'טיוטה',
      document_id: null,
      draft_id: draft.id,
      can_view_document: false,
      can_edit_draft: canEditDraft,
      pdf_download_path: null,
      email_delivery: null,
      docflow_delivery: null,
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

  return {
    aggregate_key: WORK_ENGINE_INVOICES_CLIENT_DOCUMENTS_BY_TYPE_AGGREGATE_KEY,
    represented_client_id: representedClientId,
    client_display_name: client.display_name,
    document_type_key: documentTypeKey,
    document_type_label: COUNTER_LABELS[documentTypeKey],
    selected_year: selectedYear,
    available_years: availableYears.length > 0 ? availableYears : [selectedYear],
    is_draft_mode: isDraftMode,
    table_columns: isDraftMode ? DRAFT_TABLE_COLUMNS : ISSUED_TABLE_COLUMNS,
    rows,
    allowed_actions: allowedActions,
    empty_state: {
      visible: rows.length === 0,
      title: 'אין מסמכים',
      description: null,
    },
  };
}

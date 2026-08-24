/**
 * INV-1 P4 — email history aggregates (document + represented client scope).
 *
 * Document send recipient prefill = invoice customer / delivery contact
 * (never Core represented-client issuer email).
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import {
  assertRowMatchesIssuerScope,
  reqUuid,
  type ActiveIncomeIssuerScope,
} from './income.guards.js';
import { incomeWorkspacePermissionsFromContext } from './income-issuer-context.service.js';
import { resolveIssuerScopeForIssuedDocument } from './income-issued-document-issuer-scope.service.js';
import {
  buildIncomeDocumentEmailSendForm,
  buildIncomeDocumentEmailSendView,
  mapDeliveryAttemptToDocumentHistoryRow,
  normalizeIncomeDocumentRecipientEmailPrefill,
  resolveIncomeDocumentEmailSendEligibility,
  toIncomeDocumentPdfSendReadinessView,
  deliveryAttemptResultLabel,
  formatEmailDeliverySentAtDisplay,
  subjectPreviewFromMessageSnapshot,
} from './income-document-email-delivery.read-model.pure.js';
import {
  listIncomeDocumentEmailAttempts,
  listRepresentedClientEmailAttempts,
  loadIncomeDocumentsMetaByIds,
} from './income-document-email-delivery.read-model.service.js';
import { customerDisplayNameFromSnapshot } from './income-document-email-delivery.pure.js';
import { ensureIssuedDocumentCanonicalPdfAsset } from './income-document-pdf.service.js';
import { hasCanonicalIncomeDocumentPdfAsset } from './income-document-pdf-send-readiness.pure.js';
import { resolveIssuedDocumentEmailRecipientPrefill } from './income-document-email-recipient-prefill.pure.js';
import { loadIncomeRecipientById } from './income-recipient.service.js';
import type { IncomeDocumentType } from './income.types.js';
import {
  INCOME_COMMAND_RETRY_PDF_RENDER,
  INCOME_COMMAND_SEND_DOCUMENT_BY_EMAIL,
  INCOME_DOCUMENT_EMAIL_HISTORY_AGGREGATE_KEY,
  INCOME_REPRESENTED_CLIENT_EMAIL_HISTORY_AGGREGATE_KEY,
  type IncomeDocumentEmailHistoryAggregate,
  type IncomeRepresentedClientEmailHistoryAggregate,
} from './income.types.js';

const DOCUMENT_TYPE_LABELS: Record<IncomeDocumentType, string> = {
  quote: 'הצעת מחיר',
  deal_invoice: 'חשבון עסקה',
  tax_invoice: 'חשבונית מס',
  tax_invoice_receipt: 'חשבונית מס/קבלה',
  receipt: 'קבלה',
  credit_tax_invoice: 'זיכוי',
};

const DOCUMENT_HISTORY_COLUMNS = [
  { key: 'sent_at_display', label: 'נשלח בתאריך' },
  { key: 'recipient_email', label: 'נמען' },
  { key: 'result_label', label: 'סטטוס' },
  { key: 'subject_preview', label: 'נושא' },
];

const CLIENT_HISTORY_COLUMNS = [
  { key: 'sent_at_display', label: 'נשלח בתאריך' },
  { key: 'document_number', label: 'מספר מסמך' },
  { key: 'document_type_label', label: 'סוג מסמך' },
  { key: 'recipient_email', label: 'נמען' },
  { key: 'result_label', label: 'סטטוס' },
];

function assertEmailHistoryViewAccess(ctx: RequestContext): void {
  const perms = incomeWorkspacePermissionsFromContext(ctx);
  if (!perms.view) throw forbidden('income.view required');
}

function assertClientEmailHistoryAccess(ctx: RequestContext): void {
  assertEmailHistoryViewAccess(ctx);
  const perms = incomeWorkspacePermissionsFromContext(ctx);
  if (!perms.issue_on_behalf) throw forbidden('income.issue_on_behalf required');
}

async function loadIssuedDocumentForHistory(
  orgId: string,
  incomeDocumentId: string,
): Promise<{
  id: string;
  organization_id: string;
  issuer_business_id: string;
  represented_client_id: string | null;
  document_number: string;
  document_type: IncomeDocumentType;
  document_status: string;
  pdf_render_status: string;
  pdf_asset_id: string | null;
  income_customer_id: string | null;
  customer_snapshot_json: Record<string, unknown> | null;
  source_draft_id: string | null;
}> {
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select(
      'id, organization_id, issuer_business_id, represented_client_id, document_number, document_type, document_status, pdf_render_status, pdf_asset_id, income_customer_id, customer_snapshot_json, source_draft_id',
    )
    .eq('id', incomeDocumentId)
    .eq('organization_id', orgId)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadIssuedDocumentForEmailHistory');
  if (!data) throw notFound('Income document not found');
  return data as {
    id: string;
    organization_id: string;
    issuer_business_id: string;
    represented_client_id: string | null;
    document_number: string;
    document_type: IncomeDocumentType;
    document_status: string;
    pdf_render_status: string;
    pdf_asset_id: string | null;
    income_customer_id: string | null;
    customer_snapshot_json: Record<string, unknown> | null;
    source_draft_id: string | null;
  };
}

async function loadDraftDeliveryContactJson(
  orgId: string,
  draftId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseAdmin
    .from('income_document_drafts')
    .select('delivery_contact_json')
    .eq('organization_id', orgId)
    .eq('id', draftId)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadDraftDeliveryContactForEmailHistory');
  const row = data as { delivery_contact_json?: Record<string, unknown> | null } | null;
  return row?.delivery_contact_json ?? null;
}

async function resolveDocumentRecipientEmailDefault(params: {
  scope: ActiveIncomeIssuerScope;
  doc: {
    income_customer_id: string | null;
    customer_snapshot_json: Record<string, unknown> | null;
    source_draft_id: string | null;
  };
}): Promise<string | null> {
  let draftDeliveryContactJson: unknown = null;
  if (params.doc.source_draft_id) {
    draftDeliveryContactJson = await loadDraftDeliveryContactJson(
      params.scope.org_id,
      params.doc.source_draft_id,
    );
  }

  let incomeCustomerEmail: string | null = null;
  if (params.doc.income_customer_id) {
    const customer = await loadIncomeRecipientById(params.scope, params.doc.income_customer_id);
    incomeCustomerEmail = customer?.email ?? null;
  }

  return resolveIssuedDocumentEmailRecipientPrefill({
    incomeCustomerId: params.doc.income_customer_id,
    draftDeliveryContactJson,
    incomeCustomerEmail,
    customerSnapshotJson: params.doc.customer_snapshot_json,
  });
}

async function loadRepresentedClient(orgId: string, clientId: string) {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id, display_name, email, is_archived')
    .eq('organization_id', orgId)
    .eq('id', clientId)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadEmailHistoryRepresentedClient');
  const row = data as {
    id: string;
    display_name: string;
    email: string | null;
    is_archived: boolean;
  } | null;
  if (!row || row.is_archived) throw notFound('Office client not found');
  return {
    id: row.id,
    display_name: row.display_name,
    email: normalizeIncomeDocumentRecipientEmailPrefill(row.email),
  };
}

export async function buildIncomeDocumentEmailHistoryAggregate(params: {
  ctx: RequestContext;
  incomeDocumentId: string;
}): Promise<IncomeDocumentEmailHistoryAggregate> {
  assertEmailHistoryViewAccess(params.ctx);
  const incomeDocumentId = reqUuid(params.incomeDocumentId, 'income_document_id');
  const orgId = params.ctx.organizationId;
  if (!orgId) throw forbidden('Organization context required');
  const doc = await loadIssuedDocumentForHistory(orgId, incomeDocumentId);
  const scope = await resolveIssuerScopeForIssuedDocument(params.ctx, doc);
  assertRowMatchesIssuerScope(scope, doc);

  const attempts = await listIncomeDocumentEmailAttempts(scope.org_id, incomeDocumentId);
  let pdfAssetId = doc.pdf_asset_id;
  let pdfRenderStatus = doc.pdf_render_status;
  const canEnsureCanonicalPdf =
    Boolean(scope.permissions.issue) &&
    Boolean(scope.represented_client_id) &&
    doc.document_status === 'issued';
  if (canEnsureCanonicalPdf && !hasCanonicalIncomeDocumentPdfAsset(pdfAssetId)) {
    const ensured = await ensureIssuedDocumentCanonicalPdfAsset(
      params.ctx,
      scope.org_id,
      incomeDocumentId,
    );
    pdfAssetId = ensured.pdf_asset_id;
    pdfRenderStatus = ensured.pdf_render_status;
  }

  const sendEligibility = resolveIncomeDocumentEmailSendEligibility({
    permissions: scope.permissions,
    representedClientId: scope.represented_client_id,
    documentStatus: doc.document_status,
    pdfRenderStatus,
    pdfAssetId,
  });

  const recipientEmailDefault = await resolveDocumentRecipientEmailDefault({ scope, doc });

  const rows = attempts.map((attempt) => mapDeliveryAttemptToDocumentHistoryRow(attempt));
  const allowedActions = ['view_income_document_email_history'];
  if (sendEligibility.enabled) {
    allowedActions.push(INCOME_COMMAND_SEND_DOCUMENT_BY_EMAIL);
  }
  if (sendEligibility.retry_pdf_render_allowed) {
    allowedActions.push(INCOME_COMMAND_RETRY_PDF_RENDER);
  }

  const documentTypeLabel = DOCUMENT_TYPE_LABELS[doc.document_type];
  const sendForm = buildIncomeDocumentEmailSendForm({
    incomeDocumentId,
    sendEligibility,
    recipientEmailDefault,
  });
  const senderDisplayName =
    scope.represented_client_label?.trim() || scope.issuer_label.trim();

  return {
    aggregate_key: INCOME_DOCUMENT_EMAIL_HISTORY_AGGREGATE_KEY,
    income_document_id: incomeDocumentId,
    document_number: doc.document_number,
    document_type_label: documentTypeLabel,
    represented_client_id: doc.represented_client_id,
    recipient_email_default: recipientEmailDefault,
    pdf_send_readiness: toIncomeDocumentPdfSendReadinessView(sendEligibility.pdf_readiness),
    table_columns: DOCUMENT_HISTORY_COLUMNS,
    rows,
    send_form: sendForm,
    send_view: buildIncomeDocumentEmailSendView({
      documentTypeLabel,
      documentNumber: doc.document_number,
      senderDisplayName,
      recipientDisplayName: customerDisplayNameFromSnapshot(doc.customer_snapshot_json) ?? '',
      sendEligibility,
      emailFieldPresent: sendForm.fields.some((field) => field.key === 'recipient_email'),
      historyAvailable: rows.length > 0,
      pdfAssetId,
    }),
    allowed_actions: allowedActions,
    empty_state: {
      visible: rows.length === 0,
      title: 'אין היסטוריית שליחה במייל',
      description: 'מסמך זה טרם נשלח במייל.',
    },
  };
}

export async function buildIncomeRepresentedClientEmailHistoryAggregate(params: {
  ctx: RequestContext;
  representedClientId: string;
  /** Optional: scope history to a single end customer under the represented client. */
  incomeCustomerId?: string | null;
}): Promise<IncomeRepresentedClientEmailHistoryAggregate> {
  assertClientEmailHistoryAccess(params.ctx);
  const representedClientId = reqUuid(params.representedClientId, 'represented_client_id');
  const incomeCustomerIdRaw = String(params.incomeCustomerId ?? '').trim();
  const incomeCustomerId = incomeCustomerIdRaw
    ? reqUuid(incomeCustomerIdRaw, 'income_customer_id')
    : null;
  const orgId = params.ctx.organizationId;
  if (!orgId) throw forbidden('Organization context required');
  const client = await loadRepresentedClient(orgId, representedClientId);
  const attempts = await listRepresentedClientEmailAttempts(orgId, representedClientId);
  const documentIds = [...new Set(attempts.map((a) => a.sourceEntityId))];
  const docMeta = await loadIncomeDocumentsMetaByIds(orgId, documentIds);

  const rows = attempts
    .map((attempt) => {
      const meta = docMeta.get(attempt.sourceEntityId);
      return {
        attempt_id: attempt.id,
        income_document_id: attempt.sourceEntityId,
        document_number: meta?.document_number ?? null,
        document_type_label: meta?.document_type_label ?? null,
        sent_at_display: formatEmailDeliverySentAtDisplay(attempt.sentAt),
        recipient_email: attempt.recipientEmail,
        result: attempt.result,
        result_label: deliveryAttemptResultLabel(attempt.result),
        failure_reason: attempt.failureReason,
        subject_preview: subjectPreviewFromMessageSnapshot(attempt.messageSnapshotJson),
        income_customer_id: meta?.income_customer_id ?? null,
      };
    })
    .filter((row) =>
      incomeCustomerId ? row.income_customer_id === incomeCustomerId : true,
    )
    .map(({ income_customer_id: _omit, ...row }) => row);

  return {
    aggregate_key: INCOME_REPRESENTED_CLIENT_EMAIL_HISTORY_AGGREGATE_KEY,
    represented_client_id: representedClientId,
    income_customer_id: incomeCustomerId,
    client_display_name: client.display_name,
    table_columns: CLIENT_HISTORY_COLUMNS,
    rows,
    allowed_actions: ['view_income_represented_client_email_history'],
    empty_state: {
      visible: rows.length === 0,
      title: 'אין היסטוריית שליחה במייל',
      description: incomeCustomerId
        ? 'טרם נשלחו מסמכי הכנסה במייל עבור לקוח קצה זה.'
        : 'טרם נשלחו מסמכי הכנסה במייל עבור לקוח זה.',
    },
  };
}

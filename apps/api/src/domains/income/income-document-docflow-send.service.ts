/**
 * INV-1 P7 — DocFlow send confirm aggregate for issued income documents.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { assertRowMatchesIssuerScope, reqUuid } from './income.guards.js';
import { loadActiveIncomeIssuerScope } from './income-issuer-scope.service.js';
import { incomeWorkspacePermissionsFromContext } from './income-issuer-context.service.js';
import {
  buildIncomeDocumentDocflowSendForm,
  mapDeliveryAttemptToDocflowHistoryRow,
} from './income-document-docflow-delivery.read-model.pure.js';
import { resolveIncomeDocumentDocflowSendEligibility } from './income-document-docflow-delivery.pure.js';
import {
  isDocflowEntitledForOrg,
  listIncomeDocumentDocflowAttempts,
  loadRepresentedClientDocflowPortalActive,
} from './income-document-email-delivery.read-model.service.js';
import type { IncomeDocumentType } from './income.types.js';
import {
  INCOME_COMMAND_SEND_DOCUMENT_BY_DOCFLOW,
  INCOME_DOCUMENT_DOCFLOW_SEND_AGGREGATE_KEY,
  type IncomeDocumentDocflowSendAggregate,
} from './income.types.js';

const DOCUMENT_TYPE_LABELS: Record<IncomeDocumentType, string> = {
  quote: 'הצעת מחיר',
  deal_invoice: 'חשבון עסקה',
  tax_invoice: 'חשבונית מס',
  tax_invoice_receipt: 'חשבונית מס/קבלה',
  receipt: 'קבלה',
  credit_tax_invoice: 'זיכוי',
};

const DOC_HISTORY_COLUMNS = [
  { key: 'sent_at_display', label: 'נשלח בתאריך' },
  { key: 'result_label', label: 'סטטוס' },
  { key: 'body_preview', label: 'הודעה' },
];

function assertDocflowSendViewAccess(ctx: RequestContext): void {
  const perms = incomeWorkspacePermissionsFromContext(ctx);
  if (!perms.view) throw forbidden('income.view required');
}

async function loadIssuedDocumentForDocflowSend(
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
}> {
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select(
      'id, organization_id, issuer_business_id, represented_client_id, document_number, document_type, document_status, pdf_render_status, pdf_asset_id',
    )
    .eq('id', incomeDocumentId)
    .eq('organization_id', orgId)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadIssuedDocumentForDocflowSend');
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
  };
}

async function loadRepresentedClientDisplayName(orgId: string, clientId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('display_name, is_archived')
    .eq('organization_id', orgId)
    .eq('id', clientId)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadDocflowSendRepresentedClient');
  const row = data as { display_name: string; is_archived: boolean } | null;
  if (!row || row.is_archived) throw notFound('Office client not found');
  return row.display_name;
}

export async function buildIncomeDocumentDocflowSendAggregate(params: {
  ctx: RequestContext;
  incomeDocumentId: string;
}): Promise<IncomeDocumentDocflowSendAggregate> {
  assertDocflowSendViewAccess(params.ctx);
  const incomeDocumentId = reqUuid(params.incomeDocumentId, 'income_document_id');
  const scope = await loadActiveIncomeIssuerScope(params.ctx);
  const doc = await loadIssuedDocumentForDocflowSend(scope.org_id, incomeDocumentId);
  assertRowMatchesIssuerScope(scope, doc);

  const [attempts, docflowEntitled, portalActive] = await Promise.all([
    listIncomeDocumentDocflowAttempts(scope.org_id, incomeDocumentId),
    isDocflowEntitledForOrg(scope.org_id),
    doc.represented_client_id
      ? loadRepresentedClientDocflowPortalActive(scope.org_id, doc.represented_client_id)
      : Promise.resolve(false),
  ]);

  const sendEligibility = resolveIncomeDocumentDocflowSendEligibility({
    permissions: scope.permissions,
    representedClientId: scope.represented_client_id,
    documentStatus: doc.document_status,
    pdfRenderStatus: doc.pdf_render_status,
    pdfAssetId: doc.pdf_asset_id,
    docflowEntitled,
    portalActive,
  });

  const rows = attempts.map((attempt) => mapDeliveryAttemptToDocflowHistoryRow(attempt));
  const allowedActions = ['view_income_document_docflow_send'];
  if (sendEligibility.enabled) {
    allowedActions.push(INCOME_COMMAND_SEND_DOCUMENT_BY_DOCFLOW);
  }

  const clientDisplayName =
    doc.represented_client_id != null
      ? await loadRepresentedClientDisplayName(scope.org_id, doc.represented_client_id)
      : null;

  return {
    aggregate_key: INCOME_DOCUMENT_DOCFLOW_SEND_AGGREGATE_KEY,
    income_document_id: incomeDocumentId,
    document_number: doc.document_number,
    document_type_label: DOCUMENT_TYPE_LABELS[doc.document_type],
    represented_client_id: doc.represented_client_id,
    client_display_name: clientDisplayName,
    table_columns: DOC_HISTORY_COLUMNS,
    rows,
    send_form: buildIncomeDocumentDocflowSendForm({
      incomeDocumentId,
      sendEligibility,
    }),
    allowed_actions: allowedActions,
    empty_state: {
      visible: rows.length === 0,
      title: 'אין היסטוריית שליחה בדוקפלו',
      description: 'מסמך זה טרם נשלח ללקוח בדוקפלו.',
    },
  };
}

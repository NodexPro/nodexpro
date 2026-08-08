/**
 * Issued document VIEW aggregate — immutable snapshot HTML via unified renderer.
 * Does not require pdf_asset_id. PDF binary remains a separate capability.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { assertRowMatchesIssuerScope, reqUuid } from './income.guards.js';
import { incomeWorkspacePermissionsFromContext } from './income-issuer-context.service.js';
import { loadActiveIncomeIssuerScope } from './income-issuer-scope.service.js';
import {
  buildIncomeIssuedDocumentPdfAction,
} from './income-document-view-action.pure.js';
import { incomeDocumentDownloadPath } from './income-document-pdf.service.js';
import { renderUnifiedIncomeDocumentHtml } from './income-document-unified-render.html.js';
import {
  buildUnifiedIncomeDocumentRenderModelForIssuedDocument,
  type IssuedIncomeDocumentForRender,
} from './income-document-unified-render.service.js';
import {
  INCOME_COMMAND_RETRY_PDF_RENDER,
  INCOME_ISSUED_DOCUMENT_VIEW_AGGREGATE_KEY,
  type IncomeDocumentType,
  type IncomeIssuedDocumentViewAggregate,
} from './income.types.js';

const DOCUMENT_TYPE_LABELS: Record<IncomeDocumentType, string> = {
  quote: 'הצעת מחיר',
  deal_invoice: 'חשבון עסקה',
  tax_invoice: 'חשבונית מס',
  tax_invoice_receipt: 'חשבונית מס/קבלה',
  receipt: 'קבלה',
  credit_tax_invoice: 'זיכוי',
};

type IssuedDocForView = IssuedIncomeDocumentForRender & {
  document_status: string;
  pdf_render_status: string;
  pdf_asset_id: string | null;
  pdf_render_error: string | null;
};

async function loadIssuedDocumentForView(
  orgId: string,
  incomeDocumentId: string,
): Promise<IssuedDocForView> {
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select(
      'id, organization_id, issuer_business_id, represented_client_id, document_type, document_number, document_status, issue_date, due_date, currency, language, notes, issuer_snapshot_json, customer_snapshot_json, lines_snapshot_json, totals_snapshot_json, source_draft_id, tax_allocation_number, pdf_render_status, pdf_asset_id, pdf_render_error',
    )
    .eq('id', incomeDocumentId)
    .eq('organization_id', orgId)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadIssuedDocumentForView');
  if (!data) throw notFound('Income document not found');
  return data as IssuedDocForView;
}

export async function buildIncomeIssuedDocumentViewAggregate(params: {
  ctx: RequestContext;
  incomeDocumentId: string;
}): Promise<IncomeIssuedDocumentViewAggregate> {
  const perms = incomeWorkspacePermissionsFromContext(params.ctx);
  if (!perms.view) throw forbidden('income.view required');

  const incomeDocumentId = reqUuid(params.incomeDocumentId, 'income_document_id');
  const scope = await loadActiveIncomeIssuerScope(params.ctx);
  const doc = await loadIssuedDocumentForView(scope.org_id, incomeDocumentId);
  assertRowMatchesIssuerScope(scope, doc);

  if (doc.document_status !== 'issued') {
    throw forbidden('Only issued documents can be viewed as final documents');
  }

  const renderModel = await buildUnifiedIncomeDocumentRenderModelForIssuedDocument(scope, doc);
  const document_html = renderUnifiedIncomeDocumentHtml(renderModel);

  const pdfPath =
    doc.pdf_render_status === 'rendered' && doc.pdf_asset_id
      ? incomeDocumentDownloadPath(doc.id)
      : null;
  const pdf_action = buildIncomeIssuedDocumentPdfAction({
    incomeDocumentId: doc.id,
    canRetryPdf: perms.issue,
    pdfRenderStatus: doc.pdf_render_status,
    pdfAssetId: doc.pdf_asset_id,
    pdfDownloadPath: pdfPath,
    pdfRenderError: doc.pdf_render_error,
  });

  const typeLabel = DOCUMENT_TYPE_LABELS[doc.document_type];
  const allowedActions = ['view_issued_document'];
  if (pdf_action.retry_command) {
    allowedActions.push(INCOME_COMMAND_RETRY_PDF_RENDER);
  }
  if (pdf_action.enabled) {
    allowedActions.push('download_pdf');
  }

  return {
    aggregate_key: INCOME_ISSUED_DOCUMENT_VIEW_AGGREGATE_KEY,
    income_document_id: doc.id,
    document_number: doc.document_number,
    document_type_label: typeLabel,
    title: `${typeLabel} ${doc.document_number}`,
    read_only: true,
    view_mode: 'issued_html',
    document_html,
    pdf_action,
    allowed_actions: allowedActions,
  };
}

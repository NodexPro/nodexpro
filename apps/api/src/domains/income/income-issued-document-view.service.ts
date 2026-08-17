/**
 * Issued document VIEW aggregate — immutable snapshot HTML via unified renderer.
 * Does not require pdf_asset_id. PDF binary remains a separate capability.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import {
  assertRowMatchesIssuerScope,
  optionalUuid,
  reqUuid,
} from './income.guards.js';
import { incomeWorkspacePermissionsFromContext } from './income-issuer-context.service.js';
import { assertIncomeEditPermission } from './income-issuer-scope.service.js';
import { resolveIssuerScopeForIssuedDocument } from './income-issued-document-issuer-scope.service.js';
import {
  buildIncomeIssuedDocumentPdfAction,
} from './income-document-view-action.pure.js';
import { incomeDocumentDownloadPath } from './income-document-pdf.service.js';
import { renderUnifiedIncomeDocumentHtml } from './income-document-unified-render.html.js';
import {
  buildUnifiedIncomeDocumentRenderModelForIssuedDocument,
  type IssuedIncomeDocumentForRender,
} from './income-document-unified-render.service.js';
import { buildIncomeDocumentEmailDeliveryBlock } from './income-document-email-delivery.read-model.pure.js';
import { buildIncomeDocumentDocflowDeliveryBlock } from './income-document-docflow-delivery.read-model.pure.js';
import {
  loadEmailAttemptCountsByDocumentIds,
  loadDocflowAttemptCountsByDocumentIds,
  isDocflowEntitledForOrg,
  loadRepresentedClientDocflowPortalActive,
} from './income-document-email-delivery.read-model.service.js';
import {
  buildIncomeDocumentAllocationNumberField,
  normalizeAllocationNumberInput,
  validateAllocationNumberFormat,
} from './income-document-allocation-number.pure.js';
import { resolveIncomeTaxAllocationNumberPolicyForOrg } from './income-document-allocation-number-resolver.js';
import {
  INCOME_COMMAND_RETRY_PDF_RENDER,
  INCOME_COMMAND_UPDATE_ALLOCATION_NUMBER,
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
      'id, organization_id, issuer_business_id, represented_client_id, document_type, document_number, document_status, issue_date, due_date, currency, language, notes, issuer_snapshot_json, customer_snapshot_json, lines_snapshot_json, totals_snapshot_json, source_draft_id, income_customer_id, tax_allocation_number, owner_layout_version_id, owner_layout_snapshot_json, pdf_render_status, pdf_asset_id, pdf_render_error',
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

  const orgId = params.ctx.organizationId;
  if (!orgId) throw forbidden('Organization context required');

  const incomeDocumentId = reqUuid(params.incomeDocumentId, 'income_document_id');
  const doc = await loadIssuedDocumentForView(orgId, incomeDocumentId);
  const scope = await resolveIssuerScopeForIssuedDocument(params.ctx, doc);
  assertRowMatchesIssuerScope(scope, doc);

  if (doc.document_status !== 'issued') {
    throw forbidden('Only issued documents can be viewed as final documents');
  }

  const renderModel = await buildUnifiedIncomeDocumentRenderModelForIssuedDocument(scope, doc);
  const document_html = renderUnifiedIncomeDocumentHtml(renderModel);

  const allocationPolicy = await resolveIncomeTaxAllocationNumberPolicyForOrg(
    scope.org_id,
    'IL',
    doc.issue_date,
  );
  const allocation_number_field = buildIncomeDocumentAllocationNumberField({
    policy: allocationPolicy,
    documentType: doc.document_type,
    value: doc.tax_allocation_number ?? null,
    canEdit: perms.edit,
    isIssued: true,
  });

  const pdfPath = doc.pdf_asset_id ? incomeDocumentDownloadPath(doc.id) : null;
  const pdf_action = buildIncomeIssuedDocumentPdfAction({
    incomeDocumentId: doc.id,
    canRetryPdf: perms.issue,
    pdfRenderStatus: doc.pdf_render_status,
    pdfAssetId: doc.pdf_asset_id,
    pdfDownloadPath: pdfPath,
    pdfRenderError: doc.pdf_render_error,
  });

  const [emailAttemptCounts, docflowAttemptCounts, docflowEntitled, portalActive] = await Promise.all([
    loadEmailAttemptCountsByDocumentIds(scope.org_id, [doc.id]),
    loadDocflowAttemptCountsByDocumentIds(scope.org_id, [doc.id]),
    isDocflowEntitledForOrg(scope.org_id),
    scope.represented_client_id
      ? loadRepresentedClientDocflowPortalActive(scope.org_id, scope.represented_client_id)
      : Promise.resolve(false),
  ]);

  const email_delivery = buildIncomeDocumentEmailDeliveryBlock({
    incomeDocumentId: doc.id,
    attemptCount: emailAttemptCounts.get(doc.id) ?? 0,
    permissions: scope.permissions,
    representedClientId: scope.represented_client_id,
    documentStatus: doc.document_status,
    pdfRenderStatus: doc.pdf_render_status,
    pdfAssetId: doc.pdf_asset_id,
  });
  const docflow_delivery = buildIncomeDocumentDocflowDeliveryBlock({
    incomeDocumentId: doc.id,
    attemptCount: docflowAttemptCounts.get(doc.id) ?? 0,
    permissions: scope.permissions,
    representedClientId: scope.represented_client_id,
    documentStatus: doc.document_status,
    pdfRenderStatus: doc.pdf_render_status,
    pdfAssetId: doc.pdf_asset_id,
    docflowEntitled,
    portalActive,
  });

  const typeLabel = DOCUMENT_TYPE_LABELS[doc.document_type];
  const allowedActions = ['view_issued_document'];
  if (allocation_number_field.editable) {
    allowedActions.push(INCOME_COMMAND_UPDATE_ALLOCATION_NUMBER);
  }
  if (pdf_action.retry_command) {
    allowedActions.push(INCOME_COMMAND_RETRY_PDF_RENDER);
  }
  if (pdf_action.enabled) {
    allowedActions.push('download_pdf');
  }
  if (email_delivery.action.enabled) {
    allowedActions.push(email_delivery.action.key);
  }
  if (docflow_delivery.action.enabled) {
    allowedActions.push(docflow_delivery.action.key);
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
    allocation_number_field,
    pdf_action,
    email_delivery,
    docflow_delivery,
    allowed_actions: allowedActions,
  };
}

/**
 * Update מספר הקצאה on an issued document (when Country Pack policy allows
 * editable_after_issue). Returns refreshed issued-document-view aggregate.
 */
export async function updateIssuedIncomeDocumentAllocationNumber(
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<IncomeIssuedDocumentViewAggregate> {
  const incomeDocumentId = reqUuid(body.income_document_id, 'income_document_id');
  const orgId = ctx.organizationId;
  if (!orgId) throw forbidden('Organization context required');

  const doc = await loadIssuedDocumentForView(orgId, incomeDocumentId);
  const scope = await resolveIssuerScopeForIssuedDocument(ctx, doc);
  assertRowMatchesIssuerScope(scope, doc);
  assertIncomeEditPermission(scope);

  if (doc.document_status !== 'issued') {
    throw badRequest('allocation number update on income_document_id requires an issued document');
  }

  const allocationPolicy = await resolveIncomeTaxAllocationNumberPolicyForOrg(
    scope.org_id,
    'IL',
    doc.issue_date,
  );
  const field = buildIncomeDocumentAllocationNumberField({
    policy: allocationPolicy,
    documentType: doc.document_type,
    value: doc.tax_allocation_number ?? null,
    canEdit: true,
    isIssued: true,
  });
  if (!field.visible) throw badRequest('מספר הקצאה אינו רלוונטי למסמך זה');
  if (!field.editable) {
    throw badRequest(field.disabled_reason ?? 'לא ניתן לערוך מספר הקצאה');
  }

  const nextValue = normalizeAllocationNumberInput(body.allocation_number);
  const formatError = validateAllocationNumberFormat(nextValue);
  if (formatError) throw badRequest(formatError);
  if (field.required && !nextValue) {
    throw badRequest('מספר הקצאה נדרש');
  }

  const previous = doc.tax_allocation_number ?? null;
  const { error: updateErr } = await supabaseAdmin
    .from('income_documents')
    .update({ tax_allocation_number: nextValue })
    .eq('id', doc.id)
    .eq('organization_id', scope.org_id);
  throwIfSupabaseError(updateErr, 'updateIssuedIncomeDocumentAllocationNumber');

  void writeAudit({
    organizationId: scope.org_id,
    actorUserId: scope.actor_user_id,
    moduleCode: 'income',
    entityType: 'income_document',
    entityId: doc.id,
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_ALLOCATION_NUMBER_UPDATED,
    payload: {
      income_document_id: doc.id,
      represented_client_id: scope.represented_client_id,
      previous_allocation_number: previous,
      allocation_number: nextValue,
      command: INCOME_COMMAND_UPDATE_ALLOCATION_NUMBER,
    },
  }).catch(() => {
    /* audit must not block UX */
  });

  return buildIncomeIssuedDocumentViewAggregate({ ctx, incomeDocumentId: doc.id });
}

/** True when the allocation command targets an issued document (not a draft). */
export function isIssuedAllocationNumberCommandBody(body: Record<string, unknown>): boolean {
  return optionalUuid(body.income_document_id, 'income_document_id') != null;
}

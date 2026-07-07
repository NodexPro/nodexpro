/**
 * INC-2 — Income named commands (customers, items, drafts).
 * No issuing, accounting, work engine, or docflow.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import {
  assertRowMatchesIssuerScope,
  optionalJsonObject,
  optionalPriceReference,
  optionalString,
  optionalUuid,
  parseIncomeDocumentType,
  parseIncomeItemType,
  reqJsonArray,
  reqNonEmptyString,
  reqUuid,
  type ActiveIncomeIssuerScope,
} from './income.guards.js';
import {
  applySelectIncomeIssuerContext,
  buildIncomeWorkspaceContextAggregate,
} from './income-issuer-context.service.js';
import {
  activeIncomeIssuerScopeFromContextAggregate,
  assertIncomeEditPermission,
  assertIncomeIssuePermission,
  loadActiveIncomeIssuerScope,
} from './income-issuer-scope.service.js';
import {
  parseDraftPayloadBody,
  validateDraftAgainstDocumentTypeRules,
} from './income-document-draft.helpers.js';
import {
  assertDocumentTypeEnabled,
  findAvailableDocumentType,
  resolveAvailableDocumentTypes,
} from './income-document-types.resolver.js';
import { retryAccountingPostingForIssuedDocument } from './income-accounting-posting.service.js';
import { executeIssueIncomeDocument } from './income-document-issue.service.js';
import { renderIncomeDocumentPdf } from './income-document-pdf.service.js';
import {
  buildIncomeWorkspaceAggregate,
  buildIncomeWorkspaceWizardPatchAggregate,
} from './income-workspace-aggregate.service.js';
import {
  insertSavedIncomeRecipient,
  loadIncomeRecipientById,
  searchIncomeRecipients,
  selectedFromInputFields,
  selectedFromSavedRow,
  type RecipientSearchOverlay,
} from './income-recipient.service.js';
import {
  DEFAULT_INCOME_CUSTOMER_PAYMENT_TERMS,
  parseIncomeCustomerPaymentTermsKey,
} from './income-customer-payment-terms.pure.js';
import {
  assertRecipientInputValid,
  parseRecipientInputBody,
  validateRecipientInputFields,
} from './income-recipient.validation.js';
import {
  beginIncomeWizardDocumentDraft,
  addIncomeDocumentLine,
  updateIncomeDocumentLine,
  deleteIncomeDocumentLine,
  reorderIncomeDocumentLines,
  saveIncomeDocumentDraft,
  resumeIncomeDocumentDraft,
  resumeIncomeDocumentDraftFromContext,
  generateIncomeDocumentPreview,
  updateIncomeDocumentDiscount,
  updateIncomeDocumentDraftSettings,
  updateIncomeDocumentNotes,
  updateIncomeDocumentDeliveryContact,
  type WizardDraftOverlay,
} from './income-document-draft-editor.service.js';
import { executeSendIncomeDocumentByEmail } from './income-document-email-delivery.service.js';
import { executeSendIncomeDocumentByDocflow } from './income-document-docflow-delivery.service.js';
import {
  executeUpdateIncomeDocumentBrandingProfile,
  executeUpdateIncomeDocumentBrandingProfilePreviewDraft,
  executeUploadIncomeDocumentLogo,
  executeUploadIncomeDocumentSignature,
} from './income-document-branding.commands.js';
import {
  INCOME_COMMAND_ADD_LINE,
  INCOME_COMMAND_BEGIN_WIZARD_DRAFT,
  INCOME_COMMAND_CANCEL_DRAFT,
  INCOME_COMMAND_DELETE_LINE,
  INCOME_COMMAND_ISSUE_DOCUMENT,
  INCOME_COMMAND_REORDER_LINES,
  INCOME_COMMAND_SAVE_DRAFT,
  INCOME_COMMAND_RESUME_DRAFT,
  INCOME_COMMAND_GENERATE_PREVIEW,
  INCOME_COMMAND_UPDATE_DISCOUNT,
  INCOME_COMMAND_UPDATE_BRANDING_PROFILE,
  INCOME_COMMAND_UPDATE_BRANDING_PROFILE_PREVIEW_DRAFT,
  INCOME_COMMAND_UPLOAD_DOCUMENT_LOGO,
  INCOME_COMMAND_UPLOAD_DOCUMENT_SIGNATURE,
  INCOME_COMMAND_SEARCH_RECIPIENTS,
  INCOME_COMMAND_SELECT_RECIPIENT,
  INCOME_COMMAND_SET_RECIPIENT_SNAPSHOT,
  INCOME_COMMAND_SAVE_RECIPIENT_FOR_FUTURE,
  INCOME_COMMAND_RETRY_ACCOUNTING_POSTING,
  INCOME_COMMAND_RETRY_PDF_RENDER,
  INCOME_COMMAND_SEND_DOCUMENT_BY_EMAIL,
  INCOME_COMMAND_SEND_DOCUMENT_BY_DOCFLOW,
  INCOME_COMMAND_CREATE_CUSTOMER,
  INCOME_COMMAND_CREATE_CUSTOMER_FOR_ISSUER,
  INCOME_COMMAND_UPDATE_CUSTOMER_FOR_ISSUER,
  INCOME_COMMAND_CREATE_DRAFT,
  INCOME_COMMAND_CREATE_ITEM,
  INCOME_COMMAND_CREATE_ONE_TIME_CUSTOMER,
  INCOME_COMMAND_SELECT_ISSUER,
  INCOME_COMMAND_UPDATE_DRAFT,
  INCOME_COMMAND_UPDATE_DRAFT_SETTINGS,
  INCOME_COMMAND_UPDATE_DELIVERY_CONTACT,
  INCOME_COMMAND_UPDATE_LINE,
  INCOME_COMMAND_UPDATE_NOTES,
  type IncomeCommandResponse,
  type IncomeCommandType,
  type IncomeBrandingPreviewDraftCommandResponse,
  type SelectIncomeIssuerContextCommandResponse,
} from './income.types.js';

const ALLOWED_COMMANDS = new Set<IncomeCommandType>([
  INCOME_COMMAND_SELECT_ISSUER,
  INCOME_COMMAND_CREATE_CUSTOMER,
  INCOME_COMMAND_CREATE_CUSTOMER_FOR_ISSUER,
  INCOME_COMMAND_UPDATE_CUSTOMER_FOR_ISSUER,
  INCOME_COMMAND_CREATE_ONE_TIME_CUSTOMER,
  INCOME_COMMAND_CREATE_ITEM,
  INCOME_COMMAND_CREATE_DRAFT,
  INCOME_COMMAND_UPDATE_DRAFT,
  INCOME_COMMAND_CANCEL_DRAFT,
  INCOME_COMMAND_ISSUE_DOCUMENT,
  INCOME_COMMAND_SEARCH_RECIPIENTS,
  INCOME_COMMAND_SELECT_RECIPIENT,
  INCOME_COMMAND_SET_RECIPIENT_SNAPSHOT,
  INCOME_COMMAND_SAVE_RECIPIENT_FOR_FUTURE,
  INCOME_COMMAND_RETRY_ACCOUNTING_POSTING,
  INCOME_COMMAND_RETRY_PDF_RENDER,
  INCOME_COMMAND_SEND_DOCUMENT_BY_EMAIL,
  INCOME_COMMAND_SEND_DOCUMENT_BY_DOCFLOW,
  INCOME_COMMAND_BEGIN_WIZARD_DRAFT,
  INCOME_COMMAND_ADD_LINE,
  INCOME_COMMAND_UPDATE_LINE,
  INCOME_COMMAND_DELETE_LINE,
  INCOME_COMMAND_REORDER_LINES,
  INCOME_COMMAND_UPDATE_DRAFT_SETTINGS,
  INCOME_COMMAND_UPDATE_NOTES,
  INCOME_COMMAND_UPDATE_DELIVERY_CONTACT,
  INCOME_COMMAND_SAVE_DRAFT,
  INCOME_COMMAND_RESUME_DRAFT,
  INCOME_COMMAND_GENERATE_PREVIEW,
  INCOME_COMMAND_UPDATE_DISCOUNT,
  INCOME_COMMAND_UPDATE_BRANDING_PROFILE,
  INCOME_COMMAND_UPDATE_BRANDING_PROFILE_PREVIEW_DRAFT,
  INCOME_COMMAND_UPLOAD_DOCUMENT_LOGO,
  INCOME_COMMAND_UPLOAD_DOCUMENT_SIGNATURE,
]);

async function commandResponse(
  ctx: RequestContext,
  command: IncomeCommandType,
  recipientOverlay: RecipientSearchOverlay = {},
  wizardDraftOverlay: WizardDraftOverlay = {},
): Promise<IncomeCommandResponse> {
  return {
    ok: true,
    command,
    income_workspace_aggregate: await buildIncomeWorkspaceAggregate(
      ctx,
      undefined,
      recipientOverlay,
      wizardDraftOverlay,
    ),
  };
}

function hasDraftIdInBody(body: Record<string, unknown>): boolean {
  const raw = body.draft_id;
  return raw !== null && raw !== undefined && String(raw).trim() !== '';
}

async function brandingCommandResponse(
  ctx: RequestContext,
  command: IncomeCommandType,
  body: Record<string, unknown>,
  run: (
    scope: ActiveIncomeIssuerScope,
    body: Record<string, unknown>,
  ) => Promise<WizardDraftOverlay>,
): Promise<IncomeCommandResponse> {
  const scope = await loadActiveIncomeIssuerScope(ctx);
  assertIncomeEditPermission(scope);
  const overlay = await run(scope, body);
  if (hasDraftIdInBody(body)) {
    return wizardDraftCommandResponse(ctx, command, scope, {}, overlay, 'preview');
  }
  const income_workspace_aggregate = await buildIncomeWorkspaceAggregate(ctx, scope, {}, overlay);
  return {
    ok: true,
    command,
    income_workspace_aggregate,
    meta: { workspace_aggregate_mode: 'full' },
  };
}

async function wizardDraftCommandResponse(
  _ctx: RequestContext,
  command: IncomeCommandType,
  scope: ActiveIncomeIssuerScope,
  recipientOverlay: RecipientSearchOverlay,
  wizardDraftOverlay: WizardDraftOverlay,
  startingStepKey: string | null = null,
): Promise<IncomeCommandResponse> {
  return {
    ok: true,
    command,
    income_workspace_aggregate: await buildIncomeWorkspaceWizardPatchAggregate(
      scope,
      wizardDraftOverlay,
      recipientOverlay,
      startingStepKey,
    ),
    meta: { workspace_aggregate_mode: 'wizard_patch' },
  };
}

async function recipientCommandResponse(
  ctx: RequestContext,
  command: IncomeCommandType,
  scope: ActiveIncomeIssuerScope,
  overlay: RecipientSearchOverlay,
): Promise<IncomeCommandResponse> {
  return {
    ok: true,
    command,
    income_workspace_aggregate: await buildIncomeWorkspaceAggregate(ctx, scope, overlay),
  };
}

async function selectIssuerContextCommandResponse(
  ctx: RequestContext,
): Promise<SelectIncomeIssuerContextCommandResponse> {
  const income_workspace_context_aggregate = await buildIncomeWorkspaceContextAggregate(ctx);
  const scope = activeIncomeIssuerScopeFromContextAggregate(income_workspace_context_aggregate);
  const income_workspace_aggregate = await buildIncomeWorkspaceAggregate(ctx, scope);
  return {
    ok: true,
    command: INCOME_COMMAND_SELECT_ISSUER,
    income_workspace_context_aggregate,
    income_workspace_aggregate,
  };
}

async function loadIncomeCustomerInScope(
  scope: ActiveIncomeIssuerScope,
  customerId: string,
): Promise<{
  id: string;
  organization_id: string;
  issuer_business_id: string;
  represented_client_id: string | null;
  status: string;
}> {
  const { data, error } = await supabaseAdmin
    .from('income_customers')
    .select('id, organization_id, issuer_business_id, represented_client_id, status')
    .eq('id', customerId)
    .eq('organization_id', scope.org_id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Income customer not found');
  const row = data as {
    id: string;
    organization_id: string;
    issuer_business_id: string;
    represented_client_id: string | null;
    status: string;
  };
  assertRowMatchesIssuerScope(scope, row);
  if (row.status !== 'active') throw badRequest('Income customer is not active');
  return row;
}

async function loadDraftInScope(
  scope: ActiveIncomeIssuerScope,
  draftId: string,
): Promise<{
  id: string;
  organization_id: string;
  issuer_business_id: string;
  represented_client_id: string | null;
  status: string;
}> {
  const { data, error } = await supabaseAdmin
    .from('income_document_drafts')
    .select('id, organization_id, issuer_business_id, represented_client_id, status')
    .eq('id', draftId)
    .eq('organization_id', scope.org_id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Income document draft not found');
  const row = data as {
    id: string;
    organization_id: string;
    issuer_business_id: string;
    represented_client_id: string | null;
    status: string;
  };
  assertRowMatchesIssuerScope(scope, row);
  return row;
}

async function insertIncomeCustomer(
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
  isOneTime: boolean,
  auditAction: string,
): Promise<{ id: string }> {
  assertIncomeEditPermission(scope);
  const display_name = reqNonEmptyString(body.display_name, 'display_name');
  const default_payment_terms =
    'default_payment_terms' in body
      ? parseIncomeCustomerPaymentTermsKey(body.default_payment_terms)
      : DEFAULT_INCOME_CUSTOMER_PAYMENT_TERMS;
  const { data, error } = await supabaseAdmin
    .from('income_customers')
    .insert({
      organization_id: scope.org_id,
      represented_client_id: scope.represented_client_id,
      issuer_business_id: scope.issuer_business_id,
      display_name,
      phone: optionalString(body.phone),
      email: optionalString(body.email),
      tax_id: optionalString(body.tax_id),
      address_json: optionalJsonObject(body.address_json, 'address_json'),
      default_payment_terms,
      is_one_time: isOneTime,
      status: 'active',
      created_by_user_id: scope.actor_user_id,
    })
    .select('id')
    .single();
  if (error) throw error;
  const row = data as { id: string };
  await writeAudit({
    organizationId: scope.org_id,
    actorUserId: scope.actor_user_id,
    moduleCode: 'income',
    entityType: 'income_customer',
    entityId: row.id,
    action: auditAction,
    payload: { display_name, is_one_time: isOneTime, issuer_business_id: scope.issuer_business_id },
  });
  return row;
}

async function executeUpdateIncomeCustomerForIssuer(
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<IncomeCommandResponse> {
  const scope = await loadActiveIncomeIssuerScope(ctx);
  assertIncomeEditPermission(scope);
  const income_customer_id = reqUuid(body.income_customer_id, 'income_customer_id');
  await loadIncomeCustomerInScope(scope, income_customer_id);

  const patch: Record<string, unknown> = {};
  if ('display_name' in body) {
    patch.display_name = reqNonEmptyString(body.display_name, 'display_name');
  }
  if ('phone' in body) {
    patch.phone = optionalString(body.phone);
  }
  if ('email' in body) {
    patch.email = optionalString(body.email);
  }
  if ('tax_id' in body) {
    patch.tax_id = optionalString(body.tax_id);
  }
  if ('default_payment_terms' in body) {
    patch.default_payment_terms = parseIncomeCustomerPaymentTermsKey(body.default_payment_terms);
  }
  if (Object.keys(patch).length === 0) {
    throw badRequest('At least one customer field is required');
  }

  const { error } = await supabaseAdmin
    .from('income_customers')
    .update(patch)
    .eq('id', income_customer_id)
    .eq('organization_id', scope.org_id);
  if (error) throw error;

  await writeAudit({
    organizationId: scope.org_id,
    actorUserId: scope.actor_user_id,
    moduleCode: 'income',
    entityType: 'income_customer',
    entityId: income_customer_id,
    action: AUDIT_ACTIONS.INCOME_CUSTOMER_UPDATED,
    payload: {
      issuer_business_id: scope.issuer_business_id,
      represented_client_id: scope.represented_client_id,
      fields: Object.keys(patch),
    },
  });

  return commandResponse(ctx, INCOME_COMMAND_UPDATE_CUSTOMER_FOR_ISSUER);
}

async function executeCreateIncomeItem(
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<void> {
  const scope = await loadActiveIncomeIssuerScope(ctx);
  assertIncomeEditPermission(scope);
  const item_type = parseIncomeItemType(body.item_type);
  const name = reqNonEmptyString(body.name, 'name');
  const { error } = await supabaseAdmin.from('income_items').insert({
    organization_id: scope.org_id,
    represented_client_id: scope.represented_client_id,
    issuer_business_id: scope.issuer_business_id,
    item_type,
    name,
    description: optionalString(body.description),
    default_unit_price_reference: optionalPriceReference(body.default_unit_price_reference),
    currency: optionalString(body.currency) ?? 'ILS',
    active: true,
    created_by_user_id: scope.actor_user_id,
  });
  if (error) throw error;
  await writeAudit({
    organizationId: scope.org_id,
    actorUserId: scope.actor_user_id,
    moduleCode: 'income',
    entityType: 'income_item',
    action: AUDIT_ACTIONS.INCOME_ITEM_CREATED,
    payload: { name, item_type, issuer_business_id: scope.issuer_business_id },
  });
}

async function executeCreateDraft(ctx: RequestContext, body: Record<string, unknown>): Promise<void> {
  const scope = await loadActiveIncomeIssuerScope(ctx);
  assertIncomeEditPermission(scope);
  const { available_document_types } = await resolveAvailableDocumentTypes(scope.org_id, scope);
  const payload = parseDraftPayloadBody(
    body,
    parseIncomeDocumentType,
    optionalUuid,
    reqJsonArray,
  );
  assertDocumentTypeEnabled(available_document_types, payload.document_type);
  const docType = findAvailableDocumentType(available_document_types, payload.document_type!);
  if (!docType) throw badRequest('document_type is invalid');

  if (payload.income_customer_id) {
    await loadIncomeCustomerInScope(scope, payload.income_customer_id);
  }

  const { validation_warnings_json, draft_totals_preview_json } =
    await validateDraftAgainstDocumentTypeRules(payload, docType);

  const { error } = await supabaseAdmin.from('income_document_drafts').insert({
    organization_id: scope.org_id,
    represented_client_id: scope.represented_client_id,
    issuer_business_id: scope.issuer_business_id,
    actor_user_id: scope.actor_user_id,
    acting_mode: scope.acting_mode,
    document_type: payload.document_type,
    income_customer_id: payload.income_customer_id,
    one_time_customer_snapshot_json: payload.one_time_customer_snapshot_json,
    draft_lines_json: payload.draft_lines_json,
    payment_terms_json: payload.payment_terms_json,
    due_date: payload.due_date,
    document_date: payload.document_date,
    payment_received_json: payload.payment_received_json,
    notes: payload.notes,
    currency: payload.currency,
    language: payload.language,
    draft_totals_preview_json,
    validation_warnings_json,
    status: 'draft',
  });
  if (error) throw error;
  await writeAudit({
    organizationId: scope.org_id,
    actorUserId: scope.actor_user_id,
    moduleCode: 'income',
    entityType: 'income_document_draft',
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_DRAFT_CREATED,
    payload: {
      document_type: payload.document_type,
      income_customer_id: payload.income_customer_id,
      issuer_business_id: scope.issuer_business_id,
      line_count: payload.draft_lines_json.length,
    },
  });
}

async function executeUpdateDraft(ctx: RequestContext, body: Record<string, unknown>): Promise<void> {
  const scope = await loadActiveIncomeIssuerScope(ctx);
  assertIncomeEditPermission(scope);
  const draft_id = reqUuid(body.draft_id, 'draft_id');
  const existing = await loadDraftInScope(scope, draft_id);
  if (existing.status === 'cancelled') {
    throw badRequest('Cannot update a cancelled draft');
  }
  if (existing.status === 'issued') {
    throw badRequest('Cannot update an issued draft');
  }

  const { available_document_types } = await resolveAvailableDocumentTypes(scope.org_id, scope);
  const payload = parseDraftPayloadBody(
    body,
    parseIncomeDocumentType,
    optionalUuid,
    reqJsonArray,
  );
  assertDocumentTypeEnabled(available_document_types, payload.document_type);
  const docType = findAvailableDocumentType(available_document_types, payload.document_type!);
  if (!docType) throw badRequest('document_type is invalid');

  if (payload.income_customer_id) {
    await loadIncomeCustomerInScope(scope, payload.income_customer_id);
  }

  const { validation_warnings_json, draft_totals_preview_json } =
    await validateDraftAgainstDocumentTypeRules(payload, docType);

  const { error } = await supabaseAdmin
    .from('income_document_drafts')
    .update({
      document_type: payload.document_type,
      income_customer_id: payload.income_customer_id,
      one_time_customer_snapshot_json: payload.one_time_customer_snapshot_json,
      draft_lines_json: payload.draft_lines_json,
      payment_terms_json: payload.payment_terms_json,
      due_date: payload.due_date,
      document_date: payload.document_date,
      payment_received_json: payload.payment_received_json,
      notes: payload.notes,
      currency: payload.currency,
      language: payload.language,
      draft_totals_preview_json,
      validation_warnings_json,
    })
    .eq('id', draft_id)
    .eq('organization_id', scope.org_id);
  if (error) throw error;

  await writeAudit({
    organizationId: scope.org_id,
    actorUserId: scope.actor_user_id,
    moduleCode: 'income',
    entityType: 'income_document_draft',
    entityId: draft_id,
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_DRAFT_UPDATED,
    payload: {
      document_type: payload.document_type,
      income_customer_id: payload.income_customer_id,
      line_count: payload.draft_lines_json.length,
    },
  });
}

async function executeCancelDraft(ctx: RequestContext, body: Record<string, unknown>): Promise<void> {
  const scope = await loadActiveIncomeIssuerScope(ctx);
  assertIncomeEditPermission(scope);
  const draft_id = reqUuid(body.draft_id, 'draft_id');
  const reason = optionalString(body.reason);
  const existing = await loadDraftInScope(scope, draft_id);
  if (existing.status === 'cancelled') {
    throw badRequest('Draft is already cancelled');
  }
  if (existing.status === 'issued') {
    throw badRequest('Cannot cancel an issued draft');
  }

  const { error } = await supabaseAdmin
    .from('income_document_drafts')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by_user_id: scope.actor_user_id,
    })
    .eq('id', draft_id)
    .eq('organization_id', scope.org_id);
  if (error) throw error;

  await writeAudit({
    organizationId: scope.org_id,
    actorUserId: scope.actor_user_id,
    moduleCode: 'income',
    entityType: 'income_document_draft',
    entityId: draft_id,
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_DRAFT_CANCELLED,
    payload: { reason, issuer_business_id: scope.issuer_business_id },
  });
}

export async function executeIncomeCommand(
  ctx: RequestContext,
  body: Record<string, unknown>,
  auditMeta?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<
  IncomeCommandResponse | SelectIncomeIssuerContextCommandResponse | IncomeBrandingPreviewDraftCommandResponse
> {
  const command = String(body.command ?? '').trim() as IncomeCommandType;
  if (!command) throw badRequest('command is required');
  if (!ALLOWED_COMMANDS.has(command)) {
    throw badRequest(`Unknown income command: ${command}`);
  }

  if (command === INCOME_COMMAND_SELECT_ISSUER) {
    await applySelectIncomeIssuerContext(ctx, body, auditMeta);
    return selectIssuerContextCommandResponse(ctx);
  }

  if (command === INCOME_COMMAND_CREATE_CUSTOMER) {
    const scope = await loadActiveIncomeIssuerScope(ctx);
    await insertIncomeCustomer(scope, body, false, AUDIT_ACTIONS.INCOME_CUSTOMER_CREATED);
    return commandResponse(ctx, command);
  }

  if (command === INCOME_COMMAND_CREATE_CUSTOMER_FOR_ISSUER) {
    const scope = await loadActiveIncomeIssuerScope(ctx);
    await insertIncomeCustomer(scope, body, false, AUDIT_ACTIONS.INCOME_CUSTOMER_CREATED);
    return commandResponse(ctx, command);
  }

  if (command === INCOME_COMMAND_UPDATE_CUSTOMER_FOR_ISSUER) {
    return executeUpdateIncomeCustomerForIssuer(ctx, body);
  }

  if (command === INCOME_COMMAND_CREATE_ONE_TIME_CUSTOMER) {
    const scope = await loadActiveIncomeIssuerScope(ctx);
    await insertIncomeCustomer(scope, body, true, AUDIT_ACTIONS.INCOME_ONE_TIME_CUSTOMER_CREATED);
    return commandResponse(ctx, command);
  }

  if (command === INCOME_COMMAND_CREATE_ITEM) {
    await executeCreateIncomeItem(ctx, body);
    return commandResponse(ctx, command);
  }

  if (command === INCOME_COMMAND_CREATE_DRAFT) {
    await executeCreateDraft(ctx, body);
    return commandResponse(ctx, command);
  }

  if (command === INCOME_COMMAND_UPDATE_DRAFT) {
    await executeUpdateDraft(ctx, body);
    return commandResponse(ctx, command);
  }

  if (command === INCOME_COMMAND_CANCEL_DRAFT) {
    await executeCancelDraft(ctx, body);
    return commandResponse(ctx, command);
  }

  if (command === INCOME_COMMAND_SEARCH_RECIPIENTS) {
    const scope = await loadActiveIncomeIssuerScope(ctx);
    assertIncomeEditPermission(scope);
    const query = String(body.query ?? '').trim();
    const search_results = await searchIncomeRecipients(scope, query);
    return recipientCommandResponse(ctx, command, scope, {
      search_query: query,
      search_results,
    });
  }

  if (command === INCOME_COMMAND_SELECT_RECIPIENT) {
    const scope = await loadActiveIncomeIssuerScope(ctx);
    assertIncomeEditPermission(scope);
    const income_customer_id = reqUuid(body.income_customer_id, 'income_customer_id');
    const row = await loadIncomeRecipientById(scope, income_customer_id);
    if (!row) {
      throw notFound(
        'Income recipient not found for the active issuer. Refresh the list and try again.',
        'INCOME_RECIPIENT_NOT_FOUND',
      );
    }
    const overlay: RecipientSearchOverlay = {
      selected: selectedFromSavedRow(row),
    };
    const searchQuery = String(body.search_query ?? '').trim();
    if (searchQuery) overlay.search_query = searchQuery;
    return recipientCommandResponse(ctx, command, scope, overlay);
  }

  if (command === INCOME_COMMAND_SET_RECIPIENT_SNAPSHOT) {
    const scope = await loadActiveIncomeIssuerScope(ctx);
    assertIncomeEditPermission(scope);
    const fields = parseRecipientInputBody(body);
    const field_errors = validateRecipientInputFields(fields);
    if (Object.keys(field_errors).length > 0) {
      return recipientCommandResponse(ctx, command, scope, { field_errors, selected: null });
    }
    return recipientCommandResponse(ctx, command, scope, {
      selected: selectedFromInputFields(fields),
      field_errors: {},
    });
  }

  if (command === INCOME_COMMAND_SAVE_RECIPIENT_FOR_FUTURE) {
    const scope = await loadActiveIncomeIssuerScope(ctx);
    assertIncomeEditPermission(scope);
    const fields = assertRecipientInputValid(body);
    const row = await insertSavedIncomeRecipient(scope, fields, scope.actor_user_id);
    await writeAudit({
      organizationId: scope.org_id,
      actorUserId: scope.actor_user_id,
      moduleCode: 'income',
      entityType: 'income_customer',
      entityId: row.income_customer_id,
      action: AUDIT_ACTIONS.INCOME_CUSTOMER_CREATED,
      payload: {
        display_name: fields.display_name,
        is_one_time: false,
        issuer_business_id: scope.issuer_business_id,
        save_for_future: true,
      },
    });
    return recipientCommandResponse(ctx, command, scope, {
      selected: selectedFromSavedRow(row),
      field_errors: {},
    });
  }

  if (command === INCOME_COMMAND_ISSUE_DOCUMENT) {
    const issueResult = await executeIssueIncomeDocument(ctx, body);
    const response = await commandResponse(ctx, command);
    return {
      ...response,
      meta: {
        idempotent_replay: issueResult.idempotentReplay,
        income_document_id: issueResult.issuedDocumentId,
      },
    };
  }

  if (command === INCOME_COMMAND_RETRY_ACCOUNTING_POSTING) {
    const scope = await loadActiveIncomeIssuerScope(ctx);
    assertIncomeIssuePermission(scope);
    const income_document_id = reqUuid(body.income_document_id, 'income_document_id');
    await retryAccountingPostingForIssuedDocument(ctx, scope.org_id, income_document_id);
    return commandResponse(ctx, command);
  }

  if (command === INCOME_COMMAND_RETRY_PDF_RENDER) {
    const scope = await loadActiveIncomeIssuerScope(ctx);
    assertIncomeIssuePermission(scope);
    const income_document_id = reqUuid(body.income_document_id, 'income_document_id');
    await renderIncomeDocumentPdf(ctx, scope.org_id, income_document_id);
    return commandResponse(ctx, command);
  }

  if (command === INCOME_COMMAND_SEND_DOCUMENT_BY_EMAIL) {
    const sendResult = await executeSendIncomeDocumentByEmail(ctx, body);
    const response = await commandResponse(ctx, command);
    return {
      ...response,
      meta: {
        idempotent_replay: sendResult.idempotentReplay,
        income_document_id: reqUuid(body.income_document_id, 'income_document_id'),
        delivery_attempt_id: sendResult.deliveryAttemptId,
        delivery_result: sendResult.deliveryResult,
        provider_message_id: sendResult.providerMessageId,
        failure_reason: sendResult.failureReason,
      },
    };
  }

  if (command === INCOME_COMMAND_SEND_DOCUMENT_BY_DOCFLOW) {
    const sendResult = await executeSendIncomeDocumentByDocflow(ctx, body);
    const response = await commandResponse(ctx, command);
    return {
      ...response,
      meta: {
        idempotent_replay: sendResult.idempotentReplay,
        income_document_id: reqUuid(body.income_document_id, 'income_document_id'),
        delivery_attempt_id: sendResult.deliveryAttemptId,
        delivery_result: sendResult.deliveryResult,
        docflow_thread_id: sendResult.docflowThreadId,
        docflow_message_id: sendResult.docflowMessageId,
        failure_reason: sendResult.failureReason,
      },
    };
  }

  if (command === INCOME_COMMAND_BEGIN_WIZARD_DRAFT) {
    const scope = await loadActiveIncomeIssuerScope(ctx);
    assertIncomeEditPermission(scope);
    const { wizardOverlay, recipientOverlay } = await beginIncomeWizardDocumentDraft(scope, body, {});
    return wizardDraftCommandResponse(ctx, command, scope, recipientOverlay, wizardOverlay);
  }
  if (command === INCOME_COMMAND_RESUME_DRAFT) {
    const resumed = await resumeIncomeDocumentDraftFromContext(ctx, body);
    return wizardDraftCommandResponse(
      ctx,
      command,
      resumed.scope,
      resumed.result.recipientOverlay,
      resumed.result.wizardOverlay,
      resumed.result.starting_step_key,
    );
  }

  const wizardDraftCmd = async (
    runner: (scope: ActiveIncomeIssuerScope, body: Record<string, unknown>) => Promise<WizardDraftOverlay>,
  ): Promise<IncomeCommandResponse> => {
    const scope = await loadActiveIncomeIssuerScope(ctx);
    assertIncomeEditPermission(scope);
    const overlay = await runner(scope, body);
    return wizardDraftCommandResponse(ctx, command, scope, {}, overlay);
  };

  if (command === INCOME_COMMAND_ADD_LINE) {
    return wizardDraftCmd(addIncomeDocumentLine);
  }
  if (command === INCOME_COMMAND_UPDATE_LINE) {
    return wizardDraftCmd(updateIncomeDocumentLine);
  }
  if (command === INCOME_COMMAND_DELETE_LINE) {
    return wizardDraftCmd(deleteIncomeDocumentLine);
  }
  if (command === INCOME_COMMAND_REORDER_LINES) {
    return wizardDraftCmd(reorderIncomeDocumentLines);
  }
  if (command === INCOME_COMMAND_UPDATE_DRAFT_SETTINGS) {
    return wizardDraftCmd(updateIncomeDocumentDraftSettings);
  }
  if (command === INCOME_COMMAND_UPDATE_NOTES) {
    return wizardDraftCmd(updateIncomeDocumentNotes);
  }
  if (command === INCOME_COMMAND_UPDATE_DELIVERY_CONTACT) {
    return wizardDraftCmd(updateIncomeDocumentDeliveryContact);
  }
  if (command === INCOME_COMMAND_SAVE_DRAFT) {
    return wizardDraftCmd(saveIncomeDocumentDraft);
  }
  if (command === INCOME_COMMAND_GENERATE_PREVIEW) {
    const scope = await loadActiveIncomeIssuerScope(ctx);
    assertIncomeEditPermission(scope);
    const overlay = await generateIncomeDocumentPreview(scope, body);
    return wizardDraftCommandResponse(ctx, command, scope, {}, overlay, 'preview');
  }
  if (command === INCOME_COMMAND_UPDATE_DISCOUNT) {
    return wizardDraftCmd(updateIncomeDocumentDiscount);
  }
  if (command === INCOME_COMMAND_UPDATE_BRANDING_PROFILE_PREVIEW_DRAFT) {
    const scope = await loadActiveIncomeIssuerScope(ctx);
    assertIncomeEditPermission(scope);
    const document_branding_studio_preview = await executeUpdateIncomeDocumentBrandingProfilePreviewDraft(
      scope,
      body,
    );
    return {
      ok: true,
      command: INCOME_COMMAND_UPDATE_BRANDING_PROFILE_PREVIEW_DRAFT,
      document_branding_studio_preview,
    };
  }
  if (command === INCOME_COMMAND_UPDATE_BRANDING_PROFILE) {
    return brandingCommandResponse(ctx, command, body, executeUpdateIncomeDocumentBrandingProfile);
  }
  if (command === INCOME_COMMAND_UPLOAD_DOCUMENT_LOGO) {
    return brandingCommandResponse(ctx, command, body, (scope, b) => executeUploadIncomeDocumentLogo(ctx, scope, b));
  }
  if (command === INCOME_COMMAND_UPLOAD_DOCUMENT_SIGNATURE) {
    return brandingCommandResponse(ctx, command, body, (scope, b) =>
      executeUploadIncomeDocumentSignature(ctx, scope, b),
    );
  }

  throw badRequest(`Unhandled income command: ${command}`);
}

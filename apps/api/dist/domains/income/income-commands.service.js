/**
 * INC-2 — Income named commands (customers, items, drafts).
 * No issuing, accounting, work engine, or docflow.
 */
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { assertRowMatchesIssuerScope, optionalJsonObject, optionalPriceReference, optionalString, optionalUuid, parseIncomeDocumentType, parseIncomeItemType, reqJsonArray, reqNonEmptyString, reqUuid, } from './income.guards.js';
import { applySelectIncomeIssuerContext, buildIncomeWorkspaceContextAggregate, } from './income-issuer-context.service.js';
import { assertIncomeEditPermission, assertIncomeIssuePermission, loadActiveIncomeIssuerScope, } from './income-issuer-scope.service.js';
import { parseDraftPayloadBody, validateDraftAgainstDocumentTypeRules, } from './income-document-draft.helpers.js';
import { assertDocumentTypeEnabled, findAvailableDocumentType, resolveAvailableDocumentTypes, } from './income-document-types.resolver.js';
import { retryAccountingPostingForIssuedDocument } from './income-accounting-posting.service.js';
import { executeIssueIncomeDocument } from './income-document-issue.service.js';
import { buildIncomeWorkspaceAggregate } from './income-workspace-aggregate.service.js';
import { INCOME_COMMAND_CANCEL_DRAFT, INCOME_COMMAND_ISSUE_DOCUMENT, INCOME_COMMAND_RETRY_ACCOUNTING_POSTING, INCOME_COMMAND_CREATE_CUSTOMER, INCOME_COMMAND_CREATE_DRAFT, INCOME_COMMAND_CREATE_ITEM, INCOME_COMMAND_CREATE_ONE_TIME_CUSTOMER, INCOME_COMMAND_SELECT_ISSUER, INCOME_COMMAND_UPDATE_DRAFT, } from './income.types.js';
const ALLOWED_COMMANDS = new Set([
    INCOME_COMMAND_SELECT_ISSUER,
    INCOME_COMMAND_CREATE_CUSTOMER,
    INCOME_COMMAND_CREATE_ONE_TIME_CUSTOMER,
    INCOME_COMMAND_CREATE_ITEM,
    INCOME_COMMAND_CREATE_DRAFT,
    INCOME_COMMAND_UPDATE_DRAFT,
    INCOME_COMMAND_CANCEL_DRAFT,
    INCOME_COMMAND_ISSUE_DOCUMENT,
    INCOME_COMMAND_RETRY_ACCOUNTING_POSTING,
]);
async function commandResponse(ctx, command) {
    return {
        ok: true,
        command,
        income_workspace_aggregate: await buildIncomeWorkspaceAggregate(ctx),
    };
}
async function selectIssuerContextCommandResponse(ctx) {
    const [income_workspace_context_aggregate, income_workspace_aggregate] = await Promise.all([
        buildIncomeWorkspaceContextAggregate(ctx),
        buildIncomeWorkspaceAggregate(ctx),
    ]);
    return {
        ok: true,
        command: INCOME_COMMAND_SELECT_ISSUER,
        income_workspace_context_aggregate,
        income_workspace_aggregate,
    };
}
async function loadIncomeCustomerInScope(scope, customerId) {
    const { data, error } = await supabaseAdmin
        .from('income_customers')
        .select('id, organization_id, issuer_business_id, represented_client_id, status')
        .eq('id', customerId)
        .eq('organization_id', scope.org_id)
        .maybeSingle();
    if (error)
        throw error;
    if (!data)
        throw notFound('Income customer not found');
    const row = data;
    assertRowMatchesIssuerScope(scope, row);
    if (row.status !== 'active')
        throw badRequest('Income customer is not active');
    return row;
}
async function loadDraftInScope(scope, draftId) {
    const { data, error } = await supabaseAdmin
        .from('income_document_drafts')
        .select('id, organization_id, issuer_business_id, represented_client_id, status')
        .eq('id', draftId)
        .eq('organization_id', scope.org_id)
        .maybeSingle();
    if (error)
        throw error;
    if (!data)
        throw notFound('Income document draft not found');
    const row = data;
    assertRowMatchesIssuerScope(scope, row);
    return row;
}
async function insertIncomeCustomer(scope, body, isOneTime, auditAction) {
    assertIncomeEditPermission(scope);
    const display_name = reqNonEmptyString(body.display_name, 'display_name');
    const { error } = await supabaseAdmin.from('income_customers').insert({
        organization_id: scope.org_id,
        represented_client_id: scope.represented_client_id,
        issuer_business_id: scope.issuer_business_id,
        display_name,
        phone: optionalString(body.phone),
        email: optionalString(body.email),
        tax_id: optionalString(body.tax_id),
        address_json: optionalJsonObject(body.address_json, 'address_json'),
        is_one_time: isOneTime,
        status: 'active',
        created_by_user_id: scope.actor_user_id,
    });
    if (error)
        throw error;
    await writeAudit({
        organizationId: scope.org_id,
        actorUserId: scope.actor_user_id,
        moduleCode: 'income',
        entityType: 'income_customer',
        action: auditAction,
        payload: { display_name, is_one_time: isOneTime, issuer_business_id: scope.issuer_business_id },
    });
}
async function executeCreateIncomeItem(ctx, body) {
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
    if (error)
        throw error;
    await writeAudit({
        organizationId: scope.org_id,
        actorUserId: scope.actor_user_id,
        moduleCode: 'income',
        entityType: 'income_item',
        action: AUDIT_ACTIONS.INCOME_ITEM_CREATED,
        payload: { name, item_type, issuer_business_id: scope.issuer_business_id },
    });
}
async function executeCreateDraft(ctx, body) {
    const scope = await loadActiveIncomeIssuerScope(ctx);
    assertIncomeEditPermission(scope);
    const { available_document_types } = await resolveAvailableDocumentTypes(scope.org_id, scope);
    const payload = parseDraftPayloadBody(body, parseIncomeDocumentType, optionalUuid, reqJsonArray);
    assertDocumentTypeEnabled(available_document_types, payload.document_type);
    const docType = findAvailableDocumentType(available_document_types, payload.document_type);
    if (!docType)
        throw badRequest('document_type is invalid');
    if (payload.income_customer_id) {
        await loadIncomeCustomerInScope(scope, payload.income_customer_id);
    }
    const { validation_warnings_json, draft_totals_preview_json } = validateDraftAgainstDocumentTypeRules(payload, docType);
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
        payment_received_json: payload.payment_received_json,
        notes: payload.notes,
        currency: payload.currency,
        language: payload.language,
        draft_totals_preview_json,
        validation_warnings_json,
        status: 'draft',
    });
    if (error)
        throw error;
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
async function executeUpdateDraft(ctx, body) {
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
    const payload = parseDraftPayloadBody(body, parseIncomeDocumentType, optionalUuid, reqJsonArray);
    assertDocumentTypeEnabled(available_document_types, payload.document_type);
    const docType = findAvailableDocumentType(available_document_types, payload.document_type);
    if (!docType)
        throw badRequest('document_type is invalid');
    if (payload.income_customer_id) {
        await loadIncomeCustomerInScope(scope, payload.income_customer_id);
    }
    const { validation_warnings_json, draft_totals_preview_json } = validateDraftAgainstDocumentTypeRules(payload, docType);
    const { error } = await supabaseAdmin
        .from('income_document_drafts')
        .update({
        document_type: payload.document_type,
        income_customer_id: payload.income_customer_id,
        one_time_customer_snapshot_json: payload.one_time_customer_snapshot_json,
        draft_lines_json: payload.draft_lines_json,
        payment_terms_json: payload.payment_terms_json,
        due_date: payload.due_date,
        payment_received_json: payload.payment_received_json,
        notes: payload.notes,
        currency: payload.currency,
        language: payload.language,
        draft_totals_preview_json,
        validation_warnings_json,
    })
        .eq('id', draft_id)
        .eq('organization_id', scope.org_id);
    if (error)
        throw error;
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
async function executeCancelDraft(ctx, body) {
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
    if (error)
        throw error;
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
export async function executeIncomeCommand(ctx, body, auditMeta) {
    const command = String(body.command ?? '').trim();
    if (!command)
        throw badRequest('command is required');
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
    if (command === INCOME_COMMAND_ISSUE_DOCUMENT) {
        await executeIssueIncomeDocument(ctx, body);
        return commandResponse(ctx, command);
    }
    if (command === INCOME_COMMAND_RETRY_ACCOUNTING_POSTING) {
        const scope = await loadActiveIncomeIssuerScope(ctx);
        assertIncomeIssuePermission(scope);
        const income_document_id = reqUuid(body.income_document_id, 'income_document_id');
        await retryAccountingPostingForIssuedDocument(ctx, scope.org_id, income_document_id);
        return commandResponse(ctx, command);
    }
    throw badRequest(`Unhandled income command: ${command}`);
}

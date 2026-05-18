/**
 * INC-4 — Issue income document from draft (immutable document snapshot; no PDF/delivery/AB/WE/DocFlow).
 */
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { assertRowMatchesIssuerScope, reqUuid, } from './income.guards.js';
import { assertIncomeIssuePermission, loadActiveIncomeIssuerScope, } from './income-issuer-scope.service.js';
import { loadIncomeIssuerProfileProjection } from './income-issuer-profile-sync.service.js';
import { assertDocumentTypeEnabled, findAvailableDocumentType, resolveAvailableDocumentTypes, } from './income-document-types.resolver.js';
import { allocateIncomeDocumentNumber } from './income-document-numbering.service.js';
import { assertDraftReadyToIssue, buildLegalSnapshotForIssue, buildTotalsSnapshotForIssue, } from './income-document-issue.pure.js';
import { applyAccountingPostingForIssuedDocument } from './income-accounting-posting.service.js';
async function loadFullDraftForIssue(scope, draftId) {
    const { data, error } = await supabaseAdmin
        .from('income_document_drafts')
        .select('id, organization_id, issuer_business_id, represented_client_id, actor_user_id, acting_mode, document_type, income_customer_id, one_time_customer_snapshot_json, draft_lines_json, draft_totals_preview_json, payment_terms_json, due_date, payment_received_json, notes, currency, language, status')
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
async function buildCustomerSnapshot(scope, draft) {
    if (draft.income_customer_id) {
        const { data, error } = await supabaseAdmin
            .from('income_customers')
            .select('id, organization_id, issuer_business_id, represented_client_id, display_name, phone, email, tax_id, address_json, is_one_time, status')
            .eq('id', draft.income_customer_id)
            .eq('organization_id', scope.org_id)
            .maybeSingle();
        if (error)
            throw error;
        if (!data)
            throw badRequest('Income customer not found');
        const customer = data;
        assertRowMatchesIssuerScope(scope, customer);
        if (customer.status !== 'active')
            throw badRequest('Income customer is not active');
        return {
            source: 'income_customer',
            income_customer_id: customer.id,
            display_name: customer.display_name,
            phone: customer.phone,
            email: customer.email,
            tax_id: customer.tax_id,
            address_json: customer.address_json,
            is_one_time: customer.is_one_time,
        };
    }
    return {
        source: 'one_time_snapshot',
        ...(draft.one_time_customer_snapshot_json ?? {}),
    };
}
async function buildIssuerSnapshot(orgId) {
    const profile = await loadIncomeIssuerProfileProjection(orgId);
    if (!profile) {
        return { source: 'income_issuer_profile', incomplete: true };
    }
    return {
        source: 'income_issuer_profile',
        display_name: profile.display_name,
        legal_name: profile.legal_name,
        tax_id: profile.tax_id,
        normalized_income_business_type: profile.normalized_income_business_type,
        country_code: profile.country_code,
        vat_registration_status: profile.vat_registration_status,
        default_currency: profile.default_currency,
        default_language: profile.default_language,
        business_type_source: profile.business_type_source,
    };
}
export async function executeIssueIncomeDocument(ctx, body) {
    const scope = await loadActiveIncomeIssuerScope(ctx);
    assertIncomeIssuePermission(scope);
    const draft_id = reqUuid(body.draft_id, 'draft_id');
    const draft = await loadFullDraftForIssue(scope, draft_id);
    try {
        assertDraftReadyToIssue(draft);
    }
    catch (e) {
        throw badRequest(e instanceof Error ? e.message : 'Draft is not ready to issue');
    }
    const docTypesResult = await resolveAvailableDocumentTypes(scope.org_id, scope);
    assertDocumentTypeEnabled(docTypesResult.available_document_types, draft.document_type);
    const docType = findAvailableDocumentType(docTypesResult.available_document_types, draft.document_type);
    if (!docType)
        throw badRequest('document_type is invalid');
    const issue_date = new Date().toISOString().slice(0, 10);
    const allocated = await allocateIncomeDocumentNumber(scope, draft.document_type, issue_date);
    await writeAudit({
        organizationId: scope.org_id,
        actorUserId: scope.actor_user_id,
        moduleCode: 'income',
        entityType: 'income_document_numbering_sequence',
        action: AUDIT_ACTIONS.INCOME_DOCUMENT_NUMBER_ALLOCATED,
        payload: {
            document_type: draft.document_type,
            document_number: allocated.document_number,
            sequence_number: allocated.sequence_number,
            year: allocated.year,
            issuer_business_id: scope.issuer_business_id,
        },
    });
    const lines = Array.isArray(draft.draft_lines_json) ? draft.draft_lines_json : [];
    const customer_snapshot_json = await buildCustomerSnapshot(scope, draft);
    const issuer_snapshot_json = await buildIssuerSnapshot(scope.org_id);
    const legal_snapshot_json = buildLegalSnapshotForIssue({
        country_code: docTypesResult.country_code,
        ruleset_id: docType.ruleset_id,
        document_type: draft.document_type,
        docType,
        business_type: docTypesResult.business_type,
        business_type_raw: null,
        warnings: docTypesResult.warnings,
    });
    const totals_snapshot_json = buildTotalsSnapshotForIssue(draft.draft_totals_preview_json, draft.currency ?? 'ILS', lines.length);
    const { data: issued, error: insertErr } = await supabaseAdmin
        .from('income_documents')
        .insert({
        organization_id: scope.org_id,
        represented_client_id: scope.represented_client_id,
        issuer_business_id: scope.issuer_business_id,
        actor_user_id: scope.actor_user_id,
        acting_mode: scope.acting_mode,
        income_customer_id: draft.income_customer_id,
        customer_snapshot_json,
        document_type: draft.document_type,
        document_number: allocated.document_number,
        document_status: 'issued',
        issue_date,
        currency: draft.currency ?? 'ILS',
        language: draft.language ?? 'he',
        lines_snapshot_json: lines,
        totals_snapshot_json,
        legal_snapshot_json,
        issuer_snapshot_json,
        source_draft_id: draft.id,
        accounting_posting_status: 'pending',
    })
        .select('id')
        .single();
    if (insertErr || !issued)
        throw insertErr ?? new Error('Failed to create issued income document');
    const issuedId = issued.id;
    try {
        await applyAccountingPostingForIssuedDocument(ctx, {
            id: issuedId,
            organization_id: scope.org_id,
            document_type: draft.document_type,
            document_number: allocated.document_number,
            issue_date,
            currency: draft.currency ?? 'ILS',
            represented_client_id: scope.represented_client_id,
            totals_snapshot_json,
            lines_snapshot_json: lines,
            accounting_posting_status: 'pending',
            accounting_entry_id: null,
            notes: draft.notes,
        });
    }
    catch (postingErr) {
        await supabaseAdmin.from('income_documents').delete().eq('id', issuedId).eq('organization_id', scope.org_id);
        throw postingErr;
    }
    const { error: draftUpdateErr } = await supabaseAdmin
        .from('income_document_drafts')
        .update({
        status: 'issued',
        issued_document_id: issuedId,
        issued_at: new Date().toISOString(),
    })
        .eq('id', draft_id)
        .eq('organization_id', scope.org_id)
        .eq('status', 'draft');
    if (draftUpdateErr) {
        throw draftUpdateErr;
    }
    await writeAudit({
        organizationId: scope.org_id,
        actorUserId: scope.actor_user_id,
        moduleCode: 'income',
        entityType: 'income_document',
        entityId: issuedId,
        action: AUDIT_ACTIONS.INCOME_DOCUMENT_ISSUED,
        payload: {
            source_draft_id: draft_id,
            document_type: draft.document_type,
            document_number: allocated.document_number,
            issuer_business_id: scope.issuer_business_id,
        },
    });
    return issuedId;
}

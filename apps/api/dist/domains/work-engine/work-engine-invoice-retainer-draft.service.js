/**
 * Retainer — reuse income document draft as template (backend-owned snapshot).
 */
import { supabaseAdmin } from '../../db/client.js';
import { badRequest, forbidden } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { normalizeDraftLines } from '../income/income-document-draft-lines.pure.js';
import { beginIncomeWizardDocumentDraft, resumeIncomeDocumentDraft, } from '../income/income-document-draft-editor.service.js';
import { applySelectIncomeIssuerContext } from '../income/income-issuer-context.service.js';
import { loadActiveIncomeIssuerScope } from '../income/income-issuer-scope.service.js';
import { INCOME_COMMAND_SELECT_ISSUER } from '../income/income.types.js';
import { buildIncomeWorkspaceAggregate } from '../income/income-workspace-aggregate.service.js';
import { buildWorkEngineInvoicesDocumentCreationEntrypoint } from './work-engine-invoices-document-creation.builders.js';
const DRAFT_SELECT = 'id, organization_id, represented_client_id, issuer_business_id, income_customer_id, document_type, document_date, due_date, currency, language, notes, document_settings_json, delivery_contact_json, draft_lines_json, draft_totals_preview_json, status';
async function loadDraftRow(orgId, draftId) {
    const { data, error } = await supabaseAdmin
        .from('income_document_drafts')
        .select(DRAFT_SELECT)
        .eq('organization_id', orgId)
        .eq('id', draftId)
        .maybeSingle();
    throwIfSupabaseError(error, 'loadRetainerDraftRow');
    const row = data;
    if (!row)
        throw badRequest('source_draft_template_id not found');
    if (row.status !== 'draft')
        throw badRequest('source_draft_template_id must reference an active draft');
    return row;
}
function assertDraftBelongsToRetainer(params) {
    if (params.row.represented_client_id !== params.representedClientId) {
        throw badRequest('source_draft_template_id does not belong to office client');
    }
    if (params.row.issuer_business_id !== params.representedClientId) {
        throw badRequest('source_draft_template_id issuer mismatch');
    }
    if (params.row.income_customer_id !== params.endCustomerId) {
        throw badRequest('source_draft_template_id end customer mismatch');
    }
}
export function buildDocumentTemplateSnapshotFromDraftRow(row) {
    const preview = row.draft_totals_preview_json && typeof row.draft_totals_preview_json === 'object'
        ? row.draft_totals_preview_json
        : {};
    const discountPercent = preview.discount_percent_reference;
    const discountAmount = preview.discount_amount_reference;
    return {
        snapshot_version: 1,
        snapshot_kind: 'document_template_snapshot',
        document_type: row.document_type,
        document_date: row.document_date,
        due_date: row.due_date,
        currency: row.currency,
        language: row.language,
        notes: row.notes,
        document_settings_json: row.document_settings_json ?? {},
        delivery_contact_json: row.delivery_contact_json,
        draft_lines_json: normalizeDraftLines(row.draft_lines_json).map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unit_price_reference: line.unit_price_reference,
            currency: line.currency,
            price_includes_vat: line.price_includes_vat,
            exchange_rate_to_ils_override: line.exchange_rate_to_ils_override,
        })),
        discount_percent_reference: typeof discountPercent === 'number' && Number.isFinite(discountPercent) ? discountPercent : null,
        discount_amount_reference: typeof discountAmount === 'number' && Number.isFinite(discountAmount) ? discountAmount : null,
    };
}
export function denormalizedProfileFieldsFromSnapshot(snapshot) {
    const firstLine = snapshot.draft_lines_json[0];
    const description = String(firstLine?.description ?? '').trim() || '—';
    const quantityRaw = Number(firstLine?.quantity ?? 1);
    const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : 1;
    const unitRaw = Number(firstLine?.unit_price_reference ?? 0);
    const unit_price_before_vat_reference = Number.isFinite(unitRaw) && unitRaw >= 0 ? unitRaw : 0;
    return {
        document_type: snapshot.document_type,
        next_document_date: snapshot.document_date,
        line_description_template: description,
        quantity,
        unit_price_before_vat_reference,
        currency: snapshot.currency,
        discount_percent_reference: snapshot.discount_percent_reference,
        discount_amount_reference: snapshot.discount_amount_reference,
    };
}
export async function buildDocumentTemplateSnapshotForRetainer(params) {
    const row = await loadDraftRow(params.orgId, params.sourceDraftTemplateId);
    assertDraftBelongsToRetainer({
        row,
        representedClientId: params.representedClientId,
        endCustomerId: params.endCustomerId,
    });
    const snapshot = buildDocumentTemplateSnapshotFromDraftRow(row);
    return { snapshot, denormalized: denormalizedProfileFieldsFromSnapshot(snapshot) };
}
async function ensureIssuerForOfficeClient(ctx, representedClientId) {
    await applySelectIncomeIssuerContext(ctx, {
        command: INCOME_COMMAND_SELECT_ISSUER,
        acting_mode: 'office_representative',
        issuer_business_id: representedClientId,
        represented_client_id: representedClientId,
    });
    const scope = await loadActiveIncomeIssuerScope(ctx);
    if (scope.represented_client_id !== representedClientId) {
        throw forbidden('Office client issuer context required');
    }
    return scope;
}
export async function ensureRetainerDocumentDraftWorkspace(params) {
    const scope = await ensureIssuerForOfficeClient(params.ctx, params.representedClientId);
    const entrypoint = await buildWorkEngineInvoicesDocumentCreationEntrypoint(params.ctx);
    const income_commands = entrypoint.wizard.income_commands;
    let recipientOverlay = {};
    let wizardOverlay = {};
    if (params.sourceDraftTemplateId) {
        try {
            const row = await loadDraftRow(scope.org_id, params.sourceDraftTemplateId);
            assertDraftBelongsToRetainer({
                row,
                representedClientId: params.representedClientId,
                endCustomerId: params.endCustomerId,
            });
            const resumed = await resumeIncomeDocumentDraft(scope, { draft_id: params.sourceDraftTemplateId });
            recipientOverlay = resumed.recipientOverlay;
            wizardOverlay = resumed.wizardOverlay;
        }
        catch {
            // Stale template id — fall through to fresh draft.
        }
    }
    if (!wizardOverlay.active_wizard_draft_id) {
        const document_type = params.fallbackDocumentType ?? 'deal_invoice';
        const begun = await beginIncomeWizardDocumentDraft(scope, {
            document_type,
            income_customer_id: params.endCustomerId,
        });
        recipientOverlay = begun.recipientOverlay;
        wizardOverlay = begun.wizardOverlay;
    }
    const income_workspace_aggregate = await buildIncomeWorkspaceAggregate(params.ctx, scope, recipientOverlay, wizardOverlay);
    return { income_workspace_aggregate, income_commands };
}

/**
 * INC-2 — Income workspace aggregate (issuer-scoped operational data).
 */
import { supabaseAdmin } from '../../db/client.js';
import { forbidden } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { loadActiveIncomeIssuerScope, toIssuerContextSummary } from './income-issuer-scope.service.js';
import { buildDocumentCreationSchema } from './income-document-creation-schema.builders.js';
import { resolveAvailableDocumentTypes } from './income-document-types.resolver.js';
import { accountingDisplayStatusLabel, resolveAccountingDisplayStatus, } from './income-accounting-posting.mapping.js';
import { incomeDocumentDownloadPath } from './income-document-pdf.service.js';
import { buildIncomeWorkspaceCards, buildWorkspaceAllowedActions } from './income-workspace-cards.builders.js';
import { buildIncomeRecipientSearchModel, buildRecipientCreateFieldsSchema, recipientSearchAllowedActions, } from './income-recipient.service.js';
import { INCOME_WORKSPACE_AGGREGATE_KEY, } from './income.types.js';
const DOCUMENT_TYPE_LABELS = {
    receipt: 'קבלה',
    tax_invoice: 'חשבונית מס',
    tax_invoice_receipt: 'חשבונית מס קבלה',
    credit_tax_invoice: 'חשבונית מס זיכוי',
    deal_invoice: 'חשבונית עסקה',
    quote: 'הצעת מחיר',
};
function applyIssuerScopeToBuilder(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
query, scope) {
    let q = query.eq('organization_id', scope.org_id).eq('issuer_business_id', scope.issuer_business_id);
    if (scope.represented_client_id === null) {
        q = q.is('represented_client_id', null);
    }
    else {
        q = q.eq('represented_client_id', scope.represented_client_id);
    }
    return q;
}
async function countScoped(table, scope, statusFilter) {
    let query = supabaseAdmin.from(table).select('id', { count: 'exact', head: true });
    query = applyIssuerScopeToBuilder(query, scope);
    if (statusFilter)
        query = query.eq(statusFilter.column, statusFilter.value);
    const { count, error } = await query;
    throwIfSupabaseError(error, `countScoped:${table}`);
    return count ?? 0;
}
async function loadCustomers(scope) {
    let query = supabaseAdmin
        .from('income_customers')
        .select('id, display_name, phone, email, tax_id, is_one_time, status, created_at')
        .order('display_name', { ascending: true })
        .limit(500);
    query = applyIssuerScopeToBuilder(query, scope);
    const { data, error } = await query;
    throwIfSupabaseError(error, 'loadIncomeWorkspaceCustomers');
    return (data ?? []).map((row) => {
        const r = row;
        return {
            customer_id: r.id,
            display_name: r.display_name,
            phone: r.phone,
            email: r.email,
            tax_id: r.tax_id,
            is_one_time: r.is_one_time,
            status: r.status,
            status_label: r.status === 'archived' ? 'Archived' : 'Active',
            created_at: r.created_at,
        };
    });
}
async function loadItems(scope) {
    let query = supabaseAdmin
        .from('income_items')
        .select('id, item_type, name, description, default_unit_price_reference, currency, active, created_at')
        .eq('active', true)
        .order('name', { ascending: true })
        .limit(500);
    query = applyIssuerScopeToBuilder(query, scope);
    const { data, error } = await query;
    throwIfSupabaseError(error, 'loadIncomeWorkspaceItems');
    return (data ?? []).map((row) => {
        const r = row;
        return {
            item_id: r.id,
            item_type: r.item_type,
            item_type_label: r.item_type === 'product' ? 'Product' : 'Service',
            name: r.name,
            description: r.description,
            default_unit_price_reference: r.default_unit_price_reference,
            currency: r.currency,
            active: r.active,
            created_at: r.created_at,
        };
    });
}
async function loadDrafts(scope, customerNames) {
    let query = supabaseAdmin
        .from('income_document_drafts')
        .select('id, document_type, status, income_customer_id, one_time_customer_snapshot_json, draft_lines_json, updated_at')
        .eq('status', 'draft')
        .order('updated_at', { ascending: false })
        .limit(500);
    query = applyIssuerScopeToBuilder(query, scope);
    const { data, error } = await query;
    throwIfSupabaseError(error, 'loadIncomeWorkspaceDrafts');
    const canEdit = scope.permissions.edit;
    const canIssue = scope.permissions.issue;
    return (data ?? []).map((row) => {
        const r = row;
        const lines = Array.isArray(r.draft_lines_json) ? r.draft_lines_json : [];
        let customerDisplay = null;
        if (r.income_customer_id) {
            customerDisplay = customerNames.get(r.income_customer_id) ?? null;
        }
        else if (r.one_time_customer_snapshot_json?.display_name != null) {
            customerDisplay = String(r.one_time_customer_snapshot_json.display_name);
        }
        const docType = r.document_type;
        return {
            draft_id: r.id,
            document_type: docType,
            document_type_label: docType ? DOCUMENT_TYPE_LABELS[docType] : null,
            status: r.status,
            status_label: r.status === 'cancelled' ? 'Cancelled' : 'Draft',
            income_customer_id: r.income_customer_id,
            customer_display_name: customerDisplay,
            line_count: lines.length,
            updated_at: r.updated_at,
            allowed_actions: [
                ...(canEdit ? ['update_income_document_draft', 'cancel_income_document_draft'] : []),
                ...(canIssue ? ['issue_income_document'] : []),
            ],
        };
    });
}
async function loadIssuedDocuments(scope) {
    let query = supabaseAdmin
        .from('income_documents')
        .select('id, document_number, document_type, document_status, customer_snapshot_json, issue_date, currency, lines_snapshot_json, source_draft_id, created_at, accounting_posting_status, accounting_entry_id, pdf_render_status, pdf_asset_id')
        .eq('document_status', 'issued')
        .order('issue_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500);
    query = applyIssuerScopeToBuilder(query, scope);
    const { data, error } = await query;
    throwIfSupabaseError(error, 'loadIncomeWorkspaceIssuedDocuments');
    const canRetryPosting = scope.permissions.issue;
    const canView = scope.permissions.view;
    const pdfStatusLabel = (status) => {
        if (status === 'rendered')
            return 'PDF ready';
        if (status === 'failed')
            return 'PDF failed';
        if (status === 'pending')
            return 'PDF pending';
        return status;
    };
    return (data ?? []).map((row) => {
        const r = row;
        const lines = Array.isArray(r.lines_snapshot_json) ? r.lines_snapshot_json : [];
        const customerDisplay = r.customer_snapshot_json?.display_name != null
            ? String(r.customer_snapshot_json.display_name)
            : null;
        const docType = r.document_type;
        const accountingDisplay = resolveAccountingDisplayStatus(docType, r.accounting_posting_status);
        const rowActions = [];
        if (canRetryPosting && r.accounting_posting_status === 'failed') {
            rowActions.push('retry_income_document_accounting_posting');
        }
        if (canRetryPosting && r.pdf_render_status === 'failed') {
            rowActions.push('retry_income_document_pdf_render');
        }
        if (canView && r.pdf_render_status === 'rendered' && r.pdf_asset_id) {
            rowActions.push('download_pdf');
        }
        return {
            document_id: r.id,
            document_number: r.document_number,
            document_type: docType,
            document_type_label: DOCUMENT_TYPE_LABELS[docType],
            document_status: r.document_status,
            document_status_label: r.document_status === 'issued' ? 'Issued' : r.document_status,
            customer_display_name: customerDisplay,
            issue_date: r.issue_date,
            currency: r.currency,
            line_count: lines.length,
            source_draft_id: r.source_draft_id,
            created_at: r.created_at,
            accounting_posting_status: r.accounting_posting_status,
            accounting_status_label: accountingDisplayStatusLabel(accountingDisplay),
            accounting_display_status: accountingDisplay,
            accounting_entry_id: r.accounting_entry_id,
            accounting_entry_reference: r.accounting_entry_id
                ? `accounting_entry:${r.accounting_entry_id}`
                : null,
            pdf_render_status: r.pdf_render_status,
            pdf_status_label: pdfStatusLabel(r.pdf_render_status),
            pdf_asset_id: r.pdf_asset_id,
            pdf_download_path: r.pdf_render_status === 'rendered' && r.pdf_asset_id
                ? incomeDocumentDownloadPath(r.id)
                : null,
            allowed_actions: rowActions,
        };
    });
}
function customersTableModel(rows) {
    return {
        columns: [
            { key: 'display_name', label: 'שם' },
            { key: 'phone', label: 'טלפון' },
            { key: 'email', label: 'אימייל' },
            { key: 'tax_id', label: 'מספר עוסק / ח.פ.' },
            { key: 'status_label', label: 'סטטוס' },
        ],
        rows,
        empty_state: {
            visible: rows.length === 0,
            title: 'אין לקוחות הכנסות',
            description: null,
        },
    };
}
function itemsTableModel(rows) {
    return {
        columns: [
            { key: 'name', label: 'שם פריט' },
            { key: 'item_type_label', label: 'סוג' },
            { key: 'default_unit_price_reference', label: 'מחיר התייחסות' },
            { key: 'currency', label: 'מטבע' },
        ],
        rows,
        empty_state: {
            visible: rows.length === 0,
            title: 'אין פריטים',
            description: null,
        },
    };
}
function issuedDocumentsTableModel(rows) {
    return {
        columns: [
            { key: 'document_number', label: 'מספר מסמך' },
            { key: 'document_type_label', label: 'סוג מסמך' },
            { key: 'customer_display_name', label: 'לקוח' },
            { key: 'issue_date', label: 'תאריך הנפקה' },
            { key: 'document_status_label', label: 'סטטוס' },
            { key: 'accounting_status_label', label: 'חשבונאות' },
            { key: 'pdf_status_label', label: 'PDF' },
        ],
        rows,
        empty_state: {
            visible: rows.length === 0,
            title: 'אין מסמכים שהונפקו',
            description: null,
        },
    };
}
function draftsTableModel(rows) {
    return {
        columns: [
            { key: 'document_type_label', label: 'סוג מסמך' },
            { key: 'customer_display_name', label: 'לקוח' },
            { key: 'line_count', label: 'שורות' },
            { key: 'status_label', label: 'סטטוס' },
            { key: 'updated_at', label: 'עודכן' },
        ],
        rows,
        empty_state: {
            visible: rows.length === 0,
            title: 'אין טיוטות',
            description: null,
        },
    };
}
function emptyIncomeTableModel(title) {
    return {
        columns: [],
        rows: [],
        empty_state: { visible: true, title, description: null },
    };
}
function minimalRecipientSearchStub(scope) {
    const canEdit = scope.permissions.edit;
    return {
        label: 'מקבל המסמך',
        placeholder: 'חיפוש לפי שם / ח.פ / ע.מ / טלפון / אימייל',
        recent_recipients: [],
        search_results: [],
        empty_state: { visible: false, message: 'לא נמצאו מקבלים שמורים' },
        create_new_action: {
            label: '+ יצירת מקבל חדש',
            enabled: canEdit,
            disabled_reason: canEdit ? null : 'נדרשת הרשאת income.edit',
        },
        create_fields_schema: buildRecipientCreateFieldsSchema(),
        save_for_future_label: 'שמור לשימוש עתידי',
        save_for_future_available: canEdit,
        selected: null,
        field_errors: {},
        allowed_actions: recipientSearchAllowedActions(scope.permissions),
    };
}
/**
 * Lightweight workspace aggregate for Work Engine wizard draft mutations.
 * Skips customers/items/drafts/issued tables and count queries (major latency win).
 */
export async function buildIncomeWorkspaceWizardPatchAggregate(scope, wizardDraftOverlay, recipientOverlay = {}) {
    const recipient_search = {
        ...minimalRecipientSearchStub(scope),
        ...(recipientOverlay.selected != null ? { selected: recipientOverlay.selected } : {}),
        ...(recipientOverlay.field_errors != null ? { field_errors: recipientOverlay.field_errors } : {}),
    };
    return {
        aggregate_key: INCOME_WORKSPACE_AGGREGATE_KEY,
        org_id: scope.org_id,
        actor_user_id: scope.actor_user_id,
        issuer_context: toIssuerContextSummary(scope),
        available_document_types: [],
        document_creation_schema: { steps: [], allowed_actions: [] },
        cards: [],
        customers_table_model: emptyIncomeTableModel('אין לקוחות הכנסות'),
        items_table_model: emptyIncomeTableModel('אין פריטים'),
        drafts_table_model: emptyIncomeTableModel('אין טיוטות'),
        issued_documents_table_model: emptyIncomeTableModel('אין מסמכים שהונפקו'),
        issued_documents_count: 0,
        recipient_search,
        document_details_step: wizardDraftOverlay.document_details_step ?? null,
        active_wizard_draft_id: wizardDraftOverlay.active_wizard_draft_id ?? null,
        allowed_actions: buildWorkspaceAllowedActions(scope.permissions),
        warnings: [],
    };
}
export async function buildIncomeWorkspaceAggregate(ctx, scopeOverride, recipientOverlay = {}, wizardDraftOverlay = {}) {
    const scope = scopeOverride ?? (await loadActiveIncomeIssuerScope(ctx));
    if (!scope.permissions.view)
        throw forbidden('income.view required');
    const [customersCount, itemsCount, draftsCount, issuedCount, postedCount, postingFailedCount] = await Promise.all([
        countScoped('income_customers', scope, { column: 'status', value: 'active' }),
        countScoped('income_items', scope, { column: 'active', value: true }),
        countScoped('income_document_drafts', scope, { column: 'status', value: 'draft' }),
        countScoped('income_documents', scope, { column: 'document_status', value: 'issued' }),
        countScoped('income_documents', scope, {
            column: 'accounting_posting_status',
            value: 'posted',
        }),
        countScoped('income_documents', scope, {
            column: 'accounting_posting_status',
            value: 'failed',
        }),
    ]);
    const docTypesResult = await resolveAvailableDocumentTypes(scope.org_id, scope);
    const canCreateDocument = scope.permissions.edit && docTypesResult.available_document_types.some((t) => t.enabled);
    const customers = await loadCustomers(scope);
    const customerNames = new Map(customers.map((c) => [c.customer_id, c.display_name]));
    const items = await loadItems(scope);
    const drafts = await loadDrafts(scope, customerNames);
    const issuedDocuments = await loadIssuedDocuments(scope);
    const recipient_search = await buildIncomeRecipientSearchModel(scope, scope.permissions, recipientOverlay);
    return {
        aggregate_key: INCOME_WORKSPACE_AGGREGATE_KEY,
        org_id: scope.org_id,
        actor_user_id: scope.actor_user_id,
        issuer_context: toIssuerContextSummary(scope),
        available_document_types: docTypesResult.available_document_types,
        document_creation_schema: buildDocumentCreationSchema(scope.permissions),
        cards: buildIncomeWorkspaceCards(scope.permissions, {
            customers: customersCount,
            items: itemsCount,
            drafts: draftsCount,
            issued_documents: issuedCount,
            posted_documents: postedCount,
            posting_failed: postingFailedCount,
        }, { canCreateDocument }),
        customers_table_model: customersTableModel(customers),
        items_table_model: itemsTableModel(items),
        drafts_table_model: draftsTableModel(drafts),
        issued_documents_table_model: issuedDocumentsTableModel(issuedDocuments),
        issued_documents_count: issuedCount,
        recipient_search,
        document_details_step: wizardDraftOverlay.document_details_step ?? null,
        active_wizard_draft_id: wizardDraftOverlay.active_wizard_draft_id ?? null,
        allowed_actions: buildWorkspaceAllowedActions(scope.permissions),
        warnings: docTypesResult.warnings,
    };
}

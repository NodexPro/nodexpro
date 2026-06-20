/**
 * Income — Client Document Management panel (CRM-style client list).
 * Single aggregate read model; issuer-scoped branding via existing studio.
 */
import { supabaseAdmin } from '../../db/client.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { amountReferenceFromTotalsSnapshot, isInvoiceCollectionDocumentType, } from './income-work-engine-bridge.pure.js';
import { excludeSelfModeActingFilter, resolveOfficeClientGroupKey, } from './income-client-document-management-panel.pure.js';
import { INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL_AGGREGATE_KEY, INCOME_COMMAND_SELECT_ISSUER, } from './income.types.js';
const PANEL_DOCUMENT_TYPES = [
    'quote',
    'deal_invoice',
    'tax_invoice',
    'tax_invoice_receipt',
    'receipt',
    'credit_tax_invoice',
];
const REPORT_CATALOG = [
    { key: 'income_summary', label: 'דוח הכנסות', enabled: false, disabled_reason: 'בקרוב' },
    { key: 'aging', label: 'Aging', enabled: false, disabled_reason: 'בקרוב' },
    { key: 'documents', label: 'דוח מסמכים', enabled: false, disabled_reason: 'בקרוב' },
    { key: 'payments', label: 'דוח תשלומים', enabled: false, disabled_reason: 'בקרוב' },
    { key: 'csv_export', label: 'CSV Export', enabled: false, disabled_reason: 'בקרוב' },
];
function buildRowActions(clientId, perms, options) {
    const canEdit = perms.edit;
    const actions = [
        {
            key: 'open_branding_studio',
            label: 'הגדרות מסמך',
            icon_key: 'settings',
            command: INCOME_COMMAND_SELECT_ISSUER,
            command_payload: {
                command: INCOME_COMMAND_SELECT_ISSUER,
                acting_mode: 'office_representative',
                issuer_business_id: clientId,
                represented_client_id: clientId,
                open_document_branding_studio: true,
            },
            enabled: canEdit,
            disabled_reason: canEdit ? null : 'אין הרשאת עריכה',
        },
        {
            key: 'open_end_customers',
            label: 'לקוחות הלקוח',
            icon_key: 'end_customers',
            command: INCOME_COMMAND_SELECT_ISSUER,
            command_payload: {
                command: INCOME_COMMAND_SELECT_ISSUER,
                acting_mode: 'office_representative',
                issuer_business_id: clientId,
                represented_client_id: clientId,
                open_end_customers_panel: true,
            },
            enabled: perms.view,
            disabled_reason: perms.view ? null : 'אין הרשאת צפייה',
        },
        {
            key: 'open_reports',
            label: 'דוחות',
            icon_key: 'reports',
            command: null,
            command_payload: { open_reports_panel: true, client_id: clientId },
            enabled: perms.view,
            disabled_reason: perms.view ? null : 'אין הרשאת צפייה',
        },
        {
            key: 'open_income_ledger_card',
            label: 'כרטסת הכנסות',
            icon_key: 'ledger',
            command: null,
            command_payload: {
                open_income_ledger_card: true,
                represented_client_id: clientId,
            },
            enabled: perms.view,
            disabled_reason: perms.view ? null : 'אין הרשאת צפייה',
        },
    ];
    if (options?.includeRetainerAction) {
        actions.push({
            key: 'open_invoice_retainer_setup',
            label: 'ריטיינר חשבוניות',
            icon_key: 'retainer',
            command: null,
            command_payload: {
                open_invoice_retainer_setup: true,
                represented_client_id: clientId,
            },
            enabled: perms.edit,
            disabled_reason: perms.edit ? null : 'אין הרשאת עריכה',
        });
    }
    actions.push({
        key: 'more',
        label: 'פעולות נוספות',
        icon_key: 'more',
        command: null,
        command_payload: { open_more_menu: true, client_id: clientId },
        enabled: true,
        disabled_reason: null,
    });
    return actions;
}
function formatMoneyReference(amount, currency) {
    return `${amount.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}
function formatDateDisplay(iso) {
    if (!iso)
        return '—';
    const d = iso.length >= 10 ? iso.slice(0, 10) : iso;
    return new Date(d).toLocaleDateString('he-IL');
}
function emptyPanel(visible) {
    return {
        aggregate_key: INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL_AGGREGATE_KEY,
        visible,
        title: 'ניהול מסמכים לפי לקוח',
        description: visible ? 'לקוחות שכבר הופקו עבורם מסמכי הכנסה' : null,
        columns: [],
        rows: [],
        report_catalog: visible ? REPORT_CATALOG : [],
        empty_state: {
            visible: false,
            title: visible ? 'אין עדיין לקוחות עם מסמכים' : '',
            description: visible ? 'לאחר הפקת מסמך עבור לקוח — הוא יופיע כאן.' : null,
        },
    };
}
function incrementTypeCount(acc, documentType) {
    if (documentType === 'quote')
        acc.quote_count += 1;
    else if (documentType === 'deal_invoice')
        acc.deal_count += 1;
    else if (documentType === 'tax_invoice' || documentType === 'tax_invoice_receipt')
        acc.tax_invoice_count += 1;
    else if (documentType === 'receipt')
        acc.receipt_count += 1;
    else if (documentType === 'credit_tax_invoice')
        acc.credit_count += 1;
}
function incrementIssuedTypeCount(acc, documentType) {
    if (documentType === 'quote')
        acc.quote_issued_count += 1;
    else if (documentType === 'deal_invoice')
        acc.deal_issued_count += 1;
    else if (documentType === 'tax_invoice')
        acc.tax_invoice_issued_count += 1;
    else if (documentType === 'tax_invoice_receipt')
        acc.tax_invoice_receipt_issued_count += 1;
    else if (documentType === 'receipt')
        acc.receipt_issued_count += 1;
    else if (documentType === 'credit_tax_invoice')
        acc.credit_issued_count += 1;
}
function buildDocumentTypeCounters(acc) {
    return [
        {
            key: 'quote',
            label: 'הצעת מחיר',
            count: acc.quote_issued_count,
            tone: 'blue',
            tooltip_label: 'הצעות מחיר',
            action_key: 'open_documents_by_type',
        },
        {
            key: 'deal_invoice',
            label: 'חשבון עסקה',
            count: acc.deal_issued_count,
            tone: 'purple',
            tooltip_label: 'חשבונות עסקה',
            action_key: 'open_documents_by_type',
        },
        {
            key: 'tax_invoice',
            label: 'חשבונית מס',
            count: acc.tax_invoice_issued_count,
            tone: 'cyan',
            tooltip_label: 'חשבוניות מס',
            action_key: 'open_documents_by_type',
        },
        {
            key: 'tax_invoice_receipt',
            label: 'חשבונית מס/קבלה',
            count: acc.tax_invoice_receipt_issued_count,
            tone: 'teal',
            tooltip_label: 'חשבוניות מס/קבלה',
            action_key: 'open_documents_by_type',
        },
        {
            key: 'receipt',
            label: 'קבלה',
            count: acc.receipt_issued_count,
            tone: 'green',
            tooltip_label: 'קבלות',
            action_key: 'open_documents_by_type',
        },
        {
            key: 'credit_tax_invoice',
            label: 'זיכוי',
            count: acc.credit_issued_count,
            tone: 'red',
            tooltip_label: 'זיכויים',
            action_key: 'open_documents_by_type',
        },
        {
            key: 'draft',
            label: 'טיוטות',
            count: acc.draft_documents_count,
            tone: 'slate',
            tooltip_label: 'טיוטות',
            action_key: 'open_documents_by_type',
        },
    ];
}
function ensureAcc(byClient, clientId, currency = 'ILS') {
    let acc = byClient.get(clientId);
    if (!acc) {
        acc = {
            represented_client_id: clientId,
            total_documents_count: 0,
            draft_documents_count: 0,
            quote_count: 0,
            deal_count: 0,
            tax_invoice_count: 0,
            receipt_count: 0,
            credit_count: 0,
            quote_issued_count: 0,
            deal_issued_count: 0,
            tax_invoice_issued_count: 0,
            tax_invoice_receipt_issued_count: 0,
            receipt_issued_count: 0,
            credit_issued_count: 0,
            last_document_date: null,
            last_activity_at: null,
            unpaid_reference: 0,
            currency,
        };
        byClient.set(clientId, acc);
    }
    return acc;
}
export async function buildIncomeClientDocumentManagementPanel(params) {
    const orgId = params.ctx.organizationId;
    const visible = params.perms.issue_on_behalf;
    if (!visible) {
        return emptyPanel(false);
    }
    const { data: docs, error: docsErr } = await supabaseAdmin
        .from('income_documents')
        .select('id, represented_client_id, issuer_business_id, acting_mode, document_type, document_status, issue_date, updated_at, currency, totals_snapshot_json, due_date')
        .eq('organization_id', orgId)
        .or(excludeSelfModeActingFilter())
        .eq('document_status', 'issued')
        .in('document_type', PANEL_DOCUMENT_TYPES)
        .order('issue_date', { ascending: false })
        .limit(5000);
    throwIfSupabaseError(docsErr, 'loadClientDocumentManagementDocs');
    const { data: draftRows, error: draftsErr } = await supabaseAdmin
        .from('income_document_drafts')
        .select('id, represented_client_id, issuer_business_id, acting_mode, document_type, status, updated_at')
        .eq('organization_id', orgId)
        .or(excludeSelfModeActingFilter())
        .eq('status', 'draft')
        .order('updated_at', { ascending: false })
        .limit(5000);
    throwIfSupabaseError(draftsErr, 'loadClientDocumentManagementDrafts');
    const byClient = new Map();
    let selfModeIssuedCount = 0;
    let selfModeDraftCount = 0;
    for (const raw of docs ?? []) {
        const row = raw;
        const clientId = resolveOfficeClientGroupKey(row);
        if (!clientId) {
            if (row.acting_mode === 'self')
                selfModeIssuedCount += 1;
            continue;
        }
        const acc = ensureAcc(byClient, clientId, row.currency || 'ILS');
        acc.total_documents_count += 1;
        incrementTypeCount(acc, row.document_type);
        incrementIssuedTypeCount(acc, row.document_type);
        const activityAt = row.updated_at || row.issue_date;
        if (!acc.last_activity_at || (activityAt && activityAt > acc.last_activity_at)) {
            acc.last_activity_at = activityAt;
        }
        if (!acc.last_document_date || (row.issue_date && row.issue_date > acc.last_document_date)) {
            acc.last_document_date = row.issue_date;
        }
        if (isInvoiceCollectionDocumentType(row.document_type)) {
            const amount = amountReferenceFromTotalsSnapshot(row.totals_snapshot_json);
            if (amount != null && amount > 0) {
                acc.unpaid_reference += amount;
            }
        }
    }
    for (const raw of draftRows ?? []) {
        const row = raw;
        const clientId = resolveOfficeClientGroupKey(row);
        if (!clientId) {
            if (row.acting_mode === 'self')
                selfModeDraftCount += 1;
            continue;
        }
        const acc = ensureAcc(byClient, clientId);
        acc.draft_documents_count += 1;
        if (row.document_type)
            incrementTypeCount(acc, row.document_type);
        const activityAt = row.updated_at;
        if (!acc.last_activity_at || (activityAt && activityAt > acc.last_activity_at)) {
            acc.last_activity_at = activityAt;
        }
    }
    const clientIds = [...byClient.keys()];
    const clientMetaById = new Map();
    if (clientIds.length > 0) {
        const { data: clients, error: clientsErr } = await supabaseAdmin
            .from('clients')
            .select('id, display_name, tax_id, email')
            .eq('organization_id', orgId)
            .in('id', clientIds);
        throwIfSupabaseError(clientsErr, 'loadClientDocumentManagementClients');
        for (const c of clients ?? []) {
            const client = c;
            clientMetaById.set(client.id, {
                display_name: client.display_name,
                tax_id: client.tax_id,
                email: client.email,
            });
        }
    }
    const rows = clientIds
        .map((clientId) => {
        const acc = byClient.get(clientId);
        const meta = clientMetaById.get(clientId);
        const clientName = meta?.display_name ?? clientId;
        const unpaidRef = acc.unpaid_reference > 0 ? acc.unpaid_reference : null;
        return {
            represented_client_id: clientId,
            client_display_name: clientName,
            client_logo_url: null,
            client_initials: clientName.trim().slice(0, 2) || '—',
            tax_id: meta?.tax_id ?? null,
            email: meta?.email ?? null,
            total_documents_count: acc.total_documents_count,
            quote_count: acc.quote_count,
            deal_count: acc.deal_count,
            tax_invoice_count: acc.tax_invoice_count,
            receipt_count: acc.receipt_count,
            credit_count: acc.credit_count,
            document_type_counters: buildDocumentTypeCounters(acc),
            unpaid_amount_reference: unpaidRef,
            unpaid_amount_display: unpaidRef != null ? formatMoneyReference(unpaidRef, acc.currency) : '—',
            last_document_date: acc.last_document_date,
            last_document_date_display: formatDateDisplay(acc.last_document_date),
            last_activity_at: acc.last_activity_at,
            last_activity_display: formatDateDisplay(acc.last_activity_at),
            status_label: acc.total_documents_count > 0
                ? unpaidRef != null
                    ? 'פתוח לגבייה'
                    : 'פעיל'
                : acc.draft_documents_count > 0
                    ? 'טיוטות פעילות'
                    : 'פעיל',
            actions: buildRowActions(clientId, params.perms, {
                includeRetainerAction: params.includeRetainerAction,
            }),
        };
    })
        .sort((a, b) => a.client_display_name.localeCompare(b.client_display_name, 'he'));
    return {
        aggregate_key: INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL_AGGREGATE_KEY,
        visible: true,
        title: 'ניהול מסמכים לפי לקוח',
        description: 'לקוחות עם מסמכים שהונפקו או טיוטות פעילות במצב נציג משרד',
        columns: [
            { key: 'client', label: 'לקוח' },
            { key: 'total_documents_count', label: 'מסמכים' },
            { key: 'unpaid_amount_display', label: 'לא שולם' },
            { key: 'last_document_date_display', label: 'מסמך אחרון' },
            { key: 'last_activity_display', label: 'פעילות אחרונה' },
            { key: 'status_label', label: 'סטטוס' },
            { key: 'actions', label: '' },
        ],
        rows,
        report_catalog: REPORT_CATALOG,
        empty_state: {
            visible: rows.length === 0,
            title: 'אין עדיין לקוחות עם מסמכים',
            description: rows.length === 0 && (selfModeIssuedCount > 0 || selfModeDraftCount > 0)
                ? 'מסמכים במצב עצמי (self) אינם מוצגים כאן. בחר לקוח במצב נציג משרד, צור טיוטה או הפק מסמך — והלקוח יופיע בשורה אחת.'
                : 'לאחר הפקת מסמך או שמירת טיוטה עבור לקוח במצב נציג משרד — הוא יופיע כאן.',
        },
    };
}

/**
 * Income — Client Document Management panel (CRM-style client list).
 * Single aggregate read model; counters from SQL aggregation (P4.2).
 * unpaid_amount_* binds to SQL unpaid_reference = Accounting Base remaining
 * (original − posted allocations − issued Credit Note totals). No FE arithmetic.
 */
import { supabaseAdmin } from '../../db/client.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL_AGGREGATE_KEY, INCOME_COMMAND_SELECT_ISSUER, INCOME_REPRESENTED_CLIENT_EMAIL_HISTORY_AGGREGATE_KEY, } from './income.types.js';
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
        {
            key: 'open_email_history',
            label: '@',
            icon_key: 'at',
            command: null,
            command_payload: {
                open_email_history: true,
                represented_client_id: clientId,
                aggregate_key: INCOME_REPRESENTED_CLIENT_EMAIL_HISTORY_AGGREGATE_KEY,
            },
            enabled: perms.view && perms.issue_on_behalf,
            disabled_reason: perms.view && perms.issue_on_behalf ? null : 'זמין במצב ניהול לקוח בלבד',
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
function buildDocumentTypeCounters(stat) {
    return [
        {
            key: 'quote',
            label: 'הצעת מחיר',
            count: Number(stat.quote_issued_count) || 0,
            tone: 'blue',
            tooltip_label: 'הצעות מחיר',
            action_key: 'open_documents_by_type',
        },
        {
            key: 'deal_invoice',
            label: 'חשבון עסקה',
            count: Number(stat.deal_issued_count) || 0,
            tone: 'purple',
            tooltip_label: 'חשבונות עסקה',
            action_key: 'open_documents_by_type',
        },
        {
            key: 'tax_invoice',
            label: 'חשבונית מס',
            count: Number(stat.tax_invoice_issued_count) || 0,
            tone: 'cyan',
            tooltip_label: 'חשבוניות מס',
            action_key: 'open_documents_by_type',
        },
        {
            key: 'tax_invoice_receipt',
            label: 'חשבונית מס/קבלה',
            count: Number(stat.tax_invoice_receipt_issued_count) || 0,
            tone: 'teal',
            tooltip_label: 'חשבוניות מס/קבלה',
            action_key: 'open_documents_by_type',
        },
        {
            key: 'receipt',
            label: 'קבלה',
            count: Number(stat.receipt_issued_count) || 0,
            tone: 'green',
            tooltip_label: 'קבלות',
            action_key: 'open_documents_by_type',
        },
        {
            key: 'credit_tax_invoice',
            label: 'זיכוי',
            count: Number(stat.credit_issued_count) || 0,
            tone: 'red',
            tooltip_label: 'זיכויים',
            action_key: 'open_documents_by_type',
        },
        {
            key: 'draft',
            label: 'טיוטות',
            count: Number(stat.draft_documents_count) || 0,
            tone: 'slate',
            tooltip_label: 'טיוטות',
            action_key: 'open_documents_by_type',
        },
    ];
}
async function countSelfModeRows(orgId) {
    const [issuedRes, draftRes] = await Promise.all([
        supabaseAdmin
            .from('income_documents')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('acting_mode', 'self')
            .eq('document_status', 'issued'),
        supabaseAdmin
            .from('income_document_drafts')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('acting_mode', 'self')
            .eq('status', 'draft')
            .not('user_saved_at', 'is', null),
    ]);
    throwIfSupabaseError(issuedRes.error, 'countSelfModeIssuedDocuments');
    throwIfSupabaseError(draftRes.error, 'countSelfModeUserSavedDrafts');
    return {
        issued: issuedRes.count ?? 0,
        drafts: draftRes.count ?? 0,
    };
}
function logPanelTiming(label, startedAt) {
    const elapsedMs = Date.now() - startedAt;
    console.info(`[income][client-document-panel][timing] ${label} ${elapsedMs}ms`);
    return Date.now();
}
export async function buildIncomeClientDocumentManagementPanel(params) {
    const orgId = params.ctx.organizationId;
    const visible = params.perms.issue_on_behalf;
    const aggregateStartMs = Date.now();
    if (!visible) {
        return emptyPanel(false);
    }
    let stepStart = aggregateStartMs;
    const [statsRes, selfCounts] = await Promise.all([
        supabaseAdmin.rpc('income_client_document_management_panel_stats', {
            p_org_id: orgId,
        }),
        countSelfModeRows(orgId),
    ]);
    throwIfSupabaseError(statsRes.error, 'incomeClientDocumentManagementPanelStats', {
        migrationHint: '163_income_client_panel_unpaid_subtract_issued_credits.sql',
    });
    stepStart = logPanelTiming('rpc_stats_and_self_counts', stepStart);
    const stats = (statsRes.data ?? []);
    const clientIds = stats
        .map((s) => String(s.represented_client_id ?? '').trim())
        .filter(Boolean);
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
    stepStart = logPanelTiming('load_client_meta', stepStart);
    const rows = stats
        .map((stat) => {
        const clientId = String(stat.represented_client_id);
        const meta = clientMetaById.get(clientId);
        const clientName = meta?.display_name ?? clientId;
        // Backend-owned AB remaining sum from RPC (not original invoice total).
        const unpaidRaw = Number(stat.unpaid_reference ?? 0);
        const unpaidRef = Number.isFinite(unpaidRaw) && unpaidRaw > 0 ? unpaidRaw : null;
        const currency = String(stat.currency || 'ILS');
        const totalDocuments = Number(stat.total_documents_count) || 0;
        const draftDocuments = Number(stat.draft_documents_count) || 0;
        const lastDocumentDate = typeof stat.last_document_date === 'string' ? stat.last_document_date : null;
        const lastActivityAt = typeof stat.last_activity_at === 'string' ? stat.last_activity_at : null;
        return {
            represented_client_id: clientId,
            client_display_name: clientName,
            client_logo_url: null,
            client_initials: clientName.trim().slice(0, 2) || '—',
            tax_id: meta?.tax_id ?? null,
            email: meta?.email ?? null,
            total_documents_count: totalDocuments,
            quote_count: Number(stat.quote_count) || 0,
            deal_count: Number(stat.deal_count) || 0,
            tax_invoice_count: Number(stat.tax_invoice_count) || 0,
            receipt_count: Number(stat.receipt_count) || 0,
            credit_count: Number(stat.credit_count) || 0,
            document_type_counters: buildDocumentTypeCounters(stat),
            unpaid_amount_reference: unpaidRef,
            unpaid_amount_display: unpaidRef != null ? formatMoneyReference(unpaidRef, currency) : '—',
            last_document_date: lastDocumentDate,
            last_document_date_display: formatDateDisplay(lastDocumentDate),
            last_activity_at: lastActivityAt,
            last_activity_display: formatDateDisplay(lastActivityAt),
            status_label: totalDocuments > 0
                ? unpaidRef != null
                    ? 'פתוח לגבייה'
                    : 'פעיל'
                : draftDocuments > 0
                    ? 'טיוטות פעילות'
                    : 'פעיל',
            actions: buildRowActions(clientId, params.perms, {
                includeRetainerAction: params.includeRetainerAction,
            }),
        };
    })
        .sort((a, b) => a.client_display_name.localeCompare(b.client_display_name, 'he'));
    logPanelTiming('TOTAL', aggregateStartMs);
    console.info(`[income][client-document-panel][payload] clients=${rows.length} stats_rows=${stats.length}`);
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
            description: rows.length === 0 && (selfCounts.issued > 0 || selfCounts.drafts > 0)
                ? 'מסמכים במצב עצמי (self) אינם מוצגים כאן. בחר לקוח במצב נציג משרד, צור טיוטה או הפק מסמך — והלקוח יופיע בשורה אחת.'
                : 'לאחר הפקת מסמך או שמירת טיוטה עבור לקוח במצב נציג משרד — הוא יופיע כאן.',
        },
    };
}

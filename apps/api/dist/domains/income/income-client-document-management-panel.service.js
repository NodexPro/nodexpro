/**
 * Income — Client Document Management panel (CRM-style client list).
 * Single aggregate read model; issuer-scoped branding via existing studio.
 */
import { supabaseAdmin } from '../../db/client.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { amountReferenceFromTotalsSnapshot, isInvoiceCollectionDocumentType, } from './income-work-engine-bridge.pure.js';
import { INCOME_COMMAND_SELECT_ISSUER } from './income.types.js';
const PANEL_DOCUMENT_TYPES = [
    'quote',
    'deal_invoice',
    'tax_invoice',
    'tax_invoice_receipt',
    'receipt',
    'credit_tax_invoice',
];
const DOCUMENT_TYPE_LABELS = {
    quote: 'הצעת מחיר',
    deal_invoice: 'חשבון עסקה',
    tax_invoice: 'חשבונית מס',
    tax_invoice_receipt: 'חשבונית מס/קבלה',
    receipt: 'קבלה',
    credit_tax_invoice: 'זיכוי',
};
const REPORT_CATALOG = [
    { key: 'income_summary', label: 'דוח הכנסות', enabled: false, disabled_reason: 'בקרוב' },
    { key: 'aging', label: 'Aging', enabled: false, disabled_reason: 'בקרוב' },
    { key: 'documents', label: 'דוח מסמכים', enabled: false, disabled_reason: 'בקרוב' },
    { key: 'payments', label: 'דוח תשלומים', enabled: false, disabled_reason: 'בקרוב' },
    { key: 'csv_export', label: 'CSV Export', enabled: false, disabled_reason: 'בקרוב' },
];
const BUCKET_ORG_ASSETS = 'organization-assets';
async function ensureOrgAssetsBucket() {
    const { error } = await supabaseAdmin.storage.createBucket(BUCKET_ORG_ASSETS, { public: false });
    if (error && !/already exists/i.test(error.message))
        throw error;
}
async function fileAssetToDataUrl(fileAssetId) {
    const { data, error } = await supabaseAdmin
        .from('file_assets')
        .select('storage_bucket, storage_key, mime_type, archived_at')
        .eq('id', fileAssetId)
        .maybeSingle();
    throwIfSupabaseError(error, 'fileAssetToDataUrl');
    const row = data;
    if (!row?.storage_key || row.archived_at)
        return null;
    const bucket = row.storage_bucket ?? BUCKET_ORG_ASSETS;
    if (bucket === BUCKET_ORG_ASSETS)
        await ensureOrgAssetsBucket();
    const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(bucket).download(row.storage_key);
    if (dlErr || !blob)
        return null;
    const buf = Buffer.from(await blob.arrayBuffer());
    const mime = (row.mime_type ?? 'image/png').split(';')[0].trim();
    return `data:${mime};base64,${buf.toString('base64')}`;
}
function buildRowActions(clientId, perms) {
    const canEdit = perms.edit;
    return [
        {
            key: 'document_settings',
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
            key: 'end_customers',
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
            key: 'reports',
            label: 'דוחות',
            icon_key: 'reports',
            command: null,
            command_payload: { open_reports_panel: true, client_id: clientId },
            enabled: perms.view,
            disabled_reason: perms.view ? null : 'אין הרשאת צפייה',
        },
        {
            key: 'more',
            label: 'פעולות נוספות',
            icon_key: 'more',
            command: null,
            command_payload: { open_more_menu: true, client_id: clientId },
            enabled: true,
            disabled_reason: null,
        },
    ];
}
function formatMoneyReference(amount, currency) {
    return `${amount.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}
export async function buildIncomeClientDocumentManagementPanel(params) {
    const orgId = params.ctx.organizationId;
    const visible = params.perms.issue_on_behalf;
    if (!visible) {
        return {
            visible: false,
            title: 'ניהול מסמכים לפי לקוח',
            description: null,
            columns: [],
            rows: [],
            report_catalog: [],
            empty_state: {
                visible: false,
                title: '',
                description: null,
            },
        };
    }
    const { data: docs, error: docsErr } = await supabaseAdmin
        .from('income_documents')
        .select('id, represented_client_id, document_type, issue_date, updated_at, currency, totals_snapshot_json, due_date')
        .eq('organization_id', orgId)
        .not('represented_client_id', 'is', null)
        .in('document_type', PANEL_DOCUMENT_TYPES)
        .order('issue_date', { ascending: false })
        .limit(5000);
    throwIfSupabaseError(docsErr, 'loadClientDocumentManagementDocs');
    const byClient = new Map();
    for (const raw of docs ?? []) {
        const row = raw;
        const clientId = row.represented_client_id;
        let acc = byClient.get(clientId);
        if (!acc) {
            acc = {
                client_id: clientId,
                documents_count: 0,
                last_document_type: null,
                last_document_at: null,
                last_activity_at: null,
                unpaid_reference: 0,
                currency: row.currency || 'ILS',
            };
            byClient.set(clientId, acc);
        }
        acc.documents_count += 1;
        const activityAt = row.updated_at || row.issue_date;
        if (!acc.last_activity_at || (activityAt && activityAt > acc.last_activity_at)) {
            acc.last_activity_at = activityAt;
        }
        if (!acc.last_document_at || (row.issue_date && row.issue_date > acc.last_document_at)) {
            acc.last_document_at = row.issue_date;
            acc.last_document_type = row.document_type;
        }
        if (isInvoiceCollectionDocumentType(row.document_type)) {
            const amount = amountReferenceFromTotalsSnapshot(row.totals_snapshot_json);
            if (amount != null && amount > 0) {
                acc.unpaid_reference += amount;
            }
        }
    }
    const clientIds = [...byClient.keys()];
    const clientNameById = new Map();
    if (clientIds.length > 0) {
        const { data: clients, error: clientsErr } = await supabaseAdmin
            .from('clients')
            .select('id, display_name')
            .eq('organization_id', orgId)
            .in('id', clientIds);
        throwIfSupabaseError(clientsErr, 'loadClientDocumentManagementClients');
        for (const c of clients ?? []) {
            const client = c;
            clientNameById.set(client.id, client.display_name);
        }
    }
    const logoByClientId = new Map();
    if (clientIds.length > 0) {
        const { data: profiles, error: profilesErr } = await supabaseAdmin
            .from('income_document_branding_profiles')
            .select('issuer_business_id, logo_file_asset_id')
            .eq('organization_id', orgId)
            .in('issuer_business_id', clientIds);
        throwIfSupabaseError(profilesErr, 'loadClientDocumentManagementLogos');
        for (const p of profiles ?? []) {
            const profile = p;
            if (profile.logo_file_asset_id) {
                logoByClientId.set(profile.issuer_business_id, await fileAssetToDataUrl(profile.logo_file_asset_id));
            }
        }
    }
    const rows = clientIds
        .map((clientId) => {
        const acc = byClient.get(clientId);
        const clientName = clientNameById.get(clientId) ?? clientId;
        const lastDocLabel = acc.last_document_type != null
            ? DOCUMENT_TYPE_LABELS[acc.last_document_type]
            : '—';
        return {
            client_id: clientId,
            client_name: clientName,
            logo_preview_url: logoByClientId.get(clientId) ?? null,
            client_initials: clientName.trim().slice(0, 2) || '—',
            last_document_label: lastDocLabel,
            last_document_at: acc.last_document_at,
            documents_count: acc.documents_count,
            unpaid_display: acc.unpaid_reference > 0
                ? formatMoneyReference(acc.unpaid_reference, acc.currency)
                : '—',
            last_activity_at: acc.last_activity_at,
            last_activity_label: acc.last_activity_at
                ? new Date(acc.last_activity_at).toLocaleDateString('he-IL')
                : '—',
            actions: buildRowActions(clientId, params.perms),
        };
    })
        .sort((a, b) => a.client_name.localeCompare(b.client_name, 'he'));
    return {
        visible: true,
        title: 'ניהול מסמכים לפי לקוח',
        description: 'לקוחות שכבר הופקו עבורם מסמכי הכנסה',
        columns: [
            { key: 'client', label: 'לקוח' },
            { key: 'last_document', label: 'מסמך אחרון' },
            { key: 'documents_count', label: 'מספר מסמכים' },
            { key: 'unpaid', label: 'לא שולם' },
            { key: 'last_activity', label: 'פעילות אחרונה' },
            { key: 'actions', label: '' },
        ],
        rows,
        report_catalog: REPORT_CATALOG,
        empty_state: {
            visible: rows.length === 0,
            title: 'אין עדיין לקוחות עם מסמכים',
            description: 'לאחר הפקת מסמך עבור לקוח — הוא יופיע כאן.',
        },
    };
}

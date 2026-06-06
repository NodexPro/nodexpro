/**
 * INC-8 — Work Engine Invoices tab aggregate (operational Excel-like table).
 *
 * NOT Income module homepage. Single read model; no frontend stitching.
 * Money columns are reference display from income_documents snapshots only.
 */
import { supabaseAdmin } from '../../db/client.js';
import { forbidden } from '../../shared/errors.js';
import { buildAccountantWorkspaceTabs } from './work-engine.read-models.service.js';
import { buildWorkEngineInvoicesDocumentCreationEntrypoint } from './work-engine-invoices-document-creation.builders.js';
import { amountReferenceFromTotalsSnapshot, customerDisplayFromSnapshot, isOverdueByDueDate, } from '../income/income-work-engine-bridge.pure.js';
import { loadActiveIncomeIssuerScope } from '../income/income-issuer-scope.service.js';
import { incomeWorkspacePermissionsFromContext } from '../income/income-issuer-context.service.js';
import { buildIncomeClientDocumentManagementPanel } from '../income/income-client-document-management-panel.service.js';
import { buildDocumentBrandingProfileAggregate, buildDocumentBrandingSettingsEntrypoint, } from '../income/income-document-branding.service.js';
const DOCUMENT_TYPE_LABELS = {
    receipt: 'קבלה',
    tax_invoice: 'חשבונית מס',
    tax_invoice_receipt: 'חשבונית מס קבלה',
    credit_tax_invoice: 'חשבונית מס זיכוי',
    deal_invoice: 'חשבונית עסקה',
    quote: 'הצעת מחיר',
};
export const WORK_ENGINE_INVOICES_TAB_COLUMNS = [
    { key: 'client_name', label: 'לקוח', type: 'text' },
    { key: 'amount_due_reference', label: 'סכום לתשלום', type: 'money_reference' },
    { key: 'amount_paid_reference', label: 'שולם', type: 'money_reference' },
    { key: 'renewal_date', label: 'תאריך חידוש', type: 'date' },
    { key: 'quote_sent_date', label: 'הצעת מחיר נשלחה', type: 'date' },
    { key: 'approval_status', label: 'אישור', type: 'status' },
    { key: 'invoice_sent_date', label: 'חשבונית נשלחה', type: 'date' },
    { key: 'due_date', label: 'תאריך לתשלום', type: 'date' },
    { key: 'collection_status', label: 'סטטוס', type: 'status' },
    { key: 'invoice_paid_date', label: 'תאריך תשלום', type: 'date' },
    { key: 'invoice_number', label: 'מספר חשבונית', type: 'text' },
    { key: 'comments', label: 'הערות', type: 'text' },
];
function collectionStatusLabel(dueDate, todayIso) {
    if (!dueDate)
        return 'ללא תאריך לתשלום';
    if (isOverdueByDueDate(dueDate, todayIso))
        return 'באיחור';
    return 'פתוח';
}
export async function buildWorkEngineInvoicesTabAggregate(params) {
    const orgId = params.ctx.organizationId;
    if (!orgId)
        throw forbidden('Organization context required');
    const incomePerms = incomeWorkspacePermissionsFromContext(params.ctx);
    const client_document_management_panel = await buildIncomeClientDocumentManagementPanel({
        ctx: params.ctx,
        perms: incomePerms,
        includeRetainerAction: true,
    });
    let document_branding_profile = null;
    let document_branding_settings_entrypoint = null;
    try {
        const issuerScope = await loadActiveIncomeIssuerScope(params.ctx);
        if (issuerScope.permissions.view) {
            document_branding_profile = await buildDocumentBrandingProfileAggregate(issuerScope, issuerScope.permissions.edit);
            document_branding_settings_entrypoint = buildDocumentBrandingSettingsEntrypoint(issuerScope.permissions);
        }
    }
    catch {
        document_branding_profile = null;
        document_branding_settings_entrypoint = null;
    }
    if (client_document_management_panel.visible) {
        return {
            aggregate_key: 'work_engine_invoices_tab_aggregate',
            org_id: orgId,
            workspace_tabs: buildAccountantWorkspaceTabs('invoices'),
            title: 'חשבוניות',
            description: 'ניהול מסמכים לפי לקוח — הגדרות, לקוחות קצה ודוחות',
            table_model: {
                columns: [],
                rows: [],
                empty_state: {
                    visible: false,
                    title: '',
                    description: null,
                },
            },
            summary: {
                rows_count: client_document_management_panel.rows.length,
                sum_paid_reference: 0,
                avg_paid_reference: 0,
                currency: 'ILS',
            },
            filters: [],
            allowed_actions: ['view_invoices_tab', 'open_income_document_wizard'],
            document_creation_entrypoint: await buildWorkEngineInvoicesDocumentCreationEntrypoint(params.ctx),
            draft_entrypoints: [],
            gaps: [],
            document_branding_profile,
            document_branding_settings_entrypoint,
            client_document_management_panel,
        };
    }
    const todayIso = new Date().toISOString().slice(0, 10);
    const { data: drafts, error: dErr } = await supabaseAdmin
        .from('income_document_drafts')
        .select('id, represented_client_id, document_type, status, updated_at, draft_lines_json, draft_totals_preview_json, income_customer_id, one_time_customer_snapshot_json')
        .eq('organization_id', orgId)
        .eq('status', 'draft')
        .not('represented_client_id', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(20);
    if (dErr)
        throw dErr;
    const { data: docs, error } = await supabaseAdmin
        .from('income_documents')
        .select('id, represented_client_id, document_number, document_type, issue_date, due_date, currency, customer_snapshot_json, totals_snapshot_json')
        .eq('organization_id', orgId)
        .eq('document_status', 'issued')
        .not('represented_client_id', 'is', null)
        .order('issue_date', { ascending: false })
        .limit(500);
    if (error)
        throw error;
    const clientIds = [
        ...new Set((docs ?? [])
            .map((d) => d.represented_client_id)
            .filter((id) => !!id)),
    ];
    for (const raw of drafts ?? []) {
        const rid = raw.represented_client_id;
        if (rid)
            clientIds.push(rid);
    }
    const clientNameById = new Map();
    if (clientIds.length > 0) {
        const { data: clients, error: cErr } = await supabaseAdmin
            .from('clients')
            .select('id, display_name')
            .eq('organization_id', orgId)
            .in('id', clientIds);
        if (cErr)
            throw cErr;
        for (const c of clients ?? []) {
            const row = c;
            clientNameById.set(row.id, row.display_name);
        }
    }
    const rows = [];
    let sumPaidReference = 0;
    let paidCount = 0;
    let currency = 'ILS';
    for (const raw of docs ?? []) {
        const d = raw;
        currency = d.currency || currency;
        const amountDue = amountReferenceFromTotalsSnapshot(d.totals_snapshot_json);
        const amountPaid = null;
        if (amountPaid != null) {
            sumPaidReference += amountPaid;
            paidCount += 1;
        }
        const clientName = clientNameById.get(d.represented_client_id) ??
            customerDisplayFromSnapshot(d.customer_snapshot_json) ??
            '—';
        rows.push({
            income_document_id: d.id,
            client_name: clientName,
            amount_due_reference: amountDue,
            amount_paid_reference: amountPaid,
            renewal_date: null,
            quote_sent_date: d.document_type === 'quote' ? d.issue_date : null,
            approval_status: null,
            invoice_sent_date: d.issue_date,
            due_date: d.due_date,
            collection_status: collectionStatusLabel(d.due_date, todayIso),
            invoice_paid_date: null,
            invoice_number: d.document_number,
            comments: null,
        });
    }
    const avgPaidReference = paidCount > 0 ? Math.round((sumPaidReference / paidCount) * 100) / 100 : 0;
    const draft_entrypoints = (drafts ?? []).map((raw) => {
        const d = raw;
        const docTypeLabel = d.document_type ? DOCUMENT_TYPE_LABELS[d.document_type] ?? d.document_type : 'מסמך';
        const issuerName = clientNameById.get(d.represented_client_id) ?? '—';
        const recipient = typeof d.draft_totals_preview_json?.recipient_display_name === 'string'
            ? String(d.draft_totals_preview_json.recipient_display_name)
            : typeof d.one_time_customer_snapshot_json?.display_name === 'string'
                ? String(d.one_time_customer_snapshot_json.display_name)
                : '—';
        const line_count = typeof d.draft_totals_preview_json?.line_count === 'number'
            ? Number(d.draft_totals_preview_json.line_count)
            : Array.isArray(d.draft_lines_json)
                ? d.draft_lines_json.length
                : 0;
        const total_display = typeof d.draft_totals_preview_json?.grand_total_display === 'string'
            ? String(d.draft_totals_preview_json.grand_total_display)
            : null;
        return {
            draft_id: d.id,
            title: `${issuerName} · ${docTypeLabel}`,
            subtitle: `ל-${recipient}`,
            status_label: 'טיוטה',
            last_saved_at: d.updated_at ?? todayIso,
            total_display,
            line_count,
            allowed_actions: [
                {
                    command: 'resume_income_document_draft',
                    label: 'המשך עריכה',
                    enabled: true,
                    reason: null,
                    command_payload: { draft_id: d.id },
                },
            ],
        };
    }) ?? [];
    let document_branding_profile_legacy = document_branding_profile;
    let document_branding_settings_entrypoint_legacy = document_branding_settings_entrypoint;
    if (!document_branding_profile_legacy) {
        try {
            const issuerScope = await loadActiveIncomeIssuerScope(params.ctx);
            if (issuerScope.permissions.view) {
                document_branding_profile_legacy = await buildDocumentBrandingProfileAggregate(issuerScope, issuerScope.permissions.edit);
                document_branding_settings_entrypoint_legacy = buildDocumentBrandingSettingsEntrypoint(issuerScope.permissions);
            }
        }
        catch {
            document_branding_profile_legacy = null;
            document_branding_settings_entrypoint_legacy = null;
        }
    }
    return {
        aggregate_key: 'work_engine_invoices_tab_aggregate',
        org_id: orgId,
        workspace_tabs: buildAccountantWorkspaceTabs('invoices'),
        title: 'חשבוניות',
        description: 'מעקב גבייה ותשלומים',
        table_model: {
            columns: WORK_ENGINE_INVOICES_TAB_COLUMNS,
            rows,
            empty_state: {
                visible: rows.length === 0,
                title: 'אין חשבוניות להצגה',
                description: 'מסמכים שהונפקו במצב נציג משרד יופיעו כאן.',
            },
        },
        summary: {
            rows_count: rows.length,
            sum_paid_reference: sumPaidReference,
            avg_paid_reference: avgPaidReference,
            currency,
        },
        filters: [],
        allowed_actions: ['view_invoices_tab', 'open_income_document_wizard'],
        document_creation_entrypoint: await buildWorkEngineInvoicesDocumentCreationEntrypoint(params.ctx),
        draft_entrypoints,
        gaps: [
            'income.invoice_paid — payment status not implemented (INC-8)',
            'income.invoice_partially_paid — not implemented',
            'income.payment_failed — not implemented',
            'amount_paid_reference — awaiting payment pipeline',
            'self_mode_documents_excluded — requires represented_client_id',
        ],
        document_branding_profile: document_branding_profile_legacy,
        document_branding_settings_entrypoint: document_branding_settings_entrypoint_legacy,
        client_document_management_panel,
    };
}

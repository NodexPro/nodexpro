import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError, badRequest, conflict, forbidden } from '../../shared/errors.js';
import { syncAnnualScopeMaterialWorkEvent } from './client-operations-work-engine-bridge.js';
const BUCKET = 'client-files';
const MAX_B64 = 12_000_000;
const MAX_FILE = 8_000_000;
/** שורות מערכת — מקור יחיד בשרת; לא מוצגות כרשימה בלקוח */
export const ANNUAL_SYSTEM_DOCUMENT_TEMPLATES = [
    { system_key: 'form_106_owner_all_jobs', document_name_he: 'טופס 106 בעל מכל מקומות עבודה', sort_order: 10 },
    { system_key: 'form_106_spouse_all_jobs', document_name_he: 'טופס 106 אישה מכל מקומות עבודה', sort_order: 20 },
    {
        system_key: 'annual_short_income_tax_pension_self',
        document_name_he: 'אישור שנתי מקוצר למס הכנסה פנסיות כעצמאי',
        sort_order: 30,
    },
    {
        system_key: 'annual_short_income_tax_training_fund_self',
        document_name_he: 'אישור שנתי מקוצר למס הכנסה קרן השתלמות כעצמאי',
        sort_order: 40,
    },
    { system_key: 'withholding_tax_certificate', document_name_he: 'אישור ניכוי מס במקור', sort_order: 50 },
    {
        system_key: 'withholding_tax_certificate_securities_867',
        document_name_he: 'אישור ניכוי מס במקור מניירות ערך - טופס 867',
        sort_order: 60,
    },
    { system_key: 'inventory_count', document_name_he: 'ספירת מלאי', sort_order: 70 },
    { system_key: 'salary_pricing', document_name_he: 'תמחיר שכר', sort_order: 80 },
    { system_key: 'profit_loss_report', document_name_he: 'דוח רווח והפסד', sort_order: 90 },
    { system_key: 'national_insurance_tax_confirmation', document_name_he: 'אישור למס ביטוח לאומי', sort_order: 100 },
    { system_key: 'national_insurance_pensions_confirmation', document_name_he: 'אישור גמלאות ביטוח לאומי', sort_order: 110 },
    {
        system_key: 'national_insurance_reporting_period_confirmation',
        document_name_he: 'אישור תקופת דיווח ביטוח לאומי',
        sort_order: 120,
    },
    {
        system_key: 'national_insurance_payment_confirmation',
        document_name_he: 'אישור תשלום לביטוח לאומי',
        sort_order: 130,
    },
    { system_key: 'income_tax_137', document_name_he: 'מס הכנסה 137', sort_order: 140 },
    { system_key: 'esna_report', document_name_he: 'דוח ESNA', sort_order: 150 },
];
const CAPITAL_DECLARATION_SYSTEM_DOCUMENT_TEMPLATES = [
    {
        system_key: 'initial_declaration_copy',
        document_name_he: 'העתק הצהרת הון קודמת',
        description_he: 'עותק של הצהרת ההון הקודמת שהוגשה למס הכנסה לצורך השוואה ובדיקה.',
        sort_order: 10,
        required: true,
    },
    {
        system_key: 'bank_accounts_balances',
        document_name_he: 'אישורים על יתרות בבנקים',
        description_he: 'אישור מהבנקים על יתרות כל החשבונות נכון לתאריך הצהרת ההון.',
        sort_order: 20,
        required: true,
    },
    {
        system_key: 'credit_cards',
        document_name_he: 'פירוט כרטיסי אשראי',
        description_he: 'פירוט כרטיסי אשראי כולל יתרות וחיובים לתאריך הצהרת ההון.',
        sort_order: 30,
        required: true,
    },
    {
        system_key: 'savings_plans',
        document_name_he: 'תוכניות חסכון / קופות גמל / ביטוח חיים',
        description_he: 'אישורים על יתרות בתוכניות חסכון, קופות גמל וביטוחים פיננסיים.',
        sort_order: 40,
        required: true,
    },
    {
        system_key: 'securities',
        document_name_he: 'ניירות ערך',
        description_he: 'פירוט אחזקות בניירות ערך, מניות, אג״ח והשקעות פיננסיות.',
        sort_order: 50,
        required: true,
    },
    {
        system_key: 'real_estate',
        document_name_he: 'נכסי מקרקעין',
        description_he: 'פרטי נכסים בבעלות כולל דירות, קרקעות ונכסים נוספים.',
        sort_order: 60,
        required: true,
    },
    {
        system_key: 'loans',
        document_name_he: 'הלוואות והתחייבויות',
        description_he: 'פירוט הלוואות, משכנתאות והתחייבויות כספיות.',
        sort_order: 70,
        required: true,
    },
    {
        system_key: 'vehicles',
        document_name_he: 'כלי רכב',
        description_he: 'פרטי רכבים בבעלות כולל שווי מוערך.',
        sort_order: 80,
        required: true,
    },
    {
        system_key: 'business_assets',
        document_name_he: 'נכסי העסק',
        description_he: 'ציוד, מלאי ונכסים הקשורים לפעילות העסק.',
        sort_order: 90,
        required: true,
    },
    {
        system_key: 'liabilities',
        document_name_he: 'התחייבויות נוספות',
        description_he: 'התחייבויות כספיות נוספות שלא נכללו בסעיפים אחרים.',
        sort_order: 100,
        required: true,
    },
    {
        system_key: 'cash',
        document_name_he: 'מזומן',
        description_he: 'סכומי מזומן המוחזקים נכון לתאריך הצהרת ההון.',
        sort_order: 110,
        required: true,
    },
    {
        system_key: 'other_assets',
        document_name_he: 'נכסים נוספים',
        description_he: 'נכסים נוספים כגון תכשיטים, זהב, אוספים או רכוש יקר ערך.',
        sort_order: 120,
        required: true,
    },
];
function assertOrg(ctx) {
    const orgId = ctx.organizationId;
    if (!orgId)
        throw forbidden('Active organization required');
    return orgId;
}
function hasPerm(ctx, code) {
    return (ctx.membership?.permissions ?? []).includes(code);
}
function canViewAnnualTab(ctx) {
    return hasPerm(ctx, 'annual_report_tab.view') || hasPerm(ctx, 'client_operations.view');
}
function canEditAnnualTab(ctx) {
    return hasPerm(ctx, 'annual_report_tab.edit') || hasPerm(ctx, 'client_operations.edit');
}
function parseAnnualTabScope(v) {
    return v === 'capital_declaration' ? 'capital_declaration' : 'annual_report';
}
const LEGACY_SCOPE_MARKER = {
    annual_report: '[scope:annual_report]',
    capital_declaration: '[scope:capital_declaration]',
};
function hasLegacyScopeMarker(note, scope) {
    return String(note ?? '').startsWith(LEGACY_SCOPE_MARKER[scope]);
}
function stripLegacyScopeMarker(note) {
    const s = String(note ?? '');
    if (s.startsWith(LEGACY_SCOPE_MARKER.annual_report))
        return s.slice(LEGACY_SCOPE_MARKER.annual_report.length).trim() || null;
    if (s.startsWith(LEGACY_SCOPE_MARKER.capital_declaration))
        return s.slice(LEGACY_SCOPE_MARKER.capital_declaration.length).trim() || null;
    return note ?? null;
}
function attachLegacyScopeMarker(note, scope, scoped) {
    if (scoped)
        return note;
    const payload = note == null || note === '' ? '' : ` ${note}`;
    return `${LEGACY_SCOPE_MARKER[scope]}${payload}`.trim();
}
let annualScopeSupportCache = null;
async function supportsAnnualScopeColumns() {
    if (annualScopeSupportCache != null)
        return annualScopeSupportCache;
    try {
        const { data, error } = await supabaseAdmin
            .from('information_schema.columns')
            .select('column_name')
            .eq('table_schema', 'public')
            .eq('table_name', 'client_annual_report_profiles')
            .eq('column_name', 'tab_scope')
            .maybeSingle();
        if (error) {
            annualScopeSupportCache = false;
            return false;
        }
        annualScopeSupportCache = Boolean(data);
        return annualScopeSupportCache;
    }
    catch {
        annualScopeSupportCache = false;
        return false;
    }
}
function systemTemplatesForScope(scope) {
    if (scope === 'capital_declaration')
        return CAPITAL_DECLARATION_SYSTEM_DOCUMENT_TEMPLATES;
    return ANNUAL_SYSTEM_DOCUMENT_TEMPLATES.map((t) => ({
        system_key: t.system_key,
        document_name_he: t.document_name_he,
        description_he: null,
        sort_order: t.sort_order,
        required: true,
    }));
}
async function ensureClientInOrg(orgId, clientId) {
    const { data } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('organization_id', orgId)
        .eq('id', clientId)
        .maybeSingle();
    if (!data)
        throw forbidden('Client not found');
}
function asObj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}
async function loadUserLabels(userIds) {
    const uniq = [...new Set(userIds.filter(Boolean))];
    if (uniq.length === 0)
        return new Map();
    const { data } = await supabaseAdmin.from('users').select('id, full_name, email').in('id', uniq);
    const m = new Map();
    for (const u of (data ?? [])) {
        m.set(u.id, u.full_name?.trim() ? u.full_name.trim() : u.email ?? u.id);
    }
    return m;
}
function formatDateTimeHe(iso) {
    if (!iso)
        return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return '—';
    return d.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
}
/** סטטוס וסגנון שורה — רק בשרת */
function computeDocumentRowPresentation(received, fileAssetId) {
    const hasFile = Boolean(fileAssetId);
    if (received && hasFile) {
        return { status: 'completed', status_label_he: 'הושלם', row_style: 'success' };
    }
    if (received && !hasFile) {
        return { status: 'checked_only', status_label_he: 'סומן — חסר קובץ', row_style: 'warning' };
    }
    if (!received && hasFile) {
        return { status: 'attached_only', status_label_he: 'קובץ מצורף — לא סומן כהתקבל', row_style: 'warning' };
    }
    return { status: 'missing', status_label_he: 'חסר', row_style: 'neutral' };
}
function submissionStatusLabelHe(code) {
    const c = String(code ?? '').trim();
    if (c === 'submitted')
        return 'הוגש';
    if (c === 'late')
        return 'באיחור';
    if (c === 'extension')
        return 'בהארכה';
    if (c === 'draft')
        return 'טיוטה';
    return c || '—';
}
/** הפרש ימים בלוח שנה (UTC, YYYY-MM-DD) — toYmd מינוס fromYmd */
function calendarDaysDiffUtc(fromYmd, toYmd) {
    const a = new Date(`${fromYmd}T12:00:00.000Z`).getTime();
    const b = new Date(`${toYmd}T12:00:00.000Z`).getTime();
    return Math.round((b - a) / 86_400_000);
}
/** Default deadline: May 31 UTC (year from server clock). */
function buildAnnualDeadlineInfo(serverNow) {
    const year = serverNow.getUTCFullYear();
    const due_date = `${year}-05-31`;
    const today = serverNow.toISOString().slice(0, 10);
    const days_left = calendarDaysDiffUtc(today, due_date);
    const is_overdue = today > due_date;
    const label_he = is_overdue ? 'באיחור' : `נותרו ${days_left} ימים להגשה`;
    return { due_date, days_left, is_overdue, label_he };
}
function buildAnnualControlState(rows, serverNow) {
    const total_required = rows.length;
    const completed_count = rows.filter((r) => r.status === 'completed').length;
    const missing_documents = rows.filter((r) => r.status !== 'completed').map((r) => r.document_name_he);
    const completion_percent = total_required === 0 ? 100 : Math.round((completed_count / total_required) * 100);
    const deadline_info = buildAnnualDeadlineInfo(serverNow);
    const all_complete = total_required === 0 || completed_count === total_required;
    const has_missing = !all_complete;
    let status;
    let risk_label_he;
    if (!has_missing) {
        status = { code: 'ready', label_he: 'מוכן להגשה', color: 'green' };
        risk_label_he = 'ללא סיכון';
    }
    else if (deadline_info.is_overdue || deadline_info.days_left <= 7) {
        status = { code: 'attention', label_he: 'נדרש טיפול דחוף', color: 'red' };
        risk_label_he = 'סיכון גבוה';
    }
    else {
        status = { code: 'missing_docs', label_he: 'חסרים מסמכים', color: 'yellow' };
        risk_label_he = 'סיכון בינוני';
    }
    return {
        status,
        missing_documents,
        completion_percent,
        deadline_info,
        risk_indicator: { label_he: risk_label_he },
        missing_documents_section_title_he: 'חסרים מסמכים',
    };
}
function buildCapitalFallbackReadModel(canEdit) {
    const rows = CAPITAL_DECLARATION_SYSTEM_DOCUMENT_TEMPLATES.map((t) => ({
        row_id: `capital-fallback-${t.system_key}`,
        source_type: 'system',
        system_key: t.system_key,
        code: t.system_key,
        label_he: t.document_name_he,
        description_he: t.description_he,
        required: t.required,
        document_name_he: t.document_name_he,
        received: false,
        row_note: null,
        status: 'missing',
        status_label_he: 'חסר',
        row_style: 'neutral',
        file: { state: 'none', file_asset_id: null, file_name: null },
        actions: {
            can_toggle_received: false,
            can_attach_file: false,
            can_remove_file: false,
            can_edit_row_note: false,
            can_rename_document: false,
            can_remove_row: false,
        },
    }));
    const control = buildAnnualControlState(rows, new Date());
    return {
        tab_key: 'capital_declaration',
        tab_title_he: 'הצהרת הון',
        read_model_version: 1,
        permissions: { can_view: true, can_edit: canEdit && false },
        status: control.status,
        missing_documents: control.missing_documents,
        completion_percent: control.completion_percent,
        deadline_info: control.deadline_info,
        control_block: {
            days_left_caption_he: 'ימים נותרו להגשה',
            progress_caption_he: 'התקבלו / סה״כ מסמכים',
            progress_received_total_he: '0 / 12',
        },
        risk_indicator: control.risk_indicator,
        missing_documents_section_title_he: control.missing_documents_section_title_he,
        status_card_title_he: 'סטטוס הצהרת הון',
        meta: {
            updated_last_label_he: 'עודכן לאחרונה:',
            updated_last_display_he: '—',
            updated_by_label_he: 'מאת:',
            updated_by_display_he: '—',
        },
        visibility: { show_documents: true, show_submissions: true, show_notes: true },
        documents_table: {
            card_title_he: 'רשימת מסמכים להצהרת הון',
            column_headers_he: ['התקבל', 'שם מסמך', 'קובץ', 'סטטוס', 'הערת שורה'],
            empty_state_he: 'אין שורות מסמכים',
            add_custom_label_he: 'הוסף מסמך',
            add_custom_enabled: false,
            summary: {
                total_label_he: 'סה״כ מסמכים',
                total_count: rows.length,
                received_label_he: 'התקבלו',
                received_count: 0,
                missing_label_he: 'חסרים',
                missing_count: rows.length,
                updated_label_he: 'עודכן לאחרונה',
                updated_display_he: '—',
            },
            rows,
        },
        submissions_table: {
            card_title_he: 'תאריכי הגשת דוחות שנתיים קודמים',
            column_headers_he: ['שנת מס', 'תאריך הגשה', 'סטטוס', 'דוח', 'פעולות'],
            empty_state_he: 'אין רשומות',
            add_row_label_he: 'הוסף תאריך הגשה',
            add_row_enabled: false,
            rows: [],
        },
        notes_card: {
            card_title_he: 'הערות',
            notes: null,
            placeholder_he: 'הערות כלליות להצהרת הון…',
            save_label_he: 'שמירת הערות',
            edit_enabled: false,
        },
        workspace_actions: [
            { action_key: 'upload_document', label_he: 'הוסף מסמך', enabled: false },
            { action_key: 'copy_previous', label_he: 'העתק הצהרת הון קודמת', enabled: false },
        ],
        file_open_path_template: `/m/client-operations/clients/{clientId}/annual/files/{fileAssetId}/open`,
    };
}
let annualBucketEnsured = false;
async function ensureAnnualBucket() {
    if (annualBucketEnsured)
        return;
    const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
    if (error && !error.message?.toLowerCase().includes('already exists')) {
        console.warn('[annual-report] bucket:', error.message);
    }
    annualBucketEnsured = true;
}
async function ensureProfile(orgId, clientId, scope) {
    const scoped = await supportsAnnualScopeColumns();
    let existingQuery = supabaseAdmin
        .from('client_annual_report_profiles')
        .select('id, read_model_version')
        .eq('organization_id', orgId)
        .eq('client_id', clientId);
    if (scoped)
        existingQuery = existingQuery.eq('tab_scope', scope);
    const { data: existing } = await existingQuery.maybeSingle();
    if (existing) {
        return { id: String(existing.id), read_model_version: Number(existing.read_model_version ?? 1) };
    }
    const { data: ins, error } = await supabaseAdmin
        .from('client_annual_report_profiles')
        .insert({
        organization_id: orgId,
        client_id: clientId,
        ...(scoped ? { tab_scope: scope } : {}),
        notes: null,
        read_model_version: 1,
    })
        .select('id, read_model_version')
        .single();
    if (error || !ins)
        throw new AppError(500, error?.message ?? 'annual profile insert failed', 'SUPABASE_ERROR');
    return { id: String(ins.id), read_model_version: Number(ins.read_model_version ?? 1) };
}
async function ensureSystemDocumentRows(orgId, clientId, scope) {
    const scoped = await supportsAnnualScopeColumns();
    const templates = systemTemplatesForScope(scope);
    let existingQ = supabaseAdmin
        .from('client_annual_document_rows')
        .select('system_key')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .eq('source_type', 'system');
    if (scoped)
        existingQ = existingQ.eq('tab_scope', scope);
    const { data: existingRows, error: readErr } = await existingQ;
    if (readErr)
        throw new AppError(500, readErr.message ?? 'annual system rows read failed', 'SUPABASE_ERROR');
    const existingKeys = new Set((existingRows ?? [])
        .map((r) => (r.system_key ? String(r.system_key) : ''))
        .filter(Boolean));
    const missing = templates.filter((t) => !existingKeys.has(t.system_key));
    if (!missing.length)
        return;
    const rows = missing.map((t) => ({
        organization_id: orgId,
        client_id: clientId,
        ...(scoped ? { tab_scope: scope } : {}),
        source_type: 'system',
        system_key: t.system_key,
        document_name_he: t.document_name_he,
        ...(scoped ? { description_he: t.description_he, required: t.required } : {}),
        sort_order: t.sort_order,
        received: false,
        row_note: null,
        file_asset_id: null,
    }));
    const { error: insertErr } = await supabaseAdmin.from('client_annual_document_rows').insert(rows);
    if (insertErr)
        throw new AppError(500, insertErr.message ?? 'annual system rows insert failed', 'SUPABASE_ERROR');
}
async function assertExpectedVersion(orgId, clientId, expected, scope) {
    const scoped = await supportsAnnualScopeColumns();
    let q = supabaseAdmin
        .from('client_annual_report_profiles')
        .select('read_model_version')
        .eq('organization_id', orgId)
        .eq('client_id', clientId);
    if (scoped)
        q = q.eq('tab_scope', scope);
    const { data: row } = await q.single();
    const cur = Number(row?.read_model_version ?? 1);
    if (!Number.isFinite(expected) || expected !== cur) {
        throw conflict('הנתונים עודכנו; רענן ונסה שוב');
    }
}
async function bumpReadModelVersion(orgId, clientId, expected, userId, scope) {
    const scoped = await supportsAnnualScopeColumns();
    let q = supabaseAdmin
        .from('client_annual_report_profiles')
        .update({
        read_model_version: expected + 1,
        updated_at: new Date().toISOString(),
        updated_by: userId,
    })
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .eq('read_model_version', expected);
    if (scoped)
        q = q.eq('tab_scope', scope);
    const { data: updated, error } = await q.select('id');
    if (error)
        throw new AppError(500, error.message ?? 'version bump failed', 'SUPABASE_ERROR');
    if (!updated?.length)
        throw conflict('הנתונים עודכנו; רענן ונסה שוב');
}
async function auditAnnual(ctx, orgId, clientId, command, payload) {
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        moduleCode: 'client-operations',
        entityType: 'client_annual_report',
        entityId: clientId,
        action: AUDIT_ACTIONS.CLIENT_ANNUAL_REPORT_UPDATED,
        payload: {
            client_id: clientId,
            workspace_command: command,
            command,
            domain: 'client_annual_report',
            ...payload,
        },
    });
}
export async function getAnnualTabReadModel(ctx, clientId, scopeInput) {
    const orgId = assertOrg(ctx);
    const scope = parseAnnualTabScope(scopeInput);
    const scoped = await supportsAnnualScopeColumns();
    if (!canViewAnnualTab(ctx))
        return null;
    await ensureClientInOrg(orgId, clientId);
    const prof = await ensureProfile(orgId, clientId, scope);
    await ensureSystemDocumentRows(orgId, clientId, scope);
    let profileQ = supabaseAdmin
        .from('client_annual_report_profiles')
        .select('notes, read_model_version, updated_at, updated_by')
        .eq('organization_id', orgId)
        .eq('client_id', clientId);
    if (scoped)
        profileQ = profileQ.eq('tab_scope', scope);
    const { data: profileRow } = await profileQ.single();
    const p = profileRow;
    const userLabels = await loadUserLabels([p?.updated_by ?? ''].filter(Boolean));
    const canEdit = canEditAnnualTab(ctx);
    let docQ = supabaseAdmin
        .from('client_annual_document_rows')
        .select('*')
        .eq('organization_id', orgId)
        .eq('client_id', clientId);
    if (scoped)
        docQ = docQ.eq('tab_scope', scope);
    const { data: docRows } = await docQ.order('sort_order', { ascending: true }).order('id', { ascending: true });
    let subQ = supabaseAdmin
        .from('client_annual_submission_rows')
        .select('id, tax_year, submitted_on, status, note, sort_order, file_asset_id')
        .eq('organization_id', orgId)
        .eq('client_id', clientId);
    if (scoped)
        subQ = subQ.eq('tab_scope', scope);
    const { data: subRows } = await subQ.order('sort_order', { ascending: true }).order('tax_year', { ascending: false });
    const fileIds = [
        ...new Set([...(docRows ?? []), ...(subRows ?? [])].map((r) => r.file_asset_id).filter(Boolean)),
    ];
    const fileNameById = new Map();
    if (fileIds.length > 0) {
        const { data: assets } = await supabaseAdmin.from('file_assets').select('id, file_name').eq('organization_id', orgId).in('id', fileIds);
        for (const a of (assets ?? [])) {
            fileNameById.set(a.id, a.file_name ?? '');
        }
    }
    const rows = (docRows ?? []).map((raw) => {
        const r = raw;
        const pres = computeDocumentRowPresentation(Boolean(r.received), r.file_asset_id);
        const fid = r.file_asset_id ? String(r.file_asset_id) : null;
        return {
            row_id: String(r.id),
            source_type: r.source_type === 'custom' ? 'custom' : 'system',
            system_key: r.system_key ? String(r.system_key) : null,
            code: r.system_key ? String(r.system_key) : null,
            label_he: String(r.document_name_he ?? ''),
            description_he: r.description_he ?? null,
            required: Boolean(r.required ?? r.source_type !== 'custom'),
            document_name_he: String(r.document_name_he ?? ''),
            received: Boolean(r.received),
            row_note: r.row_note ?? null,
            status: pres.status,
            status_label_he: pres.status_label_he,
            row_style: pres.row_style,
            file: {
                state: fid ? 'attached' : 'none',
                file_asset_id: fid,
                file_name: fid ? fileNameById.get(fid) ?? null : null,
            },
            actions: {
                can_toggle_received: canEdit,
                can_attach_file: canEdit,
                can_remove_file: canEdit && Boolean(fid),
                can_edit_row_note: canEdit,
                can_rename_document: canEdit && r.source_type === 'custom',
                can_remove_row: canEdit && r.source_type === 'custom',
            },
        };
    });
    const allowedSystemKeys = new Set(systemTemplatesForScope(scope).map((t) => t.system_key));
    const scopedRows = scoped
        ? rows
        : rows.filter((r) => (r.source_type === 'custom' ? true : Boolean(r.system_key && allowedSystemKeys.has(r.system_key))));
    const scopedSubRows = (subRows ?? []).filter((raw) => {
        if (scoped)
            return true;
        const note = raw.note ?? null;
        if (scope === 'capital_declaration')
            return hasLegacyScopeMarker(note, 'capital_declaration');
        return !hasLegacyScopeMarker(note, 'capital_declaration');
    });
    const submissions = scopedSubRows.map((raw) => {
        const s = raw;
        const st = String(s.status ?? 'submitted');
        const fid = s.file_asset_id ? String(s.file_asset_id) : null;
        return {
            submission_id: String(s.id),
            tax_year: Number(s.tax_year),
            submitted_on: String(s.submitted_on).slice(0, 10),
            status: st,
            status_label_he: submissionStatusLabelHe(st),
            note: stripLegacyScopeMarker(s.note ?? null),
            file: {
                state: fid ? 'attached' : 'none',
                file_asset_id: fid,
                file_name: fid ? fileNameById.get(fid) ?? null : null,
            },
            actions: { can_edit: canEdit, can_remove: canEdit, can_attach_file: canEdit, can_open_file: Boolean(fid) },
        };
    });
    const serverNow = new Date();
    const control = buildAnnualControlState(scopedRows, serverNow);
    const summary = {
        total_label_he: 'סה��כ מסמכים',
        total_count: scopedRows.length,
        received_label_he: 'התקבלו',
        received_count: scopedRows.filter((r) => r.received).length,
        missing_label_he: 'חסרים',
        missing_count: scopedRows.filter((r) => r.status === 'missing').length,
        updated_label_he: 'עודכן לאחרונה',
        updated_display_he: p?.updated_at ? formatDateTimeHe(p.updated_at) : '—',
    };
    const control_block = {
        days_left_caption_he: 'ימים נותרו להגשה',
        progress_caption_he: `${summary.received_label_he} / ${summary.total_label_he}`,
        progress_received_total_he: `${summary.received_count} / ${summary.total_count}`,
    };
    const hasPreviousDeclarationFile = scope === 'capital_declaration' && submissions.some((s) => s.file.state === 'attached' && Boolean(s.file.file_asset_id));
    return {
        tab_key: scope,
        tab_title_he: scope === 'capital_declaration' ? 'הצהרת הון' : 'דוח שנתי',
        read_model_version: Number(p?.read_model_version ?? prof.read_model_version ?? 1),
        permissions: { can_view: true, can_edit: canEdit },
        status: control.status,
        missing_documents: control.missing_documents,
        completion_percent: control.completion_percent,
        deadline_info: control.deadline_info,
        control_block,
        risk_indicator: control.risk_indicator,
        missing_documents_section_title_he: control.missing_documents_section_title_he,
        status_card_title_he: scope === 'capital_declaration' ? 'סטטוס הצהרת הון' : 'סטטוס דוח שנתי',
        meta: {
            updated_last_label_he: 'עודכן לאחרונה:',
            updated_last_display_he: p?.updated_at ? formatDateTimeHe(p.updated_at) : '—',
            updated_by_label_he: 'מאת:',
            updated_by_display_he: p?.updated_by ? userLabels.get(p.updated_by) ?? '—' : '—',
        },
        visibility: { show_documents: true, show_submissions: true, show_notes: true },
        documents_table: {
            card_title_he: scope === 'capital_declaration' ? 'רשימת מסמכים להצהרת הון' : 'רשימת מסמכים לדוח שנתי',
            column_headers_he: ['התקבל', 'שם מסמך', 'קובץ', 'סטטוס', 'הערת שורה'],
            empty_state_he: 'אין שורות מסמכים',
            add_custom_label_he: 'הוסף מסמך',
            add_custom_enabled: canEdit,
            summary: {
                total_label_he: 'סה״כ מסמכים',
                total_count: scopedRows.length,
                received_label_he: 'התקבלו',
                received_count: scopedRows.filter((r) => r.received).length,
                missing_label_he: 'חסרים',
                missing_count: scopedRows.filter((r) => r.status === 'missing').length,
                updated_label_he: 'עודכן לאחרונה',
                updated_display_he: p?.updated_at ? formatDateTimeHe(p.updated_at) : '—',
            },
            rows: scopedRows,
        },
        submissions_table: {
            card_title_he: scope === 'capital_declaration' ? 'תאריכי הגשת הצהרות הון קודמות' : 'תאריכי הגשת דוחות שנתיים קודמים',
            column_headers_he: ['שנת מס', 'תאריך הגשה', 'סטטוס', 'דוח', 'פעולות'],
            empty_state_he: 'אין רשומות',
            add_row_label_he: 'הוסף תאריך הגשה',
            add_row_enabled: canEdit,
            rows: submissions,
        },
        notes_card: {
            card_title_he: 'הערות',
            notes: p?.notes ?? null,
            placeholder_he: scope === 'capital_declaration' ? 'הערות כלליות להצהרת הון…' : 'הערות כלליות לדוח השנתי…',
            save_label_he: 'שמירת הערות',
            edit_enabled: canEdit,
        },
        workspace_actions: scope === 'capital_declaration'
            ? [
                { action_key: 'upload_document', label_he: 'הוסף מסמך', enabled: canEdit },
                { action_key: 'copy_previous', label_he: 'העתק הצהרת הון קודמת', enabled: canEdit && hasPreviousDeclarationFile },
            ]
            : [{ action_key: 'upload_document', label_he: 'הוסף מסמך', enabled: canEdit }],
        file_open_path_template: `/m/client-operations/clients/{clientId}/annual/files/{fileAssetId}/open`,
    };
}
async function fetchDocumentRow(orgId, clientId, rowId, scope) {
    const scoped = await supportsAnnualScopeColumns();
    let q = supabaseAdmin
        .from('client_annual_document_rows')
        .select('id, source_type, system_key, file_asset_id')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .eq('id', rowId);
    if (scoped)
        q = q.eq('tab_scope', scope);
    const { data } = await q.maybeSingle();
    return data ?? null;
}
export async function assertAnnualReportFileOpenAllowed(orgId, clientId, fileAssetId, scope = 'annual_report') {
    const scoped = await supportsAnnualScopeColumns();
    let linkedQ = supabaseAdmin
        .from('client_annual_document_rows')
        .select('id')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .eq('file_asset_id', fileAssetId)
        .limit(1);
    if (scoped)
        linkedQ = linkedQ.eq('tab_scope', scope);
    const { data: linked } = await linkedQ.maybeSingle();
    if (linked)
        return;
    let subQ = supabaseAdmin
        .from('client_annual_submission_rows')
        .select('id')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .eq('file_asset_id', fileAssetId)
        .limit(1);
    if (scoped)
        subQ = subQ.eq('tab_scope', scope);
    if (!scoped && scope === 'capital_declaration')
        subQ = subQ.like('note', `${LEGACY_SCOPE_MARKER.capital_declaration}%`);
    const { data: linkedSubmission } = await subQ.maybeSingle();
    if (linkedSubmission)
        return;
    const { data: fileAsset, error } = await supabaseAdmin
        .from('file_assets')
        .select('organization_id, storage_key')
        .eq('id', fileAssetId)
        .single();
    if (error || !fileAsset)
        throw forbidden('File not found');
    const fa = fileAsset;
    if (fa.organization_id !== orgId)
        throw forbidden('File not found');
    const annualPrefix = `${orgId}/annual-report/${clientId}/`;
    const capitalPrefix = `${orgId}/capital-declaration/${clientId}/`;
    const expectedPrefix = scope === 'capital_declaration' ? capitalPrefix : annualPrefix;
    if (!String(fa.storage_key).startsWith(expectedPrefix))
        throw forbidden('File not linked to this client annual report');
}
async function fetchSubmissionRow(orgId, clientId, submissionId, scope) {
    const scoped = await supportsAnnualScopeColumns();
    let q = supabaseAdmin
        .from('client_annual_submission_rows')
        .select('id, note')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .eq('id', submissionId);
    if (scoped)
        q = q.eq('tab_scope', scope);
    const { data } = await q.maybeSingle();
    const row = data ?? null;
    if (!row)
        return null;
    if (!scoped) {
        const note = row.note ?? null;
        if (scope === 'capital_declaration' && !hasLegacyScopeMarker(note, 'capital_declaration'))
            return null;
        if (scope === 'annual_report' && hasLegacyScopeMarker(note, 'capital_declaration'))
            return null;
    }
    return row;
}
export async function uploadAnnualReportDocument(ctx, orgId, clientId, body) {
    const scope = parseAnnualTabScope(body.tab_scope);
    const scoped = await supportsAnnualScopeColumns();
    const fileName = String(body.file_name ?? '').trim();
    if (!fileName)
        throw badRequest('file_name is required');
    const b64 = body.file_base64;
    if (typeof b64 !== 'string' || !b64.length)
        throw badRequest('file_base64 is required');
    if (b64.length > MAX_B64)
        throw badRequest('File too large');
    const { data: client } = await supabaseAdmin.from('clients').select('id').eq('id', clientId).eq('organization_id', orgId).single();
    if (!client)
        throw forbidden('Client not found');
    await ensureAnnualBucket();
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > MAX_FILE)
        throw badRequest('File too large');
    const storageScope = scope === 'capital_declaration' ? 'capital-declaration' : 'annual-report';
    const storageKey = `${orgId}/${storageScope}/${clientId}/${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(storageKey, buf, {
        contentType: body.mime_type ?? 'application/octet-stream',
        upsert: false,
    });
    if (upErr)
        throw new AppError(500, upErr.message ?? 'upload failed', 'SUPABASE_ERROR');
    const { data: asset, error: faErr } = await supabaseAdmin
        .from('file_assets')
        .insert({
        organization_id: orgId,
        storage_provider: 'supabase',
        storage_key: storageKey,
        file_name: fileName,
        mime_type: body.mime_type ?? null,
        file_size: buf.length,
        uploaded_by: ctx.user.id,
        access_level: 'organization',
    })
        .select('id, file_name')
        .single();
    if (faErr || !asset)
        throw new AppError(500, faErr?.message ?? 'file_assets insert failed', 'SUPABASE_ERROR');
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        moduleCode: 'client-operations',
        entityType: 'client_annual_report_file',
        entityId: clientId,
        action: AUDIT_ACTIONS.CLIENT_FILE_ATTACHED,
        payload: { client_id: clientId, file_asset_id: asset.id, context: 'annual_report_upload' },
    });
    return { file_asset_id: String(asset.id), file_name: String(asset.file_name ?? fileName) };
}
const SIGNED_URL_SEC = 120;
export async function getAnnualReportDocumentFileOpenUrl(ctx, orgId, clientId, fileAssetId, scope = 'annual_report') {
    await assertAnnualReportFileOpenAllowed(orgId, clientId, fileAssetId, scope);
    const { data: fileAsset, error } = await supabaseAdmin
        .from('file_assets')
        .select('storage_key, organization_id')
        .eq('id', fileAssetId)
        .single();
    if (error || !fileAsset || fileAsset.organization_id !== orgId) {
        throw forbidden('File not found');
    }
    await ensureAnnualBucket();
    const { data: signed, error: se } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(fileAsset.storage_key, SIGNED_URL_SEC);
    if (se || !signed?.signedUrl)
        throw new AppError(500, se?.message ?? 'signed url failed', 'SUPABASE_ERROR');
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        moduleCode: 'client-operations',
        entityType: 'client_annual_report_file',
        entityId: clientId,
        action: AUDIT_ACTIONS.FILE_OPENED,
        payload: { client_id: clientId, file_asset_id: fileAssetId },
    });
    return { url: signed.signedUrl };
}
export async function executeAnnualTabCommand(ctx, clientId, body) {
    const orgId = assertOrg(ctx);
    const scope = parseAnnualTabScope(body?.tab_scope);
    const scoped = await supportsAnnualScopeColumns();
    if (!canEditAnnualTab(ctx))
        throw forbidden('Insufficient permission');
    await ensureClientInOrg(orgId, clientId);
    await ensureProfile(orgId, clientId, scope);
    await ensureSystemDocumentRows(orgId, clientId, scope);
    if (body == null || typeof body.type !== 'string')
        throw badRequest('פקודה לא תקינה');
    const expected = Number(body.expected_version);
    if (!Number.isFinite(expected))
        throw badRequest('גרסה לא תקינה');
    await assertExpectedVersion(orgId, clientId, expected, scope);
    const payload = asObj(body.payload);
    const cmd = body.type;
    switch (cmd) {
        case 'add_annual_document_row': {
            const name = String(payload.document_name_he ?? '').trim();
            if (!name)
                throw badRequest('שם מסמך נדרש');
            const sortOrder = payload.sort_order != null ? Number(payload.sort_order) : 9990;
            const { error } = await supabaseAdmin.from('client_annual_document_rows').insert({
                organization_id: orgId,
                client_id: clientId,
                ...(scoped ? { tab_scope: scope } : {}),
                source_type: 'custom',
                system_key: null,
                document_name_he: name,
                ...(scoped ? { description_he: null, required: false } : {}),
                sort_order: Number.isFinite(sortOrder) ? sortOrder : 9990,
                received: false,
                row_note: null,
                file_asset_id: null,
            });
            if (error)
                throw new AppError(500, error.message ?? 'insert failed', 'SUPABASE_ERROR');
            await auditAnnual(ctx, orgId, clientId, cmd, { document_name_he: name });
            break;
        }
        case 'update_annual_document_row': {
            const rowId = String(payload.row_id ?? '');
            if (!rowId)
                throw badRequest('row_id נדרש');
            const row = await fetchDocumentRow(orgId, clientId, rowId, scope);
            if (!row)
                throw badRequest('שורה לא נמצאה');
            const isCustom = String(row.source_type) === 'custom';
            const patch = {};
            if (payload.document_name_he !== undefined) {
                if (!isCustom)
                    throw badRequest('לא ניתן לערוך שם לשורת מערכת');
                const n = String(payload.document_name_he ?? '').trim();
                if (!n)
                    throw badRequest('שם מסמך ריק');
                patch.document_name_he = n;
            }
            if (payload.row_note !== undefined)
                patch.row_note = payload.row_note == null || payload.row_note === '' ? null : String(payload.row_note);
            if (payload.sort_order !== undefined) {
                if (!isCustom)
                    throw badRequest('לא ניתן לשנות סדר לשורת מערכת');
                const so = Number(payload.sort_order);
                if (Number.isFinite(so))
                    patch.sort_order = so;
            }
            if (Object.keys(patch).length === 0)
                throw badRequest('אין שדות לעדכון');
            const { error } = await supabaseAdmin
                .from('client_annual_document_rows')
                .update(patch)
                .eq('id', rowId)
                .eq('organization_id', orgId)
                .eq('client_id', clientId)
                .match(scoped ? { tab_scope: scope } : {});
            if (error)
                throw new AppError(500, error.message ?? 'update failed', 'SUPABASE_ERROR');
            await auditAnnual(ctx, orgId, clientId, cmd, { row_id: rowId, keys: Object.keys(patch) });
            break;
        }
        case 'remove_annual_document_row': {
            const rowId = String(payload.row_id ?? '');
            if (!rowId)
                throw badRequest('row_id נדרש');
            const row = await fetchDocumentRow(orgId, clientId, rowId, scope);
            if (!row)
                throw badRequest('שורה לא נמצאה');
            if (String(row.source_type) !== 'custom')
                throw badRequest('לא ניתן למחוק שורת מערכת');
            const { error } = await supabaseAdmin
                .from('client_annual_document_rows')
                .delete()
                .eq('id', rowId)
                .eq('organization_id', orgId)
                .eq('client_id', clientId)
                .match(scoped ? { tab_scope: scope } : {});
            if (error)
                throw new AppError(500, error.message ?? 'delete failed', 'SUPABASE_ERROR');
            await auditAnnual(ctx, orgId, clientId, cmd, { row_id: rowId });
            break;
        }
        case 'toggle_annual_document_received': {
            const rowId = String(payload.row_id ?? '');
            if (!rowId)
                throw badRequest('row_id נדרש');
            const received = payload.received === true || payload.received === 'yes' || payload.received === 'כן';
            const { error } = await supabaseAdmin
                .from('client_annual_document_rows')
                .update({ received })
                .eq('id', rowId)
                .eq('organization_id', orgId)
                .eq('client_id', clientId)
                .match(scoped ? { tab_scope: scope } : {});
            if (error)
                throw new AppError(500, error.message ?? 'update failed', 'SUPABASE_ERROR');
            await auditAnnual(ctx, orgId, clientId, cmd, { row_id: rowId, received });
            break;
        }
        case 'attach_annual_document_file': {
            const rowId = String(payload.row_id ?? '');
            const fileAssetId = String(payload.file_asset_id ?? '');
            if (!rowId || !fileAssetId)
                throw badRequest('row_id וקובץ נדרשים');
            await assertAnnualReportFileOpenAllowed(orgId, clientId, fileAssetId, scope);
            const { error } = await supabaseAdmin
                .from('client_annual_document_rows')
                .update({ file_asset_id: fileAssetId })
                .eq('id', rowId)
                .eq('organization_id', orgId)
                .eq('client_id', clientId)
                .match(scoped ? { tab_scope: scope } : {});
            if (error)
                throw new AppError(500, error.message ?? 'attach failed', 'SUPABASE_ERROR');
            await auditAnnual(ctx, orgId, clientId, cmd, { row_id: rowId, file_asset_id: fileAssetId });
            break;
        }
        case 'remove_annual_document_file': {
            const rowId = String(payload.row_id ?? '');
            if (!rowId)
                throw badRequest('row_id נדרש');
            const { error } = await supabaseAdmin
                .from('client_annual_document_rows')
                .update({ file_asset_id: null })
                .eq('id', rowId)
                .eq('organization_id', orgId)
                .eq('client_id', clientId)
                .match(scoped ? { tab_scope: scope } : {});
            if (error)
                throw new AppError(500, error.message ?? 'remove file failed', 'SUPABASE_ERROR');
            await auditAnnual(ctx, orgId, clientId, cmd, { row_id: rowId });
            break;
        }
        case 'add_annual_submission_date': {
            const taxYear = Number(payload.tax_year);
            if (!Number.isFinite(taxYear) || taxYear < 1900 || taxYear > 2200)
                throw badRequest('שנת מס לא תקינה');
            const submittedOn = String(payload.submitted_at ?? payload.submitted_on ?? '').trim().slice(0, 10);
            if (!submittedOn)
                throw badRequest('תאריך הגשה נדרש');
            const status = payload.status != null ? String(payload.status).trim() || 'submitted' : 'submitted';
            const cleanNote = payload.note == null || payload.note === '' ? null : String(payload.note);
            const note = attachLegacyScopeMarker(cleanNote, scope, scoped);
            const { error } = await supabaseAdmin.from('client_annual_submission_rows').insert({
                organization_id: orgId,
                client_id: clientId,
                ...(scoped ? { tab_scope: scope } : {}),
                tax_year: taxYear,
                submitted_on: submittedOn,
                status,
                note,
                sort_order: 0,
            });
            if (error)
                throw new AppError(500, error.message ?? 'insert submission failed', 'SUPABASE_ERROR');
            await auditAnnual(ctx, orgId, clientId, cmd, { tax_year: taxYear, submitted_on: submittedOn });
            break;
        }
        case 'update_annual_submission_date': {
            const submissionId = String(payload.submission_id ?? '');
            if (!submissionId)
                throw badRequest('submission_id נדרש');
            const patch = {};
            if (payload.tax_year !== undefined) {
                const ty = Number(payload.tax_year);
                if (!Number.isFinite(ty))
                    throw badRequest('שנת מס לא תקינה');
                patch.tax_year = ty;
            }
            if (payload.submitted_at !== undefined || payload.submitted_on !== undefined) {
                const d = String(payload.submitted_at ?? payload.submitted_on ?? '').trim().slice(0, 10);
                if (!d)
                    throw badRequest('תאריך ריק');
                patch.submitted_on = d;
            }
            if (payload.status !== undefined)
                patch.status = String(payload.status ?? 'submitted').trim() || 'submitted';
            if (payload.note !== undefined) {
                const cleanNote = payload.note == null || payload.note === '' ? null : String(payload.note);
                patch.note = attachLegacyScopeMarker(cleanNote, scope, scoped);
            }
            if (Object.keys(patch).length === 0)
                throw badRequest('אין שדות לעדכון');
            const { error } = await supabaseAdmin
                .from('client_annual_submission_rows')
                .update(patch)
                .eq('id', submissionId)
                .eq('organization_id', orgId)
                .eq('client_id', clientId)
                .match(scoped ? { tab_scope: scope } : {});
            if (error)
                throw new AppError(500, error.message ?? 'update submission failed', 'SUPABASE_ERROR');
            await auditAnnual(ctx, orgId, clientId, cmd, { submission_id: submissionId, keys: Object.keys(patch) });
            break;
        }
        case 'remove_annual_submission_date': {
            const submissionId = String(payload.submission_id ?? '');
            if (!submissionId)
                throw badRequest('submission_id נדרש');
            const { error } = await supabaseAdmin
                .from('client_annual_submission_rows')
                .delete()
                .eq('id', submissionId)
                .eq('organization_id', orgId)
                .eq('client_id', clientId)
                .match(scoped ? { tab_scope: scope } : {});
            if (error)
                throw new AppError(500, error.message ?? 'delete submission failed', 'SUPABASE_ERROR');
            await auditAnnual(ctx, orgId, clientId, cmd, { submission_id: submissionId });
            break;
        }
        case 'attach_annual_submission_file': {
            const submissionId = String(payload.submission_id ?? '');
            const fileAssetId = String(payload.file_asset_id ?? '');
            if (!submissionId || !fileAssetId)
                throw badRequest('submission_id וקובץ נדרשים');
            const row = await fetchSubmissionRow(orgId, clientId, submissionId, scope);
            if (!row)
                throw badRequest('רשומת הגשה לא נמצאה');
            await assertAnnualReportFileOpenAllowed(orgId, clientId, fileAssetId, scope);
            const { error } = await supabaseAdmin
                .from('client_annual_submission_rows')
                .update({ file_asset_id: fileAssetId })
                .eq('id', submissionId)
                .eq('organization_id', orgId)
                .eq('client_id', clientId)
                .match(scoped ? { tab_scope: scope } : {});
            if (error)
                throw new AppError(500, error.message ?? 'attach submission file failed', 'SUPABASE_ERROR');
            await auditAnnual(ctx, orgId, clientId, cmd, { submission_id: submissionId, file_asset_id: fileAssetId });
            break;
        }
        case 'update_annual_notes': {
            const notes = payload.notes == null ? null : String(payload.notes);
            const { error } = await supabaseAdmin
                .from('client_annual_report_profiles')
                .update({ notes })
                .eq('organization_id', orgId)
                .eq('client_id', clientId)
                .match(scoped ? { tab_scope: scope } : {});
            if (error)
                throw new AppError(500, error.message ?? 'notes update failed', 'SUPABASE_ERROR');
            await auditAnnual(ctx, orgId, clientId, cmd, { notes_len: notes?.length ?? 0 });
            break;
        }
        case 'copy_previous_capital_declaration': {
            if (scope !== 'capital_declaration')
                throw badRequest('פקודה זו זמינה רק בהצהרת הון');
            let prevQ = supabaseAdmin
                .from('client_annual_submission_rows')
                .select('id, file_asset_id, tax_year, submitted_on')
                .eq('organization_id', orgId)
                .eq('client_id', clientId)
                .not('file_asset_id', 'is', null);
            if (scoped)
                prevQ = prevQ.eq('tab_scope', scope);
            if (!scoped)
                prevQ = prevQ.like('note', `${LEGACY_SCOPE_MARKER.capital_declaration}%`);
            const { data: prevRows, error: prevErr } = await prevQ.order('tax_year', { ascending: false }).order('submitted_on', { ascending: false }).limit(1);
            if (prevErr)
                throw new AppError(500, prevErr.message ?? 'previous declaration read failed', 'SUPABASE_ERROR');
            const prev = (prevRows?.[0] ?? null);
            if (!prev?.file_asset_id)
                throw badRequest('לא נמצאה הצהרת הון קודמת עם מסמך');
            const { data: targetRows, error: targetErr } = await supabaseAdmin
                .from('client_annual_document_rows')
                .select('id')
                .eq('organization_id', orgId)
                .eq('client_id', clientId)
                .eq('source_type', 'system')
                .eq('system_key', 'initial_declaration_copy')
                .match(scoped ? { tab_scope: scope } : {})
                .limit(1);
            if (targetErr)
                throw new AppError(500, targetErr.message ?? 'target document row read failed', 'SUPABASE_ERROR');
            const targetRowId = String(targetRows?.[0]?.id ?? '');
            if (!targetRowId)
                throw badRequest('שורת יעד לא נמצאה');
            const { error: updateErr } = await supabaseAdmin
                .from('client_annual_document_rows')
                .update({
                file_asset_id: prev.file_asset_id,
                received: true,
                row_note: `הועתק מהצהרה קודמת (${prev.tax_year})`,
            })
                .eq('id', targetRowId)
                .eq('organization_id', orgId)
                .eq('client_id', clientId)
                .match(scoped ? { tab_scope: scope } : {});
            if (updateErr)
                throw new AppError(500, updateErr.message ?? 'copy previous declaration failed', 'SUPABASE_ERROR');
            await auditAnnual(ctx, orgId, clientId, cmd, { from_submission_id: prev.id, target_row_id: targetRowId });
            break;
        }
        default:
            throw badRequest('סוג פקודה לא מוכר');
    }
    await bumpReadModelVersion(orgId, clientId, expected, ctx.user.id, scope);
    const orgIdCtx = ctx.organizationId;
    if (orgIdCtx) {
        const refreshed = await getAnnualTabReadModel(ctx, clientId, scope);
        const hasMissingDocs = Boolean(refreshed &&
            (refreshed.status.code === 'missing_docs' || refreshed.missing_documents.length > 0));
        await syncAnnualScopeMaterialWorkEvent(ctx, orgIdCtx, clientId, scope, hasMissingDocs);
    }
}

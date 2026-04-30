import { supabaseAdmin } from '../../db/client.js';
import { AppError, badRequest, conflict, forbidden } from '../../shared/errors.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { encryptJson } from '../../shared/field-encryption.js';
import { loadVehicleFleet, vehicleFleetRowSummaryFields, } from './client-vehicle-fleet.service.js';
import { EXPENSE_MGMT_CUSTOM_FIELD_MAX_TOTAL, EXPENSE_MGMT_CUSTOM_FIELD_OPTIONS_MAX, applyExpenseMgmtCustomFieldValuesFromBody, createExpenseMgmtCustomField, deleteExpenseMgmtCustomField, formatExpenseMgmtCustomFieldSummary, loadExpenseMgmtCustomFields, normalizeExpenseMgmtFieldType, parseExpenseMgmtOptionsJson, parseExpenseMgmtSelectedJson, } from './client-expense-mgmt-custom-fields.service.js';
const SUMMARY_EMPTY_STATE_HE = 'לא הוגדר';
function summaryLinesFromParts(parts, maxInline) {
    if (parts.length === 0)
        return [];
    if (parts.length <= maxInline)
        return [...parts];
    return [...parts.slice(0, maxInline), `+${parts.length - maxInline}`];
}
const EXPENSE_TYPES = [
    { code: 'rent', label: 'שכירות', value_kind: 'amount' },
    { code: 'electricity', label: 'חשמל', value_kind: 'percent' },
    { code: 'water', label: 'מים', value_kind: 'percent' },
    { code: 'arnona', label: 'ארנונה', value_kind: 'percent' },
    { code: 'internet', label: 'אינטרנט', value_kind: 'percent' },
    { code: 'phone', label: 'טלפון', value_kind: 'amount' },
    { code: 'insurance', label: 'ביטוחים', value_kind: 'amount' },
    { code: 'software_subscriptions', label: 'תוכנות / מנויים', value_kind: 'amount' },
    { code: 'bank_fees', label: 'עמלות בנק', value_kind: 'amount' },
    { code: 'clearing_fees', label: 'עמלות סליקה', value_kind: 'amount' },
];
const INCOME_SOURCES = [
    { code: 'business', label: 'עסק' },
    { code: 'salary', label: 'משכורת' },
    { code: 'pension', label: 'פנסיה' },
    { code: 'allowance', label: 'קצבה' },
    { code: 'other', label: 'אחר' },
];
const DOC_DELIVERY = [
    { code: 'email', label: 'מייל' },
    { code: 'whatsapp', label: 'וואטסאפ' },
    { code: 'upload', label: 'העלאה למערכת' },
    { code: 'manual', label: 'ידני' },
    { code: 'mixed', label: 'מעורב' },
];
/** קבלת הוצאות — סקציית ניהול הוצאות (מסלול aggregate בלבד; לא מסמכי מס הכנסה כללית) */
const EXPENSE_DELIVERY_METHODS = [
    { code: 'external_software', label: 'תוכנה חיצונית' },
    { code: 'email', label: 'מייל' },
    { code: 'whatsapp', label: 'וואטסאפ' },
    { code: 'nodex_inbox', label: 'Nodex Inbox' },
    { code: 'nodexpro_upload', label: 'העלאה ל־NodexPro' },
    { code: 'physical_manual', label: 'פיזי / ידני' },
    { code: 'mixed', label: 'מעורב' },
];
const EXPENSE_UPLOADED_BY_OPTS = [
    { code: 'client', label: 'הלקוח' },
    { code: 'office', label: 'המשרד' },
    { code: 'both', label: 'גם הלקוח וגם המשרד' },
    { code: 'system_auto', label: 'אוטומטי ממערכת' },
    { code: 'unknown', label: 'לא ידוע' },
];
const EXPENSE_DOCS_ORDER_OPTS = [
    { code: 'organized', label: 'מסודר' },
    { code: 'partial', label: 'חלקית מסודר' },
    { code: 'messy', label: 'לא מסודר' },
];
/** When a percent-type expense is newly selected, server applies this default (single source of truth). */
const DEFAULT_SELECTED_BUSINESS_PERCENT = 100;
function assertOrg(ctx) {
    const orgId = ctx.organizationId;
    if (!orgId)
        throw forbidden('Active organization required');
    return orgId;
}
async function ensureClientInOrg(orgId, clientId) {
    const { data } = await supabaseAdmin.from('clients').select('id').eq('organization_id', orgId).eq('id', clientId).maybeSingle();
    if (!data)
        throw forbidden('Client not found');
}
async function loadMainBusinessType(orgId, clientId) {
    const { data, error } = await supabaseAdmin
        .from('client_operational_profiles')
        .select('business_type')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .maybeSingle();
    if (error)
        throw new AppError(500, error.message ?? 'client_operational_profiles read failed', 'SUPABASE_ERROR');
    return data?.business_type ?? null;
}
function additionalBusinessTypeOptionsByMain(mainBusinessType) {
    const t = (mainBusinessType ?? '').trim();
    if (t === 'חברה') {
        return [
            { value: 'osek_murshe', label: 'מורשה' },
            { value: 'osek_patur', label: 'פטור' },
        ];
    }
    if (t === 'עוסק מורשה' || t === 'עוסק פטור') {
        return [{ value: 'company', label: 'חברה' }];
    }
    return [];
}
function additionalBusinessTypeLabel(code) {
    if (!code)
        return null;
    if (code === 'company')
        return 'חברה';
    if (code === 'osek_murshe')
        return 'מורשה';
    if (code === 'osek_patur')
        return 'פטור';
    return null;
}
function normalizeExpenseItemsForClientDraft(items) {
    const byCode = new Map();
    for (const raw of items) {
        if (!raw || typeof raw !== 'object')
            continue;
        const it = raw;
        const c = String(it.expense_type_code ?? '');
        if (c)
            byCode.set(c, it);
    }
    return EXPENSE_TYPES.map((meta) => {
        const it = byCode.get(meta.code) ?? {};
        const selected = Boolean(it.selected);
        if (!selected) {
            return {
                expense_type_code: meta.code,
                expense_type_label_he: meta.label,
                value_kind: meta.value_kind,
                selected: false,
                business_percent: null,
                monthly_amount_ils: null,
            };
        }
        if (meta.value_kind === 'percent') {
            const raw = it.business_percent;
            const useDefault = raw == null || raw === '';
            return {
                expense_type_code: meta.code,
                expense_type_label_he: meta.label,
                value_kind: meta.value_kind,
                selected: true,
                monthly_amount_ils: null,
                business_percent: useDefault ? DEFAULT_SELECTED_BUSINESS_PERCENT : raw,
            };
        }
        return {
            expense_type_code: meta.code,
            expense_type_label_he: meta.label,
            value_kind: meta.value_kind,
            selected: true,
            business_percent: null,
            monthly_amount_ils: it.monthly_amount_ils ?? null,
        };
    });
}
function normalizeIncomeSourceItemsForClientDraft(items, mainBusinessType) {
    const byCode = new Map();
    for (const raw of items) {
        if (!raw || typeof raw !== 'object')
            continue;
        const it = raw;
        const c = String(it.source_code ?? '');
        if (c)
            byCode.set(c, it);
    }
    return INCOME_SOURCES.map((src) => {
        const it = byCode.get(src.code) ?? {};
        const selected = Boolean(it.selected);
        const opts = src.code === 'business' ? additionalBusinessTypeOptionsByMain(mainBusinessType) : [];
        if (!selected) {
            return {
                source_code: src.code,
                source_label_he: src.label,
                selected: false,
                monthly_amount: null,
                additional_business_type: null,
                additional_business_tax_id: null,
                additional_business_type_options: opts,
                workplace_name: null,
                employment_scope: null,
                source_details: null,
            };
        }
        return {
            source_code: src.code,
            source_label_he: src.label,
            selected: true,
            monthly_amount: it.monthly_amount ?? null,
            additional_business_type: src.code === 'business' ? toStrOrNull(it.additional_business_type) : null,
            additional_business_tax_id: src.code === 'business'
                ? typeof it.additional_business_tax_id === 'string'
                    ? it.additional_business_tax_id
                    : it.additional_business_tax_id != null
                        ? String(it.additional_business_tax_id)
                        : null
                : null,
            additional_business_type_options: opts,
            workplace_name: src.code === 'salary' ? (it.workplace_name ?? null) : null,
            employment_scope: src.code === 'salary' ? (it.employment_scope ?? null) : null,
            source_details: src.code === 'allowance' || src.code === 'other' ? (it.source_details ?? null) : null,
        };
    });
}
export async function normalizeAccountingBlockDraft(ctx, clientId, blockKey, body) {
    const orgId = assertOrg(ctx);
    await ensureClientInOrg(orgId, clientId);
    if (!canViewTab(ctx))
        throw forbidden('Insufficient permission');
    if (blockKey === 'expenses') {
        const raw = body.expense_items;
        if (!Array.isArray(raw))
            throw badRequest('expense_items array required');
        const expense_items = normalizeExpenseItemsForClientDraft(raw);
        return {
            expense_items,
            field_visibility: computeAccountingModalFieldVisibility('expenses', { expense_items }),
        };
    }
    if (blockKey === 'income') {
        const raw = body.income_source_items;
        if (!Array.isArray(raw))
            throw badRequest('income_source_items array required');
        const mainBusinessType = await loadMainBusinessType(orgId, clientId);
        const income_source_items = normalizeIncomeSourceItemsForClientDraft(raw, mainBusinessType);
        return {
            income_source_items,
            field_visibility: computeAccountingModalFieldVisibility('income', { income_source_items }),
        };
    }
    throw badRequest('normalize-draft only supports expenses or income');
}
function incomeSourceSelectedInDraft(draft, code) {
    const items = draft.income_source_items;
    if (!Array.isArray(items))
        return false;
    return items.some((x) => {
        if (!x || typeof x !== 'object')
            return false;
        const o = x;
        return String(o.source_code ?? '') === code && Boolean(o.selected);
    });
}
/** Visibility for accounting block modals — derived only from current draft; no client-side rules. */
export function computeAccountingModalFieldVisibility(blockKey, draft) {
    if (blockKey === 'expenses') {
        return { expense_items: true };
    }
    if (blockKey === 'documents') {
        return {
            document_delivery_method: true,
            documents_due_day: true,
            expense_management_system: true,
            expense_system_username: true,
            expense_system_password: true,
            income_management_system: true,
            income_system_username: true,
            income_system_password: true,
            access_notes: true,
        };
    }
    if (blockKey === 'income') {
        return {
            income_source_items: true,
            has_additional_income: false,
            number_of_workplaces: incomeSourceSelectedInDraft(draft, 'salary'),
            other_income_details: incomeSourceSelectedInDraft(draft, 'other'),
            income_management_system: true,
            income_user_code: true,
            income_password: true,
            income_software_open_link: true,
        };
    }
    if (blockKey === 'expense_management') {
        const base = {
            expense_delivery_method: true,
            expense_software_name: true,
            expense_software_username: true,
            expense_software_password: true,
            expense_software_url: true,
            expense_uploaded_by: true,
            expense_documents_order_level: true,
            expense_management_notes: true,
        };
        for (const k of Object.keys(draft)) {
            if (k.startsWith('em_cf_'))
                base[k] = true;
        }
        return base;
    }
    if (blockKey === 'vehicles') {
        return { has_vehicles: true };
    }
    return {};
}
function applyVisibilityToModalFields(fields, visibility) {
    return fields.map((f) => {
        const { depends_on: _d, depends_on_value: _dv, ...rest } = f;
        void _d;
        void _dv;
        const vis = visibility[f.key];
        return { ...rest, visible: vis !== undefined ? vis : rest.visible };
    });
}
export async function evaluateAccountingModalFieldVisibility(ctx, clientId, blockKey, draft) {
    const orgId = assertOrg(ctx);
    await ensureClientInOrg(orgId, clientId);
    if (!canViewTab(ctx))
        throw forbidden('Insufficient permission');
    if (!['expenses', 'income', 'expense_management', 'documents', 'vehicles'].includes(blockKey)) {
        throw badRequest('modal-visibility invalid blockKey');
    }
    return { field_visibility: computeAccountingModalFieldVisibility(blockKey, draft) };
}
function hasPermission(ctx, p) {
    return (ctx.membership?.permissions ?? []).includes(p);
}
function canViewTab(ctx) {
    return hasPermission(ctx, 'accounting_settings_tab.view') || hasPermission(ctx, 'client_operations.view');
}
export function canEditBlock(ctx, block) {
    const fallback = hasPermission(ctx, 'client_operations.edit');
    if (block === 'expenses')
        return hasPermission(ctx, 'accounting_settings_expenses.edit') || fallback;
    if (block === 'income')
        return hasPermission(ctx, 'accounting_settings_income.edit') || fallback;
    if (block === 'expense_management') {
        return hasPermission(ctx, 'accounting_settings_expense_management.edit') || fallback;
    }
    if (block === 'documents')
        return hasPermission(ctx, 'accounting_settings_documents.edit') || fallback;
    return hasPermission(ctx, 'accounting_settings_vehicles.edit') || fallback;
}
async function getOrCreateParent(orgId, clientId, userId) {
    const { data: row, error } = await supabaseAdmin
        .from('client_accounting_settings')
        .select('*')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .maybeSingle();
    if (error)
        throw new AppError(500, error.message ?? 'client_accounting_settings read failed', 'SUPABASE_ERROR');
    if (row)
        return row;
    const { data: created, error: insErr } = await supabaseAdmin
        .from('client_accounting_settings')
        .insert({
        organization_id: orgId,
        client_id: clientId,
        has_vehicles: false,
        has_business_vehicles: false,
        is_seasonal_business: false,
        created_by: userId,
        updated_by: userId,
    })
        .select('*')
        .single();
    if (insErr || !created)
        throw new AppError(500, insErr?.message ?? 'client_accounting_settings insert failed', 'SUPABASE_ERROR');
    return created;
}
function mapByCode(arr) {
    return new Map(arr.map((x) => [x.code, x.label]));
}
function toIntOrNull(v) {
    if (v === null || v === undefined || v === '')
        return null;
    const n = Number(v);
    if (!Number.isFinite(n))
        return null;
    return Math.trunc(n);
}
/** Expense line: whole percent 0–100; rounds input, clamps to range; null if empty/invalid. */
function toBusinessPercentIntOrNull(v) {
    if (v === null || v === undefined || v === '')
        return null;
    const n = Number(v);
    if (!Number.isFinite(n))
        return null;
    return Math.min(100, Math.max(0, Math.round(n)));
}
/** Monthly expense amount in ₪; non-negative, max 2 decimal places. */
function toMonthlyAmountIlsOrNull(v) {
    if (v === null || v === undefined || v === '')
        return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0)
        return null;
    const rounded = Math.round(n * 100) / 100;
    if (rounded > 99_999_999.99)
        return null;
    return rounded;
}
function toNumOrNull(v) {
    if (v === null || v === undefined || v === '')
        return null;
    const n = Number(v);
    if (!Number.isFinite(n))
        return null;
    return n;
}
function toStrOrNull(v) {
    if (typeof v !== 'string')
        return null;
    const s = v.trim();
    return s ? s : null;
}
async function loadExpenses(orgId, clientId) {
    const { data, error } = await supabaseAdmin
        .from('client_accounting_expense_items')
        .select('expense_type_code, business_percent, monthly_amount_ils, sort_order')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .order('sort_order', { ascending: true });
    if (error)
        throw new AppError(500, error.message ?? 'client_accounting_expense_items read failed', 'SUPABASE_ERROR');
    return (data ?? []);
}
async function loadIncomeSources(orgId, clientId) {
    const { data, error } = await supabaseAdmin
        .from('client_accounting_income_sources')
        .select('source_code, monthly_amount, workplace_name, employment_scope, source_details, sort_order')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .order('sort_order', { ascending: true });
    if (error)
        throw new AppError(500, error.message ?? 'client_accounting_income_sources read failed', 'SUPABASE_ERROR');
    return (data ?? []).map((r) => ({
        source_code: String(r.source_code),
        monthly_amount: r.monthly_amount == null ? null : Number(r.monthly_amount),
        workplace_name: r.workplace_name == null ? null : String(r.workplace_name),
        employment_scope: r.employment_scope == null ? null : String(r.employment_scope),
        source_details: r.source_details == null ? null : String(r.source_details),
    }));
}
function expenseKind(code) {
    const m = EXPENSE_TYPES.find((e) => e.code === code);
    return m ? m.value_kind : null;
}
function buildExpensesCard(parent, rows, canEdit) {
    const dict = mapByCode(EXPENSE_TYPES);
    const allowedExpense = new Set(EXPENSE_TYPES.map((e) => e.code));
    /** מפת כרטיסייה כמו הכנסות: עמודת סכומים (שורות מחוברות ב־|) + עמודת אחוזים (summary_items). */
    const amountLines = [];
    const percentItems = [];
    for (const r of rows.filter((x) => allowedExpense.has(x.expense_type_code))) {
        const label = dict.get(r.expense_type_code) ?? r.expense_type_code;
        const kind = expenseKind(r.expense_type_code);
        if (kind === 'amount') {
            const a = r.monthly_amount_ils;
            if (a != null && Number.isFinite(Number(a))) {
                amountLines.push(`${label} ₪${Number(a).toLocaleString('he-IL')}`);
            }
        }
        else if (kind === 'percent') {
            const p = r.business_percent;
            if (p != null)
                percentItems.push({ label, value: `${p}%` });
        }
    }
    const empty = SUMMARY_EMPTY_STATE_HE;
    return {
        block_key: 'expenses',
        block_label: 'הוצאות קבועות',
        summary_text: amountLines.length ? amountLines.join(' | ') : empty,
        summary_primary_rows: amountLines,
        summary_empty_state_text: empty,
        summary_secondary_empty_message: percentItems.length === 0 ? empty : null,
        summary_items: percentItems.map((x) => ({ ...x, display: 'text' })),
        can_edit: canEdit,
        edit_action: { type: 'open_modal', modal_key: 'accounting_settings_expenses' },
        version: Number(parent.expenses_version ?? 0),
    };
}
function buildIncomeCard(parent, sources, canEdit) {
    const dict = mapByCode(INCOME_SOURCES);
    const sourceCodes = sources.map((s) => s.source_code);
    const labels = sources.map((s) => {
        const base = dict.get(s.source_code) ?? s.source_code;
        const amt = s.monthly_amount;
        if (s.source_code === 'business') {
            const addType = additionalBusinessTypeLabel(toStrOrNull(parent.additional_business_type));
            const addTax = toStrOrNull(parent.additional_business_tax_id);
            const addMeta = [addType, addTax].filter(Boolean).join(' / ');
            const withMeta = addMeta ? `${base} (${addMeta})` : base;
            return amt != null ? `${withMeta} ₪${Math.round(amt).toLocaleString('he-IL')}` : withMeta;
        }
        if (s.source_code === 'salary') {
            const salaryMeta = [toStrOrNull(s.workplace_name), toStrOrNull(s.employment_scope)].filter(Boolean).join(' / ');
            const withMeta = salaryMeta ? `${base} (${salaryMeta})` : base;
            return amt != null ? `${withMeta} ₪${Math.round(amt).toLocaleString('he-IL')}` : withMeta;
        }
        if (s.source_code === 'allowance' || s.source_code === 'other') {
            const details = toStrOrNull(s.source_details);
            const withMeta = details ? `${base} (${details})` : base;
            return amt != null ? `${withMeta} ₪${Math.round(amt).toLocaleString('he-IL')}` : withMeta;
        }
        return amt != null ? `${base} ₪${Math.round(amt).toLocaleString('he-IL')}` : base;
    });
    const extra = [];
    if (sourceCodes.includes('salary') && Number(parent.number_of_workplaces ?? 0) > 0) {
        extra.push(`${Number(parent.number_of_workplaces)} מקומות עבודה`);
    }
    if (Boolean(parent.has_additional_income))
        extra.push('הכנסה נוספת');
    const summaryParts = [...labels, ...extra];
    const leftRows = summaryLinesFromParts(summaryParts, 4);
    const detailsItems = [];
    const incomeSystem = toStrOrNull(parent.income_management_system);
    const incomeUserCode = toStrOrNull(parent.income_user_code);
    const incomeLink = toStrOrNull(parent.income_software_open_link);
    if (incomeSystem)
        detailsItems.push({ label: 'תוכנה', value: incomeSystem, display: 'text' });
    if (incomeUserCode)
        detailsItems.push({ label: 'קוד משתמש', value: incomeUserCode, display: 'text' });
    if (incomeLink)
        detailsItems.push({ label: 'לינק', value: incomeLink, display: 'link' });
    if (canEdit && toStrOrNull(parent.income_password_encrypted)) {
        detailsItems.push({ label: 'סיסמה', value: 'שמורה', display: 'password_saved' });
    }
    const empty = SUMMARY_EMPTY_STATE_HE;
    return {
        block_key: 'income',
        block_label: 'הכנסות',
        summary_text: leftRows.length ? leftRows.join(' | ') : empty,
        summary_primary_rows: leftRows,
        summary_empty_state_text: empty,
        summary_secondary_empty_message: null,
        summary_items: detailsItems,
        can_edit: canEdit,
        edit_action: { type: 'open_modal', modal_key: 'accounting_settings_income' },
        version: Number(parent.income_version ?? 0),
    };
}
function expenseMgmtSummaryLabel(dict, code, emptyFallback) {
    if (!code)
        return emptyFallback;
    return dict.get(code) ?? code;
}
function buildExpenseManagementCard(parent, canEdit, emCustomFields) {
    const methodDict = mapByCode(EXPENSE_DELIVERY_METHODS);
    const upDict = mapByCode(EXPENSE_UPLOADED_BY_OPTS);
    const ordDict = mapByCode(EXPENSE_DOCS_ORDER_OPTS);
    const methodCode = toStrOrNull(parent.expense_delivery_method);
    const empty = SUMMARY_EMPTY_STATE_HE;
    const methodLabel = expenseMgmtSummaryLabel(methodDict, methodCode, empty);
    const nameVal = toStrOrNull(parent.expense_software_name);
    const userVal = toStrOrNull(parent.expense_software_username);
    const urlVal = toStrOrNull(parent.expense_software_url);
    const uploadedLabel = expenseMgmtSummaryLabel(upDict, toStrOrNull(parent.expense_uploaded_by), empty);
    const orderLabel = expenseMgmtSummaryLabel(ordDict, toStrOrNull(parent.expense_documents_order_level), empty);
    const notesVal = toStrOrNull(parent.expense_management_notes);
    const passSaved = Boolean(toStrOrNull(parent.expense_software_password_encrypted));
    const cell = (field_key, labelHe, val, display, visible) => ({
        field_key,
        label: labelHe,
        value: val,
        display,
        visible,
    });
    /** תמיד מציגים עמודת גישה בכרטיס (אותו layout דו-עמודתי) */
    const access = [
        cell('expense_software_name', 'שם תוכנת הוצאות', nameVal ?? empty, 'text', true),
        cell('expense_software_username', 'קוד משתמש למערכת הוצאות', userVal ?? empty, 'text', true),
        cell('expense_software_password', 'סיסמה למערכת הוצאות', passSaved ? 'שמורה' : empty, passSaved ? 'password_saved' : 'text', true),
        cell('expense_software_url', 'קישור למערכת הוצאות', urlVal ?? empty, urlVal ? 'link' : 'text', true),
    ];
    const mainColumn = [
        cell('expense_delivery_method', 'קבלת הוצאות', methodLabel, 'text', true),
        cell('expense_uploaded_by', 'מי מעלה את ההוצאות', uploadedLabel, 'text', true),
        cell('expense_documents_order_level', 'רמת סדר של מסמכי הוצאות', orderLabel, 'text', true),
        cell('expense_management_notes', 'הערות על ניהול הוצאות', notesVal ?? empty, 'text', true),
        ...[...emCustomFields]
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((cf) => cell(cf.field_key, cf.label_he, formatExpenseMgmtCustomFieldSummary(cf, empty), 'text', true)),
    ];
    return {
        block_key: 'expense_management',
        block_label: 'הוצאות',
        summary_text: '',
        summary_primary_rows: [],
        summary_empty_state_text: empty,
        summary_secondary_empty_message: null,
        summary_items: [],
        expense_management_zones: {
            access,
            main_column: mainColumn,
        },
        can_edit: canEdit,
        edit_action: { type: 'open_modal', modal_key: 'accounting_settings_expense_management' },
        version: Number(parent.expense_management_version ?? 0),
    };
}
function buildDocumentsCard(parent, canEdit) {
    const dd = mapByCode(DOC_DELIVERY);
    const deliveryLabel = parent.document_delivery_method ? dd.get(String(parent.document_delivery_method)) : null;
    const dueDay = toIntOrNull(parent.documents_due_day);
    const mainSystem = toStrOrNull(parent.expense_management_system) ??
        toStrOrNull(parent.documents_income_management_system) ??
        toStrOrNull(parent.income_management_system);
    const parts = [
        deliveryLabel,
        dueDay != null ? `עד ${dueDay} בחודש` : null,
        mainSystem,
    ].filter(Boolean);
    const empty = SUMMARY_EMPTY_STATE_HE;
    const truncated = parts.slice(0, 4);
    return {
        block_key: 'documents',
        block_label: 'מסמכים',
        summary_text: parts.length ? parts.join(' | ') : empty,
        summary_primary_rows: [],
        summary_empty_state_text: empty,
        summary_secondary_empty_message: null,
        summary_items: truncated.map((p) => ({ label: p, value: '', display: 'text' })),
        can_edit: canEdit,
        edit_action: { type: 'open_modal', modal_key: 'accounting_settings_documents' },
        version: Number(parent.documents_version ?? 0),
    };
}
function buildVehiclesCard(parent, fleet, canEdit) {
    /** בלוק רכבים נשלט ב־has_vehicles (שמירת כן/לא כאן); לא למשוך כן מפרופיל עסק בלי בחירה מפורשת. */
    const hasVehicles = Boolean(parent.has_vehicles);
    const empty = SUMMARY_EMPTY_STATE_HE;
    const vehicles_yes_no = {
        field_key: 'has_vehicles',
        label: 'יש רכבים?',
        value: hasVehicles ? 'yes' : 'no',
        options: [
            { value: 'no', label: 'לא' },
            { value: 'yes', label: 'כן' },
        ],
    };
    if (!hasVehicles) {
        return {
            block_key: 'vehicles',
            block_label: 'רכבים',
            summary_text: 'אין רכבים',
            summary_primary_rows: [],
            summary_empty_state_text: empty,
            summary_secondary_empty_message: null,
            summary_items: [],
            has_vehicles: false,
            vehicles_yes_no,
            vehicle_items: [],
            vehicle_block_actions: [],
            can_edit: canEdit,
            edit_action: { type: 'open_modal', modal_key: 'accounting_settings_vehicles' },
            version: Number(parent.vehicles_version ?? 0),
        };
    }
    const vehicleCell = (field_key, labelHe, val, visible) => ({
        field_key,
        label: labelHe,
        value: val,
        visible,
    });
    const excelRows = [];
    const vehicle_items = [];
    for (const r of fleet) {
        const f = vehicleFleetRowSummaryFields(r);
        excelRows.push({
            left: vehicleCell('license_plate', 'מספר רישוי', f.license_plate, true),
            right: vehicleCell('ownership_kind', 'סוג בעלות', f.ownership_label, true),
            vehicle_id: r.id,
        });
        excelRows.push({
            left: vehicleCell('assigned_to', 'למי משויך הרכב', f.assigned_label, true),
            right: vehicleCell('fuel_vat', 'שיעור קיזוז מע״מ על דלק', f.fuel_vat_label, true),
        });
        vehicle_items.push({
            vehicle_id: r.id,
            summary_lines: [],
            edit_action: { label: 'עריכה', enabled: canEdit },
        });
    }
    const vehicle_block_actions = [];
    if (canEdit) {
        vehicle_block_actions.push({ action_key: 'add_vehicle', label: 'הוסף רכב', enabled: true });
    }
    const summary_text = fleet.length === 0 ? '' : `${fleet.length} רכבים`;
    return {
        block_key: 'vehicles',
        block_label: 'רכבים',
        summary_text,
        summary_primary_rows: [],
        summary_empty_state_text: empty,
        summary_secondary_empty_message: null,
        summary_items: [],
        has_vehicles: true,
        vehicles_yes_no,
        vehicle_items,
        vehicle_block_actions,
        excel_grid: {
            column_headers: ['פרטי רכב', 'מס וניכויים'],
            rows: fleet.length > 0 ? excelRows : [],
        },
        can_edit: canEdit,
        edit_action: { type: 'open_modal', modal_key: 'accounting_settings_vehicles' },
        version: Number(parent.vehicles_version ?? 0),
    };
}
function buildAccountingTabResponse(ctx, parent, expenseRows, incomeSources, vehicleFleet, emCustomFields = []) {
    return {
        tab_key: 'accounting_settings',
        tab_label: 'הגדרות הנה״ח',
        layout: { type: 'grid', columns: 2 },
        blocks: [
            buildIncomeCard(parent, incomeSources, canEditBlock(ctx, 'income')),
            buildExpenseManagementCard(parent, canEditBlock(ctx, 'expense_management'), emCustomFields),
            buildExpensesCard(parent, expenseRows, canEditBlock(ctx, 'expenses')),
            buildDocumentsCard(parent, canEditBlock(ctx, 'documents')),
            buildVehiclesCard(parent, vehicleFleet, canEditBlock(ctx, 'vehicles')),
        ],
    };
}
/**
 * Read model for הגדרות הנה״ח cards (same builder as GET accounting-settings/tab).
 * Returns null when the user lacks tab view permission — omit from workspace aggregate in that case.
 */
export async function getAccountingSettingsTabReadModel(ctx, clientId) {
    const orgId = assertOrg(ctx);
    await ensureClientInOrg(orgId, clientId);
    if (!canViewTab(ctx))
        return null;
    const parent = await getOrCreateParent(orgId, clientId, ctx.user.id);
    const [expenseRows, incomeSources, vehicleFleet, emCustomFields] = await Promise.all([
        loadExpenses(orgId, clientId),
        loadIncomeSources(orgId, clientId),
        loadVehicleFleet(orgId, clientId),
        loadExpenseMgmtCustomFields(orgId, clientId),
    ]);
    return buildAccountingTabResponse(ctx, parent, expenseRows, incomeSources, vehicleFleet, emCustomFields);
}
export async function getAccountingSettingsTab(ctx, clientId) {
    const out = await getAccountingSettingsTabReadModel(ctx, clientId);
    if (!out)
        throw forbidden('Insufficient permission');
    return out;
}
export async function getAccountingBlockModal(ctx, clientId, blockKey) {
    const orgId = assertOrg(ctx);
    await ensureClientInOrg(orgId, clientId);
    if (!canViewTab(ctx))
        throw forbidden('Insufficient permission');
    const parent = await getOrCreateParent(orgId, clientId, ctx.user.id);
    const mainBusinessType = await loadMainBusinessType(orgId, clientId);
    const canEdit = canEditBlock(ctx, blockKey);
    if (blockKey === 'expenses') {
        const rows = await loadExpenses(orgId, clientId);
        const byCode = new Map(rows.map((r) => [r.expense_type_code, r]));
        const value = EXPENSE_TYPES.map((e) => {
            const row = byCode.get(e.code);
            const selected = Boolean(row);
            return {
                expense_type_code: e.code,
                expense_type_label_he: e.label,
                value_kind: e.value_kind,
                selected,
                business_percent: selected && e.value_kind === 'percent' ? row.business_percent : null,
                monthly_amount_ils: selected && e.value_kind === 'amount' ? row.monthly_amount_ils : null,
            };
        });
        const expenseDraft = { expense_items: value };
        const expenseVis = computeAccountingModalFieldVisibility('expenses', expenseDraft);
        return {
            modal_key: 'accounting_settings_expenses',
            modal_label: 'עריכת הוצאות קבועות',
            block_key: 'expenses',
            version: Number(parent.expenses_version ?? 0),
            can_edit: canEdit,
            field_visibility: expenseVis,
            fields: applyVisibilityToModalFields([
                {
                    key: 'expense_items',
                    label: 'סוגי הוצאות קבועות',
                    type: 'enum_multi',
                    value,
                    required: false,
                    visible: true,
                    editable: canEdit,
                },
            ], expenseVis),
        };
    }
    if (blockKey === 'income') {
        const selectedRows = await loadIncomeSources(orgId, clientId);
        const selectedCodes = selectedRows.map((s) => s.source_code);
        const selectedMap = new Map(selectedRows.map((s) => [s.source_code, s]));
        const addTypeOptions = additionalBusinessTypeOptionsByMain(mainBusinessType);
        const sourceItems = INCOME_SOURCES.map((x) => ({
            source_code: x.code,
            source_label_he: x.label,
            selected: selectedCodes.includes(x.code),
            monthly_amount: selectedMap.get(x.code)?.monthly_amount ?? null,
            additional_business_type: x.code === 'business' ? toStrOrNull(parent.additional_business_type) : null,
            additional_business_tax_id: x.code === 'business' ? toStrOrNull(parent.additional_business_tax_id) : null,
            additional_business_type_options: x.code === 'business' ? addTypeOptions : [],
            workplace_name: x.code === 'salary' ? toStrOrNull(selectedMap.get(x.code)?.workplace_name) : null,
            employment_scope: x.code === 'salary' ? toStrOrNull(selectedMap.get(x.code)?.employment_scope) : null,
            source_details: x.code === 'allowance' || x.code === 'other'
                ? toStrOrNull(selectedMap.get(x.code)?.source_details)
                : null,
        }));
        const incomeDraft = {
            income_source_items: sourceItems,
            has_additional_income: false,
            number_of_workplaces: toIntOrNull(parent.number_of_workplaces),
            other_income_details: toStrOrNull(parent.other_income_details),
            income_management_system: toStrOrNull(parent.income_management_system),
            income_user_code: toStrOrNull(parent.income_user_code),
            income_password: null,
            income_software_open_link: toStrOrNull(parent.income_software_open_link),
        };
        const incomeVis = computeAccountingModalFieldVisibility('income', incomeDraft);
        return {
            modal_key: 'accounting_settings_income',
            modal_label: 'עריכת הכנסות',
            block_key: 'income',
            version: Number(parent.income_version ?? 0),
            can_edit: canEdit,
            field_visibility: incomeVis,
            fields: applyVisibilityToModalFields([
                {
                    key: 'income_source_items',
                    label: 'מקורות הכנסה',
                    type: 'enum_multi',
                    value: sourceItems,
                    required: false,
                    visible: true,
                    editable: canEdit,
                },
                {
                    key: 'has_additional_income',
                    label: 'יש הכנסה נוספת',
                    type: 'boolean',
                    value: false,
                    options: [{ value: true, label: 'כן' }, { value: false, label: 'לא' }],
                    required: false,
                    visible: false,
                    editable: false,
                },
                {
                    key: 'number_of_workplaces',
                    label: 'מספר מקומות עבודה',
                    type: 'integer',
                    value: toIntOrNull(parent.number_of_workplaces),
                    required: false,
                    visible: true,
                    editable: canEdit,
                    min: 1,
                },
                {
                    key: 'other_income_details',
                    label: 'פירוט הכנסה אחרת',
                    type: 'text',
                    value: toStrOrNull(parent.other_income_details),
                    required: false,
                    visible: true,
                    editable: canEdit,
                    max_length: 500,
                },
                {
                    key: 'income_management_system',
                    label: 'מערכת ניהול הכנסה',
                    type: 'text',
                    value: toStrOrNull(parent.income_management_system),
                    required: false,
                    visible: true,
                    editable: canEdit,
                    max_length: 200,
                },
                {
                    key: 'income_user_code',
                    label: 'קוד משתמש',
                    type: 'text',
                    value: toStrOrNull(parent.income_user_code),
                    required: false,
                    visible: true,
                    editable: canEdit,
                    max_length: 200,
                },
                {
                    key: 'income_password',
                    label: 'סיסמה',
                    type: 'secure_text',
                    value: null,
                    required: false,
                    visible: true,
                    editable: canEdit,
                    placeholder: '***',
                },
                {
                    key: 'income_software_open_link',
                    label: 'לינק לפתיחת תוכנה',
                    type: 'text',
                    value: toStrOrNull(parent.income_software_open_link),
                    required: false,
                    visible: true,
                    editable: canEdit,
                    max_length: 1000,
                },
            ], incomeVis),
        };
    }
    if (blockKey === 'expense_management') {
        const customFields = await loadExpenseMgmtCustomFields(orgId, clientId);
        const emDraft = {
            expense_delivery_method: toStrOrNull(parent.expense_delivery_method),
            expense_software_name: toStrOrNull(parent.expense_software_name),
            expense_software_username: toStrOrNull(parent.expense_software_username),
            expense_software_password: null,
            expense_software_url: toStrOrNull(parent.expense_software_url),
            expense_uploaded_by: toStrOrNull(parent.expense_uploaded_by),
            expense_documents_order_level: toStrOrNull(parent.expense_documents_order_level),
            expense_management_notes: toStrOrNull(parent.expense_management_notes),
        };
        for (const cf of customFields) {
            const ft = normalizeExpenseMgmtFieldType(cf.field_type);
            if (ft === 'text')
                emDraft[cf.field_key] = cf.value_text;
            else if (ft === 'enum_single')
                emDraft[cf.field_key] = cf.value_enum;
            else if (ft === 'enum_multi')
                emDraft[cf.field_key] = parseExpenseMgmtSelectedJson(cf.value_selected_json);
            else
                emDraft[cf.field_key] = cf.value_bool;
        }
        const emVis = computeAccountingModalFieldVisibility('expense_management', emDraft);
        const coreFields = [
            {
                key: 'expense_delivery_method',
                label: 'קבלת הוצאות',
                type: 'enum_single',
                value: toStrOrNull(parent.expense_delivery_method),
                options: EXPENSE_DELIVERY_METHODS.map((x) => ({ value: x.code, label: x.label })),
                required: false,
                visible: true,
                editable: canEdit,
            },
            {
                key: 'expense_software_name',
                label: 'שם תוכנת הוצאות',
                type: 'text',
                value: toStrOrNull(parent.expense_software_name),
                required: false,
                visible: true,
                editable: canEdit,
                max_length: 200,
            },
            {
                key: 'expense_software_username',
                label: 'קוד משתמש למערכת הוצאות',
                type: 'text',
                value: toStrOrNull(parent.expense_software_username),
                required: false,
                visible: true,
                editable: canEdit,
                max_length: 200,
            },
            {
                key: 'expense_software_password',
                label: 'סיסמה למערכת הוצאות',
                type: 'secure_text',
                value: null,
                required: false,
                visible: true,
                editable: canEdit,
                placeholder: '***',
            },
            {
                key: 'expense_software_url',
                label: 'קישור למערכת הוצאות',
                type: 'text',
                value: toStrOrNull(parent.expense_software_url),
                required: false,
                visible: true,
                editable: canEdit,
                max_length: 1000,
            },
            {
                key: 'expense_uploaded_by',
                label: 'מי מעלה את ההוצאות',
                type: 'enum_single',
                value: toStrOrNull(parent.expense_uploaded_by),
                options: EXPENSE_UPLOADED_BY_OPTS.map((x) => ({ value: x.code, label: x.label })),
                required: false,
                visible: true,
                editable: canEdit,
            },
            {
                key: 'expense_documents_order_level',
                label: 'רמת סדר של מסמכי הוצאות',
                type: 'enum_single',
                value: toStrOrNull(parent.expense_documents_order_level),
                options: EXPENSE_DOCS_ORDER_OPTS.map((x) => ({ value: x.code, label: x.label })),
                required: false,
                visible: true,
                editable: canEdit,
            },
            {
                key: 'expense_management_notes',
                label: 'הערות על ניהול הוצאות',
                type: 'textarea',
                value: toStrOrNull(parent.expense_management_notes),
                required: false,
                visible: true,
                editable: canEdit,
                max_length: 2000,
            },
        ];
        const customFieldSchemas = customFields.map((cf) => {
            const ft = normalizeExpenseMgmtFieldType(cf.field_type);
            if (ft === 'text') {
                return {
                    key: cf.field_key,
                    label: cf.label_he,
                    type: 'text',
                    value: cf.value_text,
                    required: false,
                    visible: true,
                    editable: canEdit,
                    max_length: 2000,
                };
            }
            if (ft === 'enum_single') {
                const opts = parseExpenseMgmtOptionsJson(cf.options_json);
                return {
                    key: cf.field_key,
                    label: cf.label_he,
                    type: 'enum_single',
                    value: cf.value_enum,
                    options: opts.map((o) => ({ value: o, label: o })),
                    required: false,
                    visible: true,
                    editable: canEdit,
                };
            }
            if (ft === 'enum_multi') {
                const opts = parseExpenseMgmtOptionsJson(cf.options_json);
                return {
                    key: cf.field_key,
                    label: cf.label_he,
                    type: 'enum_multi',
                    value: parseExpenseMgmtSelectedJson(cf.value_selected_json),
                    options: opts.map((o) => ({ value: o, label: o })),
                    required: false,
                    visible: true,
                    editable: canEdit,
                };
            }
            return {
                key: cf.field_key,
                label: cf.label_he,
                type: 'boolean',
                value: cf.value_bool,
                options: [
                    { value: true, label: 'כן' },
                    { value: false, label: 'לא' },
                ],
                required: false,
                visible: true,
                editable: canEdit,
            };
        });
        return {
            modal_key: 'accounting_settings_expense_management',
            modal_label: 'עריכת ניהול הוצאות',
            block_key: 'expense_management',
            version: Number(parent.expense_management_version ?? 0),
            can_edit: canEdit,
            field_visibility: emVis,
            fields: applyVisibilityToModalFields([...coreFields, ...customFieldSchemas], emVis),
            expense_management_modal_meta: {
                custom_field_capacity: EXPENSE_MGMT_CUSTOM_FIELD_MAX_TOTAL,
                custom_field_count: customFields.length,
                custom_field_type_default: null,
                custom_field_type_placeholder_he: 'בחר',
                custom_field_type_options: [
                    { value: 'text', label: 'שדה טקסט' },
                    { value: 'enum_single', label: 'רשימה' },
                    { value: 'enum_multi', label: "צ'קבוקס" },
                ],
                custom_field_types_requiring_options: ['enum_single', 'enum_multi'],
                custom_field_options_max_count: EXPENSE_MGMT_CUSTOM_FIELD_OPTIONS_MAX,
                custom_field_options_count_label_he: 'מספר שורות / אפשרויות',
                custom_field_option_value_label_he: 'שם אפשרות',
            },
        };
    }
    if (blockKey === 'documents') {
        const documentsDraft = {
            document_delivery_method: toStrOrNull(parent.document_delivery_method),
            documents_due_day: toIntOrNull(parent.documents_due_day),
            expense_management_system: toStrOrNull(parent.expense_management_system),
            expense_system_username: toStrOrNull(parent.expense_system_username),
            income_management_system: toStrOrNull(parent.documents_income_management_system),
            income_system_username: toStrOrNull(parent.income_system_username),
            access_notes: toStrOrNull(parent.access_notes),
        };
        const documentsVis = computeAccountingModalFieldVisibility('documents', documentsDraft);
        return {
            modal_key: 'accounting_settings_documents',
            modal_label: 'עריכת מסמכים',
            block_key: 'documents',
            version: Number(parent.documents_version ?? 0),
            can_edit: canEdit,
            field_visibility: documentsVis,
            fields: applyVisibilityToModalFields([
                {
                    key: 'document_delivery_method',
                    label: 'שיטת מסירת מסמכים',
                    type: 'enum_single',
                    value: toStrOrNull(parent.document_delivery_method),
                    options: DOC_DELIVERY.map((x) => ({ value: x.code, label: x.label })),
                    required: false,
                    visible: true,
                    editable: canEdit,
                },
                {
                    key: 'documents_due_day',
                    label: 'יום יעד למסמכים',
                    type: 'integer',
                    value: toIntOrNull(parent.documents_due_day),
                    required: false,
                    visible: true,
                    editable: canEdit,
                    min: 1,
                    max: 31,
                },
                { key: 'expense_management_system', label: 'מערכת ניהול הוצאות', type: 'text', value: toStrOrNull(parent.expense_management_system), required: false, visible: true, editable: canEdit, max_length: 200 },
                { key: 'expense_system_username', label: 'שם משתמש מערכת הוצאות', type: 'text', value: toStrOrNull(parent.expense_system_username), required: false, visible: true, editable: canEdit, max_length: 200 },
                { key: 'expense_system_password', label: 'סיסמת מערכת הוצאות', type: 'secure_text', value: null, required: false, visible: true, editable: canEdit, placeholder: '***' },
                { key: 'income_management_system', label: 'מערכת ניהול הכנסות', type: 'text', value: toStrOrNull(parent.documents_income_management_system), required: false, visible: true, editable: canEdit, max_length: 200 },
                { key: 'income_system_username', label: 'שם משתמש מערכת הכנסות', type: 'text', value: toStrOrNull(parent.income_system_username), required: false, visible: true, editable: canEdit, max_length: 200 },
                { key: 'income_system_password', label: 'סיסמת מערכת הכנסות', type: 'secure_text', value: null, required: false, visible: true, editable: canEdit, placeholder: '***' },
                { key: 'access_notes', label: 'הערות גישה', type: 'textarea', value: toStrOrNull(parent.access_notes), required: false, visible: true, editable: canEdit, max_length: 1000 },
            ], documentsVis),
        };
    }
    return {
        modal_key: 'accounting_settings_vehicles',
        modal_label: 'רכבים',
        block_key: 'vehicles',
        version: Number(parent.vehicles_version ?? 0),
        can_edit: false,
        field_visibility: {},
        fields: [],
    };
}
async function writeBlockAudit(ctx, clientId, block, changed) {
    const orgId = assertOrg(ctx);
    const action = block === 'expenses'
        ? AUDIT_ACTIONS.ACCOUNTING_SETTINGS_EXPENSES_UPDATED
        : block === 'income'
            ? AUDIT_ACTIONS.ACCOUNTING_SETTINGS_INCOME_UPDATED
            : block === 'expense_management'
                ? AUDIT_ACTIONS.ACCOUNTING_SETTINGS_EXPENSE_MANAGEMENT_UPDATED
                : block === 'documents'
                    ? AUDIT_ACTIONS.ACCOUNTING_SETTINGS_DOCUMENTS_UPDATED
                    : AUDIT_ACTIONS.ACCOUNTING_SETTINGS_VEHICLES_UPDATED;
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        moduleCode: 'client-operations',
        entityType: `accounting_settings_${block}`,
        entityId: clientId,
        action,
        payload: { client_id: clientId, changed_fields_summary: changed },
    });
}
export async function saveAccountingBlock(ctx, clientId, blockKey, body) {
    const orgId = assertOrg(ctx);
    await ensureClientInOrg(orgId, clientId);
    if (!canEditBlock(ctx, blockKey))
        throw forbidden('Insufficient permission');
    const parent = await getOrCreateParent(orgId, clientId, ctx.user.id);
    const expectedVersion = toIntOrNull(body.expected_version);
    const currentVersion = Number(blockKey === 'expenses'
        ? parent.expenses_version ?? 0
        : blockKey === 'income'
            ? parent.income_version ?? 0
            : blockKey === 'expense_management'
                ? parent.expense_management_version ?? 0
                : blockKey === 'documents'
                    ? parent.documents_version ?? 0
                    : parent.vehicles_version ?? 0);
    if (expectedVersion == null)
        throw badRequest('expected_version required');
    if (expectedVersion !== currentVersion)
        throw conflict('Version mismatch', 'VERSION_CONFLICT');
    if (blockKey === 'expenses') {
        const items = Array.isArray(body.expense_items) ? body.expense_items : [];
        const allowed = new Set(EXPENSE_TYPES.map((x) => x.code));
        const seen = new Set();
        const rows = [];
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const code = String(it.expense_type_code ?? '');
            const selected = Boolean(it.selected);
            if (!allowed.has(code))
                throw badRequest('Invalid expense type');
            if (seen.has(code))
                throw badRequest('Duplicate expense type');
            seen.add(code);
            if (!selected)
                continue;
            const meta = EXPENSE_TYPES.find((x) => x.code === code);
            if (!meta)
                throw badRequest('Invalid expense type');
            if (meta.value_kind === 'percent') {
                const p = toBusinessPercentIntOrNull(it.business_percent);
                if (p == null)
                    throw badRequest('נא להזין אחוז עסקי שלם בין 0 ל-100');
                rows.push({
                    organization_id: orgId,
                    client_id: clientId,
                    expense_type_code: code,
                    business_percent: p,
                    monthly_amount_ils: null,
                    sort_order: i,
                });
            }
            else {
                const amt = toMonthlyAmountIlsOrNull(it.monthly_amount_ils);
                if (amt == null)
                    throw badRequest('נא להזין סכום חודשי בשקלים');
                rows.push({
                    organization_id: orgId,
                    client_id: clientId,
                    expense_type_code: code,
                    business_percent: null,
                    monthly_amount_ils: amt,
                    sort_order: i,
                });
            }
        }
        const { error: delErr } = await supabaseAdmin
            .from('client_accounting_expense_items')
            .delete()
            .eq('organization_id', orgId)
            .eq('client_id', clientId);
        if (delErr)
            throw new AppError(500, delErr.message ?? 'Delete expenses failed', 'SUPABASE_ERROR');
        if (rows.length) {
            const { error: insErr } = await supabaseAdmin.from('client_accounting_expense_items').insert(rows);
            if (insErr)
                throw new AppError(500, insErr.message ?? 'Insert expenses failed', 'SUPABASE_ERROR');
        }
        const { data: updatedParent, error: updErr } = await supabaseAdmin
            .from('client_accounting_settings')
            .update({ expenses_version: currentVersion + 1, updated_by: ctx.user.id })
            .eq('organization_id', orgId)
            .eq('client_id', clientId)
            .eq('expenses_version', currentVersion)
            .select('*')
            .single();
        if (updErr || !updatedParent)
            throw new AppError(500, updErr?.message ?? 'Update expenses version failed', 'SUPABASE_ERROR');
        const [, expenseRowsFresh, incomeSources, vehicleFleetFresh, emCustomFieldsFresh] = await Promise.all([
            writeBlockAudit(ctx, clientId, 'expenses', ['expense_items']),
            loadExpenses(orgId, clientId),
            loadIncomeSources(orgId, clientId),
            loadVehicleFleet(orgId, clientId),
            loadExpenseMgmtCustomFields(orgId, clientId),
        ]);
        return buildAccountingTabResponse(ctx, updatedParent, expenseRowsFresh, incomeSources, vehicleFleetFresh, emCustomFieldsFresh);
    }
    else if (blockKey === 'income') {
        const sourceItems = Array.isArray(body.income_source_items) ? body.income_source_items : [];
        const allowed = new Set(INCOME_SOURCES.map((x) => x.code));
        const seen = new Set();
        const unique = [];
        const amountsByCode = new Map();
        const salaryByCode = new Map();
        const detailsByCode = new Map();
        let additionalBusinessType = null;
        let additionalBusinessTaxId = null;
        const mainBusinessType = await loadMainBusinessType(orgId, clientId);
        const allowedAdditionalType = new Set(additionalBusinessTypeOptionsByMain(mainBusinessType).map((o) => String(o.value)));
        for (let i = 0; i < sourceItems.length; i++) {
            const it = sourceItems[i];
            const code = String(it.source_code ?? '');
            const selected = Boolean(it.selected);
            if (!allowed.has(code))
                throw badRequest('Invalid income source');
            if (seen.has(code))
                throw badRequest('Duplicate income source');
            seen.add(code);
            if (!selected)
                continue;
            const amt = toNumOrNull(it.monthly_amount);
            if (amt == null || amt < 0)
                throw badRequest('monthly_amount required and must be non-negative for selected income source');
            unique.push(code);
            amountsByCode.set(code, amt);
            if (code === 'business') {
                additionalBusinessType = toStrOrNull(it.additional_business_type);
                additionalBusinessTaxId = toStrOrNull(it.additional_business_tax_id);
                if (!additionalBusinessType || !allowedAdditionalType.has(additionalBusinessType)) {
                    throw badRequest('additional_business_type is required and must match business type rules');
                }
                if (!additionalBusinessTaxId)
                    throw badRequest('additional_business_tax_id is required when business source selected');
                if (additionalBusinessTaxId.length > 50)
                    throw badRequest('additional_business_tax_id too long');
            }
            if (code === 'salary') {
                const workplaceName = toStrOrNull(it.workplace_name);
                const employmentScope = toStrOrNull(it.employment_scope);
                if (!workplaceName)
                    throw badRequest('workplace_name is required when salary source selected');
                if (!employmentScope)
                    throw badRequest('employment_scope is required when salary source selected');
                if (workplaceName.length > 200)
                    throw badRequest('workplace_name too long');
                if (employmentScope.length > 100)
                    throw badRequest('employment_scope too long');
                salaryByCode.set(code, { workplace_name: workplaceName, employment_scope: employmentScope });
            }
            if (code === 'allowance' || code === 'other') {
                const details = toStrOrNull(it.source_details);
                if (!details)
                    throw badRequest('source_details is required when allowance/other selected');
                if (details.length > 500)
                    throw badRequest('source_details too long');
                detailsByCode.set(code, details);
            }
        }
        const numberOfWorkplaces = toIntOrNull(body.number_of_workplaces);
        if (!unique.includes('salary') && numberOfWorkplaces != null)
            throw badRequest('number_of_workplaces allowed only with salary');
        if (unique.includes('salary') && numberOfWorkplaces != null && numberOfWorkplaces < 1)
            throw badRequest('number_of_workplaces must be >=1');
        const otherDetails = toStrOrNull(body.other_income_details);
        if (!unique.includes('other') && otherDetails)
            throw badRequest('other_income_details allowed only with other');
        if (otherDetails && otherDetails.length > 500)
            throw badRequest('other_income_details too long');
        const incomeUserCode = toStrOrNull(body.income_user_code);
        if (incomeUserCode && incomeUserCode.length > 200)
            throw badRequest('income_user_code too long');
        const incomeOpenLink = toStrOrNull(body.income_software_open_link);
        if (incomeOpenLink && incomeOpenLink.length > 1000)
            throw badRequest('income_software_open_link too long');
        const incomePassword = toStrOrNull(body.income_password);
        const { error: delErr } = await supabaseAdmin
            .from('client_accounting_income_sources')
            .delete()
            .eq('organization_id', orgId)
            .eq('client_id', clientId);
        if (delErr)
            throw new AppError(500, delErr.message ?? 'Delete income sources failed', 'SUPABASE_ERROR');
        if (unique.length) {
            const rows = unique.map((s, idx) => ({
                organization_id: orgId,
                client_id: clientId,
                source_code: s,
                monthly_amount: amountsByCode.get(s) ?? null,
                workplace_name: s === 'salary' ? salaryByCode.get(s)?.workplace_name ?? null : null,
                employment_scope: s === 'salary' ? salaryByCode.get(s)?.employment_scope ?? null : null,
                source_details: s === 'allowance' || s === 'other' ? detailsByCode.get(s) ?? null : null,
                sort_order: idx,
            }));
            const { error: insErr } = await supabaseAdmin.from('client_accounting_income_sources').insert(rows);
            if (insErr)
                throw new AppError(500, insErr.message ?? 'Insert income sources failed', 'SUPABASE_ERROR');
        }
        const { error: updErr } = await supabaseAdmin
            .from('client_accounting_settings')
            .update({
            has_additional_income: false,
            number_of_workplaces: unique.includes('salary') ? numberOfWorkplaces : null,
            estimated_monthly_income: null,
            estimated_income_source_code: null,
            other_income_details: unique.includes('other') ? otherDetails : null,
            additional_business_type: unique.includes('business') ? additionalBusinessType : null,
            additional_business_tax_id: unique.includes('business') ? additionalBusinessTaxId : null,
            income_management_system: toStrOrNull(body.income_management_system),
            income_user_code: incomeUserCode,
            income_software_open_link: incomeOpenLink,
            ...(incomePassword != null
                ? { income_password_encrypted: encryptJson({ password: incomePassword }) }
                : {}),
            income_version: currentVersion + 1,
            updated_by: ctx.user.id,
        })
            .eq('organization_id', orgId)
            .eq('client_id', clientId)
            .eq('income_version', currentVersion);
        if (updErr)
            throw new AppError(500, updErr.message ?? 'Update income failed', 'SUPABASE_ERROR');
        await writeBlockAudit(ctx, clientId, 'income', [
            'income_sources',
            'has_additional_income',
            'number_of_workplaces',
            'income_sources_monthly_amount',
            'other_income_details',
            'income_management_system',
            'income_user_code',
            ...(incomePassword != null ? ['income_password_changed'] : []),
            'income_software_open_link',
        ]);
    }
    else if (blockKey === 'documents') {
        const delivery = toStrOrNull(body.document_delivery_method);
        if (delivery && !DOC_DELIVERY.some((x) => x.code === delivery))
            throw badRequest('Invalid document_delivery_method');
        const dueDay = toIntOrNull(body.documents_due_day);
        if (dueDay != null && (dueDay < 1 || dueDay > 31))
            throw badRequest('documents_due_day must be 1-31');
        const expUser = toStrOrNull(body.expense_system_username);
        const incUser = toStrOrNull(body.income_system_username);
        if (expUser && expUser.length > 200)
            throw badRequest('expense_system_username too long');
        if (incUser && incUser.length > 200)
            throw badRequest('income_system_username too long');
        const notes = toStrOrNull(body.access_notes);
        if (notes && notes.length > 1000)
            throw badRequest('access_notes too long');
        const expensePass = toStrOrNull(body.expense_system_password);
        const incomePass = toStrOrNull(body.income_system_password);
        const patch = {
            document_delivery_method: delivery,
            documents_due_day: dueDay,
            expense_management_system: toStrOrNull(body.expense_management_system),
            expense_system_username: expUser,
            documents_income_management_system: toStrOrNull(body.income_management_system),
            income_system_username: incUser,
            access_notes: notes,
            documents_version: currentVersion + 1,
            updated_by: ctx.user.id,
        };
        if (expensePass != null)
            patch.expense_system_password_encrypted = encryptJson({ password: expensePass });
        if (incomePass != null)
            patch.income_system_password_encrypted = encryptJson({ password: incomePass });
        const { error: updErr } = await supabaseAdmin
            .from('client_accounting_settings')
            .update(patch)
            .eq('organization_id', orgId)
            .eq('client_id', clientId)
            .eq('documents_version', currentVersion);
        if (updErr)
            throw new AppError(500, updErr.message ?? 'Update documents failed', 'SUPABASE_ERROR');
        await writeBlockAudit(ctx, clientId, 'documents', [
            'document_delivery_method',
            'documents_due_day',
            'expense_management_system',
            'expense_system_username',
            ...(expensePass != null ? ['expense_system_password_changed'] : []),
            'income_management_system',
            'income_system_username',
            ...(incomePass != null ? ['income_system_password_changed'] : []),
            'access_notes',
        ]);
    }
    else if (blockKey === 'expense_management') {
        const deliveryMethod = toStrOrNull(body.expense_delivery_method);
        if (deliveryMethod && !EXPENSE_DELIVERY_METHODS.some((x) => x.code === deliveryMethod)) {
            throw badRequest('Invalid expense_delivery_method');
        }
        const uploadedBy = toStrOrNull(body.expense_uploaded_by);
        if (uploadedBy && !EXPENSE_UPLOADED_BY_OPTS.some((x) => x.code === uploadedBy)) {
            throw badRequest('Invalid expense_uploaded_by');
        }
        const orderLvl = toStrOrNull(body.expense_documents_order_level);
        if (orderLvl && !EXPENSE_DOCS_ORDER_OPTS.some((x) => x.code === orderLvl)) {
            throw badRequest('Invalid expense_documents_order_level');
        }
        const name = toStrOrNull(body.expense_software_name);
        const user = toStrOrNull(body.expense_software_username);
        const url = toStrOrNull(body.expense_software_url);
        const notes = toStrOrNull(body.expense_management_notes);
        if (name && name.length > 200)
            throw badRequest('expense_software_name too long');
        if (user && user.length > 200)
            throw badRequest('expense_software_username too long');
        if (url && url.length > 1000)
            throw badRequest('expense_software_url too long');
        if (notes && notes.length > 2000)
            throw badRequest('expense_management_notes too long');
        const pass = toStrOrNull(body.expense_software_password);
        const patch = {
            expense_delivery_method: deliveryMethod,
            expense_software_name: name,
            expense_software_username: user,
            expense_software_url: url,
            expense_uploaded_by: uploadedBy,
            expense_documents_order_level: orderLvl,
            expense_management_notes: notes,
            expense_management_version: currentVersion + 1,
            updated_by: ctx.user.id,
        };
        if (pass != null)
            patch.expense_software_password_encrypted = encryptJson({ password: pass });
        const { error: updErr } = await supabaseAdmin
            .from('client_accounting_settings')
            .update(patch)
            .eq('organization_id', orgId)
            .eq('client_id', clientId)
            .eq('expense_management_version', currentVersion);
        if (updErr)
            throw new AppError(500, updErr.message ?? 'Update expense management failed', 'SUPABASE_ERROR');
        await applyExpenseMgmtCustomFieldValuesFromBody(ctx, orgId, clientId, body);
        const customKeys = Object.keys(body).filter((k) => k.startsWith('em_cf_'));
        await writeBlockAudit(ctx, clientId, 'expense_management', [
            'expense_delivery_method',
            'expense_software_name',
            'expense_software_username',
            ...(pass != null ? ['expense_software_password_changed'] : []),
            'expense_software_url',
            'expense_uploaded_by',
            'expense_documents_order_level',
            'expense_management_notes',
            ...(customKeys.length ? ['expense_mgmt_custom_field_values'] : []),
        ]);
    }
    else {
        const hasVehicles = Boolean(body.has_vehicles);
        const { data: updatedParent, error: updErr } = await supabaseAdmin
            .from('client_accounting_settings')
            .update({
            has_business_vehicles: hasVehicles,
            has_vehicles: hasVehicles,
            vehicles_version: currentVersion + 1,
            updated_by: ctx.user.id,
        })
            .eq('organization_id', orgId)
            .eq('client_id', clientId)
            .eq('vehicles_version', currentVersion)
            .select('*')
            .single();
        if (updErr || !updatedParent)
            throw new AppError(500, updErr?.message ?? 'Update vehicles failed', 'SUPABASE_ERROR');
        const [, expenseRowsFresh, incomeSources, vehicleFleetFresh, emCustomFieldsFresh] = await Promise.all([
            writeBlockAudit(ctx, clientId, 'vehicles', ['has_vehicles']),
            loadExpenses(orgId, clientId),
            loadIncomeSources(orgId, clientId),
            loadVehicleFleet(orgId, clientId),
            loadExpenseMgmtCustomFields(orgId, clientId),
        ]);
        return buildAccountingTabResponse(ctx, updatedParent, expenseRowsFresh, incomeSources, vehicleFleetFresh, emCustomFieldsFresh);
    }
    return getAccountingSettingsTab(ctx, clientId);
}
export async function addExpenseManagementCustomFieldApi(ctx, clientId, input) {
    const orgId = assertOrg(ctx);
    await ensureClientInOrg(orgId, clientId);
    if (!canEditBlock(ctx, 'expense_management'))
        throw forbidden('Insufficient permission');
    const parent = await getOrCreateParent(orgId, clientId, ctx.user.id);
    const v = Number(parent.expense_management_version ?? 0);
    const body = {
        label_he: String(input.label_he ?? ''),
        field_type: String(input.field_type ?? ''),
        options_lines: input.options_lines != null ? String(input.options_lines) : undefined,
    };
    await createExpenseMgmtCustomField(ctx, orgId, clientId, body, v);
    return getAccountingBlockModal(ctx, clientId, 'expense_management');
}
export async function removeExpenseManagementCustomFieldApi(ctx, clientId, fieldId) {
    const orgId = assertOrg(ctx);
    await ensureClientInOrg(orgId, clientId);
    if (!canEditBlock(ctx, 'expense_management'))
        throw forbidden('Insufficient permission');
    const parent = await getOrCreateParent(orgId, clientId, ctx.user.id);
    const v = Number(parent.expense_management_version ?? 0);
    await deleteExpenseMgmtCustomField(ctx, orgId, clientId, fieldId, v);
    return getAccountingBlockModal(ctx, clientId, 'expense_management');
}

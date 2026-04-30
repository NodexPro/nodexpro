import { supabaseAdmin } from '../../db/client.js';
import { AppError, badRequest } from '../../shared/errors.js';
/** Max custom fields per org+client (total). */
export const EXPENSE_MGMT_CUSTOM_FIELD_MAX_TOTAL = 8;
/** Max options per רשימה / צ'קבוקס custom field (enforced on create + API meta). */
export const EXPENSE_MGMT_CUSTOM_FIELD_OPTIONS_MAX = 8;
/** @deprecated use EXPENSE_MGMT_CUSTOM_FIELD_MAX_TOTAL */
export const EXPENSE_MGMT_CUSTOM_FIELD_MAX = EXPENSE_MGMT_CUSTOM_FIELD_MAX_TOTAL;
function toStrOrNull(v) {
    if (v == null)
        return null;
    const s = String(v).trim();
    return s.length ? s : null;
}
/** jsonb may arrive as array or stringified JSON depending on driver/client. */
export function parseExpenseMgmtOptionsJson(raw) {
    if (raw == null)
        return [];
    if (Array.isArray(raw)) {
        return raw.map((x) => String(x).trim()).filter((s) => s.length > 0);
    }
    if (typeof raw === 'string') {
        const t = raw.trim();
        if (!t)
            return [];
        try {
            const p = JSON.parse(t);
            if (Array.isArray(p))
                return p.map((x) => String(x).trim()).filter((s) => s.length > 0);
        }
        catch {
            /* ignore */
        }
    }
    return [];
}
export function normalizeExpenseMgmtFieldType(raw) {
    const t = String(raw ?? '')
        .toLowerCase()
        .trim();
    if (t === 'text' || t === 'enum_single' || t === 'boolean' || t === 'enum_multi')
        return t;
    return 'text';
}
export function parseExpenseMgmtSelectedJson(raw) {
    if (raw == null)
        return [];
    if (Array.isArray(raw)) {
        return raw.map((x) => String(x).trim()).filter((s) => s.length > 0);
    }
    if (typeof raw === 'string') {
        const t = raw.trim();
        if (!t)
            return [];
        try {
            const p = JSON.parse(t);
            if (Array.isArray(p))
                return p.map((x) => String(x).trim()).filter((s) => s.length > 0);
        }
        catch {
            /* ignore */
        }
    }
    return [];
}
export function formatExpenseMgmtCustomFieldSummary(cf, emptyFallback) {
    const ft = normalizeExpenseMgmtFieldType(cf.field_type);
    if (ft === 'text')
        return toStrOrNull(cf.value_text) ?? emptyFallback;
    if (ft === 'enum_single')
        return toStrOrNull(cf.value_enum) ?? emptyFallback;
    if (ft === 'enum_multi') {
        const selected = parseExpenseMgmtSelectedJson(cf.value_selected_json);
        if (selected.length === 0)
            return emptyFallback;
        return selected.join(', ');
    }
    if (ft === 'boolean') {
        if (cf.value_bool === null || cf.value_bool === undefined)
            return emptyFallback;
        return cf.value_bool ? 'כן' : 'לא';
    }
    return emptyFallback;
}
export async function loadExpenseMgmtCustomFields(orgId, clientId) {
    const { data, error } = await supabaseAdmin
        .from('client_accounting_expense_mgmt_custom_fields')
        .select('*')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .order('sort_order', { ascending: true });
    if (error)
        throw new AppError(500, error.message ?? 'em custom fields read failed', 'SUPABASE_ERROR');
    return (data ?? []);
}
async function bumpExpenseManagementVersion(orgId, clientId, userId, expectedVersion) {
    const { error: updErr } = await supabaseAdmin
        .from('client_accounting_settings')
        .update({
        expense_management_version: expectedVersion + 1,
        updated_by: userId,
    })
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .eq('expense_management_version', expectedVersion);
    if (updErr)
        throw new AppError(500, updErr.message ?? 'expense_management version bump failed', 'SUPABASE_ERROR');
}
function parseOptionsLines(raw) {
    if (!raw || !String(raw).trim())
        return [];
    return String(raw)
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
}
export async function createExpenseMgmtCustomField(ctx, orgId, clientId, input, currentExpenseManagementVersion) {
    const existing = await loadExpenseMgmtCustomFields(orgId, clientId);
    if (existing.length >= EXPENSE_MGMT_CUSTOM_FIELD_MAX_TOTAL) {
        throw badRequest(`ניתן להוסיף עד ${EXPENSE_MGMT_CUSTOM_FIELD_MAX_TOTAL} שדות מותאמים`);
    }
    const label = toStrOrNull(input.label_he);
    if (!label || label.length > 80)
        throw badRequest('שם שדה נדרש (עד 80 תווים)');
    const ft = String(input.field_type ?? '').trim();
    if (ft !== 'text' && ft !== 'enum_single' && ft !== 'enum_multi') {
        throw badRequest('סוג שדה לא חוקי');
    }
    let options_json = null;
    if (ft === 'enum_single' || ft === 'enum_multi') {
        const opts = parseOptionsLines(input.options_lines);
        if (opts.length < 1)
            throw badRequest('נא להזין לפחות אפשרות אחת');
        if (opts.length > EXPENSE_MGMT_CUSTOM_FIELD_OPTIONS_MAX) {
            throw badRequest(`ניתן להגדיר עד ${EXPENSE_MGMT_CUSTOM_FIELD_OPTIONS_MAX} אפשרויות`);
        }
        for (const o of opts) {
            if (o.length > 200)
                throw badRequest('אפשרות ארוכה מדי');
        }
        options_json = opts;
    }
    const id = crypto.randomUUID();
    const field_key = `em_cf_${id}`;
    const { data: inserted, error: insErr } = await supabaseAdmin
        .from('client_accounting_expense_mgmt_custom_fields')
        .insert({
        id,
        organization_id: orgId,
        client_id: clientId,
        field_key,
        label_he: label,
        field_type: ft,
        options_json: options_json ? options_json : null,
        value_text: null,
        value_enum: null,
        value_bool: null,
        value_selected_json: null,
        sort_order: existing.length,
        created_by: ctx.user.id,
        updated_by: ctx.user.id,
    })
        .select('*')
        .single();
    if (insErr || !inserted) {
        throw new AppError(500, insErr?.message ?? 'insert custom field failed', 'SUPABASE_ERROR');
    }
    await bumpExpenseManagementVersion(orgId, clientId, ctx.user.id, currentExpenseManagementVersion);
    return inserted;
}
export async function deleteExpenseMgmtCustomField(ctx, orgId, clientId, fieldId, currentExpenseManagementVersion) {
    const { data: row, error: findErr } = await supabaseAdmin
        .from('client_accounting_expense_mgmt_custom_fields')
        .select('id')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .eq('id', fieldId)
        .maybeSingle();
    if (findErr)
        throw new AppError(500, findErr.message ?? 'custom field lookup failed', 'SUPABASE_ERROR');
    if (!row)
        throw badRequest('שדה לא נמצא');
    const { error: delErr } = await supabaseAdmin
        .from('client_accounting_expense_mgmt_custom_fields')
        .delete()
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .eq('id', fieldId);
    if (delErr)
        throw new AppError(500, delErr.message ?? 'delete custom field failed', 'SUPABASE_ERROR');
    await bumpExpenseManagementVersion(orgId, clientId, ctx.user.id, currentExpenseManagementVersion);
}
export async function applyExpenseMgmtCustomFieldValuesFromBody(ctx, orgId, clientId, body) {
    const rows = await loadExpenseMgmtCustomFields(orgId, clientId);
    const byKey = new Map(rows.map((r) => [r.field_key, r]));
    for (const [k, v] of Object.entries(body)) {
        if (!k.startsWith('em_cf_'))
            continue;
        const row = byKey.get(k);
        if (!row)
            continue;
        const patch = { updated_by: ctx.user.id };
        const nft = normalizeExpenseMgmtFieldType(row.field_type);
        if (nft === 'text') {
            const s = toStrOrNull(v);
            if (s && s.length > 2000)
                throw badRequest(`ערך ארוך מדי לשדה ${row.label_he}`);
            patch.value_text = s;
            patch.value_enum = null;
            patch.value_bool = null;
            patch.value_selected_json = null;
        }
        else if (nft === 'enum_single') {
            const s = toStrOrNull(v);
            const opts = parseExpenseMgmtOptionsJson(row.options_json);
            if (s && !opts.includes(s))
                throw badRequest(`ערך לא חוקי לשדה ${row.label_he}`);
            patch.value_enum = s;
            patch.value_text = null;
            patch.value_bool = null;
            patch.value_selected_json = null;
        }
        else if (nft === 'enum_multi') {
            let arr = [];
            if (Array.isArray(v)) {
                arr = v.map((x) => String(x).trim()).filter((s) => s.length > 0);
            }
            else if (typeof v === 'string' && String(v).trim()) {
                try {
                    const p = JSON.parse(String(v));
                    if (Array.isArray(p))
                        arr = p.map((x) => String(x).trim()).filter((s) => s.length > 0);
                    else
                        throw new Error('not array');
                }
                catch {
                    throw badRequest(`ערך לא חוקי לשדה ${row.label_he}`);
                }
            }
            else if (v == null || v === '') {
                arr = [];
            }
            else {
                throw badRequest(`ערך לא חוקי לשדה ${row.label_he}`);
            }
            const opts = parseExpenseMgmtOptionsJson(row.options_json);
            for (const s of arr) {
                if (!opts.includes(s))
                    throw badRequest(`ערך לא חוקי לשדה ${row.label_he}`);
            }
            patch.value_selected_json = arr.length ? arr : null;
            patch.value_text = null;
            patch.value_enum = null;
            patch.value_bool = null;
        }
        else {
            let b = null;
            if (typeof v === 'boolean')
                b = v;
            else if (v === 'true' || v === true)
                b = true;
            else if (v === 'false' || v === false)
                b = false;
            else if (v == null || v === '')
                b = null;
            else
                throw badRequest(`ערך לא חוקי לשדה ${row.label_he}`);
            patch.value_bool = b;
            patch.value_text = null;
            patch.value_enum = null;
            patch.value_selected_json = null;
        }
        const { error: uErr } = await supabaseAdmin
            .from('client_accounting_expense_mgmt_custom_fields')
            .update(patch)
            .eq('organization_id', orgId)
            .eq('client_id', clientId)
            .eq('id', row.id);
        if (uErr)
            throw new AppError(500, uErr.message ?? 'custom field value update failed', 'SUPABASE_ERROR');
    }
}

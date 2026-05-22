/**
 * Income document recipients (buyers) — scoped to active issuer, not Core clients.
 */
import { supabaseAdmin } from '../../db/client.js';
import { buildRecipientAddressJson, buildRecipientSnapshotJson, recipientDisplayLine, } from './income-recipient.validation.js';
function applyIssuerScopeToCustomersQuery(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
query, scope) {
    let q = query
        .eq('organization_id', scope.org_id)
        .eq('issuer_business_id', scope.issuer_business_id)
        .eq('status', 'active')
        .eq('is_one_time', false);
    if (scope.represented_client_id === null) {
        q = q.is('represented_client_id', null);
    }
    else {
        q = q.eq('represented_client_id', scope.represented_client_id);
    }
    return q;
}
function escapeIlikePattern(q) {
    return q.replace(/[%_\\]/g, '\\$&');
}
function addressPartsFromJson(address_json) {
    if (!address_json || typeof address_json !== 'object') {
        return { address_line: null, city: null };
    }
    const address = typeof address_json.address === 'string'
        ? address_json.address
        : typeof address_json.line1 === 'string'
            ? address_json.line1
            : null;
    const city = typeof address_json.city === 'string' ? address_json.city : null;
    return { address_line: address, city };
}
function mapCustomerRow(row) {
    const { address_line, city } = addressPartsFromJson(row.address_json);
    return {
        income_customer_id: row.id,
        display_name: row.display_name,
        tax_id: row.tax_id,
        phone: row.phone,
        email: row.email,
        address_line,
        city,
        display_line: recipientDisplayLine(row),
    };
}
export function buildRecipientCreateFieldsSchema() {
    return [
        { key: 'display_name', label: 'שם', required: true, input_type: 'text', placeholder: null },
        {
            key: 'tax_id',
            label: 'ח.פ / ע.מ',
            required: false,
            input_type: 'text',
            placeholder: null,
        },
        { key: 'phone', label: 'טלפון', required: false, input_type: 'text', placeholder: null },
        { key: 'email', label: 'אימייל', required: false, input_type: 'text', placeholder: null },
        { key: 'address', label: 'כתובת', required: false, input_type: 'text', placeholder: null },
        { key: 'city', label: 'עיר', required: false, input_type: 'text', placeholder: null },
        {
            key: 'save_for_future',
            label: 'שמור לשימוש עתידי',
            required: false,
            input_type: 'checkbox',
            placeholder: null,
        },
    ];
}
export function recipientSearchAllowedActions(perms) {
    const actions = [];
    if (perms.edit) {
        actions.push('search_income_recipients', 'select_income_recipient', 'set_income_recipient_snapshot', 'save_income_recipient_for_future');
    }
    return actions;
}
async function loadCustomerRows(scope, limit) {
    let query = supabaseAdmin
        .from('income_customers')
        .select('id, display_name, tax_id, phone, email, address_json, updated_at')
        .order('updated_at', { ascending: false })
        .limit(limit);
    query = applyIssuerScopeToCustomersQuery(query, scope);
    const { data, error } = await query;
    if (error)
        throw error;
    return (data ?? []);
}
export async function loadRecentIncomeRecipients(scope, limit = 8) {
    const rows = await loadCustomerRows(scope, limit);
    return rows.map(mapCustomerRow);
}
export async function searchIncomeRecipients(scope, queryText, limit = 20) {
    const q = queryText.trim();
    if (!q)
        return loadRecentIncomeRecipients(scope, limit);
    const pattern = `%${escapeIlikePattern(q)}%`;
    let query = supabaseAdmin
        .from('income_customers')
        .select('id, display_name, tax_id, phone, email, address_json, updated_at')
        .or(`display_name.ilike.${pattern},tax_id.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`)
        .order('display_name', { ascending: true })
        .limit(limit);
    query = applyIssuerScopeToCustomersQuery(query, scope);
    const { data, error } = await query;
    if (error)
        throw error;
    return (data ?? []).map((row) => mapCustomerRow(row));
}
export async function loadIncomeRecipientById(scope, incomeCustomerId) {
    let query = supabaseAdmin
        .from('income_customers')
        .select('id, display_name, tax_id, phone, email, address_json')
        .eq('id', incomeCustomerId);
    query = applyIssuerScopeToCustomersQuery(query, scope);
    const { data, error } = await query.maybeSingle();
    if (error)
        throw error;
    if (!data)
        return null;
    return mapCustomerRow(data);
}
export function selectedFromSavedRow(row) {
    return {
        kind: 'saved',
        income_customer_id: row.income_customer_id,
        display_line: row.display_line,
        snapshot: null,
    };
}
export function selectedFromInputFields(fields) {
    return {
        kind: 'snapshot',
        income_customer_id: null,
        display_line: recipientDisplayLine(fields),
        snapshot: buildRecipientSnapshotJson(fields),
    };
}
export async function buildIncomeRecipientSearchModel(scope, perms, overlay = {}) {
    const searchQuery = overlay.search_query ?? '';
    const recent_recipients = await loadRecentIncomeRecipients(scope);
    const search_results = overlay.search_results ??
        (searchQuery.trim() ? await searchIncomeRecipients(scope, searchQuery) : recent_recipients);
    const canEdit = perms.edit;
    return {
        label: 'מקבל המסמך',
        placeholder: 'חיפוש לפי שם / ח.פ / ע.מ / טלפון / אימייל',
        recent_recipients,
        search_results,
        empty_state: {
            visible: searchQuery.trim().length > 0 && search_results.length === 0,
            message: 'לא נמצאו מקבלים שמורים',
        },
        create_new_action: {
            label: '+ יצירת מקבל חדש',
            enabled: canEdit,
            disabled_reason: canEdit ? null : 'נדרשת הרשאת income.edit',
        },
        create_fields_schema: buildRecipientCreateFieldsSchema(),
        save_for_future_label: 'שמור לשימוש עתידי',
        save_for_future_available: canEdit,
        selected: overlay.selected ?? null,
        field_errors: overlay.field_errors ?? {},
        allowed_actions: recipientSearchAllowedActions(perms),
    };
}
export async function insertSavedIncomeRecipient(scope, fields, actorUserId) {
    const address_json = buildRecipientAddressJson(fields);
    const { data, error } = await supabaseAdmin
        .from('income_customers')
        .insert({
        organization_id: scope.org_id,
        represented_client_id: scope.represented_client_id,
        issuer_business_id: scope.issuer_business_id,
        display_name: fields.display_name,
        phone: fields.phone,
        email: fields.email,
        tax_id: fields.tax_id,
        address_json,
        is_one_time: false,
        status: 'active',
        created_by_user_id: actorUserId,
    })
        .select('id, display_name, tax_id, phone, email, address_json')
        .single();
    if (error)
        throw error;
    return mapCustomerRow(data);
}

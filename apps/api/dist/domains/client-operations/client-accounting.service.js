import { supabaseAdmin } from '../../db/client.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
const MAX_VEHICLES = 10;
function assertOrg(ctx) {
    const orgId = ctx.organizationId;
    if (!orgId)
        throw forbidden('Active organization required');
    return orgId;
}
async function insertAccountingEventLog(params) {
    const { error } = await supabaseAdmin.from('client_accounting_event_log').insert({
        organization_id: params.organizationId,
        client_id: params.clientId,
        user_id: params.userId,
        action_type: params.actionType,
        detail: params.detail == null || params.detail === '' ? null : params.detail.slice(0, 2000),
    });
    if (error) {
        console.error('[client-accounting] event_log insert failed:', error.message);
    }
}
function parseDateOnlyOptional(v) {
    if (v === undefined || v === null)
        return null;
    if (typeof v !== 'string')
        throw badRequest('תאריך לא חוקי');
    const s = v.trim();
    if (!s)
        return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s))
        throw badRequest('תאריך לא חוקי');
    const d = new Date(`${s}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime()))
        throw badRequest('תאריך לא חוקי');
    return s;
}
function normalizeOptString(v) {
    if (v === undefined || v === null)
        return null;
    if (typeof v !== 'string')
        return null;
    const s = v.trim();
    return s === '' ? null : s;
}
async function loadProfessionRules() {
    const { data, error } = await supabaseAdmin
        .from('accounting_vehicle_profession_rules')
        .select('profession_name, vehicle_vat_percent_default, applies_automatic_default')
        .order('sort_order', { ascending: true });
    if (error)
        throw new AppError(500, error.message ?? 'accounting_vehicle_profession_rules read failed', 'SUPABASE_ERROR');
    return (data ?? []);
}
function matchProfessionRule(occupationField, rules) {
    const o = (occupationField ?? '').trim();
    if (!o)
        return null;
    for (const r of rules) {
        if (String(r.profession_name).trim() === o)
            return r;
    }
    return null;
}
function effectiveVatPercent(stored, rule) {
    if (rule?.applies_automatic_default) {
        return Number(rule.vehicle_vat_percent_default);
    }
    return stored;
}
/** Stored value to persist when saving vehicles (respect profession rule on write) */
function vatPercentToStore(clientSent, rule) {
    if (rule?.applies_automatic_default) {
        return Number(rule.vehicle_vat_percent_default);
    }
    if (clientSent === undefined || clientSent === null)
        return null;
    const n = Number(clientSent);
    if (Number.isNaN(n))
        return null;
    return n;
}
async function getOrCreateSettingsRow(orgId, clientId) {
    const { data: existing, error: readErr } = await supabaseAdmin
        .from('client_accounting_settings')
        .select('occupation_field, business_opened_on, business_closed_on, has_vehicles')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .maybeSingle();
    if (readErr)
        throw new AppError(500, readErr.message ?? 'client_accounting_settings read failed', 'SUPABASE_ERROR');
    if (existing) {
        const r = existing;
        return {
            occupation_field: r.occupation_field ?? null,
            business_opened_on: r.business_opened_on ?? null,
            business_closed_on: r.business_closed_on ?? null,
            has_vehicles: Boolean(r.has_vehicles),
        };
    }
    const { error: insErr } = await supabaseAdmin.from('client_accounting_settings').insert({
        organization_id: orgId,
        client_id: clientId,
        occupation_field: null,
        business_opened_on: null,
        business_closed_on: null,
        has_vehicles: false,
    });
    if (insErr)
        throw new AppError(500, insErr.message ?? 'client_accounting_settings insert failed', 'SUPABASE_ERROR');
    return {
        occupation_field: null,
        business_opened_on: null,
        business_closed_on: null,
        has_vehicles: false,
    };
}
function mapVehicleRow(v, rule) {
    const storedVat = v.recognized_vat_percent != null && v.recognized_vat_percent !== ''
        ? Number(v.recognized_vat_percent)
        : null;
    const storedExp = v.recognized_expense_percent != null && v.recognized_expense_percent !== ''
        ? Number(v.recognized_expense_percent)
        : null;
    return {
        id: String(v.id),
        sort_order: Number(v.sort_order),
        vehicle_kind: v.vehicle_kind,
        license_plate: v.license_plate ?? null,
        manufacture_year: v.manufacture_year != null && v.manufacture_year !== '' ? Number(v.manufacture_year) : null,
        engine_type: v.engine_type,
        compulsory_insurance_from: v.compulsory_insurance_from ?? null,
        compulsory_insurance_to: v.compulsory_insurance_to ?? null,
        comprehensive_insurance_from: v.comprehensive_insurance_from ?? null,
        comprehensive_insurance_to: v.comprehensive_insurance_to ?? null,
        recognized_vat_percent: effectiveVatPercent(storedVat != null && !Number.isNaN(storedVat) ? storedVat : null, rule),
        recognized_expense_percent: storedExp != null && !Number.isNaN(storedExp) ? storedExp : null,
    };
}
export async function getClientAccountingBundle(ctx, clientId) {
    const orgId = assertOrg(ctx);
    const { data: client } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('organization_id', orgId)
        .eq('id', clientId)
        .maybeSingle();
    if (!client)
        throw forbidden('Client not found');
    const rules = await loadProfessionRules();
    const row = await getOrCreateSettingsRow(orgId, clientId);
    const matchedRule = matchProfessionRule(row.occupation_field, rules);
    const { data: vehiclesRaw, error: vErr } = await supabaseAdmin
        .from('client_accounting_vehicles')
        .select('*')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .order('sort_order', { ascending: true });
    if (vErr)
        throw new AppError(500, vErr.message ?? 'client_accounting_vehicles read failed', 'SUPABASE_ERROR');
    const vehicles = (vehiclesRaw ?? []).map((v) => mapVehicleRow(v, matchedRule));
    return {
        settings: {
            occupation_field: row.occupation_field,
            business_opened_on: row.business_opened_on,
            business_closed_on: row.business_closed_on,
            has_vehicles: row.has_vehicles,
            profession_vehicle_vat_rule: matchedRule
                ? {
                    profession_name: matchedRule.profession_name,
                    vehicle_vat_percent_default: Number(matchedRule.vehicle_vat_percent_default),
                    applies_automatic_default: Boolean(matchedRule.applies_automatic_default),
                }
                : null,
        },
        vehicles,
        profession_rule_names: rules.map((r) => r.profession_name),
    };
}
export async function updateClientAccountingGeneral(ctx, clientId, body) {
    const orgId = assertOrg(ctx);
    const userId = ctx.user.id;
    const { data: client } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('organization_id', orgId)
        .eq('id', clientId)
        .maybeSingle();
    if (!client)
        throw forbidden('Client not found');
    await getOrCreateSettingsRow(orgId, clientId);
    const patch = { updated_at: new Date().toISOString() };
    if (body.occupation_field !== undefined) {
        if (body.occupation_field === null || body.occupation_field === '') {
            patch.occupation_field = null;
        }
        else {
            patch.occupation_field = String(body.occupation_field).trim();
        }
    }
    if (body.business_opened_on !== undefined) {
        patch.business_opened_on =
            body.business_opened_on === null || body.business_opened_on === ''
                ? null
                : parseDateOnlyOptional(body.business_opened_on);
    }
    if (body.business_closed_on !== undefined) {
        patch.business_closed_on =
            body.business_closed_on === null || body.business_closed_on === ''
                ? null
                : parseDateOnlyOptional(body.business_closed_on);
    }
    if (body.has_vehicles !== undefined) {
        const hv = Boolean(body.has_vehicles);
        patch.has_vehicles = hv;
        if (!hv) {
            const { error: delErr } = await supabaseAdmin
                .from('client_accounting_vehicles')
                .delete()
                .eq('organization_id', orgId)
                .eq('client_id', clientId);
            if (delErr)
                throw new AppError(500, delErr.message ?? 'vehicles delete failed', 'SUPABASE_ERROR');
        }
    }
    const { error } = await supabaseAdmin
        .from('client_accounting_settings')
        .update(patch)
        .eq('organization_id', orgId)
        .eq('client_id', clientId);
    if (error)
        throw new AppError(500, error.message ?? 'client_accounting_settings update failed', 'SUPABASE_ERROR');
    await insertAccountingEventLog({
        organizationId: orgId,
        clientId,
        userId,
        actionType: 'accounting_settings_updated',
        detail: JSON.stringify(Object.keys(body)),
    });
    await writeAudit({
        organizationId: orgId,
        actorUserId: userId,
        moduleCode: 'client-operations',
        entityType: 'client_accounting_settings',
        entityId: clientId,
        action: AUDIT_ACTIONS.CLIENT_ACCOUNTING_SETTINGS_UPDATED,
        payload: { client_id: clientId },
    });
    return getClientAccountingBundle(ctx, clientId);
}
const ALLOW_KIND = new Set(['business', 'private']);
const ALLOW_ENGINE = new Set(['diesel', 'gasoline', 'electric']);
export async function replaceClientAccountingVehicles(ctx, clientId, body) {
    const orgId = assertOrg(ctx);
    const userId = ctx.user.id;
    const { data: client } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('organization_id', orgId)
        .eq('id', clientId)
        .maybeSingle();
    if (!client)
        throw forbidden('Client not found');
    const settings = await getOrCreateSettingsRow(orgId, clientId);
    if (!settings.has_vehicles) {
        throw badRequest('יש להפעיל "יש רכבים בעסק" לפני שמירת רכבים');
    }
    const vehicles = body.vehicles ?? [];
    if (vehicles.length > MAX_VEHICLES) {
        throw badRequest(`ניתן לשמור עד ${MAX_VEHICLES} רכבים`);
    }
    const rules = await loadProfessionRules();
    const matchedRule = matchProfessionRule(settings.occupation_field, rules);
    const { error: delErr } = await supabaseAdmin
        .from('client_accounting_vehicles')
        .delete()
        .eq('organization_id', orgId)
        .eq('client_id', clientId);
    if (delErr)
        throw new AppError(500, delErr.message ?? 'vehicles delete failed', 'SUPABASE_ERROR');
    const rows = [];
    for (let idx = 0; idx < vehicles.length; idx++) {
        const v = vehicles[idx];
        if (!ALLOW_KIND.has(v.vehicle_kind))
            throw badRequest('סוג רכב לא חוקי');
        if (!ALLOW_ENGINE.has(v.engine_type))
            throw badRequest('סוג הנעה לא חוקי');
        const year = v.manufacture_year === undefined || v.manufacture_year === null
            ? null
            : Number(v.manufacture_year);
        if (year != null && (Number.isNaN(year) || year < 1900 || year > 2100)) {
            throw badRequest('שנת ייצור לא חוקית');
        }
        let exp = v.recognized_expense_percent;
        if (exp !== undefined && exp !== null) {
            const n = Number(exp);
            if (Number.isNaN(n) || n < 0 || n > 100)
                throw badRequest('אחוז הוצאה מוכרת לא חוקי');
        }
        else {
            exp = null;
        }
        const vatStored = vatPercentToStore(v.recognized_vat_percent === undefined ? null : v.recognized_vat_percent === null ? null : Number(v.recognized_vat_percent), matchedRule);
        if (!matchedRule?.applies_automatic_default && v.recognized_vat_percent != null) {
            const n = Number(v.recognized_vat_percent);
            if (Number.isNaN(n) || n < 0 || n > 100)
                throw badRequest('אחוז מע״מ מוכר לא חוקי');
        }
        rows.push({
            organization_id: orgId,
            client_id: clientId,
            sort_order: idx,
            vehicle_kind: v.vehicle_kind,
            license_plate: normalizeOptString(v.license_plate),
            manufacture_year: year,
            engine_type: v.engine_type,
            compulsory_insurance_from: parseDateOnlyOptional(v.compulsory_insurance_from ?? null),
            compulsory_insurance_to: parseDateOnlyOptional(v.compulsory_insurance_to ?? null),
            comprehensive_insurance_from: parseDateOnlyOptional(v.comprehensive_insurance_from ?? null),
            comprehensive_insurance_to: parseDateOnlyOptional(v.comprehensive_insurance_to ?? null),
            recognized_vat_percent: vatStored,
            recognized_expense_percent: exp,
        });
    }
    if (rows.length > 0) {
        const { error: insErr } = await supabaseAdmin.from('client_accounting_vehicles').insert(rows);
        if (insErr)
            throw new AppError(500, insErr.message ?? 'vehicles insert failed', 'SUPABASE_ERROR');
    }
    await insertAccountingEventLog({
        organizationId: orgId,
        clientId,
        userId,
        actionType: 'vehicles_replaced',
        detail: `count=${rows.length}`,
    });
    await writeAudit({
        organizationId: orgId,
        actorUserId: userId,
        moduleCode: 'client-operations',
        entityType: 'client_accounting_vehicles',
        entityId: clientId,
        action: AUDIT_ACTIONS.CLIENT_ACCOUNTING_VEHICLES_REPLACED,
        payload: { client_id: clientId, vehicle_count: rows.length },
    });
    return getClientAccountingBundle(ctx, clientId);
}

import { supabaseAdmin } from '../../db/client.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { listCountryPacksByCountry } from './country-pack.service.js';
import { resolveActiveRulesetByDate } from './ruleset.service.js';
import { buildOwnerLegalValueRulesetLabel, ownerLegalValueRulesetMissingMessage, } from './owner-legal-value-ruleset.pure.js';
/**
 * Internal-only legal value resolvers.
 */
export async function getLegalValueByKey(countryCode, key) {
    const { data, error } = await supabaseAdmin
        .from('country_legal_values')
        .select('*')
        .eq('country_code', countryCode)
        .eq('value_key', key)
        .maybeSingle();
    if (error)
        throw error;
    return data ?? null;
}
export async function resolveLegalValue(countryCode, key, date, rulesetId) {
    const legalValue = await getLegalValueByKey(countryCode, key);
    if (!legalValue)
        return null;
    const { data, error } = await supabaseAdmin
        .from('country_legal_value_versions')
        .select('*')
        .eq('legal_value_id', legalValue.id)
        .eq('country_pack_ruleset_id', rulesetId)
        .eq('status', 'active')
        .lte('effective_from', date)
        .or(`effective_to.is.null,effective_to.gte.${date}`)
        .order('effective_from', { ascending: false })
        .limit(2);
    if (error)
        throw error;
    const rows = (data ?? []);
    if (rows.length > 1) {
        throw conflict(`More than one active legal value version resolved for key ${key}`);
    }
    return rows[0] ?? null;
}
export async function assertNoOverlapLegalValueVersions(input) {
    if (!input.effectiveFrom?.trim()) {
        throw badRequest('effective_from is required');
    }
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
        throw badRequest('effective_to must be >= effective_from');
    }
    const { data, error } = await supabaseAdmin
        .from('country_legal_value_versions')
        .select('id, effective_from, effective_to')
        .eq('legal_value_id', input.legalValueId)
        .eq('status', 'active');
    if (error)
        throw error;
    const overlaps = (data ?? []).some((row) => {
        if (input.excludeVersionId && row.id === input.excludeVersionId)
            return false;
        const rowStart = row.effective_from;
        const rowEnd = row.effective_to ?? '9999-12-31';
        const nextStart = input.effectiveFrom;
        const nextEnd = input.effectiveTo ?? '9999-12-31';
        return nextStart <= rowEnd && rowStart <= nextEnd;
    });
    if (overlaps) {
        throw conflict('Legal value version effective dates overlap an existing active version');
    }
}
export async function assertLegalValueExists(countryCode, key) {
    const legalValue = await getLegalValueByKey(countryCode, key);
    if (!legalValue)
        throw notFound('Legal value not found');
    return legalValue;
}
export async function resolveOwnerLegalValueRulesetContextForCountry(params) {
    const countryCode = params.countryCode.trim().toUpperCase();
    const date = params.effectiveDate.trim() || new Date().toISOString().slice(0, 10);
    const [{ data: countryRow }, packs] = await Promise.all([
        supabaseAdmin.from('countries').select('code, name').eq('code', countryCode).maybeSingle(),
        listCountryPacksByCountry(countryCode),
    ]);
    const enabledPacks = packs.filter((pack) => pack.status === 'enabled');
    for (const pack of enabledPacks) {
        const ruleset = await resolveActiveRulesetByDate(pack.id, date);
        if (!ruleset)
            continue;
        return {
            country_code: countryCode,
            country_name: String(countryRow?.name ?? countryCode),
            country_pack_id: pack.id,
            country_pack_name: pack.name,
            active_ruleset_id: ruleset.id,
            ruleset_code: ruleset.ruleset_code,
            ruleset_version: ruleset.ruleset_version,
            ruleset_label: buildOwnerLegalValueRulesetLabel({
                countryName: String(countryRow?.name ?? countryCode),
                packName: pack.name,
                rulesetCode: ruleset.ruleset_code,
                rulesetVersion: ruleset.ruleset_version,
            }),
        };
    }
    throw badRequest(ownerLegalValueRulesetMissingMessage(countryCode));
}

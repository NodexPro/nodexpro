import { supabaseAdmin } from '../../db/client.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
/**
 * Internal-only ruleset readers and overlap guards.
 */
export async function getRulesetById(rulesetId) {
    const { data, error } = await supabaseAdmin
        .from('country_pack_rulesets')
        .select('*')
        .eq('id', rulesetId)
        .maybeSingle();
    if (error)
        throw error;
    return data ?? null;
}
export async function resolveActiveRulesetByDate(countryPackId, date) {
    const { data, error } = await supabaseAdmin
        .from('country_pack_rulesets')
        .select('*')
        .eq('country_pack_id', countryPackId)
        .eq('status', 'active')
        .lte('effective_from', date)
        .or(`effective_to.is.null,effective_to.gte.${date}`)
        .order('effective_from', { ascending: false })
        .limit(2);
    if (error)
        throw error;
    const rows = (data ?? []);
    if (rows.length > 1) {
        throw conflict('More than one active ruleset resolved for date');
    }
    return rows[0] ?? null;
}
export async function assertNoOverlapRuleset(input) {
    if (!input.effectiveFrom?.trim()) {
        throw badRequest('effective_from is required');
    }
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
        throw badRequest('effective_to must be >= effective_from');
    }
    const { data, error } = await supabaseAdmin
        .from('country_pack_rulesets')
        .select('id, effective_from, effective_to')
        .eq('country_pack_id', input.countryPackId)
        .eq('status', 'active');
    if (error)
        throw error;
    const overlaps = (data ?? []).some((row) => {
        if (input.excludeRulesetId && row.id === input.excludeRulesetId)
            return false;
        const rowStart = row.effective_from;
        const rowEnd = row.effective_to ?? '9999-12-31';
        const nextStart = input.effectiveFrom;
        const nextEnd = input.effectiveTo ?? '9999-12-31';
        return nextStart <= rowEnd && rowStart <= nextEnd;
    });
    if (overlaps) {
        throw conflict('Ruleset effective dates overlap an existing active ruleset');
    }
}
export async function assertRulesetExists(rulesetId) {
    const ruleset = await getRulesetById(rulesetId);
    if (!ruleset)
        throw notFound('Ruleset not found');
    return ruleset;
}

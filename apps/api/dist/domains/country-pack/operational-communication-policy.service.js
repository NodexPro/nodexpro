import { resolveOrganizationActiveRuleset } from './organization-country.service.js';
import { supabaseAdmin } from '../../db/client.js';
import { OPERATIONAL_COMMUNICATION_POLICIES_CATEGORY, isOperationalReminderPolicyPayload, isOperationalReminderTemplatePayload, assertValidOperationalReminderPolicyPayload, assertValidOperationalReminderTemplatePayload, } from './operational-communication-owner-payload.js';
export { renderReminderTemplate } from './operational-communication-owner-payload.js';
export const DEFAULT_REMINDER_POLICY_VALUE_KEY = 'comm.reminder.policy';
export async function resolveOperationalCommunicationPolicies(organizationId, asOfDate) {
    const base = await resolveOrganizationActiveRuleset(organizationId, asOfDate);
    const warnings = [];
    if (base.warning)
        warnings.push(base.warning);
    if (!base.country_code || !base.ruleset_id) {
        warnings.push('operational_communication_policy_unresolved_no_ruleset');
        return {
            country_code: base.country_code,
            ruleset_id: base.ruleset_id,
            policy_version_id: null,
            active_reminder_policy: null,
            templates_by_key: {},
            warnings,
        };
    }
    const { data, error } = await supabaseAdmin
        .from('country_legal_value_versions')
        .select('id, value_payload_json, country_legal_values!inner(value_key, country_code, category, module_scope)')
        .eq('country_pack_ruleset_id', base.ruleset_id)
        .eq('status', 'active')
        .eq('country_legal_values.category', OPERATIONAL_COMMUNICATION_POLICIES_CATEGORY)
        .lte('effective_from', asOfDate)
        .or(`effective_to.is.null,effective_to.gte.${asOfDate}`);
    if (error)
        throw error;
    let policyVersionId = null;
    let activePolicy = null;
    const templatesByKey = {};
    for (const row of data ?? []) {
        const joined = Array.isArray(row.country_legal_values)
            ? row.country_legal_values[0]
            : row.country_legal_values;
        if (!joined || joined.country_code !== base.country_code) {
            warnings.push('operational_communication_country_mismatch');
            continue;
        }
        const versionId = String(row.id);
        const valueKey = String(joined.value_key ?? '');
        const vpj = row.value_payload_json;
        if (isOperationalReminderPolicyPayload(vpj)) {
            try {
                const normalized = assertValidOperationalReminderPolicyPayload(vpj);
                if (valueKey === DEFAULT_REMINDER_POLICY_VALUE_KEY || !activePolicy) {
                    activePolicy = normalized;
                    policyVersionId = versionId;
                }
            }
            catch (e) {
                warnings.push(`invalid_reminder_policy:${valueKey}:${e instanceof Error ? e.message : 'invalid'}`);
            }
            continue;
        }
        if (isOperationalReminderTemplatePayload(vpj)) {
            try {
                const normalized = assertValidOperationalReminderTemplatePayload(vpj);
                const list = templatesByKey[normalized.template_key] ?? [];
                list.push({
                    template_version_id: versionId,
                    template_key: normalized.template_key,
                    language: normalized.language,
                    channel: normalized.channel,
                    payload: normalized,
                });
                templatesByKey[normalized.template_key] = list;
            }
            catch (e) {
                warnings.push(`invalid_reminder_template:${valueKey}:${e instanceof Error ? e.message : 'invalid'}`);
            }
        }
    }
    if (!activePolicy) {
        warnings.push('operational_reminder_policy_missing');
    }
    return {
        country_code: base.country_code,
        ruleset_id: base.ruleset_id,
        policy_version_id: policyVersionId,
        active_reminder_policy: activePolicy,
        templates_by_key: templatesByKey,
        warnings,
    };
}

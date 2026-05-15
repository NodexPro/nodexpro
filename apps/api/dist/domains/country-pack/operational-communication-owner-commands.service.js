/**
 * Owner-friendly operational communication commands (Work Engine reminders).
 * Transforms smart forms → country_legal_values / versions. No raw CRUD fields in UI.
 */
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { assertCountryExists } from './country.service.js';
import { getCountryPack } from './country-pack.service.js';
import { assertRulesetExists } from './ruleset.service.js';
import { assertLegalValueExists, assertNoOverlapLegalValueVersions, getLegalValueByKey, } from './legal-value.service.js';
import { DEFAULT_REMINDER_POLICY_VALUE_KEY, parseOwnerReminderPolicyForm, parseOwnerReminderTemplateForm, } from './operational-communication-owner-form.js';
import { OPERATIONAL_COMMUNICATION_POLICIES_CATEGORY, assertOperationalCommunicationLegalValueMetadata, } from './operational-communication-owner-payload.js';
import { buildOwnerLegalControlPanelAggregate } from './country-pack-read-models.service.js';
function asString(value, field) {
    if (typeof value !== 'string' || !value.trim())
        throw badRequest(`${field} is required`);
    return value.trim();
}
function asOptionalString(value) {
    if (value === undefined || value === null)
        return null;
    if (typeof value !== 'string')
        throw badRequest('Invalid string value');
    const v = value.trim();
    return v.length ? v : null;
}
function asDate(value, field) {
    const v = asString(value, field);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v))
        throw badRequest(`${field} must be YYYY-MM-DD`);
    return v;
}
function asBool(value, defaultValue) {
    if (value === undefined || value === null)
        return defaultValue;
    if (typeof value === 'boolean')
        return value;
    if (value === 'true' || value === 1 || value === '1')
        return true;
    if (value === 'false' || value === 0 || value === '0')
        return false;
    return defaultValue;
}
async function audit(ctx, action, entityType, entityId, payload) {
    await writeAudit({
        organizationId: null,
        actorUserId: ctx.user.id,
        entityType,
        entityId,
        action,
        payload,
    });
}
async function refreshedPanel(ctx) {
    return {
        aggregate_key: 'owner_legal_control_panel_aggregate',
        aggregate: await buildOwnerLegalControlPanelAggregate(ctx),
    };
}
async function assertRulesetScope(countryCode, countryPackId, rulesetId) {
    const ruleset = await assertRulesetExists(rulesetId);
    const pack = await getCountryPack(ruleset.country_pack_id);
    if (!pack || pack.country_code !== countryCode) {
        throw conflict('Ruleset does not belong to the selected country');
    }
    if (countryPackId && pack.id !== countryPackId) {
        throw conflict('Ruleset does not belong to the selected country pack');
    }
}
async function ensureOperationalLegalValue(params) {
    const existing = await getLegalValueByKey(params.countryCode, params.valueKey);
    if (existing)
        return { id: existing.id, created: false };
    assertOperationalCommunicationLegalValueMetadata({
        category: OPERATIONAL_COMMUNICATION_POLICIES_CATEGORY,
        module_scope: 'work_engine',
        value_type: 'json',
        value_key: params.valueKey,
    });
    const { data, error } = await supabaseAdmin
        .from('country_legal_values')
        .insert({
        country_code: params.countryCode,
        value_key: params.valueKey,
        label: params.label,
        category: OPERATIONAL_COMMUNICATION_POLICIES_CATEGORY,
        module_scope: 'work_engine',
        value_type: 'json',
        status: 'active',
    })
        .select('id')
        .single();
    if (error)
        throw error;
    return { id: String(data.id), created: true };
}
async function insertLegalValueVersion(params) {
    await assertNoOverlapLegalValueVersions({
        legalValueId: params.legalValueId,
        effectiveFrom: params.effectiveFrom,
        effectiveTo: params.effectiveTo,
    });
    const { data, error } = await supabaseAdmin
        .from('country_legal_value_versions')
        .insert({
        legal_value_id: params.legalValueId,
        country_pack_ruleset_id: params.rulesetId,
        value_payload_json: params.valuePayloadJson,
        effective_from: params.effectiveFrom,
        effective_to: params.effectiveTo,
        status: params.status,
    })
        .select('id')
        .single();
    if (error)
        throw error;
    return String(data.id);
}
async function activateVersionIfRequested(ctx, versionId, activate) {
    if (!activate)
        return;
    const { error } = await supabaseAdmin
        .from('country_legal_value_versions')
        .update({ status: 'active' })
        .eq('id', versionId);
    if (error)
        throw error;
    await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_VERSION_ACTIVATED, 'country_legal_value_version', versionId, {});
}
function parseSaveScope(payload) {
    const countryCode = asString(payload.country_code, 'country_code').toUpperCase();
    const countryPackId = asOptionalString(payload.country_pack_id);
    const rulesetId = asString(payload.country_pack_ruleset_id, 'country_pack_ruleset_id');
    return {
        countryCode,
        countryPackId,
        rulesetId,
        effectiveFrom: asDate(payload.effective_from, 'effective_from'),
        effectiveTo: asOptionalString(payload.effective_to),
        activateAfterCreate: asBool(payload.activate_after_create, true),
    };
}
export async function handleSaveOperationalReminderPolicy(ctx, payload) {
    const scope = parseSaveScope(payload);
    await assertCountryExists(scope.countryCode);
    await assertRulesetScope(scope.countryCode, scope.countryPackId, scope.rulesetId);
    const policyPayload = parseOwnerReminderPolicyForm(payload.policy);
    const label = asOptionalString(payload.policy_label) ?? 'Work Engine reminder policy';
    const legal = await ensureOperationalLegalValue({
        countryCode: scope.countryCode,
        valueKey: DEFAULT_REMINDER_POLICY_VALUE_KEY,
        label,
    });
    if (legal.created) {
        await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_CREATED, 'country_legal_value', legal.id, {
            country_code: scope.countryCode,
            value_key: DEFAULT_REMINDER_POLICY_VALUE_KEY,
        });
    }
    const versionId = await insertLegalValueVersion({
        legalValueId: legal.id,
        rulesetId: scope.rulesetId,
        effectiveFrom: scope.effectiveFrom,
        effectiveTo: scope.effectiveTo,
        valuePayloadJson: policyPayload,
        status: scope.activateAfterCreate ? 'active' : 'draft',
    });
    await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_VERSION_CREATED, 'country_legal_value_version', versionId, {
        legal_value_id: legal.id,
        ruleset_id: scope.rulesetId,
        kind: 'operational_reminder_policy',
    });
    await activateVersionIfRequested(ctx, versionId, scope.activateAfterCreate);
    return {
        ok: true,
        command: 'save_operational_reminder_policy',
        refreshed: await refreshedPanel(ctx),
        meta: { legal_value_id: legal.id, legal_value_version_id: versionId, legal_value_created: legal.created },
    };
}
export async function handleSaveOperationalReminderTemplate(ctx, payload) {
    const scope = parseSaveScope(payload);
    await assertCountryExists(scope.countryCode);
    await assertRulesetScope(scope.countryCode, scope.countryPackId, scope.rulesetId);
    const { value_key: valueKey, payload: templatePayload } = parseOwnerReminderTemplateForm(payload.template);
    const label = asOptionalString(payload.template_label) ??
        `Reminder template (${templatePayload.workflow_type} / ${templatePayload.language})`;
    const legal = await ensureOperationalLegalValue({
        countryCode: scope.countryCode,
        valueKey,
        label,
    });
    if (legal.created) {
        await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_CREATED, 'country_legal_value', legal.id, {
            country_code: scope.countryCode,
            value_key: valueKey,
        });
    }
    const versionId = await insertLegalValueVersion({
        legalValueId: legal.id,
        rulesetId: scope.rulesetId,
        effectiveFrom: scope.effectiveFrom,
        effectiveTo: scope.effectiveTo,
        valuePayloadJson: templatePayload,
        status: scope.activateAfterCreate ? 'active' : 'draft',
    });
    await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_VERSION_CREATED, 'country_legal_value_version', versionId, {
        legal_value_id: legal.id,
        ruleset_id: scope.rulesetId,
        kind: 'operational_reminder_template',
        template_key: valueKey,
    });
    await activateVersionIfRequested(ctx, versionId, scope.activateAfterCreate);
    return {
        ok: true,
        command: 'save_operational_reminder_template',
        refreshed: await refreshedPanel(ctx),
        meta: {
            legal_value_id: legal.id,
            legal_value_version_id: versionId,
            template_key: valueKey,
            legal_value_created: legal.created,
        },
    };
}
export async function handleSaveOperationalReminderPolicyVersion(ctx, payload) {
    const scope = parseSaveScope(payload);
    await assertCountryExists(scope.countryCode);
    await assertRulesetScope(scope.countryCode, scope.countryPackId, scope.rulesetId);
    let legal;
    try {
        legal = await assertLegalValueExists(scope.countryCode, DEFAULT_REMINDER_POLICY_VALUE_KEY);
    }
    catch {
        throw notFound('Reminder policy legal value does not exist for this country. Create a policy first.', 'reminder_policy_legal_value_missing');
    }
    const policyPayload = parseOwnerReminderPolicyForm(payload.policy);
    const versionId = await insertLegalValueVersion({
        legalValueId: legal.id,
        rulesetId: scope.rulesetId,
        effectiveFrom: scope.effectiveFrom,
        effectiveTo: scope.effectiveTo,
        valuePayloadJson: policyPayload,
        status: scope.activateAfterCreate ? 'active' : 'draft',
    });
    await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_VERSION_CREATED, 'country_legal_value_version', versionId, {
        legal_value_id: legal.id,
        ruleset_id: scope.rulesetId,
        kind: 'operational_reminder_policy_version',
    });
    await activateVersionIfRequested(ctx, versionId, scope.activateAfterCreate);
    return {
        ok: true,
        command: 'save_operational_reminder_policy_version',
        refreshed: await refreshedPanel(ctx),
        meta: { legal_value_id: legal.id, legal_value_version_id: versionId },
    };
}
export async function handleSaveOperationalReminderTemplateVersion(ctx, payload) {
    const scope = parseSaveScope(payload);
    await assertCountryExists(scope.countryCode);
    await assertRulesetScope(scope.countryCode, scope.countryPackId, scope.rulesetId);
    const { value_key: valueKey, payload: templatePayload } = parseOwnerReminderTemplateForm(payload.template);
    let legal;
    try {
        legal = await assertLegalValueExists(scope.countryCode, valueKey);
    }
    catch {
        throw notFound('Reminder template legal value does not exist for this workflow/language. Create a template first.', 'reminder_template_legal_value_missing');
    }
    const versionId = await insertLegalValueVersion({
        legalValueId: legal.id,
        rulesetId: scope.rulesetId,
        effectiveFrom: scope.effectiveFrom,
        effectiveTo: scope.effectiveTo,
        valuePayloadJson: templatePayload,
        status: scope.activateAfterCreate ? 'active' : 'draft',
    });
    await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_VERSION_CREATED, 'country_legal_value_version', versionId, {
        legal_value_id: legal.id,
        ruleset_id: scope.rulesetId,
        kind: 'operational_reminder_template_version',
        template_key: valueKey,
    });
    await activateVersionIfRequested(ctx, versionId, scope.activateAfterCreate);
    return {
        ok: true,
        command: 'save_operational_reminder_template_version',
        refreshed: await refreshedPanel(ctx),
        meta: { legal_value_id: legal.id, legal_value_version_id: versionId, template_key: valueKey },
    };
}

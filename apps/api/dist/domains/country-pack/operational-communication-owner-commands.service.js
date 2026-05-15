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
import { DEFAULT_REMINDER_POLICY_VALUE_KEY, mergeReminderWorkflowIntoPolicy, parseOwnerReminderPolicyForm, parseOwnerReminderTemplateForm, parseOwnerReminderWorkflowForm, setWorkflowEnabledInPolicy, } from './operational-communication-owner-form.js';
import { OPERATIONAL_COMMUNICATION_POLICIES_CATEGORY, REMINDER_WORKFLOW_TYPES, assertOperationalCommunicationLegalValueMetadata, assertValidOperationalReminderPolicyPayload, isOperationalReminderPolicyPayload, } from './operational-communication-owner-payload.js';
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
function parseReminderWorkflowTypeField(raw) {
    if (typeof raw !== 'string' || !raw.trim()) {
        throw badRequest('workflow_type is required', 'invalid_workflow_type');
    }
    const v = raw.trim();
    if (!REMINDER_WORKFLOW_TYPES.includes(v)) {
        throw badRequest('workflow_type is invalid', 'invalid_workflow_type');
    }
    return v;
}
async function loadPolicyVersionContext(versionId) {
    const { data, error } = await supabaseAdmin
        .from('country_legal_value_versions')
        .select('id, legal_value_id, country_pack_ruleset_id, effective_from, effective_to, status, value_payload_json, country_legal_values!inner(country_code, value_key, category)')
        .eq('id', versionId)
        .maybeSingle();
    if (error)
        throw error;
    if (!data)
        throw notFound('Policy version not found', 'policy_version_not_found');
    const joined = data.country_legal_values;
    if (String(joined.category ?? '') !== OPERATIONAL_COMMUNICATION_POLICIES_CATEGORY) {
        throw badRequest('Version is not an operational reminder policy', 'invalid_policy_version');
    }
    if (String(joined.value_key ?? '') !== DEFAULT_REMINDER_POLICY_VALUE_KEY) {
        throw badRequest('Version is not the reminder policy legal value', 'invalid_policy_version');
    }
    const vpj = data.value_payload_json;
    if (!isOperationalReminderPolicyPayload(vpj)) {
        throw badRequest('Policy version payload is invalid', 'invalid_policy_payload');
    }
    const policy = assertValidOperationalReminderPolicyPayload(vpj);
    return {
        id: String(data.id),
        legal_value_id: String(data.legal_value_id),
        country_pack_ruleset_id: String(data.country_pack_ruleset_id),
        effective_from: String(data.effective_from),
        effective_to: data.effective_to == null ? null : String(data.effective_to),
        status: String(data.status),
        country_code: String(joined.country_code ?? '').toUpperCase(),
        policy,
    };
}
async function deactivateLegalValueVersionInPlace(ctx, versionId) {
    const { error } = await supabaseAdmin
        .from('country_legal_value_versions')
        .update({ status: 'disabled' })
        .eq('id', versionId);
    if (error)
        throw error;
    await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_VERSION_DEACTIVATED, 'country_legal_value_version', versionId, {});
}
async function activateLegalValueVersionInPlace(ctx, source) {
    await assertNoOverlapLegalValueVersions({
        legalValueId: source.legal_value_id,
        effectiveFrom: source.effective_from,
        effectiveTo: source.effective_to,
        excludeVersionId: source.id,
    });
    const { error } = await supabaseAdmin
        .from('country_legal_value_versions')
        .update({ status: 'active' })
        .eq('id', source.id);
    if (error)
        throw error;
    await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_VERSION_ACTIVATED, 'country_legal_value_version', source.id, {});
}
/** New active policy version; deactivates replaced active version (Country Pack version pattern). */
async function republishPolicyVersionWithPayload(ctx, source, newPolicy, auditMeta) {
    if (source.status === 'active') {
        await deactivateLegalValueVersionInPlace(ctx, source.id);
    }
    const newVersionId = await insertLegalValueVersion({
        legalValueId: source.legal_value_id,
        rulesetId: source.country_pack_ruleset_id,
        effectiveFrom: source.effective_from,
        effectiveTo: source.effective_to,
        valuePayloadJson: newPolicy,
        status: 'active',
    });
    await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_VERSION_CREATED, 'country_legal_value_version', newVersionId, {
        legal_value_id: source.legal_value_id,
        ruleset_id: source.country_pack_ruleset_id,
        kind: 'operational_reminder_policy',
        replaced_version_id: source.id,
        ...auditMeta,
    });
    await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_VERSION_ACTIVATED, 'country_legal_value_version', newVersionId, {});
    return newVersionId;
}
async function fetchLatestPolicyPayloadForRuleset(legalValueId, rulesetId) {
    const { data, error } = await supabaseAdmin
        .from('country_legal_value_versions')
        .select('value_payload_json, effective_from, created_at')
        .eq('legal_value_id', legalValueId)
        .eq('country_pack_ruleset_id', rulesetId)
        .order('effective_from', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1);
    if (error)
        throw error;
    const row = (data ?? [])[0];
    if (!row?.value_payload_json)
        return null;
    try {
        return parseOwnerReminderPolicyForm(row.value_payload_json);
    }
    catch {
        return null;
    }
}
export async function handleSaveOperationalReminderWorkflow(ctx, payload) {
    const scope = parseSaveScope(payload);
    await assertCountryExists(scope.countryCode);
    await assertRulesetScope(scope.countryCode, scope.countryPackId, scope.rulesetId);
    const parsed = parseOwnerReminderWorkflowForm(payload);
    const templateMeta = [];
    for (const tmpl of parsed.templates) {
        const legal = await ensureOperationalLegalValue({
            countryCode: scope.countryCode,
            valueKey: tmpl.value_key,
            label: tmpl.label,
        });
        if (legal.created) {
            await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_CREATED, 'country_legal_value', legal.id, {
                country_code: scope.countryCode,
                value_key: tmpl.value_key,
            });
        }
        const versionId = await insertLegalValueVersion({
            legalValueId: legal.id,
            rulesetId: scope.rulesetId,
            effectiveFrom: scope.effectiveFrom,
            effectiveTo: scope.effectiveTo,
            valuePayloadJson: tmpl.payload,
            status: scope.activateAfterCreate ? 'active' : 'draft',
        });
        await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_VERSION_CREATED, 'country_legal_value_version', versionId, {
            legal_value_id: legal.id,
            ruleset_id: scope.rulesetId,
            kind: 'operational_reminder_template',
            template_key: tmpl.value_key,
            source: 'save_operational_reminder_workflow',
        });
        await activateVersionIfRequested(ctx, versionId, scope.activateAfterCreate);
        templateMeta.push({ template_key: tmpl.value_key, legal_value_version_id: versionId, created: legal.created });
    }
    const policyLegal = await ensureOperationalLegalValue({
        countryCode: scope.countryCode,
        valueKey: DEFAULT_REMINDER_POLICY_VALUE_KEY,
        label: asOptionalString(payload.policy_label) ?? 'Work Engine reminder policy',
    });
    if (policyLegal.created) {
        await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_CREATED, 'country_legal_value', policyLegal.id, {
            country_code: scope.countryCode,
            value_key: DEFAULT_REMINDER_POLICY_VALUE_KEY,
        });
    }
    const existingPolicy = await fetchLatestPolicyPayloadForRuleset(policyLegal.id, scope.rulesetId);
    const mergedPolicy = mergeReminderWorkflowIntoPolicy(existingPolicy, parsed);
    const policyVersionId = await insertLegalValueVersion({
        legalValueId: policyLegal.id,
        rulesetId: scope.rulesetId,
        effectiveFrom: scope.effectiveFrom,
        effectiveTo: scope.effectiveTo,
        valuePayloadJson: mergedPolicy,
        status: scope.activateAfterCreate ? 'active' : 'draft',
    });
    await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_VERSION_CREATED, 'country_legal_value_version', policyVersionId, {
        legal_value_id: policyLegal.id,
        ruleset_id: scope.rulesetId,
        kind: 'operational_reminder_policy',
        workflow_type: parsed.workflow_type,
        source: 'save_operational_reminder_workflow',
    });
    await activateVersionIfRequested(ctx, policyVersionId, scope.activateAfterCreate);
    return {
        ok: true,
        command: 'save_operational_reminder_workflow',
        refreshed: await refreshedPanel(ctx),
        meta: {
            legal_value_id: policyLegal.id,
            legal_value_version_id: policyVersionId,
            workflow_type: parsed.workflow_type,
            reminder_count: parsed.policy_workflow.cadence_steps.length,
            templates: templateMeta,
            policy_merged_from_existing: existingPolicy !== null,
        },
    };
}
export async function handleEditOperationalReminderWorkflow(ctx, payload) {
    const out = await handleSaveOperationalReminderWorkflow(ctx, payload);
    return { ...out, command: 'edit_operational_reminder_workflow' };
}
export async function handleDisableOperationalReminderWorkflow(ctx, payload) {
    const versionId = asString(payload.policy_legal_value_version_id, 'policy_legal_value_version_id');
    const workflowType = parseReminderWorkflowTypeField(payload.workflow_type);
    const source = await loadPolicyVersionContext(versionId);
    const wf = source.policy.workflows.find((w) => w.workflow_type === workflowType);
    if (!wf?.enabled && source.status === 'active') {
        return {
            ok: true,
            command: 'disable_operational_reminder_workflow',
            refreshed: await refreshedPanel(ctx),
            meta: { workflow_type: workflowType, noop: true },
        };
    }
    const newPolicy = setWorkflowEnabledInPolicy(source.policy, workflowType, false);
    const newVersionId = await republishPolicyVersionWithPayload(ctx, source, newPolicy, {
        workflow_type: workflowType,
        workflow_enabled: false,
    });
    return {
        ok: true,
        command: 'disable_operational_reminder_workflow',
        refreshed: await refreshedPanel(ctx),
        meta: { legal_value_version_id: newVersionId, workflow_type: workflowType },
    };
}
export async function handleEnableOperationalReminderWorkflow(ctx, payload) {
    const versionId = asString(payload.policy_legal_value_version_id, 'policy_legal_value_version_id');
    const workflowType = parseReminderWorkflowTypeField(payload.workflow_type);
    const source = await loadPolicyVersionContext(versionId);
    const wf = source.policy.workflows.find((w) => w.workflow_type === workflowType);
    if (source.status !== 'active') {
        await activateLegalValueVersionInPlace(ctx, source);
        if (wf?.enabled) {
            return {
                ok: true,
                command: 'enable_operational_reminder_workflow',
                refreshed: await refreshedPanel(ctx),
                meta: { legal_value_version_id: source.id, workflow_type: workflowType, activated_version: true },
            };
        }
        const reloaded = await loadPolicyVersionContext(source.id);
        const newPolicy = setWorkflowEnabledInPolicy(reloaded.policy, workflowType, true);
        const newVersionId = await republishPolicyVersionWithPayload(ctx, reloaded, newPolicy, {
            workflow_type: workflowType,
            workflow_enabled: true,
        });
        return {
            ok: true,
            command: 'enable_operational_reminder_workflow',
            refreshed: await refreshedPanel(ctx),
            meta: { legal_value_version_id: newVersionId, workflow_type: workflowType },
        };
    }
    if (wf?.enabled) {
        return {
            ok: true,
            command: 'enable_operational_reminder_workflow',
            refreshed: await refreshedPanel(ctx),
            meta: { workflow_type: workflowType, noop: true },
        };
    }
    const newPolicy = setWorkflowEnabledInPolicy(source.policy, workflowType, true);
    const newVersionId = await republishPolicyVersionWithPayload(ctx, source, newPolicy, {
        workflow_type: workflowType,
        workflow_enabled: true,
    });
    return {
        ok: true,
        command: 'enable_operational_reminder_workflow',
        refreshed: await refreshedPanel(ctx),
        meta: { legal_value_version_id: newVersionId, workflow_type: workflowType },
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
    const parsedTemplate = parseOwnerReminderTemplateForm(payload.template);
    const { value_key: valueKey, payload: templatePayload } = parsedTemplate;
    const label = asOptionalString(payload.template_label) ??
        asOptionalString(payload.template?.template_display_name) ??
        `Reminder template (${templatePayload.workflow_type} / ${parsedTemplate.period_label} / ${templatePayload.language})`;
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
            legal_value_reused: !legal.created,
            period_slug: parsedTemplate.period_slug,
            friendly_message: legal.created
                ? 'New reminder template created.'
                : 'Existing template definition reused; a new version was added under the selected ruleset.',
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

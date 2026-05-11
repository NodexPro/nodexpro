import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { assertCountryExists } from './country.service.js';
import { getCountryPack } from './country-pack.service.js';
import { assertNoOverlapRuleset, assertRulesetExists, resolveActiveRulesetByDate } from './ruleset.service.js';
import { assertLegalValueExists, assertNoOverlapLegalValueVersions } from './legal-value.service.js';
import { isDocflowCommunicationOwnerPayload, normalizeLegalValuePayloadJsonInput, assertValidDocflowCommunicationOwnerPayload, } from './docflow-communication-owner-payload.js';
import { getOrganizationCountrySettings } from './organization-country.service.js';
import { buildOrganizationCountrySettingsAggregate, buildOwnerLegalControlPanelAggregate, } from './country-pack-read-models.service.js';
import { encryptOptionalSecret } from '../../shared/owner-email-provider-config.service.js';
import { saveOwnerEmailProviderConfigGlobal } from '../../shared/owner-email-provider-config.service.js';
import { saveOwnerEmailProviderConfigOrgOverride } from '../../shared/owner-email-provider-config.service.js';
import { savePlatformPublicUrlGlobal } from '../../shared/owner-email-provider-config.service.js';
async function refreshedOwnerLegalControlPanel(ctx) {
    return {
        aggregate_key: 'owner_legal_control_panel_aggregate',
        aggregate: await buildOwnerLegalControlPanelAggregate(ctx),
    };
}
function asString(value, field) {
    if (typeof value !== 'string' || !value.trim()) {
        throw badRequest(`${field} is required`);
    }
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        throw badRequest(`${field} must be YYYY-MM-DD`);
    }
    return v;
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
async function getOrganizationCountryCode(organizationId) {
    const { data, error } = await supabaseAdmin
        .from('organizations')
        .select('country_code')
        .eq('id', organizationId)
        .maybeSingle();
    if (error)
        throw error;
    if (!data?.country_code)
        throw notFound('Organization not found');
    return data.country_code;
}
async function handleCreateCountry(ctx, payload) {
    const code = asString(payload.code, 'code').toUpperCase();
    const name = asString(payload.name, 'name');
    const status = asString(payload.status ?? 'active', 'status');
    const defaultTimezone = asOptionalString(payload.default_timezone);
    const { data, error } = await supabaseAdmin
        .from('countries')
        .insert({ code, name, status, default_timezone: defaultTimezone })
        .select('*')
        .single();
    if (error)
        throw error;
    await audit(ctx, AUDIT_ACTIONS.COUNTRY_CREATED, 'country', data.code, { code, status });
    return {
        ok: true,
        command: 'create_country',
        refreshed: await refreshedOwnerLegalControlPanel(ctx),
    };
}
async function handleCreateCountryPack(ctx, payload) {
    const countryCode = asString(payload.country_code, 'country_code').toUpperCase();
    await assertCountryExists(countryCode);
    const insertPayload = {
        country_code: countryCode,
        pack_code: asString(payload.pack_code, 'pack_code'),
        name: asString(payload.name, 'name'),
        status: asString(payload.status ?? 'draft', 'status'),
        module_code: asOptionalString(payload.module_code),
        framework_version: asString(payload.framework_version, 'framework_version'),
        code_version: asString(payload.code_version, 'code_version'),
    };
    const { data, error } = await supabaseAdmin.from('country_packs').insert(insertPayload).select('*').single();
    if (error)
        throw error;
    await audit(ctx, AUDIT_ACTIONS.COUNTRY_PACK_CREATED, 'country_pack', data.id, { country_code: countryCode, pack_code: data.pack_code });
    return {
        ok: true,
        command: 'create_country_pack',
        refreshed: await refreshedOwnerLegalControlPanel(ctx),
    };
}
async function handleEnableDisablePack(ctx, payload, nextStatus, command, auditAction) {
    const rawPackId = typeof payload.country_pack_id === 'string' ? payload.country_pack_id.trim() : '';
    const rawPackCode = typeof payload.pack_code === 'string' ? payload.pack_code.trim() : '';
    let packId = rawPackId;
    if (!packId) {
        if (!rawPackCode) {
            throw badRequest('country_pack_id or pack_code is required');
        }
        const { data: rows, error } = await supabaseAdmin
            .from('country_packs')
            .select('id')
            .eq('pack_code', rawPackCode);
        if (error)
            throw error;
        if (!rows?.length)
            throw notFound('Country pack not found');
        if (rows.length > 1) {
            throw badRequest('pack_code matches multiple country packs; specify country_pack_id');
        }
        packId = String(rows[0].id);
    }
    const pack = await getCountryPack(packId);
    if (!pack)
        throw notFound('Country pack not found');
    const { error } = await supabaseAdmin.from('country_packs').update({ status: nextStatus }).eq('id', packId);
    if (error)
        throw error;
    await audit(ctx, auditAction, 'country_pack', packId, { previous_status: pack.status, status: nextStatus });
    return {
        ok: true,
        command,
        refreshed: await refreshedOwnerLegalControlPanel(ctx),
    };
}
async function resolveCountryPackIdForCreateRuleset(payload) {
    const idRaw = payload.country_pack_id;
    const hasId = typeof idRaw === 'string' && idRaw.trim() !== '';
    if (hasId) {
        return asString(idRaw, 'country_pack_id');
    }
    const codeRaw = payload.pack_code;
    if (typeof codeRaw !== 'string' || !codeRaw.trim()) {
        throw badRequest('country_pack_id or pack_code is required');
    }
    const packCode = codeRaw.trim();
    const { data: rows, error } = await supabaseAdmin.from('country_packs').select('id').eq('pack_code', packCode);
    if (error)
        throw error;
    if (!rows?.length)
        throw notFound('Country pack not found');
    if (rows.length > 1) {
        throw badRequest('pack_code matches multiple country packs; specify country_pack_id');
    }
    return rows[0].id;
}
async function handleCreateRuleset(ctx, payload) {
    const countryPackId = await resolveCountryPackIdForCreateRuleset(payload);
    await getCountryPack(countryPackId).then((p) => {
        if (!p)
            throw notFound('Country pack not found');
    });
    const effectiveFrom = asDate(payload.effective_from, 'effective_from');
    const effectiveTo = asOptionalString(payload.effective_to);
    await assertNoOverlapRuleset({ countryPackId, effectiveFrom, effectiveTo });
    const { data, error } = await supabaseAdmin
        .from('country_pack_rulesets')
        .insert({
        country_pack_id: countryPackId,
        ruleset_code: asString(payload.ruleset_code, 'ruleset_code'),
        ruleset_version: asString(payload.ruleset_version, 'ruleset_version'),
        legal_basis_reference: asOptionalString(payload.legal_basis_reference),
        effective_from: effectiveFrom,
        effective_to: effectiveTo,
        status: asString(payload.status ?? 'draft', 'status'),
        checksum: asOptionalString(payload.checksum),
    })
        .select('*')
        .single();
    if (error)
        throw error;
    await audit(ctx, AUDIT_ACTIONS.RULESET_CREATED, 'country_pack_ruleset', data.id, { country_pack_id: countryPackId });
    return {
        ok: true,
        command: 'create_ruleset',
        refreshed: await refreshedOwnerLegalControlPanel(ctx),
    };
}
async function handleUpdateRulesetMetadata(ctx, payload) {
    const rulesetId = asString(payload.ruleset_id, 'ruleset_id');
    await assertRulesetExists(rulesetId);
    const patch = {};
    if (payload.legal_basis_reference !== undefined)
        patch.legal_basis_reference = asOptionalString(payload.legal_basis_reference);
    if (payload.checksum !== undefined)
        patch.checksum = asOptionalString(payload.checksum);
    if (payload.ruleset_code !== undefined)
        patch.ruleset_code = asString(payload.ruleset_code, 'ruleset_code');
    if (payload.ruleset_version !== undefined)
        patch.ruleset_version = asString(payload.ruleset_version, 'ruleset_version');
    const { error } = await supabaseAdmin.from('country_pack_rulesets').update(patch).eq('id', rulesetId);
    if (error)
        throw error;
    await audit(ctx, AUDIT_ACTIONS.RULESET_METADATA_UPDATED, 'country_pack_ruleset', rulesetId, { fields: Object.keys(patch) });
    return {
        ok: true,
        command: 'update_ruleset_metadata',
        refreshed: await refreshedOwnerLegalControlPanel(ctx),
    };
}
async function handleActivateDeactivateRuleset(ctx, payload, status, command, action) {
    const rulesetId = asString(payload.ruleset_id, 'ruleset_id');
    const ruleset = await assertRulesetExists(rulesetId);
    if (status === 'active') {
        await assertNoOverlapRuleset({
            countryPackId: ruleset.country_pack_id,
            effectiveFrom: ruleset.effective_from,
            effectiveTo: ruleset.effective_to,
            excludeRulesetId: ruleset.id,
        });
    }
    const { error } = await supabaseAdmin.from('country_pack_rulesets').update({ status }).eq('id', rulesetId);
    if (error)
        throw error;
    await audit(ctx, action, 'country_pack_ruleset', rulesetId, { previous_status: ruleset.status, status });
    return {
        ok: true,
        command,
        refreshed: await refreshedOwnerLegalControlPanel(ctx),
    };
}
async function upsertOrganizationCountrySettings(input) {
    const existing = await getOrganizationCountrySettings(input.organizationId);
    if (!existing) {
        const { error } = await supabaseAdmin.from('organization_country_settings').insert({
            organization_id: input.organizationId,
            country_code: input.countryCode,
            active_country_pack_id: input.activeCountryPackId,
            active_ruleset_id: input.activeRulesetId,
            settings_status: input.settingsStatus,
        });
        if (error)
            throw error;
        return;
    }
    const { error } = await supabaseAdmin
        .from('organization_country_settings')
        .update({
        country_code: input.countryCode,
        active_country_pack_id: input.activeCountryPackId,
        active_ruleset_id: input.activeRulesetId,
        settings_status: input.settingsStatus,
    })
        .eq('organization_id', input.organizationId);
    if (error)
        throw error;
}
async function handleAssignCountryPack(ctx, payload) {
    const organizationId = asString(payload.organization_id, 'organization_id');
    const countryPackId = asString(payload.country_pack_id, 'country_pack_id');
    const effectiveDate = asDate(payload.effective_date ?? new Date().toISOString().slice(0, 10), 'effective_date');
    const orgCountryCode = (await getOrganizationCountryCode(organizationId)).toUpperCase();
    const pack = await getCountryPack(countryPackId);
    if (!pack)
        throw notFound('Country pack not found');
    if (pack.country_code.toUpperCase() !== orgCountryCode)
        throw conflict('Organization country is not eligible for this pack');
    if (pack.status !== 'enabled')
        throw conflict('Disabled pack cannot be assigned');
    const resolvedRuleset = await resolveActiveRulesetByDate(countryPackId, effectiveDate);
    if (!resolvedRuleset) {
        throw conflict('Cannot assign country pack without active ruleset for effective date');
    }
    await upsertOrganizationCountrySettings({
        organizationId,
        countryCode: orgCountryCode,
        activeCountryPackId: countryPackId,
        activeRulesetId: resolvedRuleset.id,
        settingsStatus: 'active',
    });
    await audit(ctx, AUDIT_ACTIONS.ORGANIZATION_COUNTRY_PACK_ASSIGNED, 'organization_country_settings', organizationId, {
        organization_id: organizationId,
        country_pack_id: countryPackId,
        ruleset_id: resolvedRuleset.id,
        effective_date: effectiveDate,
    });
    return {
        ok: true,
        command: 'assign_country_pack_to_organization',
        refreshed: {
            aggregate_key: 'organization_country_settings_aggregate',
            aggregate: await buildOrganizationCountrySettingsAggregate(ctx, organizationId),
        },
    };
}
async function handleChangeActiveRulesetForOrganization(ctx, payload) {
    const organizationId = asString(payload.organization_id, 'organization_id');
    const rulesetId = asString(payload.ruleset_id, 'ruleset_id');
    const settings = await getOrganizationCountrySettings(organizationId);
    if (!settings)
        throw notFound('Organization country settings not found');
    const ruleset = await assertRulesetExists(rulesetId);
    if (!settings.active_country_pack_id || ruleset.country_pack_id !== settings.active_country_pack_id) {
        throw conflict('Ruleset must belong to organization active country pack');
    }
    await upsertOrganizationCountrySettings({
        organizationId,
        countryCode: settings.country_code,
        activeCountryPackId: settings.active_country_pack_id,
        activeRulesetId: rulesetId,
        settingsStatus: settings.settings_status,
    });
    await audit(ctx, AUDIT_ACTIONS.ACTIVE_RULESET_CHANGED, 'organization_country_settings', organizationId, {
        ruleset_id: rulesetId,
    });
    return {
        ok: true,
        command: 'change_active_ruleset_for_organization',
        refreshed: {
            aggregate_key: 'organization_country_settings_aggregate',
            aggregate: await buildOrganizationCountrySettingsAggregate(ctx, organizationId),
        },
    };
}
async function handleUpdateOrganizationCountrySettings(ctx, payload) {
    const organizationId = asString(payload.organization_id, 'organization_id');
    const settings = await getOrganizationCountrySettings(organizationId);
    if (!settings)
        throw notFound('Organization country settings not found');
    const nextStatus = asString(payload.settings_status, 'settings_status');
    await upsertOrganizationCountrySettings({
        organizationId,
        countryCode: settings.country_code,
        activeCountryPackId: settings.active_country_pack_id,
        activeRulesetId: settings.active_ruleset_id,
        settingsStatus: nextStatus,
    });
    await audit(ctx, AUDIT_ACTIONS.ORGANIZATION_COUNTRY_SETTINGS_UPDATED, 'organization_country_settings', organizationId, {
        previous_status: settings.settings_status,
        settings_status: nextStatus,
    });
    return {
        ok: true,
        command: 'update_organization_country_settings',
        refreshed: {
            aggregate_key: 'organization_country_settings_aggregate',
            aggregate: await buildOrganizationCountrySettingsAggregate(ctx, organizationId),
        },
    };
}
async function handleCreateLegalValue(ctx, payload) {
    const countryCode = asString(payload.country_code, 'country_code').toUpperCase();
    await assertCountryExists(countryCode);
    const { data, error } = await supabaseAdmin
        .from('country_legal_values')
        .insert({
        country_code: countryCode,
        value_key: asString(payload.value_key, 'value_key'),
        label: asString(payload.label, 'label'),
        category: asString(payload.category, 'category'),
        module_scope: asString(payload.module_scope, 'module_scope'),
        usage_hint: asOptionalString(payload.usage_hint),
        owner_note: asOptionalString(payload.owner_note),
        value_type: asString(payload.value_type, 'value_type'),
        status: asString(payload.status ?? 'draft', 'status'),
    })
        .select('*')
        .single();
    if (error)
        throw error;
    await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_CREATED, 'country_legal_value', data.id, {
        country_code: countryCode,
        value_key: data.value_key,
    });
    return {
        ok: true,
        command: 'create_legal_value',
        refreshed: await refreshedOwnerLegalControlPanel(ctx),
    };
}
async function handleUpdateLegalValueMetadata(ctx, payload) {
    const countryCode = asString(payload.country_code, 'country_code').toUpperCase();
    const valueKey = asString(payload.value_key, 'value_key');
    const legalValue = await assertLegalValueExists(countryCode, valueKey);
    const patch = {};
    if (payload.label !== undefined)
        patch.label = asString(payload.label, 'label');
    if (payload.category !== undefined)
        patch.category = asString(payload.category, 'category');
    if (payload.value_type !== undefined)
        patch.value_type = asString(payload.value_type, 'value_type');
    if (payload.status !== undefined)
        patch.status = asString(payload.status, 'status');
    if (payload.usage_hint !== undefined)
        patch.usage_hint = asOptionalString(payload.usage_hint);
    if (payload.owner_note !== undefined)
        patch.owner_note = asOptionalString(payload.owner_note);
    if (payload.module_scope !== undefined)
        patch.module_scope = asString(payload.module_scope, 'module_scope');
    const { error } = await supabaseAdmin.from('country_legal_values').update(patch).eq('id', legalValue.id);
    if (error)
        throw error;
    await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_METADATA_UPDATED, 'country_legal_value', legalValue.id, { fields: Object.keys(patch) });
    return {
        ok: true,
        command: 'update_legal_value_metadata',
        refreshed: await refreshedOwnerLegalControlPanel(ctx),
    };
}
async function resolveRulesetIdForCreateLegalValueVersion(payload, countryCode) {
    const idRaw = payload.country_pack_ruleset_id;
    const hasRulesetId = typeof idRaw === 'string' && idRaw.trim() !== '';
    if (hasRulesetId) {
        return asString(idRaw, 'country_pack_ruleset_id');
    }
    const codeRaw = payload.ruleset_code;
    if (typeof codeRaw !== 'string' || !codeRaw.trim()) {
        throw badRequest('country_pack_ruleset_id or ruleset_code is required');
    }
    const rulesetCode = codeRaw.trim();
    const { data: rows, error } = await supabaseAdmin
        .from('country_pack_rulesets')
        .select('id, country_pack_id, country_packs!inner(country_code)')
        .eq('ruleset_code', rulesetCode)
        .eq('country_packs.country_code', countryCode);
    if (error)
        throw error;
    if (!rows?.length)
        throw notFound('Ruleset not found for country_code + ruleset_code');
    if (rows.length > 1) {
        throw badRequest('ruleset_code matches multiple rulesets for this country; specify country_pack_ruleset_id');
    }
    return rows[0].id;
}
async function handleCreateLegalValueVersion(ctx, payload) {
    const countryCode = asString(payload.country_code, 'country_code').toUpperCase();
    const valueKey = asString(payload.value_key, 'value_key');
    const rulesetId = await resolveRulesetIdForCreateLegalValueVersion(payload, countryCode);
    const legalValue = await assertLegalValueExists(countryCode, valueKey);
    const ruleset = await assertRulesetExists(rulesetId);
    const pack = await getCountryPack(ruleset.country_pack_id);
    if (!pack || pack.country_code !== countryCode) {
        throw conflict('legal_value_version must match country/ruleset scope');
    }
    const effectiveFrom = asDate(payload.effective_from, 'effective_from');
    const effectiveTo = asOptionalString(payload.effective_to);
    await assertNoOverlapLegalValueVersions({ legalValueId: legalValue.id, effectiveFrom, effectiveTo });
    const rawPayload = normalizeLegalValuePayloadJsonInput(payload.value_payload_json);
    let valuePayloadJson = rawPayload;
    if (rawPayload !== null && isDocflowCommunicationOwnerPayload(rawPayload)) {
        valuePayloadJson = assertValidDocflowCommunicationOwnerPayload(rawPayload);
    }
    if (valuePayloadJson === null || valuePayloadJson === undefined) {
        throw badRequest('value_payload_json is required');
    }
    const { data, error } = await supabaseAdmin
        .from('country_legal_value_versions')
        .insert({
        legal_value_id: legalValue.id,
        country_pack_ruleset_id: rulesetId,
        value_payload_json: valuePayloadJson,
        effective_from: effectiveFrom,
        effective_to: effectiveTo,
        status: asString(payload.status ?? 'draft', 'status'),
    })
        .select('*')
        .single();
    if (error)
        throw error;
    await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_VERSION_CREATED, 'country_legal_value_version', data.id, {
        legal_value_id: legalValue.id,
        ruleset_id: rulesetId,
    });
    return {
        ok: true,
        command: 'create_legal_value_version',
        refreshed: await refreshedOwnerLegalControlPanel(ctx),
    };
}
async function handleUpdateLegalValueVersion(ctx, payload) {
    const versionId = asString(payload.legal_value_version_id, 'legal_value_version_id');
    const { data: current, error: currentError } = await supabaseAdmin
        .from('country_legal_value_versions')
        .select('*')
        .eq('id', versionId)
        .maybeSingle();
    if (currentError)
        throw currentError;
    if (!current)
        throw notFound('Legal value version not found');
    const patch = {};
    const effectiveFrom = payload.effective_from ? asDate(payload.effective_from, 'effective_from') : current.effective_from;
    const effectiveTo = payload.effective_to !== undefined ? asOptionalString(payload.effective_to) : current.effective_to;
    await assertNoOverlapLegalValueVersions({
        legalValueId: current.legal_value_id,
        effectiveFrom,
        effectiveTo,
        excludeVersionId: versionId,
    });
    if (payload.value_payload_json !== undefined) {
        const raw = normalizeLegalValuePayloadJsonInput(payload.value_payload_json);
        let nextPayload = raw;
        if (raw !== null && isDocflowCommunicationOwnerPayload(raw)) {
            nextPayload = assertValidDocflowCommunicationOwnerPayload(raw);
        }
        patch.value_payload_json = nextPayload;
    }
    if (payload.effective_from !== undefined)
        patch.effective_from = effectiveFrom;
    if (payload.effective_to !== undefined)
        patch.effective_to = effectiveTo;
    if (payload.status !== undefined)
        patch.status = asString(payload.status, 'status');
    if (payload.country_pack_ruleset_id !== undefined) {
        const rulesetId = asString(payload.country_pack_ruleset_id, 'country_pack_ruleset_id');
        await assertRulesetExists(rulesetId);
        patch.country_pack_ruleset_id = rulesetId;
    }
    const { error } = await supabaseAdmin.from('country_legal_value_versions').update(patch).eq('id', versionId);
    if (error)
        throw error;
    await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_VERSION_UPDATED, 'country_legal_value_version', versionId, { fields: Object.keys(patch) });
    return {
        ok: true,
        command: 'update_legal_value_version',
        refreshed: await refreshedOwnerLegalControlPanel(ctx),
    };
}
async function handleActivateDeactivateLegalValueVersion(ctx, payload, status, command, action) {
    const versionId = asString(payload.legal_value_version_id, 'legal_value_version_id');
    const { data: current, error: currentError } = await supabaseAdmin
        .from('country_legal_value_versions')
        .select('*')
        .eq('id', versionId)
        .maybeSingle();
    if (currentError)
        throw currentError;
    if (!current)
        throw notFound('Legal value version not found');
    if (status === 'active') {
        await assertNoOverlapLegalValueVersions({
            legalValueId: current.legal_value_id,
            effectiveFrom: current.effective_from,
            effectiveTo: current.effective_to,
            excludeVersionId: versionId,
        });
    }
    const { error } = await supabaseAdmin.from('country_legal_value_versions').update({ status }).eq('id', versionId);
    if (error)
        throw error;
    await audit(ctx, action, 'country_legal_value_version', versionId, { previous_status: current.status, status });
    return {
        ok: true,
        command,
        refreshed: await refreshedOwnerLegalControlPanel(ctx),
    };
}
async function updateLegalValueMetadataField(ctx, payload, field, action, command) {
    const countryCode = asString(payload.country_code, 'country_code').toUpperCase();
    const valueKey = asString(payload.value_key, 'value_key');
    const legalValue = await assertLegalValueExists(countryCode, valueKey);
    const value = field === 'module_scope' ? asString(payload[field], field) : asOptionalString(payload[field]);
    const { error } = await supabaseAdmin.from('country_legal_values').update({ [field]: value }).eq('id', legalValue.id);
    if (error)
        throw error;
    await audit(ctx, action, 'country_legal_value', legalValue.id, { field });
    return {
        ok: true,
        command,
        refreshed: await refreshedOwnerLegalControlPanel(ctx),
    };
}
function parseModulePlanLimitsFromPayload(payload) {
    const raw = payload.limits_json ?? payload.limits;
    if (raw === undefined || raw === null)
        return [];
    let parsed;
    if (typeof raw === 'string') {
        const s = raw.trim();
        if (!s)
            return [];
        try {
            parsed = JSON.parse(s);
        }
        catch {
            throw badRequest('limits_json must be valid JSON');
        }
    }
    else {
        parsed = raw;
    }
    if (!Array.isArray(parsed))
        throw badRequest('limits_json must be a JSON array');
    const out = [];
    for (const item of parsed) {
        if (!item || typeof item !== 'object' || Array.isArray(item))
            throw badRequest('Invalid limit entry');
        const rec = item;
        const limit_code = asString(rec.limit_code, 'limit_code');
        const is_unlimited = typeof rec.is_unlimited === 'boolean' ? rec.is_unlimited : false;
        let limit_value = null;
        const lv = rec.limit_value;
        if (lv !== undefined && lv !== null) {
            const n = typeof lv === 'number' ? lv : Number(lv);
            if (!Number.isFinite(n))
                throw badRequest('Invalid limit_value');
            limit_value = n;
        }
        if (!is_unlimited && limit_value === null) {
            throw badRequest(`limit_value is required for limit_code ${limit_code} when is_unlimited is false`);
        }
        out.push({ limit_code, limit_value: is_unlimited ? null : limit_value, is_unlimited });
    }
    return out;
}
async function resolveModuleForNewPlan(ctx, payload) {
    const hasModuleId = Boolean(asOptionalString(payload.module_id));
    const hasModuleCode = Boolean(asOptionalString(payload.module_code));
    const newCode = asOptionalString(payload.new_module_code);
    const newName = asOptionalString(payload.new_module_name);
    const hasNewPair = Boolean(newCode) || Boolean(newName);
    if (hasNewPair && (!newCode || !newName)) {
        throw badRequest('new_module_code and new_module_name are both required to add a new catalog module');
    }
    const modes = [hasModuleId, hasModuleCode, hasNewPair].filter(Boolean).length;
    if (modes !== 1) {
        throw badRequest('Specify exactly one of: module_id, module_code, or new_module_code + new_module_name');
    }
    if (hasModuleId) {
        const id = asString(payload.module_id, 'module_id');
        const { data, error } = await supabaseAdmin.from('modules').select('id, code').eq('id', id).maybeSingle();
        if (error)
            throw error;
        if (!data)
            throw notFound('Module not found');
        return { moduleId: data.id, createdNewModule: false, moduleCode: data.code };
    }
    if (hasModuleCode) {
        const code = asString(payload.module_code, 'module_code').trim().toLowerCase();
        const { data, error } = await supabaseAdmin.from('modules').select('id, code').eq('code', code).maybeSingle();
        if (error)
            throw error;
        if (!data)
            throw notFound('Module not found');
        return { moduleId: data.id, createdNewModule: false, moduleCode: data.code };
    }
    const code = newCode.trim().toLowerCase();
    const { data: existing, error: exErr } = await supabaseAdmin.from('modules').select('id, code').eq('code', code).maybeSingle();
    if (exErr)
        throw exErr;
    if (existing) {
        return { moduleId: existing.id, createdNewModule: false, moduleCode: existing.code };
    }
    const { data: inserted, error: insErr } = await supabaseAdmin
        .from('modules')
        .insert({
        code,
        name: newName.trim(),
        is_system: false,
        is_sellable: true,
        is_active: true,
        scope_type: 'global',
        default_visibility: 'hidden',
    })
        .select('id, code')
        .single();
    if (insErr)
        throw insErr;
    await audit(ctx, AUDIT_ACTIONS.MODULE_REGISTERED, 'module', inserted.id, {
        source: 'owner_create_module_plan',
        code: inserted.code,
        name: newName.trim(),
    });
    return { moduleId: inserted.id, createdNewModule: true, moduleCode: inserted.code };
}
async function handleCreateModulePlan(ctx, payload) {
    const { moduleId, createdNewModule, moduleCode } = await resolveModuleForNewPlan(ctx, payload);
    const planCode = asString(payload.plan_code, 'plan_code').trim();
    const planName = asString(payload.name, 'name').trim();
    if (!planCode)
        throw badRequest('plan_code is required');
    if (!planName)
        throw badRequest('name is required');
    const rawPrice = payload.price_amount;
    if (rawPrice === undefined || rawPrice === null)
        throw badRequest('price_amount is required');
    const priceNum = typeof rawPrice === 'number' ? rawPrice : Number(rawPrice);
    if (!Number.isFinite(priceNum) || priceNum < 0)
        throw badRequest('Invalid price_amount');
    const currency = asString(payload.currency, 'currency').toUpperCase();
    if (currency.length !== 3)
        throw badRequest('currency must be a 3-letter code');
    let billing_period = 'month';
    if (payload.billing_period !== undefined && payload.billing_period !== null) {
        const bp = asString(payload.billing_period, 'billing_period').toLowerCase();
        if (bp !== 'month' && bp !== 'year')
            throw badRequest("billing_period must be 'month' or 'year'");
        billing_period = bp;
    }
    let sort_order = 0;
    if (payload.sort_order !== undefined && payload.sort_order !== null) {
        const so = typeof payload.sort_order === 'number' ? payload.sort_order : Number(payload.sort_order);
        if (!Number.isFinite(so) || !Number.isInteger(so))
            throw badRequest('sort_order must be an integer');
        sort_order = so;
    }
    let is_active = true;
    if (typeof payload.is_active === 'boolean') {
        is_active = payload.is_active;
    }
    const limits = parseModulePlanLimitsFromPayload(payload);
    const { data: dup, error: dupErr } = await supabaseAdmin
        .from('module_plans')
        .select('id')
        .eq('module_id', moduleId)
        .eq('code', planCode)
        .maybeSingle();
    if (dupErr)
        throw dupErr;
    if (dup)
        throw conflict('A plan with this code already exists for the module');
    const { data: plan, error: planErr } = await supabaseAdmin
        .from('module_plans')
        .insert({
        module_id: moduleId,
        code: planCode,
        name: planName,
        billing_period,
        currency,
        price_amount: priceNum,
        is_active,
        sort_order,
    })
        .select('id')
        .single();
    if (planErr)
        throw planErr;
    if (limits.length) {
        const { error: limErr } = await supabaseAdmin.from('module_plan_limits').insert(limits.map((l) => ({
            module_plan_id: plan.id,
            limit_code: l.limit_code,
            limit_value: l.limit_value,
            is_unlimited: l.is_unlimited,
        })));
        if (limErr)
            throw limErr;
    }
    await audit(ctx, AUDIT_ACTIONS.MODULE_PLAN_CREATED, 'module_plan', plan.id, {
        module_id: moduleId,
        module_code: moduleCode,
        plan_code: planCode,
        created_new_module: createdNewModule,
        price_amount: priceNum,
        currency,
        billing_period,
        limits_count: limits.length,
    });
    return {
        ok: true,
        command: 'create_module_plan',
        refreshed: await refreshedOwnerLegalControlPanel(ctx),
    };
}
async function handleSaveEmailProviderConfig(ctx, payload) {
    function parseOptionalObject(v, field) {
        if (v === undefined || v === null || v === '')
            return null;
        if (typeof v === 'string') {
            try {
                const parsed = JSON.parse(v);
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                    throw new Error('invalid');
                return parsed;
            }
            catch {
                throw badRequest(`${field} must be a JSON object`);
            }
        }
        if (typeof v !== 'object' || Array.isArray(v))
            throw badRequest(`${field} must be an object`);
        return v;
    }
    const configScope = asOptionalString(payload.config_scope) ?? 'platform_default';
    const organizationIdForOverride = asOptionalString(payload.organization_id);
    if (!['platform_default', 'organization_override'].includes(configScope)) {
        throw badRequest('config_scope must be platform_default | organization_override');
    }
    if (configScope === 'organization_override' && !organizationIdForOverride) {
        throw badRequest('organization_id is required for organization_override scope');
    }
    const providerType = asString(payload.provider_type, 'provider_type');
    if (!['resend', 'sendgrid', 'smtp', 'custom_api'].includes(providerType)) {
        throw badRequest('provider_type must be resend | sendgrid | smtp | custom_api');
    }
    const providerDisplayName = asOptionalString(payload.provider_display_name);
    const fromEmail = asString(payload.from_email, 'from_email');
    const fromName = asString(payload.from_name, 'from_name');
    const apiKey = asOptionalString(payload.api_key);
    const smtpConfigRaw = payload.smtp_config;
    const smtpConfig = smtpConfigRaw && typeof smtpConfigRaw === 'object' && !Array.isArray(smtpConfigRaw)
        ? smtpConfigRaw
        : null;
    const smtpHost = asOptionalString(smtpConfig?.host);
    const smtpPortRaw = smtpConfig?.port;
    const smtpPort = smtpPortRaw === undefined || smtpPortRaw === null || smtpPortRaw === ''
        ? null
        : Number(smtpPortRaw);
    if (smtpPort !== null && !Number.isFinite(smtpPort))
        throw badRequest('smtp_config.port must be a number');
    const smtpUser = asOptionalString(smtpConfig?.user);
    const smtpPassword = asOptionalString(smtpConfig?.password);
    const apiEndpointUrl = asOptionalString(payload.api_endpoint_url);
    const httpMethod = asOptionalString(payload.http_method);
    const authType = asOptionalString(payload.auth_type);
    const authHeaderName = asOptionalString(payload.auth_header_name);
    const recipientField = asOptionalString(payload.recipient_field);
    const subjectField = asOptionalString(payload.subject_field);
    const htmlBodyField = asOptionalString(payload.html_body_field);
    const textBodyField = asOptionalString(payload.text_body_field);
    const staticHeaders = parseOptionalObject(payload.static_headers, 'static_headers');
    const staticPayload = parseOptionalObject(payload.static_payload, 'static_payload');
    const successResponsePath = asOptionalString(payload.success_response_path);
    const errorResponsePath = asOptionalString(payload.error_response_path);
    if (providerType === 'custom_api') {
        if ((httpMethod ?? 'POST').toUpperCase() !== 'POST')
            throw badRequest('http_method must be POST');
        if (!apiEndpointUrl)
            throw badRequest('api_endpoint_url is required for custom_api');
        if (!authType || !['bearer_token', 'api_key_header'].includes(authType)) {
            throw badRequest('auth_type must be bearer_token | api_key_header');
        }
        if (!apiKey)
            throw badRequest('api_key is required for custom_api');
        if (!authHeaderName)
            throw badRequest('auth_header_name is required for custom_api');
        if (!recipientField || !subjectField || !htmlBodyField || !textBodyField) {
            throw badRequest('recipient_field, subject_field, html_body_field, text_body_field are required for custom_api');
        }
    }
    const configured = providerType === 'smtp'
        ? Boolean(fromEmail && fromName && smtpHost && smtpPort && smtpUser && smtpPassword)
        : providerType === 'custom_api'
            ? Boolean(fromEmail &&
                fromName &&
                apiKey &&
                apiEndpointUrl &&
                authType &&
                authHeaderName &&
                recipientField &&
                subjectField &&
                htmlBodyField &&
                textBodyField)
            : Boolean(fromEmail && fromName && apiKey);
    const saveBlob = {
        provider_type: providerType,
        provider_display_name: providerDisplayName,
        from_email: fromEmail,
        from_name: fromName,
        api_key_encrypted: encryptOptionalSecret(apiKey),
        smtp_host: smtpHost,
        smtp_port: smtpPort,
        smtp_user: smtpUser,
        smtp_password_encrypted: encryptOptionalSecret(smtpPassword),
        api_endpoint_url: apiEndpointUrl,
        http_method: httpMethod ? httpMethod.toUpperCase() : null,
        auth_type: authType,
        auth_header_name: authHeaderName,
        recipient_field: recipientField,
        subject_field: subjectField,
        html_body_field: htmlBodyField,
        text_body_field: textBodyField,
        static_headers_json: staticHeaders,
        static_payload_json: staticPayload,
        success_response_path: successResponsePath,
        error_response_path: errorResponsePath,
        is_configured: configured,
    };
    if (configScope === 'organization_override') {
        await saveOwnerEmailProviderConfigOrgOverride(String(organizationIdForOverride), saveBlob, ctx.user.id);
    }
    else {
        await saveOwnerEmailProviderConfigGlobal(saveBlob, ctx.user.id);
    }
    await audit(ctx, AUDIT_ACTIONS.EMAIL_PROVIDER_CONFIG_SAVED, 'owner_email_provider_config', configScope === 'organization_override' ? String(organizationIdForOverride) : 'global', {
        provider_type: providerType,
        provider_display_name: providerDisplayName,
        from_email: fromEmail,
        from_name: fromName,
        config_scope: configScope,
        organization_id: organizationIdForOverride,
        is_configured: configured,
    });
    return {
        ok: true,
        command: 'save_email_provider_config',
        refreshed: await refreshedOwnerLegalControlPanel(ctx),
    };
}
async function handleSavePlatformPublicUrl(ctx, payload) {
    const appPublicUrl = asString(payload.app_public_url, 'app_public_url');
    if (!/^https?:\/\//i.test(appPublicUrl)) {
        throw badRequest('app_public_url must start with http:// or https://');
    }
    try {
        // Validate URL format.
        void new URL(appPublicUrl);
    }
    catch {
        throw badRequest('app_public_url must be a valid URL');
    }
    await savePlatformPublicUrlGlobal(appPublicUrl, ctx.user.id);
    await audit(ctx, AUDIT_ACTIONS.PLATFORM_PUBLIC_URL_SAVED, 'platform_setting', 'app_public_url', {
        app_public_url: appPublicUrl,
    });
    return {
        ok: true,
        command: 'save_platform_public_url',
        refreshed: await refreshedOwnerLegalControlPanel(ctx),
    };
}
/**
 * Updates catalog pricing in `module_plans` (single source of truth with Modules/Billing).
 * `update_package_price` uses the same store — there is no separate package price table.
 */
async function handleUpdateModulePlanPricing(ctx, payload, command, action) {
    const modulePlanId = asString(payload.module_plan_id, 'module_plan_id');
    const rawPrice = payload.price_amount;
    if (rawPrice === undefined || rawPrice === null)
        throw badRequest('price_amount is required');
    const num = typeof rawPrice === 'number' ? rawPrice : Number(rawPrice);
    if (!Number.isFinite(num) || num < 0)
        throw badRequest('Invalid price_amount');
    const { data: existing, error: fetchErr } = await supabaseAdmin
        .from('module_plans')
        .select('id, module_id, code, currency, billing_period, price_amount, is_active')
        .eq('id', modulePlanId)
        .maybeSingle();
    if (fetchErr)
        throw fetchErr;
    if (!existing)
        throw notFound('Module plan not found');
    let currency = existing.currency;
    if (payload.currency !== undefined) {
        const c = asString(payload.currency, 'currency').toUpperCase();
        if (c.length !== 3)
            throw badRequest('currency must be a 3-letter code');
        currency = c;
    }
    let billing_period = existing.billing_period;
    if (payload.billing_period !== undefined && payload.billing_period !== null) {
        const bp = asString(payload.billing_period, 'billing_period').toLowerCase();
        if (bp !== 'month' && bp !== 'year')
            throw badRequest("billing_period must be 'month' or 'year'");
        billing_period = bp;
    }
    let is_active = existing.is_active;
    if (typeof payload.is_active === 'boolean') {
        is_active = payload.is_active;
    }
    const { error: updErr } = await supabaseAdmin
        .from('module_plans')
        .update({
        price_amount: num,
        currency,
        billing_period,
        is_active,
        updated_at: new Date().toISOString(),
    })
        .eq('id', modulePlanId);
    if (updErr)
        throw updErr;
    await audit(ctx, action, 'module_plan', modulePlanId, {
        command,
        module_id: existing.module_id,
        plan_code: existing.code,
        previous_price_amount: existing.price_amount,
        price_amount: num,
        currency,
        billing_period,
        is_active,
    });
    return {
        ok: true,
        command,
        refreshed: await refreshedOwnerLegalControlPanel(ctx),
    };
}
function parseRequestTemplateDefinitionItems(payload) {
    const raw = payload.items;
    if (!Array.isArray(raw) || raw.length === 0) {
        throw badRequest('items must be a non-empty array');
    }
    return raw.map((it, i) => {
        if (!it || typeof it !== 'object' || Array.isArray(it)) {
            throw badRequest(`items[${i}] must be an object`);
        }
        const o = it;
        const label = typeof o.label === 'string' ? o.label.trim() : '';
        if (!label)
            throw badRequest(`items[${i}].label is required`);
        if (o.description === undefined || o.description === null) {
            return { label, description: null };
        }
        if (typeof o.description !== 'string')
            throw badRequest(`items[${i}].description must be a string`);
        const d = o.description.trim();
        return { label, description: d.length ? d : null };
    });
}
async function handleSaveRequestTemplateDefinition(ctx, payload) {
    const countryCode = asString(payload.country_code, 'country_code').toUpperCase().slice(0, 2);
    await assertCountryExists(countryCode);
    const name = asString(payload.name, 'name');
    const items = parseRequestTemplateDefinitionItems(payload);
    const existingId = asOptionalString(payload.template_definition_id);
    if (existingId) {
        const { data: row, error: findErr } = await supabaseAdmin
            .from('docflow_request_template_definitions')
            .select('id, archived_at')
            .eq('id', existingId)
            .maybeSingle();
        if (findErr)
            throw findErr;
        if (!row)
            throw notFound('Template not found');
        if (row.archived_at)
            throw badRequest('Template is archived');
        const { error: uErr } = await supabaseAdmin
            .from('docflow_request_template_definitions')
            .update({
            country_code: countryCode,
            name,
            updated_at: new Date().toISOString(),
        })
            .eq('id', existingId);
        if (uErr)
            throw uErr;
        const { error: dErr } = await supabaseAdmin
            .from('docflow_request_template_definition_items')
            .delete()
            .eq('template_definition_id', existingId);
        if (dErr)
            throw dErr;
        const ins = items.map((it, idx) => ({
            template_definition_id: existingId,
            sort_order: idx,
            label: it.label,
            description: it.description,
        }));
        const { error: iErr } = await supabaseAdmin.from('docflow_request_template_definition_items').insert(ins);
        if (iErr)
            throw iErr;
        await audit(ctx, AUDIT_ACTIONS.DOCFLOW_REQUEST_TEMPLATE_SAVED, 'docflow_request_template_definition', existingId, {
            country_code: countryCode,
            name,
            item_count: items.length,
        });
        return { ok: true, command: 'save_request_template_definition', refreshed: await refreshedOwnerLegalControlPanel(ctx) };
    }
    const { data: created, error: cErr } = await supabaseAdmin
        .from('docflow_request_template_definitions')
        .insert({ country_code: countryCode, name })
        .select('id')
        .single();
    if (cErr)
        throw cErr;
    const newId = String(created.id);
    const ins = items.map((it, idx) => ({
        template_definition_id: newId,
        sort_order: idx,
        label: it.label,
        description: it.description,
    }));
    const { error: iErr } = await supabaseAdmin.from('docflow_request_template_definition_items').insert(ins);
    if (iErr)
        throw iErr;
    await audit(ctx, AUDIT_ACTIONS.DOCFLOW_REQUEST_TEMPLATE_SAVED, 'docflow_request_template_definition', newId, {
        country_code: countryCode,
        name,
        item_count: items.length,
    });
    return { ok: true, command: 'save_request_template_definition', refreshed: await refreshedOwnerLegalControlPanel(ctx) };
}
async function handleArchiveRequestTemplateDefinition(ctx, payload) {
    const id = asString(payload.template_definition_id, 'template_definition_id');
    const { data: row, error: findErr } = await supabaseAdmin
        .from('docflow_request_template_definitions')
        .select('id, archived_at')
        .eq('id', id)
        .maybeSingle();
    if (findErr)
        throw findErr;
    if (!row)
        throw notFound('Template not found');
    if (row.archived_at) {
        return { ok: true, command: 'archive_request_template_definition', refreshed: await refreshedOwnerLegalControlPanel(ctx) };
    }
    const { error: uErr } = await supabaseAdmin
        .from('docflow_request_template_definitions')
        .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id);
    if (uErr)
        throw uErr;
    await audit(ctx, AUDIT_ACTIONS.DOCFLOW_REQUEST_TEMPLATE_ARCHIVED, 'docflow_request_template_definition', id, {});
    return { ok: true, command: 'archive_request_template_definition', refreshed: await refreshedOwnerLegalControlPanel(ctx) };
}
export async function executeCountryPackCommand(ctx, command) {
    try {
        assertPlatformOwner(ctx);
    }
    catch (error) {
        await audit(ctx, AUDIT_ACTIONS.OWNER_SECURITY_CHECK_FAILED, 'country_pack_command', null, {
            attempted_command: command.command,
        });
        throw error;
    }
    switch (command.command) {
        case 'create_country':
            return handleCreateCountry(ctx, command.payload);
        case 'create_country_pack':
            return handleCreateCountryPack(ctx, command.payload);
        case 'enable_country_pack':
            return handleEnableDisablePack(ctx, command.payload, 'enabled', 'enable_country_pack', AUDIT_ACTIONS.COUNTRY_PACK_ENABLED);
        case 'disable_country_pack':
            return handleEnableDisablePack(ctx, command.payload, 'disabled', 'disable_country_pack', AUDIT_ACTIONS.COUNTRY_PACK_DISABLED);
        case 'create_ruleset':
            return handleCreateRuleset(ctx, command.payload);
        case 'update_ruleset_metadata':
            return handleUpdateRulesetMetadata(ctx, command.payload);
        case 'activate_ruleset':
            return handleActivateDeactivateRuleset(ctx, command.payload, 'active', 'activate_ruleset', AUDIT_ACTIONS.RULESET_ACTIVATED);
        case 'deactivate_ruleset':
            return handleActivateDeactivateRuleset(ctx, command.payload, 'disabled', 'deactivate_ruleset', AUDIT_ACTIONS.RULESET_DEACTIVATED);
        case 'assign_country_pack_to_organization':
            return handleAssignCountryPack(ctx, command.payload);
        case 'change_active_ruleset_for_organization':
            return handleChangeActiveRulesetForOrganization(ctx, command.payload);
        case 'update_organization_country_settings':
            return handleUpdateOrganizationCountrySettings(ctx, command.payload);
        case 'create_legal_value':
            return handleCreateLegalValue(ctx, command.payload);
        case 'update_legal_value_metadata':
            return handleUpdateLegalValueMetadata(ctx, command.payload);
        case 'create_legal_value_version':
            return handleCreateLegalValueVersion(ctx, command.payload);
        case 'update_legal_value_version':
            return handleUpdateLegalValueVersion(ctx, command.payload);
        case 'activate_legal_value_version':
            return handleActivateDeactivateLegalValueVersion(ctx, command.payload, 'active', 'activate_legal_value_version', AUDIT_ACTIONS.LEGAL_VALUE_VERSION_ACTIVATED);
        case 'deactivate_legal_value_version':
            return handleActivateDeactivateLegalValueVersion(ctx, command.payload, 'disabled', 'deactivate_legal_value_version', AUDIT_ACTIONS.LEGAL_VALUE_VERSION_DEACTIVATED);
        case 'update_owner_note':
            return updateLegalValueMetadataField(ctx, command.payload, 'owner_note', AUDIT_ACTIONS.OWNER_NOTE_UPDATED, 'update_owner_note');
        case 'update_usage_hint':
            return updateLegalValueMetadataField(ctx, command.payload, 'usage_hint', AUDIT_ACTIONS.USAGE_HINT_UPDATED, 'update_usage_hint');
        case 'update_module_scope':
            return updateLegalValueMetadataField(ctx, command.payload, 'module_scope', AUDIT_ACTIONS.MODULE_SCOPE_UPDATED, 'update_module_scope');
        case 'update_module_price':
            return handleUpdateModulePlanPricing(ctx, command.payload, 'update_module_price', AUDIT_ACTIONS.MODULE_PRICE_UPDATED);
        case 'update_package_price':
            return handleUpdateModulePlanPricing(ctx, command.payload, 'update_package_price', AUDIT_ACTIONS.PACKAGE_PRICE_UPDATED);
        case 'create_module_plan':
            return handleCreateModulePlan(ctx, command.payload);
        case 'save_email_provider_config':
            return handleSaveEmailProviderConfig(ctx, command.payload);
        case 'save_platform_public_url':
            return handleSavePlatformPublicUrl(ctx, command.payload);
        case 'save_request_template_definition':
            return handleSaveRequestTemplateDefinition(ctx, command.payload);
        case 'archive_request_template_definition':
            return handleArchiveRequestTemplateDefinition(ctx, command.payload);
        default:
            throw badRequest(`Unsupported country-pack command: ${command.command ?? 'unknown'}`);
    }
}

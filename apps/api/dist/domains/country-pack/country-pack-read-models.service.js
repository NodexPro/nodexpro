import { supabaseAdmin } from '../../db/client.js';
import { forbidden, notFound } from '../../shared/errors.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { resolveCountryContext } from './country-pack-resolver.service.js';
import { assertValidDocflowCommunicationOwnerPayload, isDocflowCommunicationOwnerPayload, } from './docflow-communication-owner-payload.js';
import { buildOwnerEmailProviderConfigAggregate } from '../../shared/owner-email-provider-config.service.js';
function canUseOrgAggregate(ctx, organizationId) {
    return !!ctx.organizationId && ctx.organizationId === organizationId;
}
function assertOrgAggregateAccess(ctx, organizationId) {
    try {
        assertPlatformOwner(ctx);
        return;
    }
    catch {
        if (!canUseOrgAggregate(ctx, organizationId)) {
            throw forbidden('Organization aggregate access denied');
        }
    }
}
function statusBadge(status) {
    switch (status) {
        case 'active':
        case 'enabled':
            return { code: status, label: 'Active', tone: 'ok' };
        case 'disabled':
            return { code: status, label: 'Disabled', tone: 'warn' };
        case 'draft':
            return { code: status, label: 'Draft', tone: 'muted' };
        case 'deprecated':
            return { code: status, label: 'Deprecated', tone: 'warn' };
        default:
            return { code: status, label: status, tone: 'muted' };
    }
}
export async function buildOwnerCountryPackAdminAggregate(ctx) {
    assertPlatformOwner(ctx);
    const [countries, packs, rulesets] = await Promise.all([
        supabaseAdmin.from('countries').select('code, name, status, default_timezone, created_at').order('code'),
        supabaseAdmin
            .from('country_packs')
            .select('id, country_code, pack_code, name, status, module_code, framework_version, code_version, created_at, updated_at')
            .order('updated_at', { ascending: false }),
        supabaseAdmin
            .from('country_pack_rulesets')
            .select('id, country_pack_id, ruleset_code, ruleset_version, legal_basis_reference, effective_from, effective_to, status, updated_at')
            .order('updated_at', { ascending: false }),
    ]);
    if (countries.error)
        throw countries.error;
    if (packs.error)
        throw packs.error;
    if (rulesets.error)
        throw rulesets.error;
    const warnings = [];
    const enabledPacks = (packs.data ?? []).filter((p) => p.status === 'enabled').length;
    const activeRulesets = (rulesets.data ?? []).filter((r) => r.status === 'active').length;
    if (enabledPacks === 0)
        warnings.push('no_enabled_packs');
    if (activeRulesets === 0)
        warnings.push('no_active_rulesets');
    return {
        aggregate_key: 'owner_country_pack_admin_aggregate',
        status: { packs_enabled: enabledPacks, rulesets_active: activeRulesets },
        tables: {
            countries: (countries.data ?? []).map((row) => ({
                ...row,
                status_badge: statusBadge(row.status),
            })),
            country_packs: (packs.data ?? []).map((row) => ({
                ...row,
                status_badge: statusBadge(row.status),
            })),
            rulesets: (rulesets.data ?? []).map((row) => ({
                ...row,
                status_badge: statusBadge(row.status),
                effective_window: `${row.effective_from} -> ${row.effective_to ?? 'open'}`,
            })),
        },
        warnings,
        errors: [],
        actions: [
            { action_key: 'create_country', enabled: true },
            { action_key: 'create_country_pack', enabled: true },
            {
                action_key: 'create_ruleset',
                enabled: true,
                note: 'country_pack_id: copy from Country Packs table (id). effective_from / effective_to: YYYY-MM-DD. DB status: draft | active | deprecated | disabled.',
                payload: {
                    country_pack_id: 'uuid',
                    ruleset_code: 'string',
                    ruleset_version: 'string',
                    effective_from: 'YYYY-MM-DD',
                    effective_to: 'optional YYYY-MM-DD',
                    status: 'optional draft|active|deprecated|disabled',
                    legal_basis_reference: 'optional string',
                    checksum: 'optional string',
                },
            },
            { action_key: 'enable_country_pack', enabled: true },
            { action_key: 'disable_country_pack', enabled: true },
            { action_key: 'activate_ruleset', enabled: true },
            { action_key: 'deactivate_ruleset', enabled: true },
        ],
    };
}
export async function buildOwnerLegalValuesAggregate(ctx) {
    assertPlatformOwner(ctx);
    const [values, versions] = await Promise.all([
        supabaseAdmin
            .from('country_legal_values')
            .select('id, country_code, value_key, label, category, module_scope, usage_hint, owner_note, value_type, status, updated_at')
            .order('updated_at', { ascending: false }),
        supabaseAdmin
            .from('country_legal_value_versions')
            .select('id, legal_value_id, country_pack_ruleset_id, value_payload_json, effective_from, effective_to, status, updated_at')
            .order('updated_at', { ascending: false }),
    ]);
    if (values.error)
        throw values.error;
    if (versions.error)
        throw versions.error;
    const byLegalValueId = new Map();
    for (const v of versions.data ?? []) {
        const list = byLegalValueId.get(v.legal_value_id) ?? [];
        list.push({
            ...v,
            status_badge: statusBadge(v.status),
            effective_window: `${v.effective_from} -> ${v.effective_to ?? 'open'}`,
        });
        byLegalValueId.set(v.legal_value_id, list);
    }
    const today = new Date().toISOString().slice(0, 10);
    const rows = (values.data ?? []).map((lv) => {
        const lvVersions = byLegalValueId.get(lv.id) ?? [];
        const activeCurrent = lvVersions.find((item) => {
            const raw = item;
            return raw.status === 'active' && raw.effective_from <= today && (raw.effective_to == null || raw.effective_to >= today);
        }) ?? null;
        return {
            ...lv,
            status_badge: statusBadge(lv.status),
            current_active_value: activeCurrent ? activeCurrent.value_payload_json : null,
            versions: lvVersions,
        };
    });
    return {
        aggregate_key: 'owner_legal_values_aggregate',
        table: rows,
        validation_warnings: rows
            .filter((r) => !r.versions.length)
            .map((r) => `missing_versions_for_${r.value_key}`),
        actions: [
            {
                action_key: 'create_legal_value',
                enabled: true,
                note: 'country_code: IL, US, … (must exist in countries). category must be exactly: VAT | Income Tax | National Insurance | Credit Points | Pricing | Reports | Calendar | Modules. value_type: number | percentage | boolean | string | json | money | date.',
                payload: {
                    country_code: 'ISO 3166-1 alpha-2',
                    value_key: 'string',
                    label: 'string',
                    category: 'VAT|Income Tax|National Insurance|Credit Points|Pricing|Reports|Calendar|Modules (exact label)',
                    module_scope: 'string',
                    value_type: 'number|percentage|boolean|string|json|money|date',
                    status: 'optional draft|active|disabled',
                    usage_hint: 'optional string',
                    owner_note: 'optional string',
                },
            },
            { action_key: 'update_legal_value_metadata', enabled: true },
            { action_key: 'create_legal_value_version', enabled: true },
            { action_key: 'update_legal_value_version', enabled: true },
            { action_key: 'activate_legal_value_version', enabled: true },
            { action_key: 'deactivate_legal_value_version', enabled: true },
            { action_key: 'update_owner_note', enabled: true },
            { action_key: 'update_usage_hint', enabled: true },
            { action_key: 'update_module_scope', enabled: true },
        ],
    };
}
export async function buildOwnerPlatformPricingAggregate(ctx) {
    assertPlatformOwner(ctx);
    /**
     * Source of truth for module catalog pricing is `module_plans` (+ `modules`), same as
     * `module-commerce.service.ts` / Modules & Billing pages. No parallel pricing table.
     *
     * PARTIAL: `module_plans` has no effective_from / effective_to versioning; only current row values.
     */
    const { data: plans, error: plansError } = await supabaseAdmin
        .from('module_plans')
        .select('id, module_id, code, name, billing_period, currency, price_amount, is_active, sort_order, updated_at')
        .order('module_id', { ascending: true })
        .order('sort_order', { ascending: true });
    if (plansError)
        throw plansError;
    const { data: allModules, error: allModsError } = await supabaseAdmin
        .from('modules')
        .select('id, code, name, is_system')
        .order('code', { ascending: true });
    if (allModsError)
        throw allModsError;
    const modById = new Map((allModules ?? []).map((m) => [m.id, { code: m.code, name: m.name, is_system: m.is_system }]));
    const rows = (plans ?? []).map((p) => {
        const m = modById.get(p.module_id);
        return {
            module_plan_id: p.id,
            module_id: p.module_id,
            module_code: m?.code ?? null,
            module_name: m?.name ?? null,
            plan_code: p.code,
            plan_name: p.name,
            price_amount: Number(p.price_amount),
            currency: p.currency,
            billing_period: p.billing_period,
            is_active: p.is_active,
            status_badge: statusBadge(p.is_active ? 'active' : 'disabled'),
            sort_order: p.sort_order,
            updated_at: p.updated_at,
            effective_from: null,
            effective_to: null,
            owner_note: null,
            is_system_module: m?.is_system ?? false,
        };
    });
    return {
        aggregate_key: 'owner_platform_pricing_aggregate',
        source: 'module_plans',
        pricing_effective_dates: 'not_supported',
        module_catalog: {
            rows: (allModules ?? []).map((m) => ({
                module_id: m.id,
                module_code: m.code,
                module_name: m.name,
                is_system_module: m.is_system,
            })),
        },
        table: { rows },
        warnings: ['module_plan_pricing_has_no_effective_date_versioning'],
        actions: [
            {
                action_key: 'create_module_plan',
                enabled: true,
                button_label: '+New',
                note: 'Новый тариф: укажите ровно один из module_id, module_code или пару new_module_code + new_module_name. Условия (лимиты) — в limits_json.',
                payload: {
                    module_id: 'optional uuid',
                    module_code: 'optional string (existing module code)',
                    new_module_code: 'optional string (creates catalog module if missing)',
                    new_module_name: 'optional string (required with new_module_code)',
                    plan_code: 'string (unique per module)',
                    name: 'string (plan title)',
                    price_amount: 'number',
                    currency: 'ISO 4217 3-letter',
                    billing_period: "optional 'month' | 'year'",
                    sort_order: 'optional number',
                    is_active: 'optional boolean',
                    limits_json: 'optional JSON array of {limit_code, limit_value?, is_unlimited?} e.g. [{"limit_code":"max_clients","limit_value":100,"is_unlimited":false}]',
                },
            },
            {
                action_key: 'update_module_price',
                enabled: true,
                payload: {
                    module_plan_id: 'uuid',
                    price_amount: 'number',
                    currency: 'optional ISO 4217 3-letter',
                    billing_period: "optional 'month' | 'year'",
                    is_active: 'optional boolean',
                },
            },
            {
                action_key: 'update_package_price',
                enabled: true,
                note: 'No separate package pricing store; updates the same module_plans row (use module_plan_id).',
                payload: {
                    module_plan_id: 'uuid',
                    price_amount: 'number',
                    currency: 'optional ISO 4217 3-letter',
                    billing_period: "optional 'month' | 'year'",
                    is_active: 'optional boolean',
                },
            },
        ],
    };
}
export async function buildOrganizationCountrySettingsAggregate(ctx, organizationId) {
    assertOrgAggregateAccess(ctx, organizationId);
    const [organization, settings] = await Promise.all([
        supabaseAdmin.from('organizations').select('id, name, country_code').eq('id', organizationId).maybeSingle(),
        supabaseAdmin.from('organization_country_settings').select('*').eq('organization_id', organizationId).maybeSingle(),
    ]);
    if (organization.error)
        throw organization.error;
    if (settings.error)
        throw settings.error;
    if (!organization.data)
        throw notFound('Organization not found');
    const packs = await supabaseAdmin
        .from('country_packs')
        .select('id, pack_code, name, status, code_version')
        .eq('country_code', organization.data.country_code);
    if (packs.error)
        throw packs.error;
    let activeRuleset = null;
    if (settings.data?.active_ruleset_id) {
        const ruleset = await supabaseAdmin
            .from('country_pack_rulesets')
            .select('id, ruleset_code, ruleset_version, effective_from, effective_to, status')
            .eq('id', settings.data.active_ruleset_id)
            .maybeSingle();
        if (ruleset.error)
            throw ruleset.error;
        activeRuleset = ruleset.data ?? null;
    }
    const diagnostics = [];
    if (!settings.data)
        diagnostics.push('country_settings_not_configured');
    if (settings.data && !settings.data.active_country_pack_id)
        diagnostics.push('no_active_country_pack');
    if (settings.data && settings.data.active_country_pack_id && !settings.data.active_ruleset_id)
        diagnostics.push('no_active_ruleset');
    return {
        aggregate_key: 'organization_country_settings_aggregate',
        organization: {
            id: organization.data.id,
            country_code: organization.data.country_code,
            name: organization.data.name,
        },
        settings_status: settings.data?.settings_status ?? 'not_configured',
        eligible_packs: (packs.data ?? []).map((p) => ({
            ...p,
            status_badge: statusBadge(p.status),
            is_assignable: p.status === 'enabled',
        })),
        active_pack: settings.data?.active_country_pack_id
            ? (packs.data ?? []).find((p) => p.id === settings.data?.active_country_pack_id) ?? null
            : null,
        active_ruleset: activeRuleset,
        diagnostics,
        actions: [
            { action_key: 'assign_country_pack_to_organization', enabled: true },
            { action_key: 'change_active_ruleset_for_organization', enabled: true },
            { action_key: 'update_organization_country_settings', enabled: true },
        ],
    };
}
export async function buildCountryPackDiagnosticsAggregate(ctx, organizationId) {
    assertOrgAggregateAccess(ctx, organizationId);
    const now = new Date().toISOString().slice(0, 10);
    const context = await resolveCountryContext(organizationId, now);
    const warnings = [...context.warnings];
    const errors = [];
    if (!context.country_code)
        errors.push('missing_country_code');
    if (!context.country_pack_id)
        warnings.push('missing_active_pack');
    if (!context.ruleset_id)
        warnings.push('missing_active_ruleset');
    return {
        aggregate_key: 'country_pack_diagnostics_aggregate',
        resolved_pack: context.country_pack_id,
        resolved_ruleset: context.ruleset_id,
        effective_date_result: now,
        warnings,
        errors,
        isolation_status: errors.length ? 'failed' : 'ok',
        actions: [
            { action_key: 'open_organization_country_settings', enabled: true },
            { action_key: 'assign_country_pack_to_organization', enabled: true },
            { action_key: 'change_active_ruleset_for_organization', enabled: true },
        ],
    };
}
export async function buildActiveRulesetContextAggregate(ctx, organizationId, date) {
    assertOrgAggregateAccess(ctx, organizationId);
    const context = await resolveCountryContext(organizationId, date);
    return {
        aggregate_key: 'active_ruleset_context_aggregate',
        country_code: context.country_code,
        active_pack: context.country_pack_id,
        active_ruleset: context.ruleset_id,
        resolved_legal_values_map: context.resolved_values_map,
        warnings: context.warnings,
    };
}
/** Entity types written by platform-owner Country Pack / legal / catalog flows (no payload exposed). */
const OWNER_LEGAL_CONTROL_AUDIT_ENTITY_TYPES = [
    'country',
    'country_pack',
    'country_pack_ruleset',
    'organization_country_settings',
    'country_legal_value',
    'country_legal_value_version',
    'module',
    'module_plan',
    'owner_country_pack_api',
    'country_pack_command',
];
function buildDocflowCommunicationTemplatesFromLegalTable(legalTable) {
    const out = [];
    for (const lv of legalTable) {
        const versions = Array.isArray(lv.versions) ? lv.versions : [];
        const countryCode = String(lv.country_code ?? '');
        const valueKey = String(lv.value_key ?? '');
        for (const ver of versions) {
            const vpj = ver.value_payload_json;
            if (!isDocflowCommunicationOwnerPayload(vpj))
                continue;
            let normalized;
            let parseError = null;
            try {
                normalized = assertValidDocflowCommunicationOwnerPayload(vpj);
            }
            catch (e) {
                parseError = e instanceof Error ? e.message : 'invalid_payload';
                normalized = {};
            }
            const messageTemplate = String(normalized.message_template ?? '');
            const preview = parseError !== null
                ? `(invalid: ${parseError})`
                : messageTemplate.length > 160
                    ? `${messageTemplate.slice(0, 160)}…`
                    : messageTemplate;
            const verStatus = String(ver.status ?? '');
            const versionId = String(ver.id ?? '');
            const rulesetId = String(ver.country_pack_ruleset_id ?? '');
            const allowedActions = [
                {
                    action_key: 'create_legal_value_version',
                    enabled: true,
                    button_label: 'New version',
                    note: 'Add a new version for this value_key with updated value_payload_json and effective_from.',
                },
                {
                    action_key: 'update_legal_value_version',
                    enabled: parseError === null,
                    button_label: 'Edit version JSON',
                    note: 'Update this version in place (payload and optional effective_from / effective_to). Use Create legal value version from Legal Values when you need a separate timeline row with a non-overlapping effective_from.',
                },
                {
                    action_key: 'activate_legal_value_version',
                    enabled: verStatus !== 'active' && parseError === null,
                    button_label: 'Activate',
                },
                {
                    action_key: 'deactivate_legal_value_version',
                    enabled: verStatus === 'active',
                    button_label: 'Deactivate',
                },
                {
                    action_key: 'update_owner_note',
                    enabled: true,
                    button_label: 'Owner note',
                },
                {
                    action_key: 'update_usage_hint',
                    enabled: true,
                    button_label: 'Usage hint',
                },
                {
                    action_key: 'update_module_scope',
                    enabled: true,
                    button_label: 'Module scope',
                },
                {
                    action_key: 'update_legal_value_metadata',
                    enabled: true,
                    button_label: 'Label / metadata',
                },
            ];
            out.push({
                legal_value_id: lv.id,
                value_key: valueKey,
                label: lv.label,
                module_scope: lv.module_scope,
                country_code: countryCode,
                version_id: versionId,
                country_pack_ruleset_id: rulesetId,
                effective_from: ver.effective_from,
                effective_to: ver.effective_to,
                status: verStatus,
                status_badge: ver.status_badge,
                effective_window: ver.effective_window,
                message_template_preview: preview,
                message_template_full: parseError === null ? messageTemplate : null,
                review_required: normalized.review_required !== false,
                message_type: normalized.message_type === 'system' ? 'system' : 'reminder',
                condition_config_summary: parseError === null ? JSON.stringify(normalized.condition_config ?? {}) : '—',
                schedule_config_summary: parseError === null ? JSON.stringify(normalized.schedule_config ?? {}) : '—',
                parse_error: parseError,
                value_payload_for_edit: parseError === null ? normalized : vpj,
                allowed_actions: allowedActions,
            });
        }
    }
    return out;
}
async function fetchOwnerLegalControlPanelAuditSummary() {
    const { data, error } = await supabaseAdmin
        .from('audit_log')
        .select('id, action, entity_type, entity_id, organization_id, created_at')
        .in('entity_type', [...OWNER_LEGAL_CONTROL_AUDIT_ENTITY_TYPES])
        .order('created_at', { ascending: false })
        .limit(50);
    if (error)
        throw error;
    return { recent: (data ?? []) };
}
/**
 * Single read model for GET /api/v1/owner/legal-control.
 * Composes existing owner aggregates only (no extra domain queries beyond audit summary).
 */
export async function buildOwnerLegalControlPanelAggregate(ctx) {
    assertPlatformOwner(ctx);
    const [countryPacksAdmin, legalValues, platformPricing, emailProviderConfig, auditSummary] = await Promise.all([
        buildOwnerCountryPackAdminAggregate(ctx),
        buildOwnerLegalValuesAggregate(ctx),
        buildOwnerPlatformPricingAggregate(ctx),
        buildOwnerEmailProviderConfigAggregate(),
        fetchOwnerLegalControlPanelAuditSummary(),
    ]);
    const tables = countryPacksAdmin.tables;
    const legalTable = legalValues.table;
    const legalValueVersionsFlat = (legalTable ?? []).flatMap((r) => Array.isArray(r.versions) ? r.versions : []);
    const docflowCommunicationTemplates = buildDocflowCommunicationTemplatesFromLegalTable(legalTable ?? []);
    const cpWarnings = countryPacksAdmin.warnings ?? [];
    const lvWarnings = legalValues.validation_warnings ?? [];
    const prWarnings = platformPricing.warnings ?? [];
    return {
        aggregate_key: 'owner_legal_control_panel_aggregate',
        country_packs_admin: countryPacksAdmin,
        legal_values: legalValues,
        platform_pricing: platformPricing,
        owner_email_provider_config_aggregate: emailProviderConfig,
        countries: tables?.countries ?? [],
        country_packs: tables?.country_packs ?? [],
        rulesets: tables?.rulesets ?? [],
        legal_values_table: legalValues.table ?? [],
        legal_value_versions: legalValueVersionsFlat,
        docflow_communication_templates: docflowCommunicationTemplates,
        docflow_communication_quick_actions: [
            {
                action_key: 'create_legal_value',
                enabled: true,
                button_label: 'New DocFlow communication legal value',
                note: 'Creates a legal value row. value_type=json, category=Modules, module_scope=docflow. Then add a version with docflow_communication payload.',
                payload: {
                    country_code: 'ISO 3166-1 alpha-2',
                    value_key: 'string unique per country',
                    label: 'string',
                    category: 'Modules',
                    module_scope: 'docflow',
                    value_type: 'json',
                    status: 'optional draft|active|disabled',
                    usage_hint: 'optional string',
                    owner_note: 'optional string',
                },
            },
            {
                action_key: 'create_legal_value_version',
                enabled: true,
                button_label: 'New legal value version',
                note: 'country_pack_ruleset_id from rulesets table. value_payload_json must match docflow_communication schema (type, message_template, …).',
                payload: {
                    country_code: 'ISO 3166-1 alpha-2',
                    value_key: 'string',
                    country_pack_ruleset_id: 'uuid',
                    effective_from: 'YYYY-MM-DD',
                    effective_to: 'optional YYYY-MM-DD',
                    status: 'optional draft|active|deprecated|disabled',
                    value_payload_json: 'string JSON object docflow_communication template see DocFlow Phase 11 owner contract',
                },
            },
        ],
        pricing: platformPricing.table ?? {},
        warnings: {
            country_pack_admin: cpWarnings,
            legal_values: lvWarnings,
            platform_pricing: prWarnings,
            combined: [...cpWarnings, ...lvWarnings, ...prWarnings],
        },
        available_actions: {
            country_pack_admin: countryPacksAdmin.actions ?? [],
            legal_values: legalValues.actions ?? [],
            platform_pricing: platformPricing.actions ?? [],
            owner_email_provider_config: [
                {
                    action_key: 'save_email_provider_config',
                    enabled: emailProviderConfig.allowed_actions.save_email_provider_config.enabled,
                    button_label: 'Email provider',
                    note: emailProviderConfig.allowed_actions.save_email_provider_config.reason ?? null,
                    payload: {
                        org_id: 'uuid',
                        provider_type: 'resend|sendgrid|smtp|custom_api',
                        provider_display_name: 'optional string',
                        api_key: 'optional string',
                        from_email: 'string',
                        from_name: 'string',
                        smtp_config: 'optional {host,port,user,password}',
                        api_endpoint_url: 'custom_api only: https://...',
                        http_method: 'custom_api only: POST',
                        auth_type: 'custom_api only: bearer_token|api_key_header',
                        auth_header_name: 'custom_api only: Authorization|X-API-Key',
                        recipient_field: 'custom_api only',
                        subject_field: 'custom_api only',
                        html_body_field: 'custom_api only',
                        text_body_field: 'custom_api only',
                        static_headers: 'custom_api only: JSON object',
                        static_payload: 'custom_api only: JSON object',
                        success_response_path: 'custom_api only: string',
                        error_response_path: 'custom_api only: string',
                    },
                },
                {
                    action_key: 'save_platform_public_url',
                    enabled: emailProviderConfig.allowed_actions.save_platform_public_url.enabled,
                    button_label: 'Application URL',
                    note: emailProviderConfig.allowed_actions.save_platform_public_url.reason ?? null,
                    payload: {
                        app_public_url: 'https://app.yourdomain.com',
                    },
                },
            ],
        },
        audit_summary: auditSummary,
    };
}

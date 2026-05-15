import { supabaseAdmin } from '../../db/client.js';
import { forbidden, notFound } from '../../shared/errors.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { resolveCountryContext } from './country-pack-resolver.service.js';
import { assertValidDocflowCommunicationOwnerPayload, isDocflowCommunicationOwnerPayload, } from './docflow-communication-owner-payload.js';
import { buildCommunicationPolicyEditorOptions } from './operational-communication-owner-form.js';
import { OPERATIONAL_COMMUNICATION_POLICIES_CATEGORY, REMINDER_TEMPLATE_VARIABLES, assertValidOperationalReminderPolicyPayload, assertValidOperationalReminderTemplatePayload, isOperationalReminderPolicyPayload, isOperationalReminderTemplatePayload, } from './operational-communication-owner-payload.js';
import { buildOwnerEmailProviderConfigAggregate } from '../../shared/owner-email-provider-config.service.js';
import { fetchDocflowRequestTemplatesForOwner } from '../docflow/docflow-request-templates.service.js';
function normalizeCommercialControlsQuery(input) {
    const page = Math.max(1, Math.floor(Number(input?.page ?? 1) || 1));
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input?.page_size ?? 20) || 20)));
    const searchRaw = typeof input?.search === 'string' ? input.search.trim() : '';
    const search = searchRaw ? searchRaw : null;
    const moduleKeyRaw = typeof input?.module_key === 'string' ? input.module_key.trim() : '';
    const module_key = moduleKeyRaw ? moduleKeyRaw : null;
    const entRaw = typeof input?.entitlement_status === 'string' ? input.entitlement_status.trim() : '';
    const entitlement_status = entRaw ? entRaw : null;
    const actRaw = typeof input?.activation_status === 'string' ? input.activation_status.trim() : '';
    const activation_status = actRaw ? actRaw : null;
    return { page, page_size: pageSize, search, module_key, entitlement_status, activation_status };
}
async function buildOwnerCommercialControlsAggregate(queryInput) {
    const q0 = normalizeCommercialControlsQuery(queryInput);
    const excludedNamePrefix = /^(cc-sync-|cc-bad-|dbg-)/i;
    // Fetch candidate orgs by name search; then apply backend-owned "meaningful org" filter and module filters.
    // Note: we cap candidates to protect the endpoint; pagination is applied AFTER filtering.
    const CANDIDATE_CAP = 5000;
    let orgQuery = supabaseAdmin
        .from('organizations')
        .select('id, name, status, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .limit(CANDIDATE_CAP);
    if (q0.search) {
        orgQuery = orgQuery.ilike('name', `%${q0.search}%`);
    }
    const { data: orgs, error: oErr } = await orgQuery;
    if (oErr)
        throw oErr;
    const orgIdsAll = (orgs ?? []).map((o) => String(o.id)).filter(Boolean);
    if (!orgIdsAll.length) {
        return {
            filters: {
                search: q0.search,
                module_key: q0.module_key,
                entitlement_status: q0.entitlement_status,
                activation_status: q0.activation_status,
            },
            pagination: { page: q0.page, page_size: q0.page_size, total_count: 0, total_pages: 0 },
            org_rows: [],
        };
    }
    // Module catalog for filter dropdowns + per-org module rendering.
    const { data: modules, error: mErr } = await supabaseAdmin
        .from('modules')
        .select('id, code, name, is_system')
        .eq('is_active', true)
        .order('created_at', { ascending: false });
    if (mErr)
        throw mErr;
    const commercialModules = (modules ?? []).filter((m) => !m.is_system);
    const moduleByKey = new Map(commercialModules.map((m) => [String(m.code), { id: String(m.id), name: String(m.name) }]));
    const moduleIdToKey = new Map();
    for (const m of commercialModules) {
        moduleIdToKey.set(String(m.id), { code: String(m.code), name: String(m.name) });
    }
    const moduleIds = commercialModules.map((m) => String(m.id));
    const plansByModule = new Map();
    if (moduleIds.length) {
        const { data: plans, error: pErr } = await supabaseAdmin
            .from('module_plans')
            .select('module_id, currency, price_amount, sort_order')
            .in('module_id', moduleIds)
            .eq('is_active', true)
            .order('sort_order', { ascending: true });
        if (pErr)
            throw pErr;
        for (const p of plans ?? []) {
            const mid = String(p.module_id);
            if (plansByModule.has(mid))
                continue;
            plansByModule.set(mid, { currency: String(p.currency), price_amount: Number(p.price_amount) });
        }
    }
    const activationByOrgModule = new Map();
    const subByOrgModule = new Map();
    const orgHasModuleActivationHistory = new Set();
    const orgHasSubscriptionHistory = new Set();
    if (orgIdsAll.length && moduleIds.length) {
        const [orgModsRes, subsRes] = await Promise.all([
            supabaseAdmin
                .from('organization_modules')
                .select('organization_id, module_id, status')
                .in('organization_id', orgIdsAll)
                .in('module_id', moduleIds),
            supabaseAdmin
                .from('organization_module_subscriptions')
                .select('organization_id, module_id, status, trial_ends_at, ends_at')
                .in('organization_id', orgIdsAll)
                .in('module_id', moduleIds),
        ]);
        if (orgModsRes.error)
            throw orgModsRes.error;
        if (subsRes.error)
            throw subsRes.error;
        for (const r of orgModsRes.data ?? []) {
            const oid = String(r.organization_id);
            orgHasModuleActivationHistory.add(oid);
            activationByOrgModule.set(`${oid}:${String(r.module_id)}`, String(r.status ?? 'inactive'));
        }
        for (const r of subsRes.data ?? []) {
            const oid = String(r.organization_id);
            orgHasSubscriptionHistory.add(oid);
            subByOrgModule.set(`${oid}:${String(r.module_id)}`, {
                status: String(r.status ?? ''),
                trial_ends_at: r.trial_ends_at ? String(r.trial_ends_at) : null,
                ends_at: r.ends_at ? String(r.ends_at) : null,
            });
        }
    }
    const nowYmd = new Date().toISOString().slice(0, 10);
    const activeAdjByOrgModule = new Map();
    const orgHasPricingHistory = new Set();
    if (orgIdsAll.length && moduleIds.length) {
        const { data: adjs, error: aErr } = await supabaseAdmin
            .from('org_module_pricing_adjustments')
            .select('id, organization_id, module_id, adjustment_type, value_amount, effective_from, effective_until, reason, status')
            .in('organization_id', orgIdsAll)
            .in('module_id', moduleIds)
            .eq('status', 'active')
            .lte('effective_from', nowYmd)
            .gte('effective_until', nowYmd);
        if (aErr)
            throw aErr;
        for (const r of adjs ?? []) {
            const oid = String(r.organization_id);
            orgHasPricingHistory.add(oid);
            const key = `${oid}:${String(r.module_id)}`;
            if (activeAdjByOrgModule.has(key))
                continue;
            activeAdjByOrgModule.set(key, {
                id: String(r.id),
                adjustment_type: String(r.adjustment_type),
                value_amount: r.value_amount != null ? Number(r.value_amount) : null,
                effective_from: String(r.effective_from),
                effective_until: String(r.effective_until),
                reason: String(r.reason ?? ''),
            });
        }
    }
    function effectivePrice(base, type, value) {
        if (base == null || !Number.isFinite(base))
            return null;
        if (!type)
            return base;
        if (type === 'free_access')
            return 0;
        const v = value ?? 0;
        if (type === 'discount_amount')
            return Math.max(0, base - v);
        if (type === 'add_amount')
            return Math.max(0, base + v);
        if (type === 'replace_price')
            return Math.max(0, v);
        return base;
    }
    // Full-platform trial state per org (used to compute entitlement without per-org calls)
    const orgHasValidTrial = new Set();
    {
        const { data: trials, error: tErr } = await supabaseAdmin
            .from('organization_trials')
            .select('organization_id')
            .in('organization_id', orgIdsAll)
            .eq('trial_scope', 'full_platform')
            .eq('status', 'trialing')
            .gt('ends_at', new Date().toISOString());
        if (tErr)
            throw tErr;
        for (const r of trials ?? []) {
            orgHasValidTrial.add(String(r.organization_id));
        }
    }
    // For "meaningful org" filtering: we need to know clients_count > 0, but we will only count
    // clients for candidate orgs by reading organization_id rows (still backend-owned).
    // This can be heavy for very large datasets; cap protects owner endpoint.
    const CLIENT_ROWS_CAP = 200_000;
    const clientsCountByOrg = new Map();
    {
        const { data: clientRows, error: cErr } = await supabaseAdmin
            .from('clients')
            .select('organization_id')
            .in('organization_id', orgIdsAll)
            .limit(CLIENT_ROWS_CAP);
        if (cErr)
            throw cErr;
        for (const row of clientRows ?? []) {
            const oid = String(row.organization_id);
            clientsCountByOrg.set(oid, (clientsCountByOrg.get(oid) ?? 0) + 1);
        }
    }
    function computeEntitlementStatus(orgId, moduleId) {
        const sub = subByOrgModule.get(`${orgId}:${moduleId}`) ?? null;
        if (sub) {
            if (sub.status === 'active' || sub.status === 'trialing') {
                if (sub.ends_at && new Date(sub.ends_at) < new Date())
                    return { status: 'expired', reason: 'Subscription ended' };
                if (sub.status === 'trialing' && sub.trial_ends_at && new Date(sub.trial_ends_at) < new Date()) {
                    return { status: 'expired', reason: 'Trial ended' };
                }
                return { status: sub.status === 'trialing' ? 'trial' : 'entitled', reason: null };
            }
            return { status: 'expired', reason: `Subscription status: ${sub.status}` };
        }
        if (orgHasValidTrial.has(orgId))
            return { status: 'trial', reason: null };
        return { status: 'not_entitled', reason: 'No subscription or trial for this module' };
    }
    // Step 1: meaningful org filtering + debug exclusion (backend-owned).
    let meaningful = (orgs ?? []).filter((o) => {
        const orgId = String(o.id);
        const name = String(o.name ?? '').trim();
        const status = String(o.status ?? '').trim().toLowerCase();
        if (!orgId)
            return false;
        if (!name)
            return false;
        if (excludedNamePrefix.test(name))
            return false;
        const clientsCount = clientsCountByOrg.get(orgId) ?? 0;
        const hasClients = clientsCount > 0;
        const hasHistory = orgHasSubscriptionHistory.has(orgId) ||
            orgHasModuleActivationHistory.has(orgId) ||
            orgHasPricingHistory.has(orgId);
        if (hasClients || hasHistory)
            return true;
        if (status !== 'active')
            return false;
        return false;
    });
    // Step 2: apply module filters (backend-owned).
    const filterModule = q0.module_key ? moduleByKey.get(q0.module_key) ?? null : null;
    meaningful = meaningful.filter((o) => {
        const orgId = String(o.id);
        const matchesModule = (moduleId) => {
            if (q0.activation_status) {
                const act = activationByOrgModule.get(`${orgId}:${moduleId}`) ?? 'inactive';
                if (act !== q0.activation_status)
                    return false;
            }
            if (q0.entitlement_status) {
                const ent = computeEntitlementStatus(orgId, moduleId).status;
                if (ent !== q0.entitlement_status)
                    return false;
            }
            return true;
        };
        if (filterModule) {
            return matchesModule(filterModule.id);
        }
        // If no module_key filter, treat other filters as "any module matches"
        if (!q0.activation_status && !q0.entitlement_status)
            return true;
        for (const mid of moduleIds) {
            if (matchesModule(mid))
                return true;
        }
        return false;
    });
    const totalCount = meaningful.length;
    const totalPages = totalCount ? Math.ceil(totalCount / q0.page_size) : 0;
    const page = Math.min(q0.page, Math.max(1, totalPages || 1));
    const start = (page - 1) * q0.page_size;
    const pageOrgs = meaningful.slice(start, start + q0.page_size);
    const orgRows = [];
    for (const o of pageOrgs) {
        const orgId = String(o.id);
        const clientsCount = clientsCountByOrg.get(orgId) ?? 0;
        const modulesOut = [];
        for (const m of commercialModules) {
            const moduleId = String(m.id);
            const modKey = moduleIdToKey.get(moduleId)?.code ?? String(m.code);
            const modName = moduleIdToKey.get(moduleId)?.name ?? String(m.name);
            const activation = activationByOrgModule.get(`${orgId}:${moduleId}`) ?? 'inactive';
            const entitlement = computeEntitlementStatus(orgId, moduleId);
            const sub = subByOrgModule.get(`${orgId}:${moduleId}`) ?? null;
            const base = plansByModule.get(moduleId) ?? null;
            const adj = activeAdjByOrgModule.get(`${orgId}:${moduleId}`) ?? null;
            const adjType = adj ? String(adj.adjustment_type ?? '') : null;
            const adjValue = adj ? (typeof adj.value_amount === 'number' ? adj.value_amount : null) : null;
            const eff = effectivePrice(base ? base.price_amount : null, adjType, adjValue);
            modulesOut.push({
                module_key: modKey,
                module_name: modName,
                activation_status: activation,
                entitlement_status: entitlement.status,
                entitlement_reason: entitlement.reason,
                trial_ends_at: sub?.trial_ends_at ?? null,
                subscription_ends_at: sub?.ends_at ?? null,
                base_price_amount: base ? base.price_amount : null,
                base_price_currency: base ? base.currency : null,
                active_pricing_adjustment: adj,
                effective_price_preview: { currency: base ? base.currency : null, amount: eff },
            });
        }
        orgRows.push({
            org_id: orgId,
            org_name: String(o.name ?? ''),
            clients_count: clientsCount,
            modules: modulesOut,
        });
    }
    return {
        filters: {
            search: q0.search,
            module_key: q0.module_key,
            entitlement_status: q0.entitlement_status,
            activation_status: q0.activation_status,
            options: {
                modules: commercialModules.map((m) => ({ module_key: String(m.code), module_name: String(m.name) })),
                entitlement_statuses: ['entitled', 'trial', 'not_entitled', 'expired'],
                activation_statuses: ['active', 'inactive'],
            },
        },
        pagination: {
            page,
            page_size: q0.page_size,
            total_count: totalCount,
            total_pages: totalPages,
        },
        org_rows: orgRows,
    };
}
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
    const allRows = (values.data ?? []).map((lv) => {
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
    const rows = allRows.filter((r) => !isOperationalCommunicationLegalValueRow(r));
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
                note: 'country_code: IL, US, … (must exist in countries). category: VAT | Income Tax | National Insurance | Credit Points | Pricing | Reports | Calendar | Modules | Operational Communication Policies (use Communication policies section for reminders). value_type: number | percentage | boolean | string | json | money | date.',
                payload: {
                    country_code: 'ISO 3166-1 alpha-2',
                    value_key: 'string',
                    label: 'string',
                    category: 'VAT|Income Tax|National Insurance|Credit Points|Pricing|Reports|Calendar|Modules|Operational Communication Policies (exact label)',
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
    'docflow_request_template_definition',
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
function isOperationalCommunicationLegalValueRow(lv) {
    return String(lv.category ?? '') === OPERATIONAL_COMMUNICATION_POLICIES_CATEGORY;
}
function buildOperationalReminderPoliciesFromLegalTable(legalTable) {
    const out = [];
    for (const lv of legalTable) {
        if (!isOperationalCommunicationLegalValueRow(lv))
            continue;
        const versions = Array.isArray(lv.versions) ? lv.versions : [];
        for (const ver of versions) {
            const vpj = ver.value_payload_json;
            if (!isOperationalReminderPolicyPayload(vpj))
                continue;
            let normalized;
            let parseError = null;
            try {
                normalized = assertValidOperationalReminderPolicyPayload(vpj);
            }
            catch (e) {
                parseError = e instanceof Error ? e.message : 'invalid_payload';
                normalized = {};
            }
            const workflows = Array.isArray(normalized.workflows) ? normalized.workflows : [];
            out.push({
                legal_value_id: lv.id,
                value_key: lv.value_key,
                label: lv.label,
                country_code: lv.country_code,
                version_id: ver.id,
                country_pack_ruleset_id: ver.country_pack_ruleset_id,
                effective_from: ver.effective_from,
                effective_to: ver.effective_to,
                status: ver.status,
                status_badge: ver.status_badge,
                effective_window: ver.effective_window,
                approval_required: normalized.approval_required !== false,
                default_channels: normalized.default_channels ?? [],
                workflow_count: workflows.length,
                cadence_step_count: workflows.reduce((n, w) => n +
                    (Array.isArray(w.cadence_steps)
                        ? w.cadence_steps.length
                        : 0), 0),
                policy_preview: parseError ?? JSON.stringify(normalized).slice(0, 200),
                parse_error: parseError,
                allowed_actions: [
                    { action_key: 'create_legal_value_version', enabled: true, button_label: 'New version' },
                    { action_key: 'update_legal_value_version', enabled: parseError === null, button_label: 'Edit JSON' },
                    { action_key: 'activate_legal_value_version', enabled: ver.status !== 'active' && parseError === null, button_label: 'Activate' },
                    { action_key: 'deactivate_legal_value_version', enabled: ver.status === 'active', button_label: 'Deactivate' },
                ],
            });
        }
    }
    return out;
}
function buildOperationalReminderTemplatesFromLegalTable(legalTable) {
    const out = [];
    for (const lv of legalTable) {
        if (!isOperationalCommunicationLegalValueRow(lv))
            continue;
        const versions = Array.isArray(lv.versions) ? lv.versions : [];
        for (const ver of versions) {
            const vpj = ver.value_payload_json;
            if (!isOperationalReminderTemplatePayload(vpj))
                continue;
            let normalized;
            let parseError = null;
            try {
                normalized = assertValidOperationalReminderTemplatePayload(vpj);
            }
            catch (e) {
                parseError = e instanceof Error ? e.message : 'invalid_payload';
                normalized = {};
            }
            const subject = String(normalized.subject_template ?? '');
            const body = String(normalized.body_template ?? '');
            const preview = parseError !== null
                ? `(invalid: ${parseError})`
                : `${subject} / ${body.length > 120 ? `${body.slice(0, 120)}…` : body}`;
            out.push({
                legal_value_id: lv.id,
                value_key: lv.value_key,
                template_key: normalized.template_key ?? lv.value_key,
                label: lv.label,
                country_code: lv.country_code,
                version_id: ver.id,
                country_pack_ruleset_id: ver.country_pack_ruleset_id,
                effective_from: ver.effective_from,
                effective_to: ver.effective_to,
                status: ver.status,
                status_badge: ver.status_badge,
                effective_window: ver.effective_window,
                workflow_type: normalized.workflow_type,
                language: normalized.language,
                channel: normalized.channel,
                variables: normalized.variables ?? [],
                tone: normalized.tone ?? null,
                template_preview: preview,
                parse_error: parseError,
                value_payload_for_edit: parseError === null ? normalized : vpj,
                allowed_actions: [
                    { action_key: 'create_legal_value_version', enabled: true, button_label: 'New version' },
                    { action_key: 'update_legal_value_version', enabled: parseError === null, button_label: 'Edit JSON' },
                    { action_key: 'activate_legal_value_version', enabled: ver.status !== 'active' && parseError === null, button_label: 'Activate' },
                    { action_key: 'deactivate_legal_value_version', enabled: ver.status === 'active', button_label: 'Deactivate' },
                ],
            });
        }
    }
    return out;
}
function buildCommunicationPoliciesPickerOptions(packContext) {
    const countries = (packContext?.countries ?? []);
    const packs = (packContext?.country_packs ?? []);
    const rulesets = (packContext?.rulesets ?? []);
    return {
        countries: countries.map((c) => {
            const countryCode = String(c.country_code ?? c.code ?? '')
                .trim()
                .toUpperCase();
            return {
                country_code: countryCode,
                name: String(c.name ?? countryCode),
                status: String(c.status ?? ''),
            };
        }),
        country_packs: packs.map((p) => ({
            id: String(p.id ?? ''),
            country_code: String(p.country_code ?? ''),
            pack_code: String(p.pack_code ?? ''),
            name: String(p.name ?? ''),
            status: String(p.status ?? ''),
        })),
        rulesets: rulesets.map((r) => ({
            id: String(r.id ?? ''),
            country_pack_id: String(r.country_pack_id ?? ''),
            ruleset_code: String(r.ruleset_code ?? ''),
            ruleset_version: String(r.ruleset_version ?? ''),
            status: String(r.status ?? ''),
            effective_from: String(r.effective_from ?? ''),
            effective_to: r.effective_to == null ? null : String(r.effective_to),
            effective_window: String(r.effective_window ?? ''),
        })),
    };
}
function buildCommunicationPoliciesSlice(legalTable, packContext) {
    const operationalReminderPolicies = buildOperationalReminderPoliciesFromLegalTable(legalTable);
    const operationalReminderTemplates = buildOperationalReminderTemplatesFromLegalTable(legalTable);
    const pickerOptions = buildCommunicationPoliciesPickerOptions(packContext);
    const validationErrors = [];
    for (const row of operationalReminderPolicies) {
        if (row.parse_error)
            validationErrors.push(`policy:${row.value_key}:${row.parse_error}`);
    }
    for (const row of operationalReminderTemplates) {
        if (row.parse_error)
            validationErrors.push(`template:${row.template_key}:${row.parse_error}`);
    }
    return {
        operational_reminder_policies: operationalReminderPolicies,
        operational_reminder_templates: operationalReminderTemplates,
        validation_errors: validationErrors,
        picker_options: pickerOptions,
        editor_options: {
            ...buildCommunicationPolicyEditorOptions(),
            template_variables: REMINDER_TEMPLATE_VARIABLES.map((code) => ({ code, label: code })),
        },
        flow_note: 'Country → Country Pack → Ruleset → Communication policy/template version. Reuse existing country structure; do not create countries here.',
        quick_actions: [
            {
                action_key: 'save_operational_reminder_policy',
                enabled: pickerOptions.countries.length > 0 && pickerOptions.rulesets.length > 0,
                button_label: 'New reminder policy',
                smart_form: 'reminder_policy',
            },
            {
                action_key: 'save_operational_reminder_template',
                enabled: pickerOptions.countries.length > 0 && pickerOptions.rulesets.length > 0,
                button_label: 'New reminder template',
                smart_form: 'reminder_template',
            },
            {
                action_key: 'save_operational_reminder_version',
                enabled: pickerOptions.countries.length > 0 && pickerOptions.rulesets.length > 0,
                button_label: 'New policy or template version',
                smart_form: 'reminder_version',
            },
        ],
    };
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
export async function buildOwnerLegalControlPanelAggregate(ctx, opts) {
    assertPlatformOwner(ctx);
    const [countryPacksAdmin, legalValues, platformPricing, emailProviderConfig, auditSummary, docflowRequestTemplates, commercialControls,] = await Promise.all([
        buildOwnerCountryPackAdminAggregate(ctx),
        buildOwnerLegalValuesAggregate(ctx),
        buildOwnerPlatformPricingAggregate(ctx),
        buildOwnerEmailProviderConfigAggregate(),
        fetchOwnerLegalControlPanelAuditSummary(),
        fetchDocflowRequestTemplatesForOwner(),
        buildOwnerCommercialControlsAggregate(opts?.commercial_controls),
    ]);
    const tables = countryPacksAdmin.tables;
    const legalTable = legalValues.table;
    const legalValueVersionsFlat = (legalTable ?? []).flatMap((r) => Array.isArray(r.versions) ? r.versions : []);
    const docflowCommunicationTemplates = buildDocflowCommunicationTemplatesFromLegalTable(legalTable ?? []);
    const legalTaxValuesTable = (legalTable ?? []).filter((r) => !isOperationalCommunicationLegalValueRow(r));
    const communicationPolicies = buildCommunicationPoliciesSlice(legalTable ?? [], {
        countries: tables?.countries,
        country_packs: tables?.country_packs,
        rulesets: tables?.rulesets,
    });
    const cpWarnings = countryPacksAdmin.warnings ?? [];
    const lvWarnings = legalValues.validation_warnings ?? [];
    const prWarnings = platformPricing.warnings ?? [];
    const commWarnings = communicationPolicies.validation_errors;
    return {
        aggregate_key: 'owner_legal_control_panel_aggregate',
        country_packs_admin: countryPacksAdmin,
        legal_values: legalValues,
        platform_pricing: platformPricing,
        owner_email_provider_config_aggregate: emailProviderConfig,
        countries: tables?.countries ?? [],
        country_packs: tables?.country_packs ?? [],
        rulesets: tables?.rulesets ?? [],
        legal_values_table: legalTaxValuesTable,
        legal_tax_values: { table: legalTaxValuesTable },
        legal_value_versions: legalValueVersionsFlat.filter((v) => {
            const parent = (legalTable ?? []).find((lv) => lv.id === v.legal_value_id);
            return parent ? !isOperationalCommunicationLegalValueRow(parent) : true;
        }),
        communication_policies: communicationPolicies,
        docflow_communication_templates: docflowCommunicationTemplates,
        docflow_request_templates: docflowRequestTemplates,
        commercial_controls: commercialControls,
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
            communication_policies: commWarnings,
            platform_pricing: prWarnings,
            combined: [...cpWarnings, ...lvWarnings, ...commWarnings, ...prWarnings],
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
            docflow_request_templates: [
                {
                    action_key: 'save_request_template_definition',
                    enabled: true,
                    button_label: 'Save document request template',
                    note: 'Full replace of name, country, and checklist items. Omit template_definition_id to create.',
                    payload: {
                        template_definition_id: 'optional uuid',
                        country_code: 'IL',
                        name: 'string',
                        items: [{ label: 'string', description: 'optional string' }],
                    },
                },
                {
                    action_key: 'archive_request_template_definition',
                    enabled: true,
                    button_label: 'Archive document request template',
                    note: null,
                    payload: { template_definition_id: 'uuid' },
                },
            ],
            commercial_controls: [
                {
                    action_key: 'extend_org_module_trial',
                    enabled: true,
                    button_label: 'Extend Trial',
                    note: null,
                    payload: { org_id: 'uuid', module_key: 'docflow', expires_at: 'ISO datetime', reason: 'string' },
                },
                {
                    action_key: 'activate_org_module_access',
                    enabled: true,
                    button_label: 'Activate Module',
                    note: null,
                    payload: { org_id: 'uuid', module_key: 'docflow', active_from: 'ISO datetime', active_until: 'optional ISO datetime', reason: 'string' },
                },
                {
                    action_key: 'create_pricing_adjustment',
                    enabled: true,
                    button_label: 'Pricing Adjustment',
                    note: null,
                    payload: {
                        org_id: 'uuid',
                        module_key: 'docflow',
                        adjustment_type: 'discount_amount|replace_price|add_amount|free_access',
                        value: 'number (not required for free_access)',
                        start_date: 'YYYY-MM-DD',
                        end_date: 'YYYY-MM-DD',
                        reason: 'string',
                    },
                },
                {
                    action_key: 'cancel_pricing_adjustment',
                    enabled: true,
                    button_label: 'Cancel Pricing Adjustment',
                    note: null,
                    payload: { pricing_adjustment_id: 'uuid', reason: 'optional string' },
                },
            ],
        },
        audit_summary: auditSummary,
    };
}

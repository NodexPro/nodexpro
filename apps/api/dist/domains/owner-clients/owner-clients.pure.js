/**
 * Platform owner — Clients list + detail modal aggregates (pure shaping).
 */
import { buildCustomerHealthNextStep, buildMonthlyValueLabel, resolveCustomerContact, } from '../owner-system-health/owner-system-health.pure.js';
const SUBSCRIPTION_STATUS_LABELS = {
    active: 'Active',
    trial: 'Trial',
    expired: 'Expired',
    inactive: 'Inactive',
};
const HEALTH_STATUS_LABELS = {
    healthy: 'Healthy',
    critical: 'Critical',
    warning: 'Warning',
    info: 'Info',
};
const SEVERITY_RANK = { critical: 0, warning: 1, info: 2, healthy: 3, none: 4 };
export const OWNER_CLIENT_DETAIL_TABS = [
    { tab_key: 'overview', label: 'Overview' },
    { tab_key: 'modules', label: 'Modules' },
    { tab_key: 'billing', label: 'Billing' },
    { tab_key: 'users', label: 'Users' },
    { tab_key: 'usage', label: 'Usage' },
    { tab_key: 'health', label: 'Health' },
    { tab_key: 'logs', label: 'Logs' },
];
export const NOT_MEASURED_LABEL = 'Not measured yet';
export const NO_DATA_LABEL = 'No data recorded yet';
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Backend-prepared short date label, e.g. "08 Jul 2026". Frontend must render this only. */
export function formatOwnerClientActivityLabel(iso) {
    if (!iso)
        return 'No activity recorded';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return 'No activity recorded';
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = SHORT_MONTHS[date.getUTCMonth()] ?? '';
    const year = date.getUTCFullYear();
    return `${day} ${month} ${year}`;
}
export function normalizeOwnerClientFilters(filters) {
    const clean = (raw) => {
        const value = (raw ?? '').trim();
        return value ? value : null;
    };
    return {
        country: clean(filters?.country),
        plan: clean(filters?.plan),
        status: clean(filters?.status),
        module: clean(filters?.module),
        health: clean(filters?.health),
        include_hidden: filters?.include_hidden === true,
    };
}
const ORGANIZATION_KIND_LABELS = {
    real: 'Real',
    test: 'Test',
    sync: 'Sync',
    demo: 'Demo',
    unknown: 'Unknown',
};
/**
 * Backend-owned organization classification. System-generated test/sync/debug orgs
 * (matching the same prefixes excluded by the commercial-controls aggregate) are
 * hidden by default. Nothing is deleted; visibility is a prepared field only.
 */
export function classifyOrganization(name) {
    const normalized = (name ?? '').trim().toLowerCase();
    let kind = 'real';
    let systemGenerated = false;
    if (/^cc-sync-/.test(normalized)) {
        kind = 'sync';
        systemGenerated = true;
    }
    else if (/^(cc-bad-|dbg-|test-)/.test(normalized) || /\btest\b/.test(normalized)) {
        kind = 'test';
        systemGenerated = true;
    }
    else if (/^demo-/.test(normalized) || /\bdemo\b/.test(normalized)) {
        kind = 'demo';
        systemGenerated = true;
    }
    return {
        organization_kind: kind,
        organization_kind_label: ORGANIZATION_KIND_LABELS[kind],
        is_system_generated: systemGenerated,
        is_hidden_by_default: systemGenerated,
    };
}
/** Email column value. Prefers owner/login email; frontend renders this only. */
export function buildEmailDisplay(params) {
    return params.owner_email ?? params.login_email ?? params.primary_email ?? '—';
}
export function buildOwnerClientActions(contactEmail) {
    const contact = contactEmail
        ? {
            action_key: 'contact_customer',
            label: 'Contact',
            enabled: true,
            reason: null,
            kind: 'mailto',
            icon: 'at',
            href: `mailto:${contactEmail}`,
        }
        : {
            action_key: 'contact_customer',
            label: 'Contact',
            enabled: false,
            reason: 'No contact email available.',
            kind: 'disabled',
            icon: 'at',
            href: null,
        };
    return [
        {
            action_key: 'open_client_modal',
            label: 'Open',
            enabled: true,
            reason: null,
            kind: 'modal',
            icon: 'folder',
            href: null,
        },
        contact,
    ];
}
export function buildCountLabel(count, singular, plural) {
    if (count == null)
        return NOT_MEASURED_LABEL;
    return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}
export function buildUsageLabel(activationStatus, entitlementStatus) {
    if (activationStatus === 'active' && (entitlementStatus === 'entitled' || entitlementStatus === 'trial')) {
        return 'In use';
    }
    if (activationStatus === 'active')
        return 'Active, not entitled';
    return activationStatus.charAt(0).toUpperCase() + activationStatus.slice(1);
}
export function computeOrgSubscriptionStatus(entitlements) {
    if (!entitlements.length) {
        return { status: 'inactive', label: SUBSCRIPTION_STATUS_LABELS.inactive };
    }
    const statuses = entitlements.map((e) => e.entitlement_status);
    if (statuses.some((s) => s === 'entitled')) {
        return { status: 'active', label: SUBSCRIPTION_STATUS_LABELS.active };
    }
    if (statuses.some((s) => s === 'trial')) {
        return { status: 'trial', label: SUBSCRIPTION_STATUS_LABELS.trial };
    }
    if (statuses.some((s) => s === 'expired')) {
        return { status: 'expired', label: SUBSCRIPTION_STATUS_LABELS.expired };
    }
    return { status: 'inactive', label: SUBSCRIPTION_STATUS_LABELS.inactive };
}
export function resolveHealthFromIssue(params) {
    if (!params.issue_key || !params.severity) {
        return {
            health_status: 'healthy',
            health_status_label: HEALTH_STATUS_LABELS.healthy,
            health_tone: 'healthy',
            row_border_tone: 'none',
            primary_issue_label: 'No issues detected',
            next_step_label: '—',
        };
    }
    const nextStep = buildCustomerHealthNextStep(params.issue_key, params.severity);
    return {
        health_status: params.severity,
        health_status_label: HEALTH_STATUS_LABELS[params.severity] ?? params.severity,
        health_tone: params.severity,
        row_border_tone: params.severity,
        primary_issue_label: params.issue_label ?? 'Unknown issue',
        next_step_label: nextStep.next_step_label,
    };
}
export function buildOwnerClientListRow(params) {
    const { contact_email, contact_label } = resolveCustomerContact({
        billing_email: params.billing_email,
        primary_email: params.primary_email,
        owner_email: params.owner_email,
    });
    const subscription = computeOrgSubscriptionStatus(params.active_modules.map((m) => ({ entitlement_status: m.entitlement_status })));
    const usedModules = params.active_modules.filter((m) => m.status === 'active' && (m.entitlement_status === 'entitled' || m.entitlement_status === 'trial'));
    const health = resolveHealthFromIssue({
        issue_key: params.health_issue?.issue_key ?? null,
        issue_label: params.health_issue?.issue_label ?? null,
        severity: params.health_issue?.severity ?? null,
    });
    const classification = classifyOrganization(params.organization_name);
    const email_display = buildEmailDisplay({
        owner_email: params.owner_email,
        login_email: params.login_email,
        primary_email: params.primary_email,
    });
    return {
        organization_id: params.organization_id,
        organization_display: params.organization_name,
        country_code: params.country_code,
        country_label: params.country_label,
        organization_kind: classification.organization_kind,
        organization_kind_label: classification.organization_kind_label,
        is_system_generated: classification.is_system_generated,
        is_hidden_by_default: classification.is_hidden_by_default,
        owner_name: params.owner_name ?? '—',
        login_email: params.login_email,
        owner_email: params.owner_email,
        billing_email: params.billing_email,
        primary_email: params.primary_email,
        contact_email,
        contact_label,
        email_display,
        subscription_status: subscription.status,
        subscription_status_label: subscription.label,
        plan_label: params.plan_label,
        mrr_value: params.mrr_value,
        mrr_currency: params.mrr_currency,
        mrr_label: buildMonthlyValueLabel(params.mrr_value, params.mrr_currency),
        active_modules: params.active_modules,
        active_modules_label: params.active_modules.length > 0
            ? params.active_modules.map((m) => m.label).join(', ')
            : 'No active modules',
        modules_count: params.active_modules.length,
        modules_count_label: buildCountLabel(params.active_modules.length, 'module', 'modules'),
        used_modules_label: usedModules.length > 0 ? usedModules.map((m) => m.label).join(', ') : 'No modules in use',
        tenant_clients_count: params.tenant_clients_count,
        tenant_clients_count_label: buildCountLabel(params.tenant_clients_count, 'client', 'clients'),
        users_count: params.users_count,
        users_count_label: buildCountLabel(params.users_count, 'user', 'users'),
        documents_count: params.documents_count,
        documents_count_label: buildCountLabel(params.documents_count, 'document', 'documents'),
        last_activity_at: params.last_activity_at,
        last_activity_label: formatOwnerClientActivityLabel(params.last_activity_at),
        time_spent_label: NOT_MEASURED_LABEL,
        health_status: health.health_status,
        health_status_label: health.health_status_label,
        health_tone: health.health_tone,
        row_border_tone: health.row_border_tone,
        primary_issue_label: health.primary_issue_label,
        next_step_label: health.next_step_label,
        available_actions: buildOwnerClientActions(contact_email),
    };
}
function buildFilterOptions(rows) {
    const countries = new Map();
    const plans = new Set();
    const statuses = new Map();
    const modules = new Map();
    const health = new Map();
    for (const row of rows) {
        if (row.country_code)
            countries.set(row.country_code, row.country_label);
        if (row.plan_label && row.plan_label !== '—')
            plans.add(row.plan_label);
        statuses.set(row.subscription_status, row.subscription_status_label);
        for (const mod of row.active_modules) {
            modules.set(mod.module_key, mod.label);
        }
        health.set(row.health_status, row.health_status_label);
    }
    return {
        countries: [...countries.entries()]
            .sort((a, b) => a[1].localeCompare(b[1]))
            .map(([value, label]) => ({ value, label })),
        plans: [...plans].sort().map((value) => ({ value, label: value })),
        statuses: [...statuses.entries()]
            .sort((a, b) => a[1].localeCompare(b[1]))
            .map(([value, label]) => ({ value, label })),
        modules: [...modules.entries()]
            .sort((a, b) => a[1].localeCompare(b[1]))
            .map(([value, label]) => ({ value, label })),
        health: [...health.entries()]
            .sort((a, b) => (SEVERITY_RANK[a[0]] ?? 99) - (SEVERITY_RANK[b[0]] ?? 99))
            .map(([value, label]) => ({ value, label })),
        visibility: [{ value: 'include_hidden', label: 'Show hidden/test organizations' }],
    };
}
function applyOwnerClientFilters(rows, filters) {
    return rows.filter((row) => {
        if (filters.country && row.country_code !== filters.country)
            return false;
        if (filters.plan && row.plan_label !== filters.plan)
            return false;
        if (filters.status && row.subscription_status !== filters.status)
            return false;
        if (filters.module && !row.active_modules.some((m) => m.module_key === filters.module))
            return false;
        if (filters.health && row.health_status !== filters.health)
            return false;
        return true;
    });
}
function buildListSummary(allRows, filteredRows) {
    const missingContacts = filteredRows.filter((row) => !row.contact_email).length;
    const seenMrr = new Set();
    const currencies = new Set();
    let totalMrr = 0;
    let mrrCounted = 0;
    for (const row of filteredRows) {
        if (row.mrr_value == null)
            continue;
        const key = row.organization_id;
        if (seenMrr.has(key))
            continue;
        seenMrr.add(key);
        totalMrr += row.mrr_value;
        mrrCounted += 1;
        if (row.mrr_currency)
            currencies.add(row.mrr_currency);
    }
    let totalMrrLabel = '—';
    if (mrrCounted > 0 && currencies.size === 1) {
        const currency = [...currencies][0] ?? null;
        totalMrrLabel = buildMonthlyValueLabel(totalMrr, currency);
    }
    const atRiskOrgs = new Set(filteredRows
        .filter((row) => row.health_status !== 'healthy' && row.mrr_value != null)
        .map((row) => row.organization_id));
    const riskCurrencies = new Set();
    let riskMrr = 0;
    for (const row of filteredRows) {
        if (!atRiskOrgs.has(row.organization_id) || row.mrr_value == null)
            continue;
        riskMrr += row.mrr_value;
        if (row.mrr_currency)
            riskCurrencies.add(row.mrr_currency);
    }
    let revenueAtRiskLabel = '—';
    if (atRiskOrgs.size > 0 && riskCurrencies.size === 1) {
        revenueAtRiskLabel = buildMonthlyValueLabel(riskMrr, [...riskCurrencies][0] ?? null);
    }
    return {
        total_organizations: new Set(allRows.map((r) => r.organization_id)).size,
        active_organizations: filteredRows.filter((r) => r.subscription_status === 'active').length,
        trial_organizations: filteredRows.filter((r) => r.subscription_status === 'trial').length,
        expired_organizations: filteredRows.filter((r) => r.subscription_status === 'expired').length,
        total_mrr_label: totalMrrLabel,
        revenue_at_risk_label: revenueAtRiskLabel,
        missing_contacts_count: missingContacts,
    };
}
/** Guarantees exactly one row per organization regardless of input ordering/duplication. */
function dedupeRowsByOrganization(rows) {
    const byOrg = new Map();
    for (const row of rows) {
        if (!byOrg.has(row.organization_id))
            byOrg.set(row.organization_id, row);
    }
    return [...byOrg.values()];
}
export function buildOwnerClientsListAggregate(params) {
    const uniqueRows = dedupeRowsByOrganization(params.rows);
    const appliedFilters = normalizeOwnerClientFilters(params.filters);
    // Visibility is backend-owned: hidden/system-generated orgs are excluded unless include_hidden.
    const visibleRows = appliedFilters.include_hidden
        ? uniqueRows
        : uniqueRows.filter((row) => !row.is_hidden_by_default);
    const filterOptions = buildFilterOptions(visibleRows);
    const filteredRows = applyOwnerClientFilters(visibleRows, appliedFilters);
    return {
        aggregate_key: 'owner_clients_aggregate',
        summary: buildListSummary(visibleRows, filteredRows),
        filter_options: filterOptions,
        applied_filters: appliedFilters,
        rows: filteredRows,
    };
}
export function buildOwnerClientDetailAggregate(params) {
    return {
        aggregate_key: 'owner_client_detail_aggregate',
        organization_id: params.organization_id,
        header: {
            organization_display: params.organization_name,
            country_label: params.country_label,
            health_status_label: params.health_status_label,
            mrr_label: params.mrr_label,
            contact_email: params.contact_email,
        },
        tabs: OWNER_CLIENT_DETAIL_TABS,
        overview: params.overview,
        modules: params.modules,
        billing: params.billing,
        users: params.users,
        usage: params.usage,
        health: params.health,
        logs: params.logs,
    };
}

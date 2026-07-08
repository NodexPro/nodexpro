/**
 * Platform owner — Clients list aggregate loader.
 */
import { buildOwnerClientListRow, buildOwnerClientsListAggregate, buildUsageLabel, } from './owner-clients.pure.js';
import { computeEntitlementStatus, loadCommercialModules, loadCountByOrg, loadCountryLabels, loadLastActivityByOrg, loadOrgHealthIssuesByOrg, loadOrgModuleActivations, loadOrgOwners, loadOrganizations, loadOrgSubscriptions, loadOrgValidTrials, } from './owner-clients.shared-read.js';
function buildOrgMrr(subscriptions) {
    const active = subscriptions.filter((s) => s.status === 'active' || s.status === 'trialing');
    if (!active.length) {
        return { value: null, currency: null, plan_label: '—' };
    }
    const currencies = new Set(active.map((s) => s.currency).filter(Boolean));
    const planNames = [...new Set(active.map((s) => s.plan_name).filter(Boolean))];
    const plan_label = planNames.length === 1 ? planNames[0] : planNames.length > 1 ? 'Multiple plans' : '—';
    if (currencies.size !== 1) {
        return { value: null, currency: null, plan_label };
    }
    const currency = [...currencies][0] ?? null;
    const value = active.reduce((sum, s) => sum + (s.price_amount ?? 0), 0);
    return { value, currency, plan_label };
}
function buildActiveModules(orgId, activations, subscriptions, orgHasValidTrial, commercialModules) {
    const activeOnly = (activations.get(orgId) ?? []).filter((a) => a.status === 'active');
    const moduleById = new Map(commercialModules.map((m) => [m.id, m]));
    return activeOnly.map((activation) => {
        const entitlement_status = computeEntitlementStatus({
            orgId,
            moduleId: activation.module_id,
            subscriptions: subscriptions.filter((s) => s.organization_id === orgId),
            orgHasValidTrial,
        });
        return {
            module_key: activation.module_key,
            label: activation.module_label,
            status: activation.status,
            entitlement_status,
            usage_label: buildUsageLabel(activation.status, entitlement_status),
        };
    });
}
export async function loadOwnerClientsListData(filters) {
    const [organizations, countryLabels, commercialModules, healthIssuesByOrg,] = await Promise.all([
        loadOrganizations(),
        loadCountryLabels(),
        loadCommercialModules(),
        loadOrgHealthIssuesByOrg(),
    ]);
    const orgIds = organizations.map((o) => o.id);
    const [ownersByOrg, activationsByOrg, subscriptionsByOrg, validTrials, clientsCountByOrg, usersCountByOrg, documentsCountByOrg, lastActivityByOrg,] = await Promise.all([
        loadOrgOwners(orgIds),
        loadOrgModuleActivations(orgIds, commercialModules),
        loadOrgSubscriptions(orgIds),
        loadOrgValidTrials(orgIds),
        loadCountByOrg('clients', orgIds, { archived: false }),
        loadCountByOrg('organization_users', orgIds, { membershipStatus: 'active' }),
        loadCountByOrg('income_documents', orgIds),
        loadLastActivityByOrg(orgIds),
    ]);
    const rows = organizations.map((org) => {
        const owner = ownersByOrg.get(org.id);
        const ownerEmail = owner?.owner_email ?? null;
        const loginEmail = owner?.login_email ?? null;
        const fallbackEmail = ownerEmail ?? loginEmail;
        const subscriptions = subscriptionsByOrg.get(org.id) ?? [];
        const mrr = buildOrgMrr(subscriptions);
        const active_modules = buildActiveModules(org.id, activationsByOrg, subscriptions, validTrials.has(org.id), commercialModules);
        const country_label = org.country_code
            ? countryLabels.get(org.country_code) ?? org.country_code
            : 'Unknown';
        return buildOwnerClientListRow({
            organization_id: org.id,
            organization_name: org.name,
            country_code: org.country_code,
            country_label,
            owner_name: owner?.owner_name ?? null,
            login_email: loginEmail,
            owner_email: ownerEmail,
            billing_email: fallbackEmail,
            primary_email: fallbackEmail,
            plan_label: mrr.plan_label,
            mrr_value: mrr.value,
            mrr_currency: mrr.currency,
            active_modules,
            tenant_clients_count: clientsCountByOrg.get(org.id) ?? 0,
            users_count: usersCountByOrg.get(org.id) ?? 0,
            documents_count: documentsCountByOrg.get(org.id) ?? 0,
            last_activity_at: lastActivityByOrg.get(org.id) ?? org.updated_at ?? null,
            health_issue: healthIssuesByOrg.get(org.id) ?? null,
        });
    });
    return buildOwnerClientsListAggregate({ rows, filters });
}

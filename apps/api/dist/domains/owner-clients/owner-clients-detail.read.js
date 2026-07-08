/**
 * Platform owner — Client detail modal aggregate loader.
 */
import { notFound } from '../../shared/errors.js';
import { buildLastActivityLabel, buildMonthlyValueLabel, resolveCustomerContact } from '../owner-system-health/owner-system-health.pure.js';
import { buildOwnerClientDetailAggregate, buildCountLabel, computeOrgSubscriptionStatus, NO_DATA_LABEL, NOT_MEASURED_LABEL, resolveHealthFromIssue, } from './owner-clients.pure.js';
import { computeEntitlementStatus, loadCommercialModules, loadCountByOrg, loadCountryLabels, loadLastActivityByOrg, loadOrgHealthIssuesByOrg, loadOrgModuleActivations, loadOrgOwners, loadOrgSubscriptions, loadOrgUsersForDetail, loadOrgValidTrials, loadOrganizations, loadRecentAuditLogs, } from './owner-clients.shared-read.js';
import { buildUsageLabel } from './owner-clients.pure.js';
export async function loadOwnerClientDetailData(organizationId) {
    const organizations = await loadOrganizations();
    const org = organizations.find((o) => o.id === organizationId);
    if (!org)
        throw notFound('Organization not found', 'ORGANIZATION_NOT_FOUND');
    const commercialModules = await loadCommercialModules();
    const [countryLabels, ownersByOrg, subscriptionsByOrg, activationsByOrg, validTrials, healthIssuesByOrg, clientsCountByOrg, usersCountByOrg, documentsCountByOrg, workItemsCountByOrg, lastActivityByOrg, users, logs,] = await Promise.all([
        loadCountryLabels(),
        loadOrgOwners([organizationId]),
        loadOrgSubscriptions([organizationId]),
        loadOrgModuleActivations([organizationId], commercialModules),
        loadOrgValidTrials([organizationId]),
        loadOrgHealthIssuesByOrg(),
        loadCountByOrg('clients', [organizationId], { archived: false }),
        loadCountByOrg('organization_users', [organizationId], { membershipStatus: 'active' }),
        loadCountByOrg('income_documents', [organizationId]),
        loadCountByOrg('work_items', [organizationId]),
        loadLastActivityByOrg([organizationId]),
        loadOrgUsersForDetail(organizationId),
        loadRecentAuditLogs(organizationId),
    ]);
    const owner = ownersByOrg.get(organizationId);
    const ownerEmail = owner?.owner_email ?? null;
    const { contact_email } = resolveCustomerContact({
        billing_email: ownerEmail,
        primary_email: ownerEmail,
        owner_email: ownerEmail,
    });
    const subscriptions = subscriptionsByOrg.get(organizationId) ?? [];
    const currencies = new Set(subscriptions
        .filter((s) => s.status === 'active' || s.status === 'trialing')
        .map((s) => s.currency)
        .filter(Boolean));
    let mrrValue = null;
    let mrrCurrency = null;
    if (currencies.size === 1) {
        mrrCurrency = [...currencies][0] ?? null;
        mrrValue = subscriptions
            .filter((s) => s.status === 'active' || s.status === 'trialing')
            .reduce((sum, s) => sum + (s.price_amount ?? 0), 0);
    }
    const mrr_label = buildMonthlyValueLabel(mrrValue, mrrCurrency);
    const healthIssue = healthIssuesByOrg.get(organizationId) ?? null;
    const health = resolveHealthFromIssue({
        issue_key: healthIssue?.issue_key ?? null,
        issue_label: healthIssue?.issue_label ?? null,
        severity: healthIssue?.severity ?? null,
    });
    const country_label = org.country_code
        ? countryLabels.get(org.country_code) ?? org.country_code
        : 'Unknown';
    const activations = (activationsByOrg.get(organizationId) ?? []).filter((a) => a.status === 'active');
    const moduleRows = activations.map((activation) => {
        const entitlement_status = computeEntitlementStatus({
            orgId: organizationId,
            moduleId: activation.module_id,
            subscriptions,
            orgHasValidTrial: validTrials.has(organizationId),
        });
        const sub = subscriptions.find((s) => s.module_id === activation.module_id) ?? null;
        return {
            module_key: activation.module_key,
            module_label: activation.module_label,
            activation_status: activation.status,
            entitlement_status,
            usage_label: buildUsageLabel(activation.status, entitlement_status),
            plan_label: sub?.plan_name ?? '—',
            subscription_status: sub?.status ?? 'none',
        };
    });
    const subscription = computeOrgSubscriptionStatus(moduleRows.map((m) => ({ entitlement_status: m.entitlement_status })));
    const planNames = [...new Set(subscriptions.map((s) => s.plan_name).filter(Boolean))];
    const plan_label = planNames.length === 1 ? planNames[0] : planNames.length > 1 ? 'Multiple plans' : '—';
    const users_count = usersCountByOrg.get(organizationId) ?? 0;
    const tenant_clients_count = clientsCountByOrg.get(organizationId) ?? 0;
    const documents_count = documentsCountByOrg.get(organizationId) ?? 0;
    const last_activity_at = lastActivityByOrg.get(organizationId) ?? org.updated_at ?? null;
    const billingSubscriptions = subscriptions.map((sub) => {
        const mod = commercialModules.find((m) => m.id === sub.module_id);
        return {
            module_key: mod?.code ?? sub.module_id,
            module_label: mod?.name ?? sub.module_id,
            plan_label: sub.plan_name ?? '—',
            status: sub.status,
            mrr_label: buildMonthlyValueLabel(sub.price_amount, sub.currency),
            ends_at: sub.ends_at,
            trial_ends_at: sub.trial_ends_at,
        };
    });
    return buildOwnerClientDetailAggregate({
        organization_id: organizationId,
        organization_name: org.name,
        country_label,
        contact_email,
        mrr_label,
        health_status_label: health.health_status_label,
        overview: {
            organization_display: org.name,
            country_label,
            organization_status: org.status,
            created_at_label: org.created_at,
            contact_email,
            owner_name: owner?.owner_name ?? '—',
            subscription_status_label: subscription.label,
            plan_label,
            users_count_label: buildCountLabel(users_count, 'user', 'users'),
            tenant_clients_count_label: buildCountLabel(tenant_clients_count, 'client', 'clients'),
            documents_count_label: buildCountLabel(documents_count, 'document', 'documents'),
            last_activity_label: buildLastActivityLabel(last_activity_at),
            time_spent_label: NOT_MEASURED_LABEL,
            next_step_label: health.next_step_label,
            primary_issue_label: health.primary_issue_label,
        },
        modules: moduleRows,
        billing: {
            mrr_label,
            subscriptions: billingSubscriptions,
            note: billingSubscriptions.length ? null : NO_DATA_LABEL,
        },
        users: users.length ? users : [],
        usage: {
            tenant_clients_count,
            tenant_clients_count_label: buildCountLabel(tenant_clients_count, 'client', 'clients'),
            documents_count,
            documents_count_label: buildCountLabel(documents_count, 'document', 'documents'),
            work_items_count: workItemsCountByOrg.get(organizationId) ?? 0,
            work_items_count_label: buildCountLabel(workItemsCountByOrg.get(organizationId) ?? 0, 'work item', 'work items'),
            time_spent_label: NOT_MEASURED_LABEL,
        },
        health: {
            health_status_label: health.health_status_label,
            primary_issue_label: health.primary_issue_label,
            next_step_label: health.next_step_label,
            issues: healthIssue
                ? [
                    {
                        issue_key: healthIssue.issue_key,
                        issue_label: healthIssue.issue_label,
                        severity: healthIssue.severity,
                    },
                ]
                : [],
            note: healthIssue ? null : 'No customer health issues detected for this organization.',
        },
        logs: logs.length ? logs : [],
    });
}

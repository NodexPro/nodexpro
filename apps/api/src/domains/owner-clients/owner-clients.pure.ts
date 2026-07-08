/**
 * Platform owner — Clients list + detail modal aggregates (pure shaping).
 */

import {
  buildCustomerHealthNextStep,
  buildLastActivityLabel,
  buildMonthlyValueLabel,
  resolveCustomerContact,
  type SystemHealthSeverity,
} from '../owner-system-health/owner-system-health.pure.js';

export type OwnerClientHealthTone = SystemHealthSeverity | 'healthy' | 'none';
export type OwnerClientBorderTone = SystemHealthSeverity | 'none';
export type OwnerClientActionKind = 'modal' | 'mailto' | 'disabled';

export type OwnerClientActionDescriptor = {
  action_key: 'open_client_modal' | 'contact_customer';
  label: string;
  enabled: boolean;
  reason: string | null;
  kind: OwnerClientActionKind;
  href: string | null;
};

export type OwnerClientActiveModule = {
  module_key: string;
  label: string;
  status: string;
  entitlement_status: string;
  usage_label: string;
};

export type OwnerClientListRow = {
  organization_id: string;
  organization_display: string;
  country_code: string | null;
  country_label: string;
  owner_name: string;
  owner_email: string | null;
  billing_email: string | null;
  primary_email: string | null;
  contact_email: string | null;
  contact_label: string;
  subscription_status: string;
  subscription_status_label: string;
  plan_label: string;
  mrr_value: number | null;
  mrr_currency: string | null;
  mrr_label: string;
  active_modules: OwnerClientActiveModule[];
  active_modules_label: string;
  used_modules_label: string;
  tenant_clients_count: number | null;
  tenant_clients_count_label: string;
  users_count: number;
  users_count_label: string;
  documents_count: number | null;
  documents_count_label: string;
  last_activity_at: string | null;
  last_activity_label: string;
  time_spent_label: string;
  health_status: string;
  health_status_label: string;
  health_tone: OwnerClientHealthTone;
  row_border_tone: OwnerClientBorderTone;
  primary_issue_label: string;
  next_step_label: string;
  available_actions: OwnerClientActionDescriptor[];
};

export type OwnerClientFilterOption = { value: string; label: string };

export type OwnerClientFilterOptions = {
  countries: OwnerClientFilterOption[];
  plans: OwnerClientFilterOption[];
  statuses: OwnerClientFilterOption[];
  modules: OwnerClientFilterOption[];
  health: OwnerClientFilterOption[];
};

export type OwnerClientFilters = {
  country: string | null;
  plan: string | null;
  status: string | null;
  module: string | null;
  health: string | null;
};

export type OwnerClientListSummary = {
  total_organizations: number;
  active_organizations: number;
  trial_organizations: number;
  expired_organizations: number;
  total_mrr_label: string;
  revenue_at_risk_label: string;
  missing_contacts_count: number;
};

export type OwnerClientsListAggregate = {
  aggregate_key: 'owner_clients_aggregate';
  summary: OwnerClientListSummary;
  filter_options: OwnerClientFilterOptions;
  applied_filters: OwnerClientFilters;
  rows: OwnerClientListRow[];
};

export type OwnerClientDetailTab = { tab_key: string; label: string };

export type OwnerClientDetailAggregate = {
  aggregate_key: 'owner_client_detail_aggregate';
  organization_id: string;
  header: {
    organization_display: string;
    country_label: string;
    health_status_label: string;
    mrr_label: string;
    contact_email: string | null;
  };
  tabs: OwnerClientDetailTab[];
  overview: Record<string, string | number | null>;
  modules: Array<Record<string, string | null>>;
  billing: Record<string, string | number | null | Array<Record<string, string | null>>>;
  users: Array<Record<string, string | null>>;
  usage: Record<string, string | number | null>;
  health: Record<string, string | number | null | Array<Record<string, string | null>>>;
  logs: Array<Record<string, string | null>>;
};

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  trial: 'Trial',
  expired: 'Expired',
  inactive: 'Inactive',
};

const HEALTH_STATUS_LABELS: Record<string, string> = {
  healthy: 'Healthy',
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
};

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2, healthy: 3, none: 4 };

export const OWNER_CLIENT_DETAIL_TABS: OwnerClientDetailTab[] = [
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

export function normalizeOwnerClientFilters(
  filters: Partial<OwnerClientFilters> | null | undefined,
): OwnerClientFilters {
  const clean = (raw: string | null | undefined): string | null => {
    const value = (raw ?? '').trim();
    return value ? value : null;
  };
  return {
    country: clean(filters?.country),
    plan: clean(filters?.plan),
    status: clean(filters?.status),
    module: clean(filters?.module),
    health: clean(filters?.health),
  };
}

export function buildOwnerClientActions(contactEmail: string | null): OwnerClientActionDescriptor[] {
  const contact: OwnerClientActionDescriptor = contactEmail
    ? {
        action_key: 'contact_customer',
        label: 'Contact customer',
        enabled: true,
        reason: null,
        kind: 'mailto',
        href: `mailto:${contactEmail}`,
      }
    : {
        action_key: 'contact_customer',
        label: 'Contact customer',
        enabled: false,
        reason: 'No contact email available.',
        kind: 'disabled',
        href: null,
      };
  return [
    {
      action_key: 'open_client_modal',
      label: 'Open client',
      enabled: true,
      reason: null,
      kind: 'modal',
      href: null,
    },
    contact,
  ];
}

export function buildCountLabel(count: number | null, singular: string, plural: string): string {
  if (count == null) return NOT_MEASURED_LABEL;
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

export function buildUsageLabel(activationStatus: string, entitlementStatus: string): string {
  if (activationStatus === 'active' && (entitlementStatus === 'entitled' || entitlementStatus === 'trial')) {
    return 'In use';
  }
  if (activationStatus === 'active') return 'Active, not entitled';
  return activationStatus.charAt(0).toUpperCase() + activationStatus.slice(1);
}

export function computeOrgSubscriptionStatus(
  entitlements: Array<{ entitlement_status: string }>,
): { status: string; label: string } {
  if (!entitlements.length) {
    return { status: 'inactive', label: SUBSCRIPTION_STATUS_LABELS.inactive! };
  }
  const statuses = entitlements.map((e) => e.entitlement_status);
  if (statuses.some((s) => s === 'entitled')) {
    return { status: 'active', label: SUBSCRIPTION_STATUS_LABELS.active! };
  }
  if (statuses.some((s) => s === 'trial')) {
    return { status: 'trial', label: SUBSCRIPTION_STATUS_LABELS.trial! };
  }
  if (statuses.some((s) => s === 'expired')) {
    return { status: 'expired', label: SUBSCRIPTION_STATUS_LABELS.expired! };
  }
  return { status: 'inactive', label: SUBSCRIPTION_STATUS_LABELS.inactive! };
}

export function resolveHealthFromIssue(params: {
  issue_key: string | null;
  issue_label: string | null;
  severity: SystemHealthSeverity | null;
}): {
  health_status: string;
  health_status_label: string;
  health_tone: OwnerClientHealthTone;
  row_border_tone: OwnerClientBorderTone;
  primary_issue_label: string;
  next_step_label: string;
} {
  if (!params.issue_key || !params.severity) {
    return {
      health_status: 'healthy',
      health_status_label: HEALTH_STATUS_LABELS.healthy!,
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

export function buildOwnerClientListRow(params: {
  organization_id: string;
  organization_name: string;
  country_code: string | null;
  country_label: string;
  owner_name: string | null;
  owner_email: string | null;
  billing_email: string | null;
  primary_email: string | null;
  plan_label: string;
  mrr_value: number | null;
  mrr_currency: string | null;
  active_modules: OwnerClientActiveModule[];
  tenant_clients_count: number | null;
  users_count: number;
  documents_count: number | null;
  last_activity_at: string | null;
  health_issue: { issue_key: string; issue_label: string; severity: SystemHealthSeverity } | null;
}): OwnerClientListRow {
  const { contact_email, contact_label } = resolveCustomerContact({
    billing_email: params.billing_email,
    primary_email: params.primary_email,
    owner_email: params.owner_email,
  });
  const subscription = computeOrgSubscriptionStatus(
    params.active_modules.map((m) => ({ entitlement_status: m.entitlement_status })),
  );
  const usedModules = params.active_modules.filter(
    (m) => m.status === 'active' && (m.entitlement_status === 'entitled' || m.entitlement_status === 'trial'),
  );
  const health = resolveHealthFromIssue({
    issue_key: params.health_issue?.issue_key ?? null,
    issue_label: params.health_issue?.issue_label ?? null,
    severity: params.health_issue?.severity ?? null,
  });

  return {
    organization_id: params.organization_id,
    organization_display: params.organization_name,
    country_code: params.country_code,
    country_label: params.country_label,
    owner_name: params.owner_name ?? '—',
    owner_email: params.owner_email,
    billing_email: params.billing_email,
    primary_email: params.primary_email,
    contact_email,
    contact_label,
    subscription_status: subscription.status,
    subscription_status_label: subscription.label,
    plan_label: params.plan_label,
    mrr_value: params.mrr_value,
    mrr_currency: params.mrr_currency,
    mrr_label: buildMonthlyValueLabel(params.mrr_value, params.mrr_currency),
    active_modules: params.active_modules,
    active_modules_label:
      params.active_modules.length > 0
        ? params.active_modules.map((m) => m.label).join(', ')
        : 'No active modules',
    used_modules_label:
      usedModules.length > 0 ? usedModules.map((m) => m.label).join(', ') : 'No modules in use',
    tenant_clients_count: params.tenant_clients_count,
    tenant_clients_count_label: buildCountLabel(params.tenant_clients_count, 'client', 'clients'),
    users_count: params.users_count,
    users_count_label: buildCountLabel(params.users_count, 'user', 'users'),
    documents_count: params.documents_count,
    documents_count_label: buildCountLabel(params.documents_count, 'document', 'documents'),
    last_activity_at: params.last_activity_at,
    last_activity_label: buildLastActivityLabel(params.last_activity_at),
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

function buildFilterOptions(rows: OwnerClientListRow[]): OwnerClientFilterOptions {
  const countries = new Map<string, string>();
  const plans = new Set<string>();
  const statuses = new Map<string, string>();
  const modules = new Map<string, string>();
  const health = new Map<string, string>();
  for (const row of rows) {
    if (row.country_code) countries.set(row.country_code, row.country_label);
    if (row.plan_label && row.plan_label !== '—') plans.add(row.plan_label);
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
  };
}

function applyOwnerClientFilters(rows: OwnerClientListRow[], filters: OwnerClientFilters): OwnerClientListRow[] {
  return rows.filter((row) => {
    if (filters.country && row.country_code !== filters.country) return false;
    if (filters.plan && row.plan_label !== filters.plan) return false;
    if (filters.status && row.subscription_status !== filters.status) return false;
    if (filters.module && !row.active_modules.some((m) => m.module_key === filters.module)) return false;
    if (filters.health && row.health_status !== filters.health) return false;
    return true;
  });
}

function buildListSummary(allRows: OwnerClientListRow[], filteredRows: OwnerClientListRow[]): OwnerClientListSummary {
  const missingContacts = filteredRows.filter((row) => !row.contact_email).length;

  const seenMrr = new Set<string>();
  const currencies = new Set<string>();
  let totalMrr = 0;
  let mrrCounted = 0;
  for (const row of filteredRows) {
    if (row.mrr_value == null) continue;
    const key = row.organization_id;
    if (seenMrr.has(key)) continue;
    seenMrr.add(key);
    totalMrr += row.mrr_value;
    mrrCounted += 1;
    if (row.mrr_currency) currencies.add(row.mrr_currency);
  }

  let totalMrrLabel = '—';
  if (mrrCounted > 0 && currencies.size === 1) {
    const currency = [...currencies][0] ?? null;
    totalMrrLabel = buildMonthlyValueLabel(totalMrr, currency);
  }

  const atRiskOrgs = new Set(
    filteredRows
      .filter((row) => row.health_status !== 'healthy' && row.mrr_value != null)
      .map((row) => row.organization_id),
  );
  const riskCurrencies = new Set<string>();
  let riskMrr = 0;
  for (const row of filteredRows) {
    if (!atRiskOrgs.has(row.organization_id) || row.mrr_value == null) continue;
    riskMrr += row.mrr_value;
    if (row.mrr_currency) riskCurrencies.add(row.mrr_currency);
  }
  let revenueAtRiskLabel = '—';
  if (atRiskOrgs.size > 0 && riskCurrencies.size === 1) {
    revenueAtRiskLabel = buildMonthlyValueLabel(riskMrr, [...riskCurrencies][0] ?? null);
  }

  return {
    total_organizations: allRows.length,
    active_organizations: filteredRows.filter((r) => r.subscription_status === 'active').length,
    trial_organizations: filteredRows.filter((r) => r.subscription_status === 'trial').length,
    expired_organizations: filteredRows.filter((r) => r.subscription_status === 'expired').length,
    total_mrr_label: totalMrrLabel,
    revenue_at_risk_label: revenueAtRiskLabel,
    missing_contacts_count: missingContacts,
  };
}

export function buildOwnerClientsListAggregate(params: {
  rows: OwnerClientListRow[];
  filters?: Partial<OwnerClientFilters> | null;
}): OwnerClientsListAggregate {
  const appliedFilters = normalizeOwnerClientFilters(params.filters);
  const filterOptions = buildFilterOptions(params.rows);
  const filteredRows = applyOwnerClientFilters(params.rows, appliedFilters);
  return {
    aggregate_key: 'owner_clients_aggregate',
    summary: buildListSummary(params.rows, filteredRows),
    filter_options: filterOptions,
    applied_filters: appliedFilters,
    rows: filteredRows,
  };
}

export function buildOwnerClientDetailAggregate(params: {
  organization_id: string;
  organization_name: string;
  country_label: string;
  contact_email: string | null;
  mrr_label: string;
  health_status_label: string;
  overview: Record<string, string | number | null>;
  modules: Array<Record<string, string | null>>;
  billing: Record<string, string | number | null | Array<Record<string, string | null>>>;
  users: Array<Record<string, string | null>>;
  usage: Record<string, string | number | null>;
  health: Record<string, string | number | null | Array<Record<string, string | null>>>;
  logs: Array<Record<string, string | null>>;
}): OwnerClientDetailAggregate {
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

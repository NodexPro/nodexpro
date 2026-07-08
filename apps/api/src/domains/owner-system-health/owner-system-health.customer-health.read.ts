/**
 * Platform owner — customer health rows (one row per organization issue).
 */

import { supabaseAdmin } from '../../db/client.js';
import { supabaseEmbedOne } from '../../shared/supabase-embed.js';
import {
  filterSessionEnabledModuleCodes,
  isSessionEnabledModuleEntitlementStatus,
  resolveEntitlement,
} from '../modules/entitlement.service.js';
import {
  buildCustomerHealthActions,
  buildLastActivityLabel,
  buildMonthlyValueLabel,
  buildSeverityDisplay,
  buildSystemHealthRowId,
  resolveCustomerContact,
  resolveSystemHealthIssue,
  type CustomerHealthRow,
} from './owner-system-health.pure.js';
import {
  CUSTOMER_HEALTH_ORG_LIMIT,
  HIGH_VOLUME_EMAIL_FAILURE_THRESHOLD,
  loadDeliveryFailureGroups,
  loadEmailFailureCountByOrg,
  loadIncomePdfFailuresByOrg,
  loadUnsupportedEventVersionByOrg,
  loadWorkEventFailureGroups,
} from './owner-system-health.shared-read.js';

type OrgContact = {
  organization_id: string;
  organization_name: string;
  owner_name: string | null;
  owner_email: string | null;
  primary_email: string | null;
  billing_email: string | null;
  last_activity_at: string | null;
};

type PendingIssue = {
  organization_id: string;
  module_key: string;
  issue_key: string;
  since: string | null;
  last_activity_at: string | null;
  count: number | null;
  sample_reason: string | null;
};

async function loadOrgContacts(orgIds: string[]): Promise<Map<string, OrgContact>> {
  const map = new Map<string, OrgContact>();
  if (!orgIds.length) return map;

  const [{ data: orgs, error: orgErr }, { data: owners, error: ownerErr }] = await Promise.all([
    supabaseAdmin.from('organizations').select('id, name, updated_at').in('id', orgIds),
    supabaseAdmin
      .from('organization_users')
      .select('organization_id, users!organization_users_user_id_fkey(email, full_name), roles(code)')
      .in('organization_id', orgIds)
      .eq('membership_status', 'active'),
  ]);
  if (orgErr) throw orgErr;
  if (ownerErr) throw ownerErr;

  const ownerByOrg = new Map<string, { email: string | null; full_name: string | null }>();
  for (const raw of owners ?? []) {
    const row = raw as {
      organization_id: string;
      users: { email: string; full_name: string | null } | { email: string; full_name: string | null }[] | null;
      roles: { code: string } | { code: string }[] | null;
    };
    const role = supabaseEmbedOne(row.roles);
    if (role?.code !== 'owner') continue;
    const user = supabaseEmbedOne(row.users);
    if (!ownerByOrg.has(row.organization_id)) {
      ownerByOrg.set(row.organization_id, {
        email: user?.email ?? null,
        full_name: user?.full_name ?? null,
      });
    }
  }

  for (const raw of orgs ?? []) {
    const org = raw as { id: string; name: string; updated_at: string };
    const owner = ownerByOrg.get(org.id);
    map.set(org.id, {
      organization_id: org.id,
      organization_name: org.name,
      owner_name: owner?.full_name ?? null,
      owner_email: owner?.email ?? null,
      primary_email: owner?.email ?? null,
      billing_email: owner?.email ?? null,
      last_activity_at: org.updated_at ?? null,
    });
  }
  return map;
}

async function loadSubscriptionPlanByOrgModule(
  orgIds: string[],
): Promise<Map<string, { plan_name: string | null; monthly_value: number | null; currency: string | null }>> {
  const map = new Map<string, { plan_name: string | null; monthly_value: number | null; currency: string | null }>();
  if (!orgIds.length) return map;

  const { data, error } = await supabaseAdmin
    .from('organization_module_subscriptions')
    .select('organization_id, module_id, module_plans(name, price_amount, currency, billing_period)')
    .in('organization_id', orgIds);
  if (error) throw error;

  for (const raw of data ?? []) {
    const row = raw as {
      organization_id: string;
      module_id: string;
      module_plans:
        | { name: string; price_amount: number; currency: string; billing_period: string }
        | { name: string; price_amount: number; currency: string; billing_period: string }[]
        | null;
    };
    const plan = supabaseEmbedOne(row.module_plans);
    const key = `${row.organization_id}:${row.module_id}`;
    map.set(key, {
      plan_name: plan?.name ?? null,
      monthly_value: plan?.price_amount != null ? Number(plan.price_amount) : null,
      currency: plan?.currency ?? null,
    });
  }
  return map;
}

async function loadEntitlementMismatchIssues(): Promise<PendingIssue[]> {
  const { data, error } = await supabaseAdmin
    .from('organization_modules')
    .select('organization_id, module_id, modules(code, is_system)')
    .eq('status', 'active')
    .limit(500);
  if (error) throw error;

  const byOrg = new Map<string, Array<{ moduleId: string; code: string }>>();
  for (const raw of data ?? []) {
    const row = raw as {
      organization_id: string;
      module_id: string;
      modules: { code: string; is_system: boolean } | { code: string; is_system: boolean }[] | null;
    };
    const mod = supabaseEmbedOne(row.modules);
    if (!mod?.code || mod.is_system) continue;
    const list = byOrg.get(row.organization_id) ?? [];
    list.push({ moduleId: row.module_id, code: mod.code });
    byOrg.set(row.organization_id, list);
  }

  const issues: PendingIssue[] = [];
  const orgIds = [...byOrg.keys()].slice(0, CUSTOMER_HEALTH_ORG_LIMIT);
  for (const organizationId of orgIds) {
    const modules = byOrg.get(organizationId) ?? [];
    const entitledCodes = await filterSessionEnabledModuleCodes({ organizationId, modules });
    for (const mod of modules) {
      if (entitledCodes.has(mod.code)) continue;
      const entitlement = await resolveEntitlement(organizationId, mod.moduleId);
      if (isSessionEnabledModuleEntitlementStatus(entitlement.status)) continue;
      const issueKey =
        entitlement.status === 'expired' && entitlement.reason?.toLowerCase().includes('trial')
          ? 'trial_expired'
          : entitlement.status === 'expired'
            ? 'license_expired'
            : 'entitlement_mismatch';
      issues.push({
        organization_id: organizationId,
        module_key: mod.code,
        issue_key: issueKey,
        since: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        count: null,
        sample_reason: entitlement.reason ?? null,
      });
    }
  }
  return issues;
}

async function loadSmtpDisconnectedIssues(orgIdsWithEmailFailures: string[]): Promise<PendingIssue[]> {
  if (!orgIdsWithEmailFailures.length) return [];
  const { data, error } = await supabaseAdmin
    .from('owner_email_provider_configs')
    .select('org_id, is_configured, updated_at')
    .in('org_id', orgIdsWithEmailFailures);
  if (error) throw error;

  const configured = new Set(
    (data ?? [])
      .filter((row) => (row as { is_configured: boolean }).is_configured)
      .map((row) => String((row as { org_id: string }).org_id)),
  );

  return orgIdsWithEmailFailures
    .filter((orgId) => !configured.has(orgId))
    .map((organization_id) => ({
      organization_id,
      module_key: 'delivery',
      issue_key: 'smtp_disconnected',
      since: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      count: null,
      sample_reason: 'Email provider is not configured for this organization.',
    }));
}

function buildCustomerRow(params: {
  pending: PendingIssue;
  contact: OrgContact | undefined;
  planKey: string;
  planByOrgModule: Map<string, { plan_name: string | null; monthly_value: number | null; currency: string | null }>;
  moduleIdByCode?: Map<string, string>;
}): CustomerHealthRow {
  const issue = resolveSystemHealthIssue(params.pending.issue_key, params.pending.sample_reason);
  const plan = params.planByOrgModule.get(params.planKey) ?? {
    plan_name: null,
    monthly_value: null,
    currency: null,
  };
  const organizationId = params.pending.organization_id;
  const moduleKey = params.pending.module_key;
  const primaryEmail = params.contact?.primary_email ?? null;
  const billingEmail = params.contact?.billing_email ?? null;
  const { contact_email, contact_label } = resolveCustomerContact({
    billing_email: billingEmail,
    primary_email: primaryEmail,
    owner_email: params.contact?.owner_email ?? null,
  });
  const severityDisplay = buildSeverityDisplay(issue.severity);
  const lastActivityAt = params.pending.last_activity_at ?? params.contact?.last_activity_at ?? null;

  return {
    id: buildSystemHealthRowId(['customer_health', organizationId, moduleKey, issue.issue_key]),
    organization_id: organizationId,
    organization_name: params.contact?.organization_name ?? organizationId,
    owner_name: params.contact?.owner_name ?? null,
    primary_email: primaryEmail,
    billing_email: billingEmail,
    contact_email,
    contact_label,
    subscription_plan: plan.plan_name,
    module_key: moduleKey,
    problem: issue.issue_label,
    problem_type: issue.issue_key,
    possible_reason: params.pending.sample_reason ?? issue.possible_reason,
    recommended_action: issue.recommended_action,
    severity: issue.severity,
    severity_label: severityDisplay.severity_label,
    severity_tone: severityDisplay.severity_tone,
    border_tone: severityDisplay.border_tone,
    status: 'open',
    since: params.pending.since,
    monthly_value: plan.monthly_value,
    monthly_value_currency: plan.currency,
    monthly_value_label: buildMonthlyValueLabel(plan.monthly_value, plan.currency),
    last_activity_at: lastActivityAt,
    last_activity_label: buildLastActivityLabel(lastActivityAt),
    available_actions: buildCustomerHealthActions({
      issueKey: issue.issue_key,
      organizationId,
      moduleKey,
      contactEmail: contact_email,
    }),
  };
}

export async function loadCustomerHealthRows(): Promise<CustomerHealthRow[]> {
  const [
    entitlementIssues,
    deliveryGroups,
    pdfByOrg,
    workEventGroups,
    unsupportedByOrg,
    emailFailuresByOrg,
  ] = await Promise.all([
    loadEntitlementMismatchIssues(),
    loadDeliveryFailureGroups(),
    loadIncomePdfFailuresByOrg(),
    loadWorkEventFailureGroups(),
    loadUnsupportedEventVersionByOrg(),
    loadEmailFailureCountByOrg(),
  ]);

  const pending: PendingIssue[] = [...entitlementIssues];

  for (const group of deliveryGroups) {
    if (!group.organization_id) continue;
    pending.push({
      organization_id: group.organization_id,
      module_key: group.source_module,
      issue_key: 'delivery_failed',
      since: group.last_seen_at,
      last_activity_at: group.last_seen_at,
      count: group.count,
      sample_reason: group.sample_reason,
    });
  }

  for (const row of pdfByOrg) {
    pending.push({
      organization_id: row.organization_id,
      module_key: 'income',
      issue_key: 'pdf_render_failed',
      since: row.last_seen_at,
      last_activity_at: row.last_seen_at,
      count: row.count,
      sample_reason: null,
    });
  }

  for (const group of workEventGroups) {
    pending.push({
      organization_id: group.organization_id,
      module_key: group.source_module,
      issue_key: group.sample_reason?.includes('Unsupported schema_version')
        ? 'event_schema_version_unsupported'
        : 'work_event_failed',
      since: group.last_seen_at,
      last_activity_at: group.last_seen_at,
      count: group.count,
      sample_reason: group.sample_reason,
    });
  }

  for (const row of unsupportedByOrg) {
    pending.push({
      organization_id: row.organization_id,
      module_key: 'work_engine',
      issue_key: 'event_schema_version_unsupported',
      since: row.last_seen_at,
      last_activity_at: row.last_seen_at,
      count: row.count,
      sample_reason: null,
    });
  }

  for (const row of emailFailuresByOrg) {
    if (row.count >= HIGH_VOLUME_EMAIL_FAILURE_THRESHOLD) {
      pending.push({
        organization_id: row.organization_id,
        module_key: 'delivery',
        issue_key: 'delivery_failures_high_volume',
        since: row.last_seen_at,
        last_activity_at: row.last_seen_at,
        count: row.count,
        sample_reason: `${row.count} failed email delivery attempts recorded.`,
      });
    }
  }

  const smtpIssues = await loadSmtpDisconnectedIssues(
    emailFailuresByOrg.map((row) => row.organization_id).slice(0, CUSTOMER_HEALTH_ORG_LIMIT),
  );
  pending.push(...smtpIssues);

  const orgIds = [...new Set(pending.map((issue) => issue.organization_id))].slice(0, CUSTOMER_HEALTH_ORG_LIMIT);
  const filteredPending = pending.filter((issue) => orgIds.includes(issue.organization_id));

  const [contacts, subscriptions] = await Promise.all([
    loadOrgContacts(orgIds),
    loadSubscriptionPlanByOrgModule(orgIds),
  ]);

  const moduleCodeToId = new Map<string, string>();
  const { data: modules, error: modErr } = await supabaseAdmin
    .from('modules')
    .select('id, code')
    .eq('is_active', true);
  if (modErr) throw modErr;
  for (const mod of modules ?? []) {
    moduleCodeToId.set(String((mod as { code: string }).code), String((mod as { id: string }).id));
  }

  return filteredPending.map((issue) => {
    const moduleId = moduleCodeToId.get(issue.module_key) ?? '';
    const planKey = moduleId ? `${issue.organization_id}:${moduleId}` : `${issue.organization_id}:`;
    return buildCustomerRow({
      pending: issue,
      contact: contacts.get(issue.organization_id),
      planKey,
      planByOrgModule: subscriptions,
    });
  });
}

/**
 * Platform owner — Clients aggregate shared batch reads.
 */

import { supabaseAdmin } from '../../db/client.js';
import { supabaseEmbedOne } from '../../shared/supabase-embed.js';
import type { SystemHealthSeverity } from '../owner-system-health/owner-system-health.pure.js';
import { resolveSystemHealthIssue } from '../owner-system-health/owner-system-health.pure.js';

export const OWNER_CLIENTS_ORG_LIMIT = 500;
export const OWNER_CLIENTS_ACTIVITY_FETCH_LIMIT = 2000;

export type OrgRecord = {
  id: string;
  name: string;
  country_code: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type OrgOwnerContact = {
  organization_id: string;
  owner_name: string | null;
  owner_email: string | null;
  login_email: string | null;
};

export type CommercialModule = {
  id: string;
  code: string;
  name: string;
};

export type OrgModuleActivation = {
  organization_id: string;
  module_id: string;
  module_key: string;
  module_label: string;
  status: string;
};

export type OrgSubscription = {
  organization_id: string;
  module_id: string;
  status: string;
  trial_ends_at: string | null;
  ends_at: string | null;
  plan_name: string | null;
  price_amount: number | null;
  currency: string | null;
};

export type OrgHealthIssue = {
  organization_id: string;
  issue_key: string;
  issue_label: string;
  severity: SystemHealthSeverity;
};

export async function loadCountryLabels(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data, error } = await supabaseAdmin.from('countries').select('code, name');
  if (error) throw error;
  for (const raw of data ?? []) {
    const row = raw as { code: string; name: string };
    map.set(String(row.code).toUpperCase(), String(row.name));
  }
  return map;
}

export async function loadOrganizations(): Promise<OrgRecord[]> {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('id, name, country_code, status, created_at, updated_at')
    .order('name', { ascending: true })
    .limit(OWNER_CLIENTS_ORG_LIMIT);
  if (error) throw error;
  return (data ?? []).map((raw) => {
    const row = raw as OrgRecord;
    return {
      id: String(row.id),
      name: String(row.name),
      country_code: row.country_code ? String(row.country_code).toUpperCase() : null,
      status: String(row.status),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  });
}

export async function loadOrgOwners(orgIds: string[]): Promise<Map<string, OrgOwnerContact>> {
  const map = new Map<string, OrgOwnerContact>();
  if (!orgIds.length) return map;
  const { data, error } = await supabaseAdmin
    .from('organization_users')
    .select('organization_id, joined_at, users!organization_users_user_id_fkey(email, full_name), roles(code)')
    .in('organization_id', orgIds)
    .eq('membership_status', 'active')
    .order('joined_at', { ascending: true });
  if (error) throw error;
  for (const raw of data ?? []) {
    const row = raw as {
      organization_id: string;
      users: { email: string; full_name: string | null } | { email: string; full_name: string | null }[] | null;
      roles: { code: string } | { code: string }[] | null;
    };
    const role = supabaseEmbedOne(row.roles);
    const user = supabaseEmbedOne(row.users);
    const existing = map.get(row.organization_id);
    // First active member establishes the login/primary email fallback.
    if (!existing) {
      map.set(row.organization_id, {
        organization_id: row.organization_id,
        owner_name: role?.code === 'owner' ? user?.full_name ?? null : null,
        owner_email: role?.code === 'owner' ? user?.email ?? null : null,
        login_email: user?.email ?? null,
      });
      continue;
    }
    // A later owner-role member fills in owner name/email if not yet set.
    if (role?.code === 'owner' && !existing.owner_email) {
      existing.owner_name = user?.full_name ?? existing.owner_name;
      existing.owner_email = user?.email ?? existing.owner_email;
    }
    if (!existing.login_email) existing.login_email = user?.email ?? existing.login_email;
  }
  return map;
}

export async function loadCommercialModules(): Promise<CommercialModule[]> {
  const { data, error } = await supabaseAdmin
    .from('modules')
    .select('id, code, name, is_system')
    .eq('is_active', true);
  if (error) throw error;
  return (data ?? [])
    .filter((raw) => !(raw as { is_system: boolean }).is_system)
    .map((raw) => ({
      id: String((raw as { id: string }).id),
      code: String((raw as { code: string }).code),
      name: String((raw as { name: string }).name),
    }));
}

export async function loadOrgModuleActivations(
  orgIds: string[],
  commercialModules: CommercialModule[],
): Promise<Map<string, OrgModuleActivation[]>> {
  const map = new Map<string, OrgModuleActivation[]>();
  if (!orgIds.length || !commercialModules.length) return map;
  const moduleById = new Map(commercialModules.map((m) => [m.id, m]));
  const { data, error } = await supabaseAdmin
    .from('organization_modules')
    .select('organization_id, module_id, status')
    .in('organization_id', orgIds)
    .in('module_id', commercialModules.map((m) => m.id));
  if (error) throw error;
  for (const raw of data ?? []) {
    const row = raw as { organization_id: string; module_id: string; status: string };
    const mod = moduleById.get(String(row.module_id));
    if (!mod) continue;
    const list = map.get(row.organization_id) ?? [];
    list.push({
      organization_id: row.organization_id,
      module_id: row.module_id,
      module_key: mod.code,
      module_label: mod.name,
      status: String(row.status),
    });
    map.set(row.organization_id, list);
  }
  return map;
}

export async function loadOrgSubscriptions(orgIds: string[]): Promise<Map<string, OrgSubscription[]>> {
  const map = new Map<string, OrgSubscription[]>();
  if (!orgIds.length) return map;
  const { data, error } = await supabaseAdmin
    .from('organization_module_subscriptions')
    .select(
      'organization_id, module_id, status, trial_ends_at, ends_at, module_plans(name, price_amount, currency)',
    )
    .in('organization_id', orgIds);
  if (error) throw error;
  for (const raw of data ?? []) {
    const row = raw as {
      organization_id: string;
      module_id: string;
      status: string;
      trial_ends_at: string | null;
      ends_at: string | null;
      module_plans:
        | { name: string; price_amount: number; currency: string }
        | { name: string; price_amount: number; currency: string }[]
        | null;
    };
    const plan = supabaseEmbedOne(row.module_plans);
    const list = map.get(row.organization_id) ?? [];
    list.push({
      organization_id: row.organization_id,
      module_id: String(row.module_id),
      status: String(row.status),
      trial_ends_at: row.trial_ends_at,
      ends_at: row.ends_at,
      plan_name: plan?.name ?? null,
      price_amount: plan?.price_amount != null ? Number(plan.price_amount) : null,
      currency: plan?.currency ?? null,
    });
    map.set(row.organization_id, list);
  }
  return map;
}

export async function loadOrgValidTrials(orgIds: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  if (!orgIds.length) return set;
  const { data, error } = await supabaseAdmin
    .from('organization_trials')
    .select('organization_id')
    .in('organization_id', orgIds)
    .eq('trial_scope', 'full_platform')
    .eq('status', 'trialing')
    .gt('ends_at', new Date().toISOString());
  if (error) throw error;
  for (const raw of data ?? []) {
    set.add(String((raw as { organization_id: string }).organization_id));
  }
  return set;
}

export function computeEntitlementStatus(params: {
  orgId: string;
  moduleId: string;
  subscriptions: OrgSubscription[];
  orgHasValidTrial: boolean;
}): string {
  const sub = params.subscriptions.find((s) => s.module_id === params.moduleId) ?? null;
  if (sub) {
    if (sub.status === 'active' || sub.status === 'trialing') {
      if (sub.ends_at && new Date(sub.ends_at) < new Date()) return 'expired';
      if (sub.status === 'trialing' && sub.trial_ends_at && new Date(sub.trial_ends_at) < new Date()) {
        return 'expired';
      }
      return sub.status === 'trialing' ? 'trial' : 'entitled';
    }
    return 'expired';
  }
  if (params.orgHasValidTrial) return 'trial';
  return 'not_entitled';
}

export async function loadCountByOrg(
  table: 'clients' | 'income_documents' | 'organization_users' | 'work_items',
  orgIds: string[],
  options?: { archived?: boolean; membershipStatus?: string },
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!orgIds.length) return map;

  if (table === 'clients') {
    let q = supabaseAdmin.from('clients').select('organization_id').in('organization_id', orgIds);
    if (options?.archived === false) q = q.eq('is_archived', false);
    const { data, error } = await q.limit(OWNER_CLIENTS_ACTIVITY_FETCH_LIMIT);
    if (error) throw error;
    for (const raw of data ?? []) {
      const oid = String((raw as { organization_id: string }).organization_id);
      map.set(oid, (map.get(oid) ?? 0) + 1);
    }
    return map;
  }

  if (table === 'income_documents') {
    const { data, error } = await supabaseAdmin
      .from('income_documents')
      .select('organization_id')
      .in('organization_id', orgIds)
      .limit(OWNER_CLIENTS_ACTIVITY_FETCH_LIMIT);
    if (error) throw error;
    for (const raw of data ?? []) {
      const oid = String((raw as { organization_id: string }).organization_id);
      map.set(oid, (map.get(oid) ?? 0) + 1);
    }
    return map;
  }

  if (table === 'organization_users') {
    let q = supabaseAdmin.from('organization_users').select('organization_id').in('organization_id', orgIds);
    if (options?.membershipStatus) q = q.eq('membership_status', options.membershipStatus);
    const { data, error } = await q.limit(OWNER_CLIENTS_ACTIVITY_FETCH_LIMIT);
    if (error) throw error;
    for (const raw of data ?? []) {
      const oid = String((raw as { organization_id: string }).organization_id);
      map.set(oid, (map.get(oid) ?? 0) + 1);
    }
    return map;
  }

  const { data, error } = await supabaseAdmin
    .from('work_items')
    .select('org_id')
    .in('org_id', orgIds)
    .limit(OWNER_CLIENTS_ACTIVITY_FETCH_LIMIT);
  if (error) throw error;
  for (const raw of data ?? []) {
    const oid = String((raw as { org_id: string }).org_id);
    map.set(oid, (map.get(oid) ?? 0) + 1);
  }
  return map;
}

function mergeLastActivity(
  target: Map<string, string>,
  rows: Array<{ orgId: string; at: string | null }>,
): void {
  for (const row of rows) {
    if (!row.at) continue;
    const existing = target.get(row.orgId);
    if (!existing || row.at > existing) target.set(row.orgId, row.at);
  }
}

export async function loadLastActivityByOrg(orgIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!orgIds.length) return map;

  const [auditRes, workRes, incomeRes, deliveryRes] = await Promise.all([
    supabaseAdmin
      .from('audit_log')
      .select('organization_id, created_at')
      .in('organization_id', orgIds)
      .order('created_at', { ascending: false })
      .limit(OWNER_CLIENTS_ACTIVITY_FETCH_LIMIT),
    supabaseAdmin
      .from('work_items')
      .select('org_id, updated_at')
      .in('org_id', orgIds)
      .order('updated_at', { ascending: false })
      .limit(OWNER_CLIENTS_ACTIVITY_FETCH_LIMIT),
    supabaseAdmin
      .from('income_documents')
      .select('organization_id, updated_at, created_at')
      .in('organization_id', orgIds)
      .order('updated_at', { ascending: false })
      .limit(OWNER_CLIENTS_ACTIVITY_FETCH_LIMIT),
    supabaseAdmin
      .from('delivery_attempts')
      .select('organization_id, updated_at, created_at')
      .in('organization_id', orgIds)
      .order('updated_at', { ascending: false })
      .limit(OWNER_CLIENTS_ACTIVITY_FETCH_LIMIT),
  ]);
  if (auditRes.error) throw auditRes.error;
  if (workRes.error) throw workRes.error;
  if (incomeRes.error) throw incomeRes.error;
  if (deliveryRes.error) throw deliveryRes.error;

  mergeLastActivity(
    map,
    (auditRes.data ?? []).map((raw) => ({
      orgId: String((raw as { organization_id: string }).organization_id),
      at: (raw as { created_at: string }).created_at ?? null,
    })),
  );
  mergeLastActivity(
    map,
    (workRes.data ?? []).map((raw) => ({
      orgId: String((raw as { org_id: string }).org_id),
      at: (raw as { updated_at: string }).updated_at ?? null,
    })),
  );
  mergeLastActivity(
    map,
    (incomeRes.data ?? []).map((raw) => {
      const row = raw as { organization_id: string; updated_at: string; created_at: string };
      return { orgId: String(row.organization_id), at: row.updated_at || row.created_at || null };
    }),
  );
  mergeLastActivity(
    map,
    (deliveryRes.data ?? []).map((raw) => {
      const row = raw as { organization_id: string; updated_at: string; created_at: string };
      return { orgId: String(row.organization_id), at: row.updated_at || row.created_at || null };
    }),
  );

  return map;
}

/** Reuse customer-health issue detection; index worst issue per organization. */
export async function loadOrgHealthIssuesByOrg(): Promise<Map<string, OrgHealthIssue>> {
  const { loadCustomerHealthRows } = await import('../owner-system-health/owner-system-health.customer-health.read.js');
  const rows = await loadCustomerHealthRows();
  const severityRank: Record<SystemHealthSeverity, number> = { critical: 0, warning: 1, info: 2 };
  const map = new Map<string, OrgHealthIssue>();
  for (const row of rows) {
    const issue = resolveSystemHealthIssue(row.problem_type, row.possible_reason);
    const existing = map.get(row.organization_id);
    if (!existing || severityRank[issue.severity] < severityRank[existing.severity]) {
      map.set(row.organization_id, {
        organization_id: row.organization_id,
        issue_key: issue.issue_key,
        issue_label: issue.issue_label,
        severity: issue.severity,
      });
    }
  }
  return map;
}

export async function loadRecentAuditLogs(
  organizationId: string,
  limit = 20,
): Promise<Array<Record<string, string | null>>> {
  const { data, error } = await supabaseAdmin
    .from('audit_log')
    .select('id, action, entity_type, entity_id, module_code, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((raw) => {
    const row = raw as {
      id: string;
      action: string;
      entity_type: string;
      entity_id: string | null;
      module_code: string | null;
      created_at: string;
    };
    return {
      id: row.id,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      module_code: row.module_code,
      created_at: row.created_at,
      label: `${row.action} · ${row.entity_type}`,
    };
  });
}

export async function loadOrgUsersForDetail(organizationId: string): Promise<Array<Record<string, string | null>>> {
  const { data, error } = await supabaseAdmin
    .from('organization_users')
    .select(
      'user_id, membership_status, joined_at, users!organization_users_user_id_fkey(email, full_name), roles(code, name)',
    )
    .eq('organization_id', organizationId)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((raw) => {
    const row = raw as {
      user_id: string;
      membership_status: string;
      joined_at: string;
      users: { email: string; full_name: string | null } | { email: string; full_name: string | null }[] | null;
      roles: { code: string; name: string } | { code: string; name: string }[] | null;
    };
    const user = supabaseEmbedOne(row.users);
    const role = supabaseEmbedOne(row.roles);
    return {
      user_id: row.user_id,
      email: user?.email ?? null,
      full_name: user?.full_name ?? null,
      role_code: role?.code ?? null,
      role_label: role?.name ?? role?.code ?? null,
      membership_status: row.membership_status,
      joined_at: row.joined_at,
    };
  });
}

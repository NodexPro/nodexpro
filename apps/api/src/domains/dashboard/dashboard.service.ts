/**
 * Dashboard summary: single aggregated response for dashboard UI.
 * Backend authoritative; all counts and data produced server-side.
 */

import { supabaseAdmin } from '../../db/client.js';
import { forbidden } from '../../shared/errors.js';
import { supabaseEmbedOne } from '../../shared/supabase-embed.js';
import type { RequestContext } from '../../shared/context.js';
import { getDashboardOverviewAggregated } from './dashboard-aggregator.service.js';
export type { DashboardOverview } from './dashboard-overview.types.js';

export interface DashboardSummary {
  organization: { id: string; name: string };
  user: { id: string; email: string; fullName: string | null };
  permissions: string[];
  enabledModules: string[];
  counts: {
    clients_count: number;
    documents_count: number;
    members_count: number;
    pending_invites_count: number;
  };
}

export async function getDashboardSummary(ctx: RequestContext): Promise<DashboardSummary> {
  const orgId = ctx.organizationId;
  const membership = ctx.membership;
  if (!orgId || !membership) throw forbidden('Active organization required');

  const [orgRow, clientsCount, documentsCount, membersCountRbac, membersCountLegacy, pendingInvitesCount, modulesRows] = await Promise.all([
    supabaseAdmin.from('organizations').select('id, name').eq('id', orgId).single(),
    supabaseAdmin.from('clients').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_archived', false),
    supabaseAdmin.from('documents').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_archived', false),
    supabaseAdmin.from('organization_memberships').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'active'),
    supabaseAdmin.from('organization_users').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('membership_status', 'active'),
    supabaseAdmin.from('user_invitations').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'pending'),
    supabaseAdmin.from('organization_modules').select('modules(code, nav_label)').eq('organization_id', orgId).eq('status', 'active'),
  ]);

  const org = orgRow.data as { id: string; name: string } | null;
  if (!org) throw forbidden('Organization not found');

  const membersCount =
    (membersCountRbac.count ?? 0) > 0 ? (membersCountRbac.count ?? 0) : (membersCountLegacy.count ?? 0);
  const modList = (modulesRows.data ?? []) as Array<{ modules: unknown }>;
  const enabledModules = modList
    .map((m) => supabaseEmbedOne(m.modules as { code: string; nav_label: string | null } | null)?.code)
    .filter((c): c is string => !!c);

  return {
    organization: { id: org.id, name: org.name },
    user: {
      id: ctx.user.id,
      email: ctx.user.email,
      fullName: ctx.user.fullName,
    },
    permissions: membership.permissions ?? [],
    enabledModules,
    counts: {
      clients_count: clientsCount.count ?? 0,
      documents_count: documentsCount.count ?? 0,
      members_count: membersCount,
      pending_invites_count: pendingInvitesCount.count ?? 0,
    },
  };
}

export async function getDashboardOverview(ctx: RequestContext) {
  return getDashboardOverviewAggregated(ctx);
}

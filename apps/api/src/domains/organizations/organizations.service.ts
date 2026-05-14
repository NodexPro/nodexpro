import { supabaseAdmin } from '../../db/client.js';
import { supabaseEmbedOne } from '../../shared/supabase-embed.js';
import { forbidden } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import { updateUserStoredActiveOrganizationId } from '../auth/active-organization.service.js';
import type { RequestContext } from '../../shared/context.js';
import type { CreateOrganizationResponse } from '../../types/api.js';

export async function createOrganization(ctx: RequestContext, params: { name: string; legalName?: string; countryCode: string; timezone?: string }): Promise<CreateOrganizationResponse> {
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .insert({
      name: params.name,
      legal_name: params.legalName ?? null,
      country_code: params.countryCode,
      timezone: params.timezone ?? 'UTC',
      status: 'active',
      owner_user_id: ctx.user.id,
    })
    .select('id, name')
    .single();
  if (!org) throw new Error('Failed to create organization');

  const ownerRole = await supabaseAdmin.from('roles').select('id').eq('code', 'owner').single();
  const adminRole = await supabaseAdmin.from('roles').select('id').eq('code', 'admin').single();
  const roleRow = ownerRole.data ?? adminRole.data;
  if (!roleRow) throw new Error('Owner or admin role not found');
  const { error: memberError } = await supabaseAdmin.from('organization_users').insert({
    organization_id: org.id,
    user_id: ctx.user.id,
    role_id: roleRow.id,
    membership_status: 'active',
  });
  if (memberError) throw new Error('Failed to create membership');
  const now = new Date().toISOString();
  await supabaseAdmin.from('organization_memberships').insert({
    organization_id: org.id,
    user_id: ctx.user.id,
    role_code: 'owner',
    status: 'active',
    joined_at: now,
    created_at: now,
    updated_at: now,
  }).then((r) => { if (r.error) console.warn('[org] organization_memberships insert:', r.error); });

  await updateUserStoredActiveOrganizationId(ctx.user.id, org.id);

  /* Legacy onboarding: optional starter plan + subscriptions + plan_modules. Not used for module entitlement.
   * Module entitlement is resolved only from organization_module_subscriptions and modules.is_system.
   * See docs/architecture/commerce-module-based/02-legacy-plans-deprecation.md */
  const starterPlan = await supabaseAdmin.from('plans').select('id, code').eq('code', 'starter').single();
  let subscriptionId: string | null = null;
  if (starterPlan.data) {
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .insert({
        organization_id: org.id,
        plan_code: starterPlan.data.code,
        status: 'active',
      })
      .select('id')
      .single();
    subscriptionId = sub?.id ?? null;
    const planModules = await supabaseAdmin.from('plan_modules').select('module_id').eq('plan_id', starterPlan.data.id);
    for (const pm of planModules.data ?? []) {
      await supabaseAdmin.from('organization_modules').insert({
        organization_id: org.id,
        module_id: pm.module_id,
        status: 'active',
        source_subscription_id: subscriptionId,
      });
    }
  }

  await writeAudit({
    organizationId: org.id,
    actorUserId: ctx.user.id,
    entityType: 'organization',
    entityId: org.id,
    action: AUDIT_ACTIONS.ORGANIZATION_CREATED,
    payload: { name: params.name },
  });

  return {
    id: org.id,
    name: org.name,
    activeOrganizationId: org.id,
    membershipCreated: true,
  };
}

export async function listMyOrganizations(userId: string) {
  const { data } = await supabaseAdmin
    .from('organization_users')
    .select('organization_id, organizations(id, name, country_code, timezone, status)')
    .eq('user_id', userId)
    .eq('membership_status', 'active');
  return (data ?? []).flatMap((o) => {
    const org = supabaseEmbedOne(
      (o as unknown as {
        organizations:
          | { id: string; name: string; country_code: string; timezone: string; status: string }
          | { id: string; name: string; country_code: string; timezone: string; status: string }[]
          | null;
      }).organizations
    );
    return org ? [org] : [];
  });
}

export async function getOrganization(ctx: RequestContext, orgId: string) {
  if (ctx.organizationId !== orgId && !(ctx.membership?.organizationId === orgId)) {
    const { data } = await supabaseAdmin.from('organization_users').select('organization_id').eq('user_id', ctx.user.id).eq('organization_id', orgId).eq('membership_status', 'active').single();
    if (!data) throw forbidden('Not a member of this organization');
  }
  const { data, error } = await supabaseAdmin.from('organizations').select('*').eq('id', orgId).single();
  if (error || !data) throw forbidden('Organization not found');
  return data;
}

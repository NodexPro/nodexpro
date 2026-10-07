import { supabaseAdmin } from '../../db/client.js';
import { forbidden } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import {
  listUserActiveOrganizationIds,
  loadOrgMembershipForUser,
  updateUserStoredActiveOrganizationId,
} from '../auth/active-organization.service.js';
import type { RequestContext } from '../../shared/context.js';
import type { CreateOrganizationResponse } from '../../types/api.js';
import { syncIncomeIssuerProfileFromOrganization } from '../income/income-issuer-profile-sync.service.js';
import { syncLegacyOrganizationUserFromCanonical } from '../memberships/organization-membership-access.js';

async function seedOrganizationSettingsOnCreate(
  orgId: string,
  params: { name: string; countryCode: string },
): Promise<void> {
  const country = String(params.countryCode ?? 'IL').trim().toUpperCase().slice(0, 2) || 'IL';
  await supabaseAdmin.from('organization_settings').upsert(
    {
      organization_id: orgId,
      organization_name: params.name.trim(),
      country,
      default_currency: 'ILS',
      default_document_language: 'he',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id' },
  );
}

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

  // Keep legacy organization_users aligned (already inserted above); ensure role remains owner.
  await syncLegacyOrganizationUserFromCanonical({
    organizationId: org.id,
    userId: ctx.user.id,
    roleCode: 'owner',
    membershipStatus: 'active',
    invitedBy: null,
  });

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

  await seedOrganizationSettingsOnCreate(org.id, { name: params.name, countryCode: params.countryCode });
  await syncIncomeIssuerProfileFromOrganization(org.id, { actorUserId: ctx.user.id, audit: true });

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
  const orgIds = await listUserActiveOrganizationIds(userId);
  if (!orgIds.length) return [];
  const { data } = await supabaseAdmin
    .from('organizations')
    .select('id, name, country_code, timezone, status')
    .in('id', orgIds);
  const byId = new Map(
    ((data ?? []) as Array<{ id: string; name: string; country_code: string; timezone: string; status: string }>).map(
      (o) => [o.id, o],
    ),
  );
  return orgIds.map((id) => byId.get(id)).filter((o): o is NonNullable<typeof o> => Boolean(o));
}

export async function getOrganization(ctx: RequestContext, orgId: string) {
  if (ctx.organizationId !== orgId && !(ctx.membership?.organizationId === orgId)) {
    const membership = await loadOrgMembershipForUser(ctx.user.id, orgId);
    if (!membership) throw forbidden('Not a member of this organization');
  }
  const { data, error } = await supabaseAdmin.from('organizations').select('*').eq('id', orgId).single();
  if (error || !data) throw forbidden('Organization not found');
  return data;
}

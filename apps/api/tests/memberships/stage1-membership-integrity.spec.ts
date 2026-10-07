/**
 * Stage 1 — Membership integrity foundation.
 * A–K security cases + source-contract guards.
 */
import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(__dirname, '../../src');

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function readSrc(...parts: string[]): string {
  return readFileSync(join(srcRoot, ...parts), 'utf8');
}

test('Stage1 source contract — canonical membership helper owns CO handler + auth gate', () => {
  const helper = readSrc('domains/memberships/organization-membership-access.ts');
  assert.match(helper, /listActiveHandlerEligibleMembers/);
  assert.match(helper, /mayUseLegacyOrganizationUsersAccessFallback/);
  assert.match(helper, /getCanonicalMembershipStatus/);
  assert.match(helper, /status === 'absent'/);
  assert.match(helper, /HANDLER_ELIGIBILITY_PERMISSION_CODES/);
  assert.match(helper, /client_operations\.edit/);
  assert.match(helper, /edit_clients/);

  const co = readSrc('domains/client-operations/client-operations.service.ts');
  assert.match(co, /listActiveHandlerEligibleMembers/);
  assert.match(co, /assertUserIsActiveHandlerEligible/);
  assert.doesNotMatch(
    co,
    /from\('organization_users'\).*assigned_handler|organization_users[\s\S]{0,80}handler/i,
  );

  const activeOrg = readSrc('domains/auth/active-organization.service.ts');
  assert.match(activeOrg, /mayUseLegacyOrganizationUsersAccessFallback/);
  assert.match(activeOrg, /canonicalOrgIds\.has\(orgId\)/);
  assert.match(activeOrg, /canonical\.status !== 'absent'/);

  const accept = readSrc('domains/memberships/memberships-rbac.service.ts');
  assert.match(accept, /syncLegacyOrganizationUserFromCanonical/);
  assert.match(accept, /invitation_accepted/);
  assert.match(accept, /user_role_changed/);
  assert.match(accept, /user_access_revoked/);

  const orgs = readSrc('domains/organizations/organizations.service.ts');
  assert.match(orgs, /listUserActiveOrganizationIds/);
  assert.match(orgs, /organization_memberships/);
  assert.match(orgs, /role_code: 'owner'/);
});

test('Stage1 A–K membership integrity (live DB)', async (t) => {
  if (!supabaseConfigured()) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }

  const { supabaseAdmin } = await import('../../src/db/client.js');
  const {
    listActiveHandlerEligibleMembers,
    assertUserIsActiveHandlerEligible,
    mayUseLegacyOrganizationUsersAccessFallback,
    getCanonicalMembershipStatus,
    syncLegacyOrganizationUserFromCanonical,
  } = await import('../../src/domains/memberships/organization-membership-access.js');
  const {
    listUserActiveOrganizationIds,
    loadOrgMembershipForUser,
  } = await import('../../src/domains/auth/active-organization.service.js');
  const { acceptInviteRbac, changeUserRoleRbac, revokeUserAccessRbac } = await import(
    '../../src/domains/memberships/memberships-rbac.service.js'
  );
  const { createOrganization } = await import('../../src/domains/organizations/organizations.service.js');
  const { AppError } = await import('../../src/shared/errors.js');

  const marker = `s1-mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ownerId = randomUUID();
  const staffId = randomUUID();
  const staffBId = randomUUID();
  const clientId = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();

  type Ctx = {
    user: { id: string; authUserId: string; email: string; fullName: string | null; status: string };
    membership: {
      organizationId: string;
      userId: string;
      roleId: string;
      roleCode: string;
      permissions: string[];
    };
    organizationId: string;
  };

  function mkCtx(userId: string, orgId: string, email: string, roleCode: string, permissions: string[]): Ctx {
    return {
      user: { id: userId, authUserId: '', email, fullName: null, status: 'active' },
      membership: {
        organizationId: orgId,
        userId,
        roleId: 's1',
        roleCode,
        permissions,
      },
      organizationId: orgId,
    };
  }

  const ownerEmail = `${marker}-owner@test.local`;
  const staffEmail = `${marker}-staff@test.local`;
  const staffBEmail = `${marker}-staffb@test.local`;

  await supabaseAdmin.from('users').insert([
    { id: ownerId, email: ownerEmail, status: 'active', full_name: 'Owner S1' },
    { id: staffId, email: staffEmail, status: 'active', full_name: 'Staff Anna' },
    { id: staffBId, email: staffBEmail, status: 'active', full_name: 'Staff Ben' },
  ]);

  // J — Owner creation → canonical active owner membership
  const ownerCtx = mkCtx(ownerId, '', ownerEmail, 'owner', [
    'invite_users',
    'change_user_role',
    'revoke_user_access',
    'view_users',
    'edit_clients',
    'client_operations.edit',
  ]);
  // createOrganization inserts org with new id — use service path via direct insert mimicking createOrganization truth
  const { data: createdOrg, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .insert({
      id: orgA,
      name: `S1 Org A ${marker}`,
      country_code: 'IL',
      timezone: 'Asia/Jerusalem',
      status: 'active',
      owner_user_id: ownerId,
    })
    .select('id')
    .single();
  if (orgErr || !createdOrg) throw orgErr ?? new Error('orgA create failed');

  const now = new Date().toISOString();
  await supabaseAdmin.from('organization_memberships').insert({
    organization_id: orgA,
    user_id: ownerId,
    role_code: 'owner',
    status: 'active',
    joined_at: now,
    created_at: now,
    updated_at: now,
  });
  await syncLegacyOrganizationUserFromCanonical({
    organizationId: orgA,
    userId: ownerId,
    roleCode: 'owner',
    membershipStatus: 'active',
  });

  const ownerMem = await getCanonicalMembershipStatus(ownerId, orgA);
  assert.equal(ownerMem.status, 'active');
  assert.equal(ownerMem.role_code, 'owner');
  const ownerLoaded = await loadOrgMembershipForUser(ownerId, orgA);
  assert.ok(ownerLoaded);
  assert.equal(ownerLoaded!.roleCode, 'owner');

  // Also verify createOrganization API path for a second org owned by staffB later (I/J hybrid)
  ownerCtx.organizationId = orgA;
  ownerCtx.membership.organizationId = orgA;

  // Org B for multi-org cases
  await supabaseAdmin.from('organizations').insert({
    id: orgB,
    name: `S1 Org B ${marker}`,
    country_code: 'IL',
    timezone: 'Asia/Jerusalem',
    status: 'active',
    owner_user_id: ownerId,
  });
  await supabaseAdmin.from('organization_memberships').insert({
    organization_id: orgB,
    user_id: ownerId,
    role_code: 'owner',
    status: 'active',
    joined_at: now,
    created_at: now,
    updated_at: now,
  });

  // A + K — Accept Staff invite → canonical active membership, no duplicate
  const inviteToken = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  const expires = new Date();
  expires.setDate(expires.getDate() + 7);
  const { data: inv, error: invErr } = await supabaseAdmin
    .from('user_invitations')
    .insert({
      organization_id: orgA,
      email: staffEmail,
      role_code: 'staff',
      status: 'pending',
      token: inviteToken,
      invited_by: ownerId,
      expires_at: expires.toISOString(),
    })
    .select('id')
    .single();
  if (invErr || !inv) throw invErr ?? new Error('invite insert failed');

  const staffCtx = mkCtx(staffId, orgA, staffEmail, 'staff', []);
  const accept1 = await acceptInviteRbac(staffCtx as never, inviteToken);
  assert.equal(accept1.success, true);

  const staffCanon = await getCanonicalMembershipStatus(staffId, orgA);
  assert.equal(staffCanon.status, 'active');
  assert.equal(staffCanon.role_code, 'staff');

  const { data: memRows } = await supabaseAdmin
    .from('organization_memberships')
    .select('id')
    .eq('organization_id', orgA)
    .eq('user_id', staffId);
  assert.equal((memRows ?? []).length, 1, 'K — no duplicate membership');

  // Compatibility dual-write present for legacy readers
  const { data: ouAfterAccept } = await supabaseAdmin
    .from('organization_users')
    .select('membership_status')
    .eq('organization_id', orgA)
    .eq('user_id', staffId)
    .maybeSingle();
  assert.equal((ouAfterAccept as { membership_status?: string } | null)?.membership_status, 'active');

  // B — Accepted Staff appears as CO handler option
  let handlers = await listActiveHandlerEligibleMembers(orgA);
  assert.ok(handlers.some((h) => h.user_id === staffId), 'B — staff in handler options');

  // C — update_profile validation accepts same eligible staff
  await assert.doesNotReject(() => assertUserIsActiveHandlerEligible(orgA, staffId));

  // Seed client with assignment for G
  await supabaseAdmin.from('clients').insert({
    id: clientId,
    organization_id: orgA,
    tax_id: `${Date.now()}`.slice(0, 15),
    client_type: 'business_customer',
    display_name: `Client ${marker}`,
    status: 'active',
    created_by: ownerId,
  });
  await supabaseAdmin.from('client_operational_profiles').upsert(
    {
      organization_id: orgA,
      client_id: clientId,
      assigned_handler_user_id: staffId,
      updated_at: now,
    },
    { onConflict: 'organization_id,client_id' },
  );

  // I — Same user different roles in two orgs (staff in A, admin in B)
  await supabaseAdmin.from('organization_memberships').insert({
    organization_id: orgB,
    user_id: staffId,
    role_code: 'admin',
    status: 'active',
    joined_at: now,
    created_at: now,
    updated_at: now,
  });
  const memA = await loadOrgMembershipForUser(staffId, orgA);
  const memB = await loadOrgMembershipForUser(staffId, orgB);
  assert.equal(memA?.roleCode, 'staff');
  assert.equal(memB?.roleCode, 'admin');

  // F — Role change to viewer → cannot newly assign as handler
  const { data: staffMemRow } = await supabaseAdmin
    .from('organization_memberships')
    .select('id')
    .eq('organization_id', orgA)
    .eq('user_id', staffId)
    .single();
  await changeUserRoleRbac(
    mkCtx(ownerId, orgA, ownerEmail, 'owner', ['change_user_role']) as never,
    orgA,
    (staffMemRow as { id: string }).id,
    'viewer',
  );
  handlers = await listActiveHandlerEligibleMembers(orgA);
  assert.ok(!handlers.some((h) => h.user_id === staffId), 'F — viewer not handler-eligible');
  await assert.rejects(
    () => assertUserIsActiveHandlerEligible(orgA, staffId),
    (e: unknown) => e instanceof AppError && (e as AppError).statusCode === 403,
  );

  // Restore staff for revoke path (attribution preservation still tested below)
  await supabaseAdmin
    .from('organization_memberships')
    .update({ role_code: 'staff', updated_at: new Date().toISOString() })
    .eq('organization_id', orgA)
    .eq('user_id', staffId);
  await syncLegacyOrganizationUserFromCanonical({
    organizationId: orgA,
    userId: staffId,
    roleCode: 'staff',
    membershipStatus: 'active',
  });

  // D + E + G + H — Revoke in Org A; stale OU must not restore access; attribution preserved; Org B still ok
  await revokeUserAccessRbac(
    mkCtx(ownerId, orgA, ownerEmail, 'owner', ['revoke_user_access']) as never,
    orgA,
    (staffMemRow as { id: string }).id,
  );

  const revoked = await getCanonicalMembershipStatus(staffId, orgA);
  assert.equal(revoked.status, 'revoked');

  handlers = await listActiveHandlerEligibleMembers(orgA);
  assert.ok(!handlers.some((h) => h.user_id === staffId), 'D — revoked gone from handler options');

  // Force stale active OU row (attack / drift scenario)
  await supabaseAdmin
    .from('organization_users')
    .update({ membership_status: 'active', updated_at: new Date().toISOString() })
    .eq('organization_id', orgA)
    .eq('user_id', staffId);

  assert.equal(await mayUseLegacyOrganizationUsersAccessFallback(staffId, orgA), false);
  const denied = await loadOrgMembershipForUser(staffId, orgA);
  assert.equal(denied, null, 'E — revoked canonical beats stale OU');

  const activeIds = await listUserActiveOrganizationIds(staffId);
  assert.ok(!activeIds.includes(orgA), 'H — Org A inaccessible when revoked');
  assert.ok(activeIds.includes(orgB), 'H — Org B still accessible');

  const { data: profileAfter } = await supabaseAdmin
    .from('client_operational_profiles')
    .select('assigned_handler_user_id')
    .eq('organization_id', orgA)
    .eq('client_id', clientId)
    .maybeSingle();
  assert.equal(
    (profileAfter as { assigned_handler_user_id: string | null } | null)?.assigned_handler_user_id,
    staffId,
    'G — assignment attribution not deleted',
  );

  // createOrganization path (J) — separate org via service
  const orgOwner2 = randomUUID();
  await supabaseAdmin.from('users').insert({
    id: orgOwner2,
    email: `${marker}-owner2@test.local`,
    status: 'active',
    full_name: 'Owner2',
  });
  const created = await createOrganization(
    mkCtx(orgOwner2, '', `${marker}-owner2@test.local`, 'owner', []) as never,
    { name: `S1 Created ${marker}`, countryCode: 'IL' },
  );
  assert.ok(created.id);
  const createdMem = await getCanonicalMembershipStatus(orgOwner2, created.id);
  assert.equal(createdMem.status, 'active');
  assert.equal(createdMem.role_code, 'owner');

  // Cleanup (best-effort)
  await supabaseAdmin.from('client_operational_profiles').delete().eq('client_id', clientId);
  await supabaseAdmin.from('clients').delete().eq('id', clientId);
  await supabaseAdmin.from('user_invitations').delete().eq('id', (inv as { id: string }).id);
  await supabaseAdmin.from('organization_memberships').delete().eq('organization_id', orgA);
  await supabaseAdmin.from('organization_memberships').delete().eq('organization_id', orgB);
  await supabaseAdmin.from('organization_memberships').delete().eq('organization_id', created.id);
  await supabaseAdmin.from('organization_users').delete().eq('organization_id', orgA);
  await supabaseAdmin.from('organization_users').delete().eq('organization_id', created.id);
  await supabaseAdmin.from('organizations').delete().eq('id', orgA);
  await supabaseAdmin.from('organizations').delete().eq('id', orgB);
  await supabaseAdmin.from('organizations').delete().eq('id', created.id);
  await supabaseAdmin.from('users').delete().in('id', [ownerId, staffId, staffBId, orgOwner2]);
});

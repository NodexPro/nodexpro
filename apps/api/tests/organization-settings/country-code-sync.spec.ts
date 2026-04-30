import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../../src/shared/context.js';

type SupabaseAdmin = any;

let supabaseAdminCached: SupabaseAdmin | null = null;
async function getSupabaseAdmin(): Promise<SupabaseAdmin> {
  if (supabaseAdminCached) return supabaseAdminCached;
  const db = await import('../../src/db/client.js');
  supabaseAdminCached = db.supabaseAdmin as unknown as SupabaseAdmin;
  return supabaseAdminCached;
}

function mkOwnerCtx(userId: string, orgId: string): RequestContext {
  return {
    user: { id: userId, authUserId: '', email: 'owner@test.local', fullName: null, status: 'active' },
    membership: {
      organizationId: orgId,
      userId,
      roleId: 'r',
      roleCode: 'owner',
      permissions: ['settings:write'],
    },
    organizationId: orgId,
  };
}

test('organization settings: PATCH country updates organizations.country_code, mirrors organization_settings, resets country pack row', async () => {
  const supabaseAdmin = await getSupabaseAdmin();
  const { patchOrganizationSettings, getOrganizationSettings } = await import(
    '../../src/domains/organization-settings/organization-settings.service.js'
  );
  const { buildOrganizationCountrySettingsAggregate } = await import(
    '../../src/domains/country-pack/country-pack-read-models.service.js'
  );
  const { executeCountryPackCommand } = await import('../../src/domains/country-pack/country-pack-commands.service.js');

  const marker = `cc-sync-${Date.now()}`;
  const userId = randomUUID();
  const orgId = randomUUID();
  let ownerUserId: string | null = null;
  let createdPackId: string | null = null;

  await supabaseAdmin.from('users').insert({ id: userId, email: `${marker}@test.local`, status: 'active' });
  await supabaseAdmin
    .from('organizations')
    .insert({
      id: orgId,
      name: `${marker}-org`,
      country_code: 'IL',
      timezone: 'UTC',
      status: 'active',
      owner_user_id: userId,
    });

  await supabaseAdmin.from('countries').upsert(
    [
      { code: 'IL', name: 'Israel', status: 'active' },
      { code: 'US', name: 'United States', status: 'active' },
    ],
    { onConflict: 'code' }
  );

  await supabaseAdmin.from('organization_settings').insert({
    organization_id: orgId,
    country: 'IL',
    organization_name: `${marker}-org`,
  });

  await supabaseAdmin.from('organization_country_settings').insert({
    organization_id: orgId,
    country_code: 'IL',
    active_country_pack_id: null,
    active_ruleset_id: null,
    settings_status: 'not_configured',
  });

  const ctx = mkOwnerCtx(userId, orgId);
  process.env.PLATFORM_OWNER_EMAIL = process.env.PLATFORM_OWNER_EMAIL ?? 'platform.owner@test.local';

  try {
    await patchOrganizationSettings(ctx, orgId, { country: 'us' });

    const { data: orgRow } = await supabaseAdmin.from('organizations').select('country_code').eq('id', orgId).single();
    assert.equal(orgRow?.country_code, 'US');

    const { data: settingsRow } = await supabaseAdmin.from('organization_settings').select('country').eq('organization_id', orgId).single();
    assert.equal(settingsRow?.country, 'US');

    const { data: ocs } = await supabaseAdmin.from('organization_country_settings').select('*').eq('organization_id', orgId).single();
    assert.equal(ocs?.country_code, 'US');
    assert.equal(ocs?.active_country_pack_id, null);
    assert.equal(ocs?.active_ruleset_id, null);
    assert.equal(ocs?.settings_status, 'not_configured');

    const dto = await getOrganizationSettings(ctx, orgId);
    assert.equal(dto.profile?.country, 'US');

    const agg = await buildOrganizationCountrySettingsAggregate(ctx, orgId);
    assert.equal((agg.organization as { country_code: string }).country_code, 'US');

    ownerUserId = randomUUID();
    await supabaseAdmin.from('users').insert({
      id: ownerUserId,
      email: process.env.PLATFORM_OWNER_EMAIL!,
      status: 'active',
    });
    const ownerCtx: RequestContext = {
      user: { id: ownerUserId, authUserId: '', email: process.env.PLATFORM_OWNER_EMAIL!, fullName: null, status: 'active' },
      membership: null,
      organizationId: null,
    };

    const packCode = `${marker}-pack`;
    await executeCountryPackCommand(ownerCtx, {
      command: 'create_country_pack',
      payload: {
        country_code: 'IL',
        pack_code: packCode,
        name: `${marker} pack`,
        status: 'enabled',
        framework_version: '1',
        code_version: '1',
      },
    });
    const { data: packRow } = await supabaseAdmin
      .from('country_packs')
      .select('id')
      .eq('pack_code', packCode)
      .maybeSingle();
    assert.ok(packRow?.id);
    createdPackId = packRow!.id;

    await assert.rejects(
      () =>
        executeCountryPackCommand(ownerCtx, {
          command: 'assign_country_pack_to_organization',
          payload: { organization_id: orgId, country_pack_id: packRow!.id },
        }),
      /not eligible|Organization country is not eligible/i
    );
  } finally {
    if (createdPackId) await supabaseAdmin.from('country_packs').delete().eq('id', createdPackId);
    await supabaseAdmin.from('organization_country_settings').delete().eq('organization_id', orgId);
    await supabaseAdmin.from('organization_settings').delete().eq('organization_id', orgId);
    await supabaseAdmin.from('organizations').delete().eq('id', orgId);
    await supabaseAdmin.from('users').delete().eq('id', userId);
    if (ownerUserId) await supabaseAdmin.from('users').delete().eq('id', ownerUserId);
  }
});

test('organization settings: PATCH country rejects unknown code when countries registry is non-empty', async () => {
  const supabaseAdmin = await getSupabaseAdmin();
  const { patchOrganizationSettings } = await import('../../src/domains/organization-settings/organization-settings.service.js');

  const marker = `cc-bad-${Date.now()}`;
  const userId = randomUUID();
  const orgId = randomUUID();

  await supabaseAdmin.from('users').insert({ id: userId, email: `${marker}@test.local`, status: 'active' });
  await supabaseAdmin.from('organizations').insert({
    id: orgId,
    name: `${marker}-org`,
    country_code: 'IL',
    timezone: 'UTC',
    status: 'active',
    owner_user_id: userId,
  });
  await supabaseAdmin.from('countries').upsert({ code: 'IL', name: 'Israel', status: 'active' }, { onConflict: 'code' });

  let unregisteredCode: string | null = null;
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let attempt = 0; attempt < 80 && !unregisteredCode; attempt++) {
    const c = letters[Math.floor(Math.random() * 26)] + letters[Math.floor(Math.random() * 26)];
    const { data } = await supabaseAdmin.from('countries').select('code').eq('code', c).maybeSingle();
    if (!data) unregisteredCode = c;
  }
  assert.ok(unregisteredCode, 'need a 2-letter code not present in countries (shared DB may have many seeds)');

  const ctx = mkOwnerCtx(userId, orgId);

  try {
    await assert.rejects(
      () => patchOrganizationSettings(ctx, orgId, { country: unregisteredCode! }),
      /not registered|COUNTRY_NOT_REGISTERED/i
    );
  } finally {
    await supabaseAdmin.from('organizations').delete().eq('id', orgId);
    await supabaseAdmin.from('users').delete().eq('id', userId);
  }
});

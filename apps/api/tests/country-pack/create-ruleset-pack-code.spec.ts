import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../../src/shared/context.js';
import { supabaseAdmin } from '../../src/db/client.js';
import { executeCountryPackCommand } from '../../src/domains/country-pack/country-pack-commands.service.js';

function ownerCtx(userId: string): RequestContext {
  return {
    user: {
      id: userId,
      authUserId: '',
      email: process.env.PLATFORM_OWNER_EMAIL ?? 'platform.owner@test.local',
      fullName: null,
      status: 'active',
    },
    membership: null,
    organizationId: null,
  };
}

test('create_ruleset resolves pack_code to country_pack_id', async () => {
  process.env.PLATFORM_OWNER_EMAIL = process.env.PLATFORM_OWNER_EMAIL ?? 'platform.owner@test.local';
  const marker = `crs-pc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const packCode = `${marker}_pack`;
  const ownerUserId = randomUUID();
  let rulesetId: string | null = null;

  await supabaseAdmin.from('users').insert({
    id: ownerUserId,
    email: process.env.PLATFORM_OWNER_EMAIL!,
    status: 'active',
  });
  await supabaseAdmin.from('countries').upsert(
    { code: 'IL', name: 'Israel', status: 'active' },
    { onConflict: 'code' }
  );

  try {
    const packRes = await executeCountryPackCommand(ownerCtx(ownerUserId), {
      command: 'create_country_pack',
      payload: {
        country_code: 'IL',
        pack_code: packCode,
        name: `${marker} Pack`,
        status: 'enabled',
        framework_version: '1',
        code_version: '1',
      },
    });
    const admin = (packRes as { refreshed: { aggregate: Record<string, unknown> } }).refreshed.aggregate.country_packs_admin as {
      tables?: { country_packs?: Array<{ id: string }> };
    };
    const packId = admin?.tables?.country_packs?.[0]?.id;
    assert.ok(packId);

    const out = await executeCountryPackCommand(ownerCtx(ownerUserId), {
      command: 'create_ruleset',
      payload: {
        pack_code: packCode,
        ruleset_code: `${marker}_rs`,
        ruleset_version: '1',
        effective_from: '2030-01-01',
        effective_to: null,
        status: 'draft',
      },
    });
    assert.equal((out as { command: string }).command, 'create_ruleset');

    const { data: row } = await supabaseAdmin
      .from('country_pack_rulesets')
      .select('id, country_pack_id')
      .eq('country_pack_id', packId)
      .eq('ruleset_code', `${marker}_rs`)
      .maybeSingle();
    assert.ok(row);
    assert.equal(row.country_pack_id, packId);
    rulesetId = row.id as string;
  } finally {
    if (rulesetId) await supabaseAdmin.from('country_pack_rulesets').delete().eq('id', rulesetId);
    await supabaseAdmin.from('country_packs').delete().eq('pack_code', packCode);
    await supabaseAdmin.from('audit_log').delete().eq('actor_user_id', ownerUserId);
    await supabaseAdmin.from('users').delete().eq('id', ownerUserId);
  }
});

test('create_ruleset prefers country_pack_id when both pack_code and country_pack_id are sent', async () => {
  process.env.PLATFORM_OWNER_EMAIL = process.env.PLATFORM_OWNER_EMAIL ?? 'platform.owner@test.local';
  const marker = `crs-both-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const packCodeA = `${marker}_pack_a`;
  const packCodeB = `${marker}_pack_b`;
  const ownerUserId = randomUUID();
  let rulesetId: string | null = null;
  let packIdA: string | null = null;
  let packIdB: string | null = null;

  await supabaseAdmin.from('users').insert({
    id: ownerUserId,
    email: process.env.PLATFORM_OWNER_EMAIL!,
    status: 'active',
  });
  await supabaseAdmin.from('countries').upsert(
    { code: 'IL', name: 'Israel', status: 'active' },
    { onConflict: 'code' }
  );

  try {
    for (const [code, name] of [
      [packCodeA, `${marker} A`],
      [packCodeB, `${marker} B`],
    ] as const) {
      await executeCountryPackCommand(ownerCtx(ownerUserId), {
        command: 'create_country_pack',
        payload: {
          country_code: 'IL',
          pack_code: code,
          name,
          status: 'enabled',
          framework_version: '1',
          code_version: '1',
        },
      });
    }
    const { data: packs } = await supabaseAdmin.from('country_packs').select('id, pack_code').in('pack_code', [packCodeA, packCodeB]);
    const a = packs?.find((p) => p.pack_code === packCodeA);
    const b = packs?.find((p) => p.pack_code === packCodeB);
    assert.ok(a && b);
    packIdA = a.id as string;
    packIdB = b.id as string;

    await executeCountryPackCommand(ownerCtx(ownerUserId), {
      command: 'create_ruleset',
      payload: {
        country_pack_id: packIdB,
        pack_code: packCodeA,
        ruleset_code: `${marker}_rs_both`,
        ruleset_version: '1',
        effective_from: '2031-01-01',
        effective_to: null,
        status: 'draft',
      },
    });

    const { data: row } = await supabaseAdmin
      .from('country_pack_rulesets')
      .select('id, country_pack_id')
      .eq('ruleset_code', `${marker}_rs_both`)
      .maybeSingle();
    assert.ok(row);
    assert.equal(row.country_pack_id, packIdB);
    rulesetId = row.id as string;
  } finally {
    if (rulesetId) await supabaseAdmin.from('country_pack_rulesets').delete().eq('id', rulesetId);
    if (packIdA) await supabaseAdmin.from('country_packs').delete().eq('id', packIdA);
    if (packIdB) await supabaseAdmin.from('country_packs').delete().eq('id', packIdB);
    await supabaseAdmin.from('audit_log').delete().eq('actor_user_id', ownerUserId);
    await supabaseAdmin.from('users').delete().eq('id', ownerUserId);
  }
});

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

test('create_legal_value_version resolves ruleset_code by country_code + ruleset_code', async () => {
  process.env.PLATFORM_OWNER_EMAIL = process.env.PLATFORM_OWNER_EMAIL ?? 'platform.owner@test.local';
  const marker = `clvv-rc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const ownerUserId = randomUUID();
  const packCode = `${marker}_pack`;
  const rulesetCode = `${marker}_rs`;
  const valueKey = `${marker}_value`;

  let legalValueId: string | null = null;
  let rulesetId: string | null = null;
  let packId: string | null = null;
  let versionId: string | null = null;

  await supabaseAdmin.from('users').insert({
    id: ownerUserId,
    email: process.env.PLATFORM_OWNER_EMAIL!,
    status: 'active',
  });
  await supabaseAdmin
    .from('countries')
    .upsert({ code: 'IL', name: 'Israel', status: 'active' }, { onConflict: 'code' });

  try {
    await executeCountryPackCommand(ownerCtx(ownerUserId), {
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
    const { data: pack } = await supabaseAdmin.from('country_packs').select('id').eq('pack_code', packCode).maybeSingle();
    assert.ok(pack?.id);
    packId = pack.id as string;

    await executeCountryPackCommand(ownerCtx(ownerUserId), {
      command: 'create_ruleset',
      payload: {
        country_pack_id: packId,
        ruleset_code: rulesetCode,
        ruleset_version: '1',
        effective_from: '2030-01-01',
        status: 'draft',
      },
    });
    const { data: ruleset } = await supabaseAdmin
      .from('country_pack_rulesets')
      .select('id')
      .eq('country_pack_id', packId)
      .eq('ruleset_code', rulesetCode)
      .maybeSingle();
    assert.ok(ruleset?.id);
    rulesetId = ruleset.id as string;

    await executeCountryPackCommand(ownerCtx(ownerUserId), {
      command: 'create_legal_value',
      payload: {
        country_code: 'IL',
        value_key: valueKey,
        label: 'Test value',
        category: 'VAT',
        module_scope: 'module:tax',
        value_type: 'json',
        status: 'draft',
      },
    });
    const { data: lv } = await supabaseAdmin
      .from('country_legal_values')
      .select('id')
      .eq('country_code', 'IL')
      .eq('value_key', valueKey)
      .maybeSingle();
    assert.ok(lv?.id);
    legalValueId = lv.id as string;

    await executeCountryPackCommand(ownerCtx(ownerUserId), {
      command: 'create_legal_value_version',
      payload: {
        country_code: 'IL',
        value_key: valueKey,
        ruleset_code: rulesetCode,
        value_payload_json: { foo: 'bar' },
        effective_from: '2030-01-01',
        status: 'draft',
      },
    });

    const { data: version } = await supabaseAdmin
      .from('country_legal_value_versions')
      .select('id, country_pack_ruleset_id')
      .eq('legal_value_id', legalValueId)
      .eq('country_pack_ruleset_id', rulesetId)
      .maybeSingle();
    assert.ok(version);
    versionId = version.id as string;
    assert.equal(version.country_pack_ruleset_id, rulesetId);
  } finally {
    if (versionId) await supabaseAdmin.from('country_legal_value_versions').delete().eq('id', versionId);
    if (legalValueId) await supabaseAdmin.from('country_legal_values').delete().eq('id', legalValueId);
    if (rulesetId) await supabaseAdmin.from('country_pack_rulesets').delete().eq('id', rulesetId);
    if (packId) await supabaseAdmin.from('country_packs').delete().eq('id', packId);
    await supabaseAdmin.from('audit_log').delete().eq('actor_user_id', ownerUserId);
    await supabaseAdmin.from('users').delete().eq('id', ownerUserId);
  }
});

test('create_legal_value_version prefers country_pack_ruleset_id when both fields are provided', async () => {
  process.env.PLATFORM_OWNER_EMAIL = process.env.PLATFORM_OWNER_EMAIL ?? 'platform.owner@test.local';
  const marker = `clvv-both-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const ownerUserId = randomUUID();
  const valueKey = `${marker}_value`;

  let legalValueId: string | null = null;
  let rulesetAId: string | null = null;
  let rulesetBId: string | null = null;
  let packAId: string | null = null;
  let packBId: string | null = null;
  let versionId: string | null = null;

  await supabaseAdmin.from('users').insert({
    id: ownerUserId,
    email: process.env.PLATFORM_OWNER_EMAIL!,
    status: 'active',
  });
  await supabaseAdmin
    .from('countries')
    .upsert({ code: 'IL', name: 'Israel', status: 'active' }, { onConflict: 'code' });

  try {
    for (const code of [`${marker}_pack_a`, `${marker}_pack_b`]) {
      await executeCountryPackCommand(ownerCtx(ownerUserId), {
        command: 'create_country_pack',
        payload: {
          country_code: 'IL',
          pack_code: code,
          name: code,
          status: 'enabled',
          framework_version: '1',
          code_version: '1',
        },
      });
    }

    const { data: packs } = await supabaseAdmin
      .from('country_packs')
      .select('id, pack_code')
      .in('pack_code', [`${marker}_pack_a`, `${marker}_pack_b`]);
    const pa = packs?.find((p) => p.pack_code === `${marker}_pack_a`);
    const pb = packs?.find((p) => p.pack_code === `${marker}_pack_b`);
    assert.ok(pa && pb);
    packAId = pa.id as string;
    packBId = pb.id as string;

    await executeCountryPackCommand(ownerCtx(ownerUserId), {
      command: 'create_ruleset',
      payload: {
        country_pack_id: packAId,
        ruleset_code: `${marker}_ruleset_a`,
        ruleset_version: '1',
        effective_from: '2031-01-01',
        status: 'draft',
      },
    });
    await executeCountryPackCommand(ownerCtx(ownerUserId), {
      command: 'create_ruleset',
      payload: {
        country_pack_id: packBId,
        ruleset_code: `${marker}_ruleset_b`,
        ruleset_version: '1',
        effective_from: '2031-01-01',
        status: 'draft',
      },
    });

    const { data: rulesets } = await supabaseAdmin
      .from('country_pack_rulesets')
      .select('id, ruleset_code, country_pack_id')
      .in('country_pack_id', [packAId, packBId]);
    const ra = rulesets?.find((r) => r.country_pack_id === packAId);
    const rb = rulesets?.find((r) => r.country_pack_id === packBId);
    assert.ok(ra && rb);
    rulesetAId = ra.id as string;
    rulesetBId = rb.id as string;

    await executeCountryPackCommand(ownerCtx(ownerUserId), {
      command: 'create_legal_value',
      payload: {
        country_code: 'IL',
        value_key: valueKey,
        label: 'Test value',
        category: 'VAT',
        module_scope: 'module:tax',
        value_type: 'json',
        status: 'draft',
      },
    });
    const { data: lv } = await supabaseAdmin
      .from('country_legal_values')
      .select('id')
      .eq('country_code', 'IL')
      .eq('value_key', valueKey)
      .maybeSingle();
    assert.ok(lv?.id);
    legalValueId = lv.id as string;

    await executeCountryPackCommand(ownerCtx(ownerUserId), {
      command: 'create_legal_value_version',
      payload: {
        country_code: 'IL',
        value_key: valueKey,
        country_pack_ruleset_id: rulesetBId,
        ruleset_code: `${marker}_ruleset_a`,
        value_payload_json: { foo: 'baz' },
        effective_from: '2031-02-01',
        status: 'draft',
      },
    });

    const { data: version } = await supabaseAdmin
      .from('country_legal_value_versions')
      .select('id, country_pack_ruleset_id')
      .eq('legal_value_id', legalValueId)
      .eq('effective_from', '2031-02-01')
      .maybeSingle();
    assert.ok(version);
    versionId = version.id as string;
    assert.equal(version.country_pack_ruleset_id, rulesetBId);
  } finally {
    if (versionId) await supabaseAdmin.from('country_legal_value_versions').delete().eq('id', versionId);
    if (legalValueId) await supabaseAdmin.from('country_legal_values').delete().eq('id', legalValueId);
    if (rulesetAId) await supabaseAdmin.from('country_pack_rulesets').delete().eq('id', rulesetAId);
    if (rulesetBId) await supabaseAdmin.from('country_pack_rulesets').delete().eq('id', rulesetBId);
    if (packAId) await supabaseAdmin.from('country_packs').delete().eq('id', packAId);
    if (packBId) await supabaseAdmin.from('country_packs').delete().eq('id', packBId);
    await supabaseAdmin.from('audit_log').delete().eq('actor_user_id', ownerUserId);
    await supabaseAdmin.from('users').delete().eq('id', ownerUserId);
  }
});

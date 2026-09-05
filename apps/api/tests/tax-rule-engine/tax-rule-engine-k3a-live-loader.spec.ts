import 'dotenv/config';

if (!process.env.PLATFORM_OWNER_EMAIL?.trim()) {
  process.env.PLATFORM_OWNER_EMAIL = 'tk3a-live-owner@nodexpro.test';
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isSupabaseMissingTableError } from '../../src/shared/supabase-errors.js';
import { TAX_RULE_ENGINE_AGGREGATE_KEY } from '../../src/domains/tax-rule-engine/tax-rule-engine.types.js';

const AUTHORIZED_DEV_HOST = 'jgxezhjctrgfbmmkqqhn.supabase.co';
const AS_OF = '2026-06-01';

const WATCHED_TABLES = [
  'tax_sources',
  'tax_rules',
  'tax_rule_versions',
  'tax_rule_version_sources',
  'tax_rule_version_legal_values',
  'tax_rule_relationships',
] as const;

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function authorizedDevTarget(): boolean {
  const raw = process.env.SUPABASE_URL?.trim();
  if (!raw) return false;
  try {
    return new URL(raw).hostname === AUTHORIZED_DEV_HOST;
  } catch {
    return false;
  }
}

function ownerEmail(): string | null {
  return process.env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase() || null;
}

function errText(error: { message?: string; code?: string; details?: string; hint?: string } | null): string {
  return [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(' | ');
}

function k3aPayload(statement: string): Record<string, unknown> {
  return { statement, applies_if: null, does_not_apply_if: null, notes: null };
}

function idsIn(aggregate: {
  applicable: Array<{ tax_rule_version_id: string }>;
  not_applicable: Array<{ tax_rule_version_id: string }>;
  undetermined: Array<{ tax_rule_version_id: string }>;
  evaluated_version_ids: string[];
}): string[] {
  return [
    ...aggregate.evaluated_version_ids,
    ...aggregate.applicable.map((row) => row.tax_rule_version_id),
    ...aggregate.not_applicable.map((row) => row.tax_rule_version_id),
    ...aggregate.undetermined.map((row) => row.tax_rule_version_id),
  ];
}

test('TAX-K3A live: loader/evaluate against DEV Tax Knowledge', async (t) => {
  if (!supabaseConfigured()) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }
  if (!authorizedDevTarget()) {
    throw new Error('TAX-K3A live test refused: SUPABASE_URL is not the authorized DEV project');
  }

  const email = ownerEmail();
  if (!email) {
    t.skip('PLATFORM_OWNER_EMAIL not configured');
    return;
  }

  const { supabaseAdmin } = await import('../../src/db/client.js');
  const probe = await supabaseAdmin.from('tax_rule_versions').select('id').limit(1);
  if (probe.error && isSupabaseMissingTableError(probe.error, 'tax_rule_versions')) {
    t.skip('tax_rule_versions not available on DEV');
    return;
  }
  if (probe.error) throw new Error(`tax_rule_versions probe failed: ${errText(probe.error)}`);

  const { executeTaxRuleEngineCommand } = await import(
    '../../src/domains/tax-rule-engine/tax-rule-engine-commands.service.js'
  );

  const marker = `tk3a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const packIl = randomUUID();
  const packUs = randomUUID();
  const rulesetIl = randomUUID();
  const rulesetUs = randomUUID();
  const sourceIl = randomUUID();
  const sourceUs = randomUUID();
  const ruleIlA = randomUUID();
  const ruleIlB = randomUUID();
  const ruleUs = randomUUID();
  const citationIl = randomUUID();
  const locatorIl = `${marker}-art-1`;

  const ownerCtx = {
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      authUserId: '00000000-0000-0000-0000-000000000001',
      email,
      fullName: null,
      status: 'active',
      uiLanguage: 'en' as const,
    },
    membership: null,
    organizationId: null,
  };

  const { error: countryErr } = await supabaseAdmin.from('countries').upsert(
    [
      { code: 'IL', name: 'Israel', status: 'active', default_timezone: 'Asia/Jerusalem' },
      { code: 'US', name: 'United States', status: 'active', default_timezone: 'America/New_York' },
    ],
    { onConflict: 'code' },
  );
  if (countryErr) throw new Error(`countries upsert failed: ${errText(countryErr)}`);

  const { error: packErr } = await supabaseAdmin.from('country_packs').insert([
    {
      id: packIl,
      country_code: 'IL',
      pack_code: `${marker}_il_pack`,
      name: `${marker} IL pack`,
      status: 'enabled',
      framework_version: '1.0.0',
      code_version: '1.0.0',
    },
    {
      id: packUs,
      country_code: 'US',
      pack_code: `${marker}_us_pack`,
      name: `${marker} US pack`,
      status: 'enabled',
      framework_version: '1.0.0',
      code_version: '1.0.0',
    },
  ]);
  if (packErr) throw new Error(`country_packs insert failed: ${errText(packErr)}`);

  const { error: rulesetErr } = await supabaseAdmin.from('country_pack_rulesets').insert([
    {
      id: rulesetIl,
      country_pack_id: packIl,
      ruleset_code: `${marker}_il_rs`,
      ruleset_version: '1.0.0',
      effective_from: '2020-01-01',
      status: 'active',
    },
    {
      id: rulesetUs,
      country_pack_id: packUs,
      ruleset_code: `${marker}_us_rs`,
      ruleset_version: '1.0.0',
      effective_from: '2020-01-01',
      status: 'active',
    },
  ]);
  if (rulesetErr) throw new Error(`country_pack_rulesets insert failed: ${errText(rulesetErr)}`);

  const { error: srcErr } = await supabaseAdmin.from('tax_sources').insert([
    {
      id: sourceIl,
      country_code: 'IL',
      source_code: `${marker}_il_src`,
      title: `${marker} IL source`,
      provenance_type: 'official_law',
      status: 'active',
    },
    {
      id: sourceUs,
      country_code: 'US',
      source_code: `${marker}_us_src`,
      title: `${marker} US source`,
      provenance_type: 'official_law',
      status: 'active',
    },
  ]);
  if (srcErr) throw new Error(`tax_sources insert failed: ${errText(srcErr)}`);

  const { error: ruleErr } = await supabaseAdmin.from('tax_rules').insert([
    {
      id: ruleIlA,
      country_code: 'IL',
      rule_code: `${marker}_il_a`,
      title: `${marker} IL rule A`,
      rule_kind: 'legal_rule',
      status: 'draft',
    },
    {
      id: ruleIlB,
      country_code: 'IL',
      rule_code: `${marker}_il_b`,
      title: `${marker} IL rule B`,
      rule_kind: 'legal_rule',
      status: 'draft',
    },
    {
      id: ruleUs,
      country_code: 'US',
      rule_code: `${marker}_us`,
      title: `${marker} US rule`,
      rule_kind: 'legal_rule',
      status: 'draft',
    },
  ]);
  if (ruleErr) throw new Error(`tax_rules insert failed: ${errText(ruleErr)}`);

  async function insertVersion(opts: {
    id?: string;
    taxRuleId: string;
    countryCode: 'IL' | 'US';
    packId: string;
    rulesetId: string;
    versionNo: number;
    effectiveFrom: string;
    effectiveTo?: string | null;
    statement: string;
  }): Promise<string> {
    const id = opts.id ?? randomUUID();
    const { error } = await supabaseAdmin.from('tax_rule_versions').insert({
      id,
      tax_rule_id: opts.taxRuleId,
      country_code: opts.countryCode,
      country_pack_id: opts.packId,
      country_pack_ruleset_id: opts.rulesetId,
      version_no: opts.versionNo,
      status: 'draft',
      effective_from: opts.effectiveFrom,
      effective_to: opts.effectiveTo === undefined ? null : opts.effectiveTo,
      payload_json: k3aPayload(opts.statement),
      payload_checksum: `tk3a-fixture-${id}`,
    });
    if (error) throw new Error(`tax_rule_versions insert failed: ${errText(error)}`);
    return id;
  }

  async function cite(versionId: string, sourceId: string, countryCode: 'IL' | 'US', citationId?: string, locator?: string) {
    const { error } = await supabaseAdmin.from('tax_rule_version_sources').insert({
      id: citationId ?? randomUUID(),
      tax_rule_version_id: versionId,
      tax_source_id: sourceId,
      country_code: countryCode,
      ...(locator ? { locator } : {}),
    });
    if (error) throw new Error(`citation insert failed: ${errText(error)}`);
  }

  async function setStatus(versionId: string, status: 'active' | 'retired') {
    const { error } = await supabaseAdmin.from('tax_rule_versions').update({ status }).eq('id', versionId);
    if (error) throw new Error(`status ${status} failed: ${errText(error)}`);
  }

  const applicableId = await insertVersion({
    taxRuleId: ruleIlA,
    countryCode: 'IL',
    packId: packIl,
    rulesetId: rulesetIl,
    versionNo: 1,
    effectiveFrom: '2024-01-01',
    statement: `${marker} applicable null applies_if`,
  });
  const expiredId = await insertVersion({
    taxRuleId: ruleIlA,
    countryCode: 'IL',
    packId: packIl,
    rulesetId: rulesetIl,
    versionNo: 2,
    effectiveFrom: '2020-01-01',
    effectiveTo: '2020-12-31',
    statement: `${marker} expired window`,
  });
  const draftId = await insertVersion({
    taxRuleId: ruleIlA,
    countryCode: 'IL',
    packId: packIl,
    rulesetId: rulesetIl,
    versionNo: 3,
    effectiveFrom: '2024-01-01',
    statement: `${marker} draft`,
  });
  const retiredId = await insertVersion({
    taxRuleId: ruleIlA,
    countryCode: 'IL',
    packId: packIl,
    rulesetId: rulesetIl,
    versionNo: 4,
    effectiveFrom: '2018-01-01',
    effectiveTo: '2018-12-31',
    statement: `${marker} retired`,
  });
  const futureId = await insertVersion({
    taxRuleId: ruleIlB,
    countryCode: 'IL',
    packId: packIl,
    rulesetId: rulesetIl,
    versionNo: 1,
    effectiveFrom: '2027-01-01',
    statement: `${marker} future window`,
  });
  const usId = await insertVersion({
    taxRuleId: ruleUs,
    countryCode: 'US',
    packId: packUs,
    rulesetId: rulesetUs,
    versionNo: 1,
    effectiveFrom: '2024-01-01',
    statement: `${marker} US must not leak`,
  });

  await cite(applicableId, sourceIl, 'IL', citationIl, locatorIl);
  await cite(expiredId, sourceIl, 'IL');
  await cite(futureId, sourceIl, 'IL');
  await cite(retiredId, sourceIl, 'IL');
  await cite(usId, sourceUs, 'US');

  await setStatus(applicableId, 'active');
  await setStatus(expiredId, 'active');
  await setStatus(futureId, 'active');
  await setStatus(retiredId, 'retired');
  await setStatus(usId, 'active');

  async function tableCounts(): Promise<Record<string, number | null>> {
    const out: Record<string, number | null> = {};
    for (const table of WATCHED_TABLES) {
      const { count, error } = await supabaseAdmin.from(table).select('id', { count: 'exact', head: true });
      if (error) throw new Error(`${table} count failed: ${errText(error)}`);
      out[table] = count ?? 0;
    }
    return out;
  }

  async function fixtureSnapshot() {
    const { data, error } = await supabaseAdmin
      .from('tax_rule_versions')
      .select('id, status, payload_checksum, effective_from, effective_to, created_at')
      .in('id', [applicableId, expiredId, draftId, retiredId, futureId, usId])
      .order('id');
    if (error) throw new Error(`fixture snapshot failed: ${errText(error)}`);
    return data ?? [];
  }

  async function auditCount(): Promise<number | null> {
    const { count, error } = await supabaseAdmin.from('audit_log').select('id', { count: 'exact', head: true });
    if (error) return null;
    return count ?? 0;
  }

  const countsBefore = await tableCounts();
  const fixturesBefore = await fixtureSnapshot();
  const auditBefore = await auditCount();

  const out = await executeTaxRuleEngineCommand(ownerCtx, 'evaluate_tax_rules', {
    country_code: 'IL',
    as_of: AS_OF,
    facts: {},
  });

  assert.equal(out.ok, true);
  assert.equal(out.command, 'evaluate_tax_rules');
  assert.equal(out.refreshed.aggregate_key, TAX_RULE_ENGINE_AGGREGATE_KEY);
  const aggregate = out.refreshed.aggregate;
  assert.equal(aggregate.aggregate_key, TAX_RULE_ENGINE_AGGREGATE_KEY);
  assert.equal(aggregate.country_code, 'IL');
  assert.equal(aggregate.as_of, AS_OF);
  assert.ok(Array.isArray(aggregate.applicable));
  assert.ok(Array.isArray(aggregate.not_applicable));
  assert.ok(Array.isArray(aggregate.undetermined));
  assert.ok(Array.isArray(aggregate.missing_facts));
  assert.ok(Array.isArray(aggregate.blocking));
  assert.ok(Array.isArray(aggregate.relationship_trace));
  assert.ok(Array.isArray(aggregate.evaluated_version_ids));

  const seen = idsIn(aggregate);
  assert.ok(!seen.includes(usId), 'IL evaluate must not return the US fixture version');
  assert.ok(!seen.includes(draftId), 'draft version must not be evaluated');
  assert.ok(!seen.includes(retiredId), 'retired version must not be evaluated');
  assert.ok(!seen.includes(expiredId), 'expired active window must not be evaluated');
  assert.ok(!seen.includes(futureId), 'future active window must not be evaluated');
  assert.ok(aggregate.evaluated_version_ids.includes(applicableId));

  const applicable = aggregate.applicable.find((row) => row.tax_rule_version_id === applicableId);
  assert.ok(applicable, 'active null applies_if version must be applicable');
  assert.equal(applicable.classification, 'applicable');
  assert.equal(applicable.tax_rule_id, ruleIlA);
  assert.equal(applicable.rule_code, `${marker}_il_a`);
  assert.equal(applicable.tax_rule_version_id, applicableId);
  assert.equal(applicable.payload_checksum, `tk3a-fixture-${applicableId}`);
  const pin = applicable.sources.find((row) => row.tax_rule_version_source_id === citationIl);
  assert.ok(pin, 'provenance pin must be present');
  assert.equal(pin.tax_source_id, sourceIl);
  assert.equal(pin.source_code, `${marker}_il_src`);
  assert.equal(pin.provenance_type, 'official_law');
  assert.equal(pin.locator, locatorIl);

  const usOut = await executeTaxRuleEngineCommand(ownerCtx, 'evaluate_tax_rules', {
    country_code: 'US',
    as_of: AS_OF,
    facts: {},
  });
  const usSeen = idsIn(usOut.refreshed.aggregate);
  assert.equal(usSeen.includes(applicableId), false, 'US evaluate must not return the IL applicable version');
  assert.equal(
    usOut.refreshed.aggregate.evaluated_version_ids.includes(usId),
    true,
    'US evaluate must include the US active in-window fixture',
  );

  const countsAfter = await tableCounts();
  const fixturesAfter = await fixtureSnapshot();
  const auditAfter = await auditCount();
  assert.deepEqual(fixturesAfter, fixturesBefore, 'evaluate_tax_rules must not mutate fixture versions');
  const changedCounts = WATCHED_TABLES.filter((table) => countsBefore[table] !== countsAfter[table]);
  assert.equal(
    changedCounts.length,
    0,
    `evaluate_tax_rules must not write Tax Knowledge tables: ${changedCounts
      .map((table) => `${table}:${String(countsBefore[table])}->${String(countsAfter[table])}`)
      .join(', ')}`,
  );
  if (auditBefore != null && auditAfter != null) {
    assert.equal(auditAfter, auditBefore, 'evaluate_tax_rules must not write audit_log');
  }
});

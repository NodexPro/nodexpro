import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSupabaseMissingTableError } from '../../src/shared/supabase-errors.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const sql603 = readFileSync(join(repoRoot, 'supabase/migrations/603_tax_knowledge_rule_relationships.sql'), 'utf8');

const RELATIONSHIP_TYPES = [
  'depends_on',
  'conflicts_with',
  'exception_to',
  'overrides',
  'alternative_to',
  'special_case_of',
  'elaborates',
] as const;

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function errText(error: { message?: string; code?: string; details?: string; hint?: string } | null): string {
  return [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(' | ');
}

function k1Payload(): Record<string, unknown> {
  return { statement: 'string', applies_if: null, does_not_apply_if: null, notes: null };
}

test('TAX-K1.3 contract: relationship table, types, isolation, from-draft lock', () => {
  assert.match(sql603, /create table if not exists public\.tax_rule_relationships/);
  assert.match(sql603, /tax_rule_relationships_from_version_country_fk/);
  assert.match(sql603, /tax_rule_relationships_to_version_country_fk/);
  assert.match(sql603, /from_tax_rule_version_id <> to_tax_rule_version_id/);
  assert.match(sql603, /tax_knowledge_relationship_requires_from_draft/);
  assert.match(sql603, /Cross-country tax rule relationship is forbidden/);
  assert.match(sql603, /must be inserted as active/);
  assert.match(sql603, /uq_tax_rule_relationships_edge/);
  for (const type of RELATIONSHIP_TYPES) {
    assert.match(sql603, new RegExp(`'${type}'`));
  }
  assert.doesNotMatch(sql603, /'supersedes'/);
  assert.doesNotMatch(sql603, /'superseded_by'/);
  assert.doesNotMatch(sql603, /'requires_fact'/);
  assert.doesNotMatch(sql603, /'affects_strategy'/);
  assert.doesNotMatch(sql603, /'supported_by'/);
  assert.doesNotMatch(sql603, /'interpreted_by'/);
  assert.doesNotMatch(sql603, /organization_id\s+(uuid|text)/i);
  assert.doesNotMatch(sql603, /insert into public\.tax_rule_relationships/);
  assert.doesNotMatch(sql603, /alter table public\.tax_rule_versions/);
  assert.doesNotMatch(sql603, /insert into storage\.buckets/);
  assert.match(sql603, /alter table public\.tax_rule_relationships enable row level security/);
  assert.match(sql603, /alter table public\.tax_rule_relationships force row level security/);
  assert.match(sql603, /revoke all on table public\.tax_rule_relationships from anon, authenticated/);
  assert.match(sql603, /No CREATE POLICY on purpose/);
  assert.doesNotMatch(sql603, /^\s*create policy\b/im);
});

test('TAX-K1.3 contract: migrations 600/601/602 untouched and no unrelated files', () => {
  for (const file of [
    'supabase/migrations/600_tax_knowledge_core_foundation.sql',
    'supabase/migrations/601_tax_knowledge_provenance_links.sql',
    'supabase/migrations/602_tax_knowledge_publication_guard.sql',
  ]) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(diff.trim(), '', `19) ${file} must remain unchanged`);
  }

  const porcelain = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[A-Z?]{1,2}\s+/, '').replace(/.* -> /, ''));
  const allowed = new Set([
    'supabase/migrations/603_tax_knowledge_rule_relationships.sql',
    'supabase/migrations/604_tax_knowledge_relationship_publication_guard.sql',
    'apps/api/tests/tax-knowledge/tax-knowledge-k1-2-provenance.spec.ts',
    'apps/api/tests/tax-knowledge/tax-knowledge-k1-2a-publication-guard.spec.ts',
    'apps/api/tests/tax-knowledge/tax-knowledge-k1-3-relationships.spec.ts',
    'apps/api/tests/tax-knowledge/tax-knowledge-k1-3a-relationship-publication.spec.ts',
    'apps/api/src/domains/tax-knowledge/',
    'apps/api/src/domains/tax-knowledge/tax-knowledge.types.ts',
    'apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts',
    'apps/api/src/domains/tax-knowledge/tax-knowledge-read-models.service.ts',
    'apps/api/src/routes/owner-country-pack.routes.ts',
    'apps/api/src/domains/country-pack/country-pack-read-models.service.ts',
    'apps/api/src/shared/audit-events.ts',
    'apps/api/tests/tax-knowledge/tax-knowledge-k1-4a-commands-aggregate.spec.ts',
    'apps/api/src/domains/tax-knowledge/tax-knowledge-checksum.pure.ts',
    'apps/api/tests/tax-knowledge/tax-knowledge-k1-4b-lifecycle.spec.ts',
    'apps/api/tests/tax-knowledge/tax-knowledge-k1-4c-provenance-bindings.spec.ts',
  ]);
  const unexpected = porcelain.filter((path) => !allowed.has(path));
  assert.deepEqual(unexpected, [], `20) unrelated files changed: ${unexpected.join(', ')}`);
});

test('TAX-K1.3 DB relationship safety', async (t) => {
  if (!supabaseConfigured()) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }

  const { supabaseAdmin } = await import('../../src/db/client.js');
  const probe = await supabaseAdmin.from('tax_rule_relationships').select('id').limit(1);
  if (probe.error && isSupabaseMissingTableError(probe.error, 'tax_rule_relationships')) {
    t.skip('migration 603 not applied');
    return;
  }
  if (probe.error) throw new Error(`tax_rule_relationships probe failed: ${errText(probe.error)}`);

  const marker = `tk13-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const packIl = randomUUID();
  const packUs = randomUUID();
  const rulesetIl = randomUUID();
  const rulesetUs = randomUUID();
  const sourceIl = randomUUID();
  const ruleIl = randomUUID();
  const ruleUs = randomUUID();
  let nextIl = 1;
  let nextUs = 1;

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

  const { error: srcErr } = await supabaseAdmin.from('tax_sources').insert({
    id: sourceIl,
    country_code: 'IL',
    source_code: `${marker}_il_src`,
    title: 'IL relationship source',
    provenance_type: 'official_guidance',
    status: 'draft',
  });
  if (srcErr) throw new Error(`tax_sources insert failed: ${errText(srcErr)}`);
  const { error: srcActErr } = await supabaseAdmin.from('tax_sources').update({ status: 'active' }).eq('id', sourceIl);
  if (srcActErr) throw new Error(`tax_sources activate failed: ${errText(srcActErr)}`);

  const { error: ruleErr } = await supabaseAdmin.from('tax_rules').insert([
    {
      id: ruleIl,
      country_code: 'IL',
      rule_code: `${marker}_il_rule`,
      title: 'IL relationship rule',
      rule_kind: 'legal_rule',
      status: 'draft',
    },
    {
      id: ruleUs,
      country_code: 'US',
      rule_code: `${marker}_us_rule`,
      title: 'US relationship rule',
      rule_kind: 'legal_rule',
      status: 'draft',
    },
  ]);
  if (ruleErr) throw new Error(`tax_rules insert failed: ${errText(ruleErr)}`);

  async function insertDraftVersion(opts: {
    country: 'IL' | 'US';
    effectiveFrom: string;
    effectiveTo?: string;
  }): Promise<string> {
    const id = randomUUID();
    const isIl = opts.country === 'IL';
    const { error } = await supabaseAdmin.from('tax_rule_versions').insert({
      id,
      tax_rule_id: isIl ? ruleIl : ruleUs,
      country_code: opts.country,
      country_pack_id: isIl ? packIl : packUs,
      country_pack_ruleset_id: isIl ? rulesetIl : rulesetUs,
      version_no: isIl ? nextIl : nextUs,
      status: 'draft',
      effective_from: opts.effectiveFrom,
      ...(opts.effectiveTo ? { effective_to: opts.effectiveTo } : {}),
      payload_json: k1Payload(),
      payload_checksum: 'fixture-not-canonical',
    });
    if (error) throw new Error(`draft version insert failed: ${errText(error)}`);
    if (isIl) nextIl += 1;
    else nextUs += 1;
    return id;
  }

  async function citeAndActivate(versionId: string): Promise<void> {
    const { error: citeErr } = await supabaseAdmin.from('tax_rule_version_sources').insert({
      id: randomUUID(),
      tax_rule_version_id: versionId,
      tax_source_id: sourceIl,
      country_code: 'IL',
      locator: `rel-${versionId.slice(0, 8)}`,
    });
    if (citeErr) throw new Error(`citation insert failed: ${errText(citeErr)}`);
    const { error: actErr } = await supabaseAdmin
      .from('tax_rule_versions')
      .update({ status: 'active' })
      .eq('id', versionId);
    if (actErr) throw new Error(`activation failed: ${errText(actErr)}`);
  }

  const fromDraft = await insertDraftVersion({ country: 'IL', effectiveFrom: '2010-01-01', effectiveTo: '2010-12-31' });
  const toDraft = await insertDraftVersion({ country: 'IL', effectiveFrom: '2011-01-01', effectiveTo: '2011-12-31' });
  const toActive = await insertDraftVersion({ country: 'IL', effectiveFrom: '2012-01-01', effectiveTo: '2012-12-31' });
  const toUs = await insertDraftVersion({ country: 'US', effectiveFrom: '2010-01-01', effectiveTo: '2010-12-31' });
  await citeAndActivate(toActive);

  await t.test('1) valid same-country relationship accepted', async () => {
    const { error } = await supabaseAdmin.from('tax_rule_relationships').insert({
      id: randomUUID(),
      country_code: 'IL',
      from_tax_rule_version_id: fromDraft,
      to_tax_rule_version_id: toDraft,
      relationship_type: 'depends_on',
    });
    assert.ifError(error);
  });

  await t.test('2) cross-country relationship rejected', async () => {
    const { error } = await supabaseAdmin.from('tax_rule_relationships').insert({
      id: randomUUID(),
      country_code: 'IL',
      from_tax_rule_version_id: fromDraft,
      to_tax_rule_version_id: toUs,
    });
    assert.ok(error, 'IL version cannot relate to US version');
  });

  await t.test('3) self-relationship rejected', async () => {
    const { error } = await supabaseAdmin.from('tax_rule_relationships').insert({
      id: randomUUID(),
      country_code: 'IL',
      from_tax_rule_version_id: fromDraft,
      to_tax_rule_version_id: fromDraft,
      relationship_type: 'elaborates',
    });
    assert.ok(error, 'self-relationship must be rejected');
  });

  await t.test('4) duplicate exact relationship rejected', async () => {
    const { error } = await supabaseAdmin.from('tax_rule_relationships').insert({
      id: randomUUID(),
      country_code: 'IL',
      from_tax_rule_version_id: fromDraft,
      to_tax_rule_version_id: toDraft,
      relationship_type: 'depends_on',
    });
    assert.ok(error, 'duplicate exact relationship must be rejected');
  });

  await t.test('5) each allowed relationship_type accepted', async () => {
    const fromTypes = await insertDraftVersion({ country: 'IL', effectiveFrom: '2013-01-01', effectiveTo: '2013-12-31' });
    const toTypes = await insertDraftVersion({ country: 'IL', effectiveFrom: '2014-01-01', effectiveTo: '2014-12-31' });
    for (const relationship_type of RELATIONSHIP_TYPES) {
      const { error } = await supabaseAdmin.from('tax_rule_relationships').insert({
        id: randomUUID(),
        country_code: 'IL',
        from_tax_rule_version_id: fromTypes,
        to_tax_rule_version_id: toTypes,
        relationship_type,
      });
      assert.ifError(error, relationship_type);
    }
  });

  await t.test('6) unknown relationship_type rejected', async () => {
    const { error } = await supabaseAdmin.from('tax_rule_relationships').insert({
      id: randomUUID(),
      country_code: 'IL',
      from_tax_rule_version_id: fromDraft,
      to_tax_rule_version_id: toDraft,
      relationship_type: 'supersedes',
    });
    assert.ok(error, 'supersedes must be rejected');
  });

  await t.test('7-9) FROM draft INSERT/UPDATE/DELETE accepted', async () => {
    const fromId = await insertDraftVersion({ country: 'IL', effectiveFrom: '2015-01-01', effectiveTo: '2015-12-31' });
    const toId = await insertDraftVersion({ country: 'IL', effectiveFrom: '2016-01-01', effectiveTo: '2016-12-31' });
    const relId = randomUUID();
    assert.ifError(
      (
        await supabaseAdmin.from('tax_rule_relationships').insert({
          id: relId,
          country_code: 'IL',
          from_tax_rule_version_id: fromId,
          to_tax_rule_version_id: toId,
          relationship_type: 'exception_to',
        })
      ).error,
    );
    assert.ifError(
      (
        await supabaseAdmin
          .from('tax_rule_relationships')
          .update({ relationship_type: 'overrides', owner_note: 'draft edit' })
          .eq('id', relId)
      ).error,
    );
    const { error } = await supabaseAdmin.from('tax_rule_relationships').delete().eq('id', relId);
    assert.ifError(error);
  });

  await t.test('10-12) FROM active relationship mutations rejected', async () => {
    const fromId = await insertDraftVersion({ country: 'IL', effectiveFrom: '2017-01-01', effectiveTo: '2017-12-31' });
    const toId = await insertDraftVersion({ country: 'IL', effectiveFrom: '2018-01-01', effectiveTo: '2018-12-31' });
    await citeAndActivate(toId);
    const relId = randomUUID();
    assert.ifError(
      (
        await supabaseAdmin.from('tax_rule_relationships').insert({
          id: relId,
          country_code: 'IL',
          from_tax_rule_version_id: fromId,
          to_tax_rule_version_id: toId,
          relationship_type: 'depends_on',
        })
      ).error,
    );
    await citeAndActivate(fromId);

    const ins = await supabaseAdmin.from('tax_rule_relationships').insert({
      id: randomUUID(),
      country_code: 'IL',
      from_tax_rule_version_id: fromId,
      to_tax_rule_version_id: toId,
      relationship_type: 'overrides',
    });
    assert.ok(ins.error, 'active FROM INSERT must be rejected');
    assert.match(errText(ins.error), /immutable after the FROM version leaves draft/i);

    const upd = await supabaseAdmin
      .from('tax_rule_relationships')
      .update({ owner_note: 'mutate after active' })
      .eq('id', relId);
    assert.ok(upd.error, 'active FROM UPDATE must be rejected');

    const del = await supabaseAdmin.from('tax_rule_relationships').delete().eq('id', relId);
    assert.ok(del.error, 'active FROM DELETE must be rejected');
  });

  await t.test('13) FROM superseded/retired mutation rejected', async () => {
    const fromSuperseded = await insertDraftVersion({
      country: 'IL',
      effectiveFrom: '2019-01-01',
      effectiveTo: '2019-12-31',
    });
    const fromRetired = await insertDraftVersion({
      country: 'IL',
      effectiveFrom: '2020-01-01',
      effectiveTo: '2020-12-31',
    });
    const toId = await insertDraftVersion({ country: 'IL', effectiveFrom: '2021-01-01', effectiveTo: '2021-12-31' });
    await citeAndActivate(toId);

    const relSup = randomUUID();
    assert.ifError(
      (
        await supabaseAdmin.from('tax_rule_relationships').insert({
          id: relSup,
          country_code: 'IL',
          from_tax_rule_version_id: fromSuperseded,
          to_tax_rule_version_id: toId,
          relationship_type: 'elaborates',
        })
      ).error,
    );
    await citeAndActivate(fromSuperseded);
    assert.ifError(
      (await supabaseAdmin.from('tax_rule_versions').update({ status: 'superseded' }).eq('id', fromSuperseded)).error,
    );
    const supMut = await supabaseAdmin.from('tax_rule_relationships').update({ owner_note: 'no' }).eq('id', relSup);
    assert.ok(supMut.error, 'superseded FROM UPDATE must be rejected');

    assert.ifError((await supabaseAdmin.from('tax_rule_versions').update({ status: 'retired' }).eq('id', fromRetired)).error);
    const retIns = await supabaseAdmin.from('tax_rule_relationships').insert({
      id: randomUUID(),
      country_code: 'IL',
      from_tax_rule_version_id: fromRetired,
      to_tax_rule_version_id: toId,
      relationship_type: 'depends_on',
    });
    assert.ok(retIns.error, 'retired FROM INSERT must be rejected');
  });

  await t.test('14) draft A → active B relationship allowed', async () => {
    const { error } = await supabaseAdmin.from('tax_rule_relationships').insert({
      id: randomUUID(),
      country_code: 'IL',
      from_tax_rule_version_id: fromDraft,
      to_tax_rule_version_id: toActive,
      relationship_type: 'special_case_of',
    });
    assert.ifError(error);
  });

  await t.test('15) draft A → draft B relationship allowed', async () => {
    const fromId = await insertDraftVersion({ country: 'IL', effectiveFrom: '2022-01-01', effectiveTo: '2022-12-31' });
    const toId = await insertDraftVersion({ country: 'IL', effectiveFrom: '2023-01-01', effectiveTo: '2023-12-31' });
    const { error } = await supabaseAdmin.from('tax_rule_relationships').insert({
      id: randomUUID(),
      country_code: 'IL',
      from_tax_rule_version_id: fromId,
      to_tax_rule_version_id: toId,
      relationship_type: 'alternative_to',
    });
    assert.ifError(error);
  });

  await t.test('16) created_at mutation rejected', async () => {
    const { data, error: readErr } = await supabaseAdmin
      .from('tax_rule_relationships')
      .select('id')
      .eq('from_tax_rule_version_id', fromDraft)
      .eq('relationship_type', 'depends_on')
      .single();
    assert.ifError(readErr);
    const { error } = await supabaseAdmin
      .from('tax_rule_relationships')
      .update({ created_at: '2000-01-01T00:00:00.000Z' })
      .eq('id', data!.id);
    assert.ok(error, 'created_at mutation must be rejected');
    assert.match(errText(error), /created_at is immutable/i);
  });

  await t.test('17) TRUNCATE rejected', async (st) => {
    const dbUrl =
      process.env.DATABASE_URL?.trim() ||
      process.env.SUPABASE_DB_URL?.trim() ||
      process.env.DIRECT_URL?.trim();
    if (!dbUrl) {
      st.skip('DATABASE_URL / SUPABASE_DB_URL not configured; TRUNCATE not proven live');
      return;
    }
    const pg = await import('pg');
    const ClientCtor =
      (pg as { Client?: typeof import('pg').Client }).Client ??
      (pg as { default?: { Client?: typeof import('pg').Client } }).default?.Client;
    if (!ClientCtor) {
      st.skip('pg.Client unavailable; TRUNCATE not proven live');
      return;
    }
    const client = new ClientCtor({ connectionString: dbUrl });
    await client.connect();
    try {
      let failed = false;
      try {
        await client.query('truncate table public.tax_rule_relationships');
      } catch (error) {
        failed = true;
        assert.match(String(error), /Hard delete is forbidden/i);
      }
      assert.ok(failed, 'TRUNCATE tax_rule_relationships must be blocked');
    } finally {
      await client.end();
    }
  });

  await t.test('18) RLS/no tenant policy contract', () => {
    assert.doesNotMatch(sql603, /^\s*create policy\b/im);
    assert.match(sql603, /revoke all on table public\.tax_rule_relationships from anon, authenticated/);
  });
});

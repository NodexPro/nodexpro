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
const sql604 = readFileSync(
  join(repoRoot, 'supabase/migrations/604_tax_knowledge_relationship_publication_guard.sql'),
  'utf8',
);

const BLOCKING_TYPES = [
  'depends_on',
  'exception_to',
  'overrides',
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

test('TAX-K1.3A contract: relationship publication guard on draft→active only', () => {
  assert.match(sql604, /tax_rule_versions_guard_publication_relationships/);
  assert.match(sql604, /tax_rule_versions_publication_relationships_guard/);
  assert.match(sql604, /when \(old\.status = 'draft' and new\.status = 'active'\)/);
  assert.match(
    sql604,
    /cannot activate while a blocking relationship points to a non-active tax_rule_version/,
  );
  assert.match(sql604, /rel\.from_tax_rule_version_id = new\.id/);
  assert.match(sql604, /dest\.status is distinct from 'active'/);
  for (const type of BLOCKING_TYPES) {
    assert.match(sql604, new RegExp(`'${type}'`));
  }
  assert.match(sql604, /conflicts_with and alternative_to do not block/);
  assert.doesNotMatch(sql604, /tax_rule_versions_guard_publication_provenance/);
  assert.doesNotMatch(sql604, /create or replace function public\.tax_rule_versions_guard_publication_provenance/);
  assert.doesNotMatch(sql604, /alter table public\.tax_rule_relationships/);
  assert.doesNotMatch(sql604, /organization_id\s+(uuid|text)/i);
  assert.doesNotMatch(sql604, /insert into storage\.buckets/);
});

test('TAX-K1.3A contract: migrations 600–603 untouched and no unrelated files', () => {
  for (const file of [
    'supabase/migrations/600_tax_knowledge_core_foundation.sql',
    'supabase/migrations/601_tax_knowledge_provenance_links.sql',
    'supabase/migrations/602_tax_knowledge_publication_guard.sql',
    'supabase/migrations/603_tax_knowledge_rule_relationships.sql',
  ]) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(diff.trim(), '', `18) ${file} must remain unchanged`);
  }

  const porcelain = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[A-Z?]{1,2}\s+/, '').replace(/.* -> /, ''));
  const allowed = new Set([
    'supabase/migrations/604_tax_knowledge_relationship_publication_guard.sql',
    'apps/api/tests/tax-knowledge/tax-knowledge-k1-2-provenance.spec.ts',
    'apps/api/tests/tax-knowledge/tax-knowledge-k1-2a-publication-guard.spec.ts',
    'apps/api/tests/tax-knowledge/tax-knowledge-k1-3-relationships.spec.ts',
    'apps/api/tests/tax-knowledge/tax-knowledge-k1-3a-relationship-publication.spec.ts',
  ]);
  const unexpected = porcelain.filter((path) => !allowed.has(path));
  assert.deepEqual(unexpected, [], `19) unrelated files changed: ${unexpected.join(', ')}`);
});

test('TAX-K1.3A DB relationship publication guard', async (t) => {
  if (!supabaseConfigured()) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }

  const { supabaseAdmin } = await import('../../src/db/client.js');
  const probe = await supabaseAdmin.from('tax_rule_relationships').select('id').limit(1);
  if (probe.error && isSupabaseMissingTableError(probe.error, 'tax_rule_relationships')) {
    t.skip('migration 603/604 not applied');
    return;
  }
  if (probe.error) throw new Error(`tax_rule_relationships probe failed: ${errText(probe.error)}`);

  const marker = `tk13a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const packIl = randomUUID();
  const packUs = randomUUID();
  const rulesetIl = randomUUID();
  const rulesetUs = randomUUID();
  const sourceIl = randomUUID();
  const ruleIl = randomUUID();
  const ruleUs = randomUUID();
  const ruleB = randomUUID();
  let nextIl = 1;
  let nextUs = 1;
  let nextB = 1;
  let year = 2000;

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
    title: 'IL relationship publication source',
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
      title: 'IL from-rule',
      rule_kind: 'legal_rule',
      status: 'draft',
    },
    {
      id: ruleB,
      country_code: 'IL',
      rule_code: `${marker}_il_rule_b`,
      title: 'IL to-rule',
      rule_kind: 'legal_rule',
      status: 'draft',
    },
    {
      id: ruleUs,
      country_code: 'US',
      rule_code: `${marker}_us_rule`,
      title: 'US rule',
      rule_kind: 'legal_rule',
      status: 'draft',
    },
  ]);
  if (ruleErr) throw new Error(`tax_rules insert failed: ${errText(ruleErr)}`);

  async function insertDraftVersion(opts: {
    rule: 'from' | 'to' | 'us';
  }): Promise<string> {
    const id = randomUUID();
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    year += 1;
    const meta =
      opts.rule === 'from'
        ? { tax_rule_id: ruleIl, country_code: 'IL' as const, pack: packIl, ruleset: rulesetIl, n: nextIl++ }
        : opts.rule === 'to'
          ? { tax_rule_id: ruleB, country_code: 'IL' as const, pack: packIl, ruleset: rulesetIl, n: nextB++ }
          : { tax_rule_id: ruleUs, country_code: 'US' as const, pack: packUs, ruleset: rulesetUs, n: nextUs++ };
    const { error } = await supabaseAdmin.from('tax_rule_versions').insert({
      id,
      tax_rule_id: meta.tax_rule_id,
      country_code: meta.country_code,
      country_pack_id: meta.pack,
      country_pack_ruleset_id: meta.ruleset,
      version_no: meta.n,
      status: 'draft',
      effective_from: from,
      effective_to: to,
      payload_json: k1Payload(),
      payload_checksum: 'fixture-not-canonical',
    });
    if (error) throw new Error(`draft version insert failed: ${errText(error)}`);
    return id;
  }

  async function cite(versionId: string): Promise<void> {
    const { error } = await supabaseAdmin.from('tax_rule_version_sources').insert({
      id: randomUUID(),
      tax_rule_version_id: versionId,
      tax_source_id: sourceIl,
      country_code: 'IL',
      locator: `rel-pub-${versionId.slice(0, 8)}`,
    });
    if (error) throw new Error(`citation insert failed: ${errText(error)}`);
  }

  async function activate(versionId: string): Promise<{ error: { message?: string; code?: string } | null }> {
    return supabaseAdmin.from('tax_rule_versions').update({ status: 'active' }).eq('id', versionId);
  }

  async function citeAndActivate(versionId: string): Promise<void> {
    await cite(versionId);
    const { error } = await activate(versionId);
    if (error) throw new Error(`activation failed: ${errText(error)}`);
  }

  async function relate(
    fromId: string,
    toId: string,
    relationship_type: string,
  ): Promise<string> {
    const id = randomUUID();
    const { error } = await supabaseAdmin.from('tax_rule_relationships').insert({
      id,
      country_code: 'IL',
      from_tax_rule_version_id: fromId,
      to_tax_rule_version_id: toId,
      relationship_type,
    });
    if (error) throw new Error(`relationship insert failed (${relationship_type}): ${errText(error)}`);
    return id;
  }

  async function expectActivationRejected(versionId: string, label: string): Promise<void> {
    await cite(versionId);
    const { error } = await activate(versionId);
    assert.ok(error, `${label} must reject activation`);
    assert.match(
      errText(error),
      /cannot activate while a blocking relationship points to a non-active tax_rule_version/i,
    );
  }

  await t.test('1) depends_on → active TO allows activation', async () => {
    const toId = await insertDraftVersion({ rule: 'to' });
    await citeAndActivate(toId);
    const fromId = await insertDraftVersion({ rule: 'from' });
    await relate(fromId, toId, 'depends_on');
    await cite(fromId);
    assert.ifError((await activate(fromId)).error);
  });

  await t.test('2) depends_on → draft TO rejects activation', async () => {
    const toId = await insertDraftVersion({ rule: 'to' });
    const fromId = await insertDraftVersion({ rule: 'from' });
    await relate(fromId, toId, 'depends_on');
    await expectActivationRejected(fromId, 'depends_on → draft');
  });

  await t.test('3) depends_on → retired TO rejects activation', async () => {
    const toId = await insertDraftVersion({ rule: 'to' });
    assert.ifError((await supabaseAdmin.from('tax_rule_versions').update({ status: 'retired' }).eq('id', toId)).error);
    const fromId = await insertDraftVersion({ rule: 'from' });
    await relate(fromId, toId, 'depends_on');
    await expectActivationRejected(fromId, 'depends_on → retired');
  });

  await t.test('4) depends_on → superseded TO rejects activation', async () => {
    const toId = await insertDraftVersion({ rule: 'to' });
    await citeAndActivate(toId);
    assert.ifError(
      (await supabaseAdmin.from('tax_rule_versions').update({ status: 'superseded' }).eq('id', toId)).error,
    );
    const fromId = await insertDraftVersion({ rule: 'from' });
    await relate(fromId, toId, 'depends_on');
    await expectActivationRejected(fromId, 'depends_on → superseded');
  });

  for (const type of BLOCKING_TYPES.filter((value) => value !== 'depends_on')) {
    await t.test(`5-8) ${type} → draft TO rejects; active TO allows`, async () => {
      const draftTo = await insertDraftVersion({ rule: 'to' });
      const fromDraft = await insertDraftVersion({ rule: 'from' });
      await relate(fromDraft, draftTo, type);
      await expectActivationRejected(fromDraft, `${type} → draft`);

      const activeTo = await insertDraftVersion({ rule: 'to' });
      await citeAndActivate(activeTo);
      const fromOk = await insertDraftVersion({ rule: 'from' });
      await relate(fromOk, activeTo, type);
      await cite(fromOk);
      assert.ifError((await activate(fromOk)).error);
    });
  }

  await t.test('9) conflicts_with → draft TO does not block activation', async () => {
    const toId = await insertDraftVersion({ rule: 'to' });
    const fromId = await insertDraftVersion({ rule: 'from' });
    await relate(fromId, toId, 'conflicts_with');
    await cite(fromId);
    assert.ifError((await activate(fromId)).error);
  });

  await t.test('10) alternative_to → draft TO does not block activation', async () => {
    const toId = await insertDraftVersion({ rule: 'to' });
    const fromId = await insertDraftVersion({ rule: 'from' });
    await relate(fromId, toId, 'alternative_to');
    await cite(fromId);
    assert.ifError((await activate(fromId)).error);
  });

  await t.test('11) one valid blocking + one invalid blocking → reject', async () => {
    const activeTo = await insertDraftVersion({ rule: 'to' });
    await citeAndActivate(activeTo);
    const draftTo = await insertDraftVersion({ rule: 'to' });
    const fromId = await insertDraftVersion({ rule: 'from' });
    await relate(fromId, activeTo, 'depends_on');
    await relate(fromId, draftTo, 'exception_to');
    await expectActivationRejected(fromId, 'mixed blocking edges');
  });

  await t.test('12) blocking relationships all valid → allow', async () => {
    const toA = await insertDraftVersion({ rule: 'to' });
    const toB = await insertDraftVersion({ rule: 'to' });
    await citeAndActivate(toA);
    await citeAndActivate(toB);
    const fromId = await insertDraftVersion({ rule: 'from' });
    await relate(fromId, toA, 'depends_on');
    await relate(fromId, toB, 'overrides');
    await cite(fromId);
    assert.ifError((await activate(fromId)).error);
  });

  await t.test('13) no relationships → relationship guard does not block', async () => {
    const fromId = await insertDraftVersion({ rule: 'from' });
    await cite(fromId);
    assert.ifError((await activate(fromId)).error);
  });

  await t.test('14) exact-version: A→B v1 retired still rejects even if B v2 is active', async () => {
    const b1 = await insertDraftVersion({ rule: 'to' });
    await citeAndActivate(b1);
    assert.ifError((await supabaseAdmin.from('tax_rule_versions').update({ status: 'retired' }).eq('id', b1)).error);
    const b2 = await insertDraftVersion({ rule: 'to' });
    await citeAndActivate(b2);
    const fromId = await insertDraftVersion({ rule: 'from' });
    await relate(fromId, b1, 'depends_on');
    await expectActivationRejected(fromId, 'exact B v1 retired despite B v2 active');
  });

  await t.test('15) after A activation, B may later be superseded without rewriting A', async () => {
    const bId = await insertDraftVersion({ rule: 'to' });
    await citeAndActivate(bId);
    const aId = await insertDraftVersion({ rule: 'from' });
    const relId = await relate(aId, bId, 'depends_on');
    await cite(aId);
    assert.ifError((await activate(aId)).error);
    assert.ifError((await supabaseAdmin.from('tax_rule_versions').update({ status: 'superseded' }).eq('id', bId)).error);

    const { data: rel, error: relErr } = await supabaseAdmin
      .from('tax_rule_relationships')
      .select('id, to_tax_rule_version_id, relationship_type')
      .eq('id', relId)
      .single();
    assert.ifError(relErr);
    assert.equal(rel?.to_tax_rule_version_id, bId);

    const mut = await supabaseAdmin
      .from('tax_rule_relationships')
      .update({ owner_note: 'rewrite after B superseded' })
      .eq('id', relId);
    assert.ok(mut.error, 'published A relationship must stay frozen');
  });

  await t.test('16) 602 provenance guard still works', async () => {
    const fromId = await insertDraftVersion({ rule: 'from' });
    const { error } = await activate(fromId);
    assert.ok(error, 'source-less activation must still be rejected');
    assert.match(errText(error), /cannot activate without at least one citation to an active tax_source/i);
  });

  await t.test('17) cross-country relationship remains impossible', async () => {
    const fromId = await insertDraftVersion({ rule: 'from' });
    const toUs = await insertDraftVersion({ rule: 'us' });
    const { error } = await supabaseAdmin.from('tax_rule_relationships').insert({
      id: randomUUID(),
      country_code: 'IL',
      from_tax_rule_version_id: fromId,
      to_tax_rule_version_id: toUs,
      relationship_type: 'depends_on',
    });
    assert.ok(error, 'IL version cannot relate to US version');
  });
});

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
const sql601 = readFileSync(join(repoRoot, 'supabase/migrations/601_tax_knowledge_provenance_links.sql'), 'utf8');
const sql600 = readFileSync(join(repoRoot, 'supabase/migrations/600_tax_knowledge_core_foundation.sql'), 'utf8');

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function errText(error: { message?: string; code?: string; details?: string; hint?: string } | null): string {
  return [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(' | ');
}

function k1Payload(): Record<string, unknown> {
  return { statement: 'string', applies_if: null, does_not_apply_if: null, notes: null };
}

test('TAX-K1.2 contract: provenance tables, isolation, parent-draft lock, no payload copy', () => {
  assert.match(sql601, /create table if not exists public\.tax_rule_version_sources/);
  assert.match(sql601, /create table if not exists public\.tax_rule_version_legal_values/);
  assert.doesNotMatch(sql601, /create table if not exists public\.tax_rule_relationships/);
  assert.doesNotMatch(sql601, /create table if not exists public\.tax_source_assets/);
  assert.doesNotMatch(sql601, /organization_id\s+(uuid|text)/i);
  assert.doesNotMatch(sql601, /value_payload_json/);
  assert.doesNotMatch(sql601, /alter table public\.country_legal_values/);
  assert.doesNotMatch(sql601, /alter table public\.tax_rule_versions/);
  assert.doesNotMatch(sql601, /insert into storage\.buckets/);
  assert.match(sql601, /tax_rule_version_sources_version_country_fk/);
  assert.match(sql601, /tax_rule_version_sources_source_country_fk/);
  assert.match(sql601, /tax_rule_version_legal_values_legal_value_country_fk/);
  assert.match(sql601, /coalesce\(btrim\(locator\), ''\)/);
  assert.match(sql601, /uq_tax_rule_version_legal_values_pair/);
  assert.match(sql601, /tax_knowledge_child_requires_parent_draft/);
  assert.match(sql601, /Cross-country tax provenance citation is forbidden/);
  assert.match(sql601, /Cross-country tax legal-value binding is forbidden/);
  assert.match(sql601, /Does not copy rates\/thresholds\/payloads/);
  assert.match(sql601, /alter table public\.tax_rule_version_sources enable row level security/);
  assert.match(sql601, /alter table public\.tax_rule_version_sources force row level security/);
  assert.match(sql601, /alter table public\.tax_rule_version_legal_values enable row level security/);
  assert.match(sql601, /alter table public\.tax_rule_version_legal_values force row level security/);
  assert.match(sql601, /revoke all on table public\.tax_rule_version_sources from anon, authenticated/);
  assert.match(sql601, /revoke all on table public\.tax_rule_version_legal_values from anon, authenticated/);
  assert.match(sql601, /No CREATE POLICY on purpose/);
  assert.doesNotMatch(sql601, /^\s*create policy\b/im);
  assert.match(sql600, /tax_rule_versions must be inserted as draft/);
});

test('TAX-K1.2 contract: migration 600 untouched, no payload copy, no unrelated files', () => {
  const diff600 = execSync('git diff -- supabase/migrations/600_tax_knowledge_core_foundation.sql', {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(diff600.trim(), '', '19) migration 600 must remain unchanged');

  const createLegalValues = sql601.slice(
    sql601.indexOf('create table if not exists public.tax_rule_version_legal_values'),
    sql601.indexOf('comment on table public.tax_rule_version_legal_values'),
  );
  assert.doesNotMatch(createLegalValues, /rate|threshold|limit|amount|percentage|payload/i);

  const porcelain = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[A-Z?]{1,2}\s+/, '').replace(/.* -> /, ''));
  const allowed = new Set([
    'supabase/migrations/601_tax_knowledge_provenance_links.sql',
    'supabase/migrations/602_tax_knowledge_publication_guard.sql',
    'supabase/migrations/603_tax_knowledge_rule_relationships.sql',
    'apps/api/tests/tax-knowledge/tax-knowledge-k1-foundation.spec.ts',
    'apps/api/tests/tax-knowledge/tax-knowledge-k1-2-provenance.spec.ts',
    'apps/api/tests/tax-knowledge/tax-knowledge-k1-2a-publication-guard.spec.ts',
    'apps/api/tests/tax-knowledge/tax-knowledge-k1-3-relationships.spec.ts',
  ]);
  const unexpected = porcelain.filter((path) => !allowed.has(path));
  assert.deepEqual(unexpected, [], `20) unrelated files changed: ${unexpected.join(', ')}`);
});

test('TAX-K1.2 DB provenance safety', async (t) => {
  if (!supabaseConfigured()) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }

  const { supabaseAdmin } = await import('../../src/db/client.js');
  const probe = await supabaseAdmin.from('tax_rule_version_sources').select('id').limit(1);
  if (probe.error && isSupabaseMissingTableError(probe.error, 'tax_rule_version_sources')) {
    t.skip('migration 601 not applied');
    return;
  }
  if (probe.error) throw new Error(`tax_rule_version_sources probe failed: ${errText(probe.error)}`);

  const marker = `tk12-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const packIl = randomUUID();
  const packUs = randomUUID();
  const rulesetIl = randomUUID();
  const rulesetUs = randomUUID();
  const sourceIl = randomUUID();
  const sourceUs = randomUUID();
  const ruleIl = randomUUID();
  const versionDraft = randomUUID();
  const versionActive = randomUUID();
  const citeDraft = randomUUID();
  const citeActive = randomUUID();
  const lvIl = randomUUID();
  const lvUs = randomUUID();
  const bindDraft = randomUUID();
  const bindActive = randomUUID();

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
      title: 'IL source',
      provenance_type: 'official_law',
      status: 'draft',
    },
    {
      id: sourceUs,
      country_code: 'US',
      source_code: `${marker}_us_src`,
      title: 'US source',
      provenance_type: 'official_law',
      status: 'draft',
    },
  ]);
  if (srcErr) throw new Error(`tax_sources insert failed: ${errText(srcErr)}`);

  const { error: ruleErr } = await supabaseAdmin.from('tax_rules').insert({
    id: ruleIl,
    country_code: 'IL',
    rule_code: `${marker}_rule`,
    title: 'IL rule',
    rule_kind: 'legal_rule',
    status: 'draft',
  });
  if (ruleErr) throw new Error(`tax_rules insert failed: ${errText(ruleErr)}`);

  const { error: verErr } = await supabaseAdmin.from('tax_rule_versions').insert([
    {
      id: versionDraft,
      tax_rule_id: ruleIl,
      country_code: 'IL',
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      version_no: 1,
      status: 'draft',
      effective_from: '2020-01-01',
      payload_json: k1Payload(),
      payload_checksum: 'fixture-not-canonical',
    },
    {
      id: versionActive,
      tax_rule_id: ruleIl,
      country_code: 'IL',
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      version_no: 2,
      status: 'draft',
      effective_from: '2021-01-01',
      effective_to: '2021-12-31',
      payload_json: k1Payload(),
      payload_checksum: 'fixture-not-canonical',
    },
  ]);
  if (verErr) throw new Error(`tax_rule_versions insert failed: ${errText(verErr)}`);

  const { error: lvErr } = await supabaseAdmin.from('country_legal_values').insert([
    {
      id: lvIl,
      country_code: 'IL',
      value_key: `${marker}_il_vat`,
      label: 'IL VAT',
      category: 'VAT',
      module_scope: 'module:tax-knowledge-test',
      value_type: 'percentage',
      status: 'draft',
    },
    {
      id: lvUs,
      country_code: 'US',
      value_key: `${marker}_us_vat`,
      label: 'US VAT',
      category: 'VAT',
      module_scope: 'module:tax-knowledge-test',
      value_type: 'percentage',
      status: 'draft',
    },
  ]);
  if (lvErr) throw new Error(`country_legal_values insert failed: ${errText(lvErr)}`);

  await t.test('1) Valid same-country version→source link accepted', async () => {
    const { error } = await supabaseAdmin.from('tax_rule_version_sources').insert({
      id: citeDraft,
      tax_rule_version_id: versionDraft,
      tax_source_id: sourceIl,
      country_code: 'IL',
      locator: 'art. 1',
    });
    assert.ifError(error);
  });

  await t.test('2) Cross-country version→source rejected', async () => {
    const { error } = await supabaseAdmin.from('tax_rule_version_sources').insert({
      id: randomUUID(),
      tax_rule_version_id: versionDraft,
      tax_source_id: sourceUs,
      country_code: 'IL',
    });
    assert.ok(error, 'IL version cannot cite US source');
  });

  await t.test('3) Duplicate version/source/locator rejected', async () => {
    const { error } = await supabaseAdmin.from('tax_rule_version_sources').insert({
      id: randomUUID(),
      tax_rule_version_id: versionDraft,
      tax_source_id: sourceIl,
      country_code: 'IL',
      locator: 'art. 1',
    });
    assert.ok(error, 'duplicate citation must be rejected');

    const nullA = await supabaseAdmin.from('tax_rule_version_sources').insert({
      id: randomUUID(),
      tax_rule_version_id: versionDraft,
      tax_source_id: sourceIl,
      country_code: 'IL',
      locator: null,
    });
    assert.ifError(nullA.error);
    const nullB = await supabaseAdmin.from('tax_rule_version_sources').insert({
      id: randomUUID(),
      tax_rule_version_id: versionDraft,
      tax_source_id: sourceIl,
      country_code: 'IL',
      locator: null,
    });
    assert.ok(nullB.error, 'duplicate NULL locator must be rejected');
  });

  await t.test('4) Draft citation may be removed', async () => {
    const temp = randomUUID();
    assert.ifError(
      (
        await supabaseAdmin.from('tax_rule_version_sources').insert({
          id: temp,
          tax_rule_version_id: versionDraft,
          tax_source_id: sourceIl,
          country_code: 'IL',
          locator: 'art. removable',
        })
      ).error,
    );
    const { error } = await supabaseAdmin.from('tax_rule_version_sources').delete().eq('id', temp);
    assert.ifError(error);
  });

  await t.test('5-8) Active version citations are frozen', async () => {
    assert.ifError(
      (await supabaseAdmin.from('tax_sources').update({ status: 'active' }).eq('id', sourceIl)).error,
    );
    assert.ifError(
      (
        await supabaseAdmin.from('tax_rule_version_sources').insert({
          id: citeActive,
          tax_rule_version_id: versionActive,
          tax_source_id: sourceIl,
          country_code: 'IL',
          locator: 'art. active',
        })
      ).error,
    );
    assert.ifError(
      (await supabaseAdmin.from('tax_rule_versions').update({ status: 'active' }).eq('id', versionActive)).error,
    );

    const ins = await supabaseAdmin.from('tax_rule_version_sources').insert({
      id: randomUUID(),
      tax_rule_version_id: versionActive,
      tax_source_id: sourceIl,
      country_code: 'IL',
      locator: 'art. after-active',
    });
    assert.ok(ins.error, 'active citation INSERT must be rejected');
    assert.match(errText(ins.error), /immutable after the parent version leaves draft/i);

    const upd = await supabaseAdmin
      .from('tax_rule_version_sources')
      .update({ locator: 'art. mutated' })
      .eq('id', citeActive);
    assert.ok(upd.error, 'active citation UPDATE must be rejected');

    const del = await supabaseAdmin.from('tax_rule_version_sources').delete().eq('id', citeActive);
    assert.ok(del.error, 'active citation DELETE must be rejected');

    const created = await supabaseAdmin
      .from('tax_rule_version_sources')
      .update({ created_at: '2000-01-01T00:00:00.000Z' })
      .eq('id', citeDraft);
    assert.ok(created.error, 'created_at mutation must be rejected');
    assert.match(errText(created.error), /created_at is immutable/i);
  });

  await t.test('9) Valid same-country version→legal_value binding accepted', async () => {
    const { error } = await supabaseAdmin.from('tax_rule_version_legal_values').insert({
      id: bindDraft,
      tax_rule_version_id: versionDraft,
      legal_value_id: lvIl,
      country_code: 'IL',
    });
    assert.ifError(error);
  });

  await t.test('10) Cross-country legal_value binding rejected', async () => {
    const { error } = await supabaseAdmin.from('tax_rule_version_legal_values').insert({
      id: randomUUID(),
      tax_rule_version_id: versionDraft,
      legal_value_id: lvUs,
      country_code: 'IL',
    });
    assert.ok(error, 'IL version cannot bind US legal value');
  });

  await t.test('11) Duplicate version/legal_value binding rejected', async () => {
    const { error } = await supabaseAdmin.from('tax_rule_version_legal_values').insert({
      id: randomUUID(),
      tax_rule_version_id: versionDraft,
      legal_value_id: lvIl,
      country_code: 'IL',
    });
    assert.ok(error, 'duplicate binding must be rejected');
  });

  await t.test('12) No legal-value payload copied into this table', () => {
    const createLegalValues = sql601.slice(
      sql601.indexOf('create table if not exists public.tax_rule_version_legal_values'),
      sql601.indexOf('comment on table public.tax_rule_version_legal_values'),
    );
    assert.doesNotMatch(createLegalValues, /rate|threshold|limit|amount|percentage|payload/i);
  });

  await t.test('13) Draft binding may be removed', async () => {
    const lvExtra = randomUUID();
    assert.ifError(
      (
        await supabaseAdmin.from('country_legal_values').insert({
          id: lvExtra,
          country_code: 'IL',
          value_key: `${marker}_il_extra`,
          label: 'IL extra',
          category: 'VAT',
          module_scope: 'module:tax-knowledge-test',
          value_type: 'percentage',
          status: 'draft',
        })
      ).error,
    );
    const temp = randomUUID();
    assert.ifError(
      (
        await supabaseAdmin.from('tax_rule_version_legal_values').insert({
          id: temp,
          tax_rule_version_id: versionDraft,
          legal_value_id: lvExtra,
          country_code: 'IL',
        })
      ).error,
    );
    const { error } = await supabaseAdmin.from('tax_rule_version_legal_values').delete().eq('id', temp);
    assert.ifError(error);
  });

  await t.test('14-17) Active version bindings are frozen', async () => {
    const bindVer = randomUUID();
    const lvAfterActive = randomUUID();
    assert.ifError(
      (
        await supabaseAdmin.from('tax_rule_versions').insert({
          id: bindVer,
          tax_rule_id: ruleIl,
          country_code: 'IL',
          country_pack_id: packIl,
          country_pack_ruleset_id: rulesetIl,
          version_no: 3,
          status: 'draft',
          effective_from: '2022-01-01',
          effective_to: '2022-12-31',
          payload_json: k1Payload(),
          payload_checksum: 'fixture-not-canonical',
        })
      ).error,
    );
    assert.ifError(
      (
        await supabaseAdmin.from('country_legal_values').insert({
          id: lvAfterActive,
          country_code: 'IL',
          value_key: `${marker}_il_after_active`,
          label: 'IL after active',
          category: 'VAT',
          module_scope: 'module:tax-knowledge-test',
          value_type: 'percentage',
          status: 'draft',
        })
      ).error,
    );
    assert.ifError(
      (
        await supabaseAdmin.from('tax_rule_version_legal_values').insert({
          id: bindActive,
          tax_rule_version_id: bindVer,
          legal_value_id: lvIl,
          country_code: 'IL',
        })
      ).error,
    );
    assert.ifError(
      (
        await supabaseAdmin.from('tax_rule_version_sources').insert({
          id: randomUUID(),
          tax_rule_version_id: bindVer,
          tax_source_id: sourceIl,
          country_code: 'IL',
          locator: 'art. bind-active',
        })
      ).error,
    );
    assert.ifError((await supabaseAdmin.from('tax_rule_versions').update({ status: 'active' }).eq('id', bindVer)).error);

    const ins = await supabaseAdmin.from('tax_rule_version_legal_values').insert({
      id: randomUUID(),
      tax_rule_version_id: bindVer,
      legal_value_id: lvAfterActive,
      country_code: 'IL',
    });
    assert.ok(ins.error, 'active binding INSERT must be rejected');
    assert.match(errText(ins.error), /immutable after the parent version leaves draft/i);

    const upd = await supabaseAdmin
      .from('tax_rule_version_legal_values')
      .update({ created_at: '2000-01-01T00:00:00.000Z' })
      .eq('id', bindActive);
    assert.ok(upd.error, 'active binding UPDATE must be rejected');

    const del = await supabaseAdmin.from('tax_rule_version_legal_values').delete().eq('id', bindActive);
    assert.ok(del.error, 'active binding DELETE must be rejected');

    const created = await supabaseAdmin
      .from('tax_rule_version_legal_values')
      .update({ created_at: '2000-01-01T00:00:00.000Z' })
      .eq('id', bindDraft);
    assert.ok(created.error, 'binding created_at mutation must be rejected');
    assert.match(errText(created.error), /created_at is immutable/i);
  });

  await t.test('18) RLS/no tenant policy contract', () => {
    assert.doesNotMatch(sql601, /^\s*create policy\b/im);
    assert.match(sql601, /revoke all on table public\.tax_rule_version_sources from anon, authenticated/);
    assert.match(sql601, /revoke all on table public\.tax_rule_version_legal_values from anon, authenticated/);
  });
});

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
const sql602 = readFileSync(join(repoRoot, 'supabase/migrations/602_tax_knowledge_publication_guard.sql'), 'utf8');

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function errText(error: { message?: string; code?: string; details?: string; hint?: string } | null): string {
  return [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(' | ');
}

function k1Payload(): Record<string, unknown> {
  return { statement: 'string', applies_if: null, does_not_apply_if: null, notes: null };
}

test('TAX-K1.2A contract: publication guard on draft→active only', () => {
  assert.match(sql602, /tax_rule_versions_guard_publication_provenance/);
  assert.match(sql602, /tax_rule_versions_publication_provenance_guard/);
  assert.match(sql602, /when \(old\.status = 'draft' and new\.status = 'active'\)/);
  assert.match(
    sql602,
    /cannot activate without at least one citation to an active tax_source/,
  );
  assert.match(sql602, /citation\.tax_rule_version_id = new\.id/);
  assert.match(sql602, /src\.status = 'active'/);
  assert.doesNotMatch(sql602, /provenance_type\s*=\s*'official_law'/);
  assert.doesNotMatch(sql602, /tax_rule_version_legal_values/);
  assert.doesNotMatch(sql602, /organization_id/);
  assert.doesNotMatch(sql602, /alter table public\.tax_rule_versions/);
  assert.doesNotMatch(sql602, /alter table public\.tax_sources/);
  assert.doesNotMatch(sql602, /alter table public\.country_legal_values/);
  assert.doesNotMatch(sql602, /insert into storage\.buckets/);
});

test('TAX-K1.2A contract: migrations 600/601 untouched and no unrelated files', () => {
  const diff600 = execSync('git diff -- supabase/migrations/600_tax_knowledge_core_foundation.sql', {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const diff601 = execSync('git diff -- supabase/migrations/601_tax_knowledge_provenance_links.sql', {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(diff600.trim(), '', '11) migration 600 must remain unchanged');
  assert.equal(diff601.trim(), '', '11) migration 601 must remain unchanged');

  const porcelain = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[A-Z?]{1,2}\s+/, '').replace(/.* -> /, ''));
  const allowed = new Set([
    'supabase/migrations/602_tax_knowledge_publication_guard.sql',
    'supabase/migrations/603_tax_knowledge_rule_relationships.sql',
    'supabase/migrations/604_tax_knowledge_relationship_publication_guard.sql',
    'apps/api/tests/tax-knowledge/tax-knowledge-k1-foundation.spec.ts',
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
  ]);
  const unexpected = porcelain.filter((path) => !allowed.has(path));
  assert.deepEqual(unexpected, [], `12) unrelated files changed: ${unexpected.join(', ')}`);
});

test('TAX-K1.2A DB publication guard', async (t) => {
  if (!supabaseConfigured()) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }

  const { supabaseAdmin } = await import('../../src/db/client.js');
  const probe = await supabaseAdmin.from('tax_rule_version_sources').select('id').limit(1);
  if (probe.error && isSupabaseMissingTableError(probe.error, 'tax_rule_version_sources')) {
    t.skip('migration 601/602 not applied');
    return;
  }
  if (probe.error) throw new Error(`tax_rule_version_sources probe failed: ${errText(probe.error)}`);

  const marker = `tk12a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const packIl = randomUUID();
  const packUs = randomUUID();
  const rulesetIl = randomUUID();
  const rulesetUs = randomUUID();
  const sourceDraft = randomUUID();
  const sourceRetired = randomUUID();
  const sourceActive = randomUUID();
  const sourceActive2 = randomUUID();
  const sourceUs = randomUUID();
  const ruleIl = randomUUID();
  let nextVersionNo = 1;

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
      id: sourceDraft,
      country_code: 'IL',
      source_code: `${marker}_il_draft`,
      title: 'IL draft source',
      provenance_type: 'textbook',
      status: 'draft',
    },
    {
      id: sourceRetired,
      country_code: 'IL',
      source_code: `${marker}_il_retired`,
      title: 'IL retired source',
      provenance_type: 'official_guidance',
      status: 'retired',
    },
    {
      id: sourceActive,
      country_code: 'IL',
      source_code: `${marker}_il_active`,
      title: 'IL active source',
      provenance_type: 'textbook',
      status: 'active',
    },
    {
      id: sourceActive2,
      country_code: 'IL',
      source_code: `${marker}_il_active2`,
      title: 'IL active source 2',
      provenance_type: 'professional_material',
      status: 'active',
    },
    {
      id: sourceUs,
      country_code: 'US',
      source_code: `${marker}_us_active`,
      title: 'US active source',
      provenance_type: 'official_law',
      status: 'active',
    },
  ]);
  if (srcErr) throw new Error(`tax_sources insert failed: ${errText(srcErr)}`);

  const { error: ruleErr } = await supabaseAdmin.from('tax_rules').insert({
    id: ruleIl,
    country_code: 'IL',
    rule_code: `${marker}_rule`,
    title: 'IL publication-guard rule',
    rule_kind: 'legal_rule',
    status: 'draft',
  });
  if (ruleErr) throw new Error(`tax_rules insert failed: ${errText(ruleErr)}`);

  async function insertDraftVersion(effectiveFrom: string, effectiveTo?: string): Promise<string> {
    const id = randomUUID();
    const { error } = await supabaseAdmin.from('tax_rule_versions').insert({
      id,
      tax_rule_id: ruleIl,
      country_code: 'IL',
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      version_no: nextVersionNo,
      status: 'draft',
      effective_from: effectiveFrom,
      ...(effectiveTo ? { effective_to: effectiveTo } : {}),
      payload_json: k1Payload(),
      payload_checksum: 'fixture-not-canonical',
    });
    if (error) throw new Error(`draft version insert failed: ${errText(error)}`);
    nextVersionNo += 1;
    return id;
  }

  async function cite(versionId: string, sourceId: string, locator?: string): Promise<string> {
    const id = randomUUID();
    const { error } = await supabaseAdmin.from('tax_rule_version_sources').insert({
      id,
      tax_rule_version_id: versionId,
      tax_source_id: sourceId,
      country_code: 'IL',
      ...(locator ? { locator } : {}),
    });
    if (error) throw new Error(`citation insert failed: ${errText(error)}`);
    return id;
  }

  await t.test('1) draft → active with zero citations rejected', async () => {
    const versionId = await insertDraftVersion('2010-01-01', '2010-12-31');
    const { error } = await supabaseAdmin.from('tax_rule_versions').update({ status: 'active' }).eq('id', versionId);
    assert.ok(error, 'source-less activation must be rejected');
    assert.match(errText(error), /cannot activate without at least one citation to an active tax_source/i);
  });

  await t.test('2) draft → active with citation to draft source rejected', async () => {
    const versionId = await insertDraftVersion('2011-01-01', '2011-12-31');
    await cite(versionId, sourceDraft, 'draft-only');
    const { error } = await supabaseAdmin.from('tax_rule_versions').update({ status: 'active' }).eq('id', versionId);
    assert.ok(error, 'draft-source activation must be rejected');
    assert.match(errText(error), /cannot activate without at least one citation to an active tax_source/i);
  });

  await t.test('3) draft → active with citation to retired source rejected', async () => {
    const versionId = await insertDraftVersion('2012-01-01', '2012-12-31');
    await cite(versionId, sourceRetired, 'retired-only');
    const { error } = await supabaseAdmin.from('tax_rule_versions').update({ status: 'active' }).eq('id', versionId);
    assert.ok(error, 'retired-source activation must be rejected');
    assert.match(errText(error), /cannot activate without at least one citation to an active tax_source/i);
  });

  await t.test('4) draft → active with at least one active source accepted', async () => {
    const versionId = await insertDraftVersion('2013-01-01', '2013-12-31');
    await cite(versionId, sourceActive, 'active-only');
    const { error } = await supabaseAdmin.from('tax_rule_versions').update({ status: 'active' }).eq('id', versionId);
    assert.ifError(error);
  });

  await t.test('5) one draft + one active citation accepted', async () => {
    const versionId = await insertDraftVersion('2014-01-01', '2014-12-31');
    await cite(versionId, sourceDraft, 'mixed-draft');
    await cite(versionId, sourceActive2, 'mixed-active');
    const { error } = await supabaseAdmin.from('tax_rule_versions').update({ status: 'active' }).eq('id', versionId);
    assert.ifError(error);
  });

  await t.test('6) draft → retired with zero sources accepted', async () => {
    const versionId = await insertDraftVersion('2015-01-01', '2015-12-31');
    const { error } = await supabaseAdmin.from('tax_rule_versions').update({ status: 'retired' }).eq('id', versionId);
    assert.ifError(error);
  });

  await t.test('7-8) later source retirement keeps historical citation frozen', async () => {
    const versionId = await insertDraftVersion('2016-01-01', '2016-12-31');
    const histSource = randomUUID();
    assert.ifError(
      (
        await supabaseAdmin.from('tax_sources').insert({
          id: histSource,
          country_code: 'IL',
          source_code: `${marker}_il_hist`,
          title: 'IL historical source',
          provenance_type: 'official_guidance',
          status: 'active',
        })
      ).error,
    );
    const citeId = await cite(versionId, histSource, 'historical');
    assert.ifError(
      (await supabaseAdmin.from('tax_rule_versions').update({ status: 'active' }).eq('id', versionId)).error,
    );
    assert.ifError(
      (await supabaseAdmin.from('tax_sources').update({ status: 'retired' }).eq('id', histSource)).error,
    );

    const { data, error: readErr } = await supabaseAdmin
      .from('tax_rule_versions')
      .select('id, status')
      .eq('id', versionId)
      .single();
    assert.ifError(readErr);
    assert.equal(data?.status, 'active');

    const ins = await supabaseAdmin.from('tax_rule_version_sources').insert({
      id: randomUUID(),
      tax_rule_version_id: versionId,
      tax_source_id: sourceActive,
      country_code: 'IL',
      locator: 'after-retire',
    });
    assert.ok(ins.error, 'citation INSERT after activation must be rejected');

    const upd = await supabaseAdmin.from('tax_rule_version_sources').update({ locator: 'mutated' }).eq('id', citeId);
    assert.ok(upd.error, 'citation UPDATE after activation must be rejected');

    const del = await supabaseAdmin.from('tax_rule_version_sources').delete().eq('id', citeId);
    assert.ok(del.error, 'citation DELETE after activation must be rejected');
  });

  await t.test('9) cross-country citation remains impossible', async () => {
    const versionId = await insertDraftVersion('2017-01-01', '2017-12-31');
    const { error } = await supabaseAdmin.from('tax_rule_version_sources').insert({
      id: randomUUID(),
      tax_rule_version_id: versionId,
      tax_source_id: sourceUs,
      country_code: 'IL',
    });
    assert.ok(error, 'IL version cannot cite US source');
  });

  await t.test('10) no legal-value binding is required for activation', async () => {
    const versionId = await insertDraftVersion('2018-01-01', '2018-12-31');
    await cite(versionId, sourceActive, 'no-legal-value');
    const { count, error: countErr } = await supabaseAdmin
      .from('tax_rule_version_legal_values')
      .select('id', { count: 'exact', head: true })
      .eq('tax_rule_version_id', versionId);
    assert.ifError(countErr);
    assert.equal(count, 0);
    const { error } = await supabaseAdmin.from('tax_rule_versions').update({ status: 'active' }).eq('id', versionId);
    assert.ifError(error);
  });
});

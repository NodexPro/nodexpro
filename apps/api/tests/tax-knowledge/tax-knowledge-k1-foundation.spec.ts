import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { isSupabaseMissingTableError } from '../../src/shared/supabase-errors.js';

const dir = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  join(dir, '../../../../supabase/migrations/600_tax_knowledge_core_foundation.sql'),
  'utf8',
);

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function errText(error: { message?: string; code?: string; details?: string; hint?: string } | null): string {
  return [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(' | ');
}

function k1Payload(): Record<string, unknown> {
  return {
    statement: 'string',
    applies_if: null,
    does_not_apply_if: null,
    notes: null,
  };
}

type AdminClient = {
  from: (table: string) => any;
};

async function insertDraftVersion(
  admin: AdminClient,
  row: Record<string, unknown>,
): Promise<{ error: { message?: string; code?: string } | null }> {
  return admin.from('tax_rule_versions').insert({ ...row, status: 'draft' });
}

async function ensureActivePublicationCitation(
  admin: AdminClient,
  versionId: string,
): Promise<{ error: { message?: string; code?: string } | null }> {
  const probe = await admin.from('tax_rule_version_sources').select('id').limit(1);
  if (probe.error && isSupabaseMissingTableError(probe.error, 'tax_rule_version_sources')) {
    return { error: null };
  }
  if (probe.error) return { error: probe.error };

  const { data: version, error: verErr } = await admin
    .from('tax_rule_versions')
    .select('id, country_code')
    .eq('id', versionId)
    .single();
  if (verErr || !version) return { error: verErr ?? { message: 'tax_rule_version not found' } };

  const sourceId = randomUUID();
  const { error: srcIns } = await admin.from('tax_sources').insert({
    id: sourceId,
    country_code: version.country_code,
    source_code: `tk-pub-${sourceId}`,
    title: 'Publication fixture source',
    provenance_type: 'official_guidance',
    status: 'draft',
  });
  if (srcIns) return { error: srcIns };

  const { error: srcAct } = await admin.from('tax_sources').update({ status: 'active' }).eq('id', sourceId);
  if (srcAct) return { error: srcAct };

  const { error: citeErr } = await admin.from('tax_rule_version_sources').insert({
    id: randomUUID(),
    tax_rule_version_id: versionId,
    tax_source_id: sourceId,
    country_code: version.country_code,
    locator: 'publication-fixture',
  });
  if (citeErr) return { error: citeErr };
  return { error: null };
}

async function activateVersion(
  admin: AdminClient,
  id: string,
): Promise<{ error: { message?: string; code?: string } | null }> {
  const cited = await ensureActivePublicationCitation(admin, id);
  if (cited.error) return cited;
  return admin.from('tax_rule_versions').update({ status: 'active' }).eq('id', id);
}

async function retireVersion(
  admin: AdminClient,
  id: string,
): Promise<{ error: { message?: string; code?: string } | null }> {
  return admin.from('tax_rule_versions').update({ status: 'retired' }).eq('id', id);
}

test('TAX-K1.1 migration contract: three tables, isolation, immutability, no tenant policies', () => {
  assert.match(migrationSql, /create table if not exists public\.tax_sources/);
  assert.match(migrationSql, /create table if not exists public\.tax_rules/);
  assert.match(migrationSql, /create table if not exists public\.tax_rule_versions/);
  assert.doesNotMatch(migrationSql, /organization_id\s+(uuid|text)/i);
  assert.doesNotMatch(migrationSql, /create table if not exists public\.tax_source_assets/);
  assert.doesNotMatch(migrationSql, /create table if not exists public\.tax_rule_relationships/);
  assert.doesNotMatch(migrationSql, /create table if not exists public\.tax_setup_case/);
  assert.doesNotMatch(migrationSql, /insert into storage\.buckets/);

  assert.match(migrationSql, /uq_tax_sources_country_source_code/);
  assert.match(migrationSql, /uq_tax_rules_country_rule_code/);
  assert.match(migrationSql, /uq_tax_rule_versions_rule_version_no/);
  assert.match(migrationSql, /tax_rule_versions_rule_country_fk/);
  assert.match(migrationSql, /tax_rule_versions_pack_country_fk/);
  assert.match(migrationSql, /tax_rule_versions_ruleset_pack_fk/);
  assert.match(migrationSql, /tax_rule_versions_no_active_overlap/);
  assert.match(migrationSql, /exclude using gist/);
  assert.match(migrationSql, /tax_rule_versions_protect_immutability/);
  assert.match(migrationSql, /tax_rules_protect_rule_code/);
  assert.match(migrationSql, /tax_knowledge_forbid_delete/);
  assert.match(migrationSql, /jsonb_typeof\(payload_json\) = 'object'/);
  assert.match(migrationSql, /canonical SHA-256/);
  assert.match(migrationSql, /rule_kind in \('legal_rule'\)/);
  assert.match(migrationSql, /supersedes_version_id is null or supersedes_version_id <> id/);
  assert.match(migrationSql, /superseded_by_version_id is null or superseded_by_version_id <> id/);
  assert.match(migrationSql, /Circular tax rule supersession lineage is forbidden/);
  assert.match(migrationSql, /Invalid tax_rule_versions status transition/);
  assert.match(migrationSql, /effective_to cannot be extended after leaving draft/);
  assert.match(migrationSql, /effective_to is frozen after supersession\/retirement/);
  assert.match(migrationSql, /tax_sources\.country_code is immutable/);
  assert.match(migrationSql, /tax_sources\.created_at is immutable/);
  assert.match(migrationSql, /tax_rules\.created_at is immutable/);
  assert.match(migrationSql, /tax_rule_versions\.created_at is immutable/);
  assert.match(migrationSql, /UNIQUE \(tax_rule_id, version_no\) is the concurrency guard/);
  assert.match(migrationSql, /before truncate on public\.tax_sources/);
  assert.match(migrationSql, /before truncate on public\.tax_rules/);
  assert.match(migrationSql, /before truncate on public\.tax_rule_versions/);
  assert.match(migrationSql, /tax_rule_versions must be inserted as draft/);
  assert.match(migrationSql, /tax_rule_versions_insert_draft_only/);

  assert.match(migrationSql, /alter table public\.tax_sources enable row level security/);
  assert.match(migrationSql, /alter table public\.tax_rules enable row level security/);
  assert.match(migrationSql, /alter table public\.tax_rule_versions enable row level security/);
  assert.match(migrationSql, /revoke all on table public\.tax_sources from anon, authenticated/);
  assert.match(migrationSql, /revoke all on table public\.tax_rules from anon, authenticated/);
  assert.match(migrationSql, /revoke all on table public\.tax_rule_versions from anon, authenticated/);
  assert.match(migrationSql, /No CREATE POLICY on purpose/);
  assert.doesNotMatch(migrationSql, /^\s*create policy\b/im);
});

test('TAX-K1.1 DB foundation safety', async (t) => {
  if (!supabaseConfigured()) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }

  const { supabaseAdmin } = await import('../../src/db/client.js');
  const probe = await supabaseAdmin.from('tax_sources').select('id').limit(1);
  if (probe.error && isSupabaseMissingTableError(probe.error, 'tax_sources')) {
    t.skip('migration 600 not applied');
    return;
  }
  if (probe.error) throw new Error(`tax_sources probe failed: ${errText(probe.error)}`);

  const marker = `tk11-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sourceA = randomUUID();
  const sourceDup = randomUUID();
  const ruleIl = randomUUID();
  const ruleIl2 = randomUUID();
  const ruleUs = randomUUID();
  const packIl = randomUUID();
  const packUs = randomUUID();
  const rulesetIl = randomUUID();
  const rulesetUs = randomUUID();
  const version1 = randomUUID();
  const version2 = randomUUID();
  const versionDraft = randomUUID();

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

  await t.test('1) Tax source country required', async () => {
    const { error } = await supabaseAdmin.from('tax_sources').insert({
      id: randomUUID(),
      country_code: null,
      source_code: `${marker}_src_null_country`,
      title: 'Missing country',
      provenance_type: 'official_law',
      status: 'draft',
    });
    assert.ok(error, 'country_code null should be rejected');
  });

  await t.test('2) Duplicate (country_code, source_code) rejected', async () => {
    const row = {
      country_code: 'IL',
      source_code: `${marker}_src`,
      title: 'Source A',
      provenance_type: 'official_law',
      status: 'draft',
    };
    const first = await supabaseAdmin.from('tax_sources').insert({ id: sourceA, ...row });
    assert.ifError(first.error);
    const dup = await supabaseAdmin.from('tax_sources').insert({ id: sourceDup, ...row });
    assert.ok(dup.error, 'duplicate source_code in same country should be rejected');
  });

  await t.test('3) Tax rule country required', async () => {
    const { error } = await supabaseAdmin.from('tax_rules').insert({
      id: randomUUID(),
      country_code: null,
      rule_code: `${marker}_rule_null_country`,
      title: 'Missing country',
      rule_kind: 'legal_rule',
      status: 'draft',
    });
    assert.ok(error, 'country_code null should be rejected');
  });

  await t.test('4) Duplicate (country_code, rule_code) rejected', async () => {
    const row = {
      country_code: 'IL',
      rule_code: `${marker}_rule`,
      title: 'Rule IL',
      rule_kind: 'legal_rule',
      status: 'draft',
    };
    const first = await supabaseAdmin.from('tax_rules').insert({ id: ruleIl, ...row });
    assert.ifError(first.error);
    const dup = await supabaseAdmin.from('tax_rules').insert({ id: ruleIl2, ...row });
    assert.ok(dup.error, 'duplicate rule_code in same country should be rejected');

    const us = await supabaseAdmin.from('tax_rules').insert({
      id: ruleUs,
      country_code: 'US',
      rule_code: `${marker}_rule_us`,
      title: 'Rule US',
      rule_kind: 'legal_rule',
      status: 'draft',
    });
    assert.ifError(us.error);
  });

  await t.test('5) rule_code update rejected', async () => {
    const { error } = await supabaseAdmin
      .from('tax_rules')
      .update({ rule_code: `${marker}_rule_renamed` })
      .eq('id', ruleIl);
    assert.ok(error, 'rule_code update should be rejected');
    assert.match(errText(error), /rule_code is immutable/i);
  });

  await t.test('6) Rule-version country mismatch rejected', async () => {
    const { error } = await supabaseAdmin.from('tax_rule_versions').insert({
      id: randomUUID(),
      tax_rule_id: ruleIl,
      country_code: 'US',
      country_pack_id: packUs,
      country_pack_ruleset_id: rulesetUs,
      version_no: 1,
      status: 'draft',
      effective_from: '2020-01-01',
      payload_json: k1Payload(),
      payload_checksum: 'fixture-not-canonical',
    });
    assert.ok(error, 'version country must match rule country');
  });

  await t.test('7) Pack/ruleset mismatch rejected', async () => {
    const packMismatch = await supabaseAdmin.from('tax_rule_versions').insert({
      id: randomUUID(),
      tax_rule_id: ruleIl,
      country_code: 'IL',
      country_pack_id: packUs,
      country_pack_ruleset_id: rulesetUs,
      version_no: 1,
      status: 'draft',
      effective_from: '2020-01-01',
      payload_json: k1Payload(),
      payload_checksum: 'fixture-not-canonical',
    });
    assert.ok(packMismatch.error, 'US pack cannot bind to IL version');

    const rulesetMismatch = await supabaseAdmin.from('tax_rule_versions').insert({
      id: randomUUID(),
      tax_rule_id: ruleIl,
      country_code: 'IL',
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetUs,
      version_no: 1,
      status: 'draft',
      effective_from: '2020-01-01',
      payload_json: k1Payload(),
      payload_checksum: 'fixture-not-canonical',
    });
    assert.ok(rulesetMismatch.error, 'ruleset must belong to the version pack');
  });

  await t.test('8) effective_to < effective_from rejected', async () => {
    const { error } = await supabaseAdmin.from('tax_rule_versions').insert({
      id: randomUUID(),
      tax_rule_id: ruleIl,
      country_code: 'IL',
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      version_no: 1,
      status: 'draft',
      effective_from: '2021-01-01',
      effective_to: '2020-12-31',
      payload_json: k1Payload(),
      payload_checksum: 'fixture-not-canonical',
    });
    assert.ok(error, 'effective_to < effective_from should be rejected');
  });

  await t.test('9) Non-object payload rejected', async () => {
    const { error } = await supabaseAdmin.from('tax_rule_versions').insert({
      id: randomUUID(),
      tax_rule_id: ruleIl,
      country_code: 'IL',
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      version_no: 1,
      status: 'draft',
      effective_from: '2020-01-01',
      payload_json: ['not', 'an', 'object'],
      payload_checksum: 'fixture-not-canonical',
    });
    assert.ok(error, 'array payload_json should be rejected');
  });

  await t.test('10) Duplicate (tax_rule_id, version_no) rejected', async () => {
    const first = await insertDraftVersion(supabaseAdmin, {
      id: version1,
      tax_rule_id: ruleIl,
      country_code: 'IL',
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      version_no: 1,
      effective_from: '2020-01-01',
      effective_to: '2020-12-31',
      payload_json: k1Payload(),
      payload_checksum: 'fixture-not-canonical',
    });
    assert.ifError(first.error);
    assert.ifError((await activateVersion(supabaseAdmin, version1)).error);

    const dup = await insertDraftVersion(supabaseAdmin, {
      id: randomUUID(),
      tax_rule_id: ruleIl,
      country_code: 'IL',
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      version_no: 1,
      effective_from: '2022-01-01',
      payload_json: k1Payload(),
      payload_checksum: 'fixture-not-canonical',
    });
    assert.ok(dup.error, 'duplicate version_no should be rejected');
  });

  await t.test('11) Overlapping active version windows rejected', async () => {
    const overlapRule = randomUUID();
    const overlapV1 = randomUUID();
    const overlapV2 = randomUUID();
    assert.ifError(
      (
        await supabaseAdmin.from('tax_rules').insert({
          id: overlapRule,
          country_code: 'IL',
          rule_code: `${marker}_overlap_active`,
          title: 'Overlap active',
          rule_kind: 'legal_rule',
          status: 'draft',
        })
      ).error,
    );
    assert.ifError(
      (
        await insertDraftVersion(supabaseAdmin, {
          id: overlapV1,
          tax_rule_id: overlapRule,
          country_code: 'IL',
          country_pack_id: packIl,
          country_pack_ruleset_id: rulesetIl,
          version_no: 1,
          effective_from: '2020-01-01',
          effective_to: '2020-12-31',
          payload_json: k1Payload(),
          payload_checksum: 'fixture-not-canonical',
        })
      ).error,
    );
    assert.ifError((await activateVersion(supabaseAdmin, overlapV1)).error);
    assert.ifError(
      (
        await insertDraftVersion(supabaseAdmin, {
          id: overlapV2,
          tax_rule_id: overlapRule,
          country_code: 'IL',
          country_pack_id: packIl,
          country_pack_ruleset_id: rulesetIl,
          version_no: 2,
          effective_from: '2020-06-01',
          effective_to: '2021-06-01',
          payload_json: k1Payload(),
          payload_checksum: 'fixture-not-canonical',
        })
      ).error,
    );
    const activated = await activateVersion(supabaseAdmin, overlapV2);
    assert.ok(activated.error, 'overlapping active windows should be rejected');
  });

  await t.test('12) Non-overlapping historical windows accepted', async () => {
    const inserted = await insertDraftVersion(supabaseAdmin, {
      id: version2,
      tax_rule_id: ruleIl,
      country_code: 'IL',
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      version_no: 2,
      effective_from: '2021-01-01',
      effective_to: '2021-12-31',
      payload_json: k1Payload(),
      payload_checksum: 'fixture-not-canonical',
    });
    assert.ifError(inserted.error);
    assert.ifError((await activateVersion(supabaseAdmin, version2)).error);
  });

  await t.test('13) Draft version may exist without becoming runtime-active', async () => {
    const { error } = await supabaseAdmin.from('tax_rule_versions').insert({
      id: versionDraft,
      tax_rule_id: ruleIl,
      country_code: 'IL',
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      version_no: 3,
      status: 'draft',
      effective_from: '2020-01-01',
      effective_to: '2020-12-31',
      payload_json: k1Payload(),
      payload_checksum: 'fixture-not-canonical',
    });
    assert.ifError(error);

    const { data, error: readErr } = await supabaseAdmin
      .from('tax_rule_versions')
      .select('id, status')
      .eq('id', versionDraft)
      .maybeSingle();
    assert.ifError(readErr);
    assert.equal(data?.status, 'draft');

    const draftRevise = await supabaseAdmin
      .from('tax_rule_versions')
      .update({ payload_json: { ...k1Payload(), notes: 'draft revise' }, payload_checksum: 'fixture-draft-revise' })
      .eq('id', versionDraft);
    assert.ifError(draftRevise.error);
  });

  await t.test('14) Active version payload update rejected', async () => {
    const { error } = await supabaseAdmin
      .from('tax_rule_versions')
      .update({ payload_json: { ...k1Payload(), notes: 'illegal mutate' } })
      .eq('id', version1);
    assert.ok(error, 'active payload_json update should be rejected');
    assert.match(errText(error), /immutable after leaving draft/i);
  });

  await t.test('15) Active version checksum update rejected', async () => {
    const { error } = await supabaseAdmin
      .from('tax_rule_versions')
      .update({ payload_checksum: 'tampered' })
      .eq('id', version1);
    assert.ok(error, 'active payload_checksum update should be rejected');
    assert.match(errText(error), /immutable after leaving draft/i);
  });

  await t.test('16) Active version pack/ruleset update rejected', async () => {
    const packErr = await supabaseAdmin
      .from('tax_rule_versions')
      .update({ country_pack_id: packUs, country_pack_ruleset_id: rulesetUs, country_code: 'US' })
      .eq('id', version1);
    assert.ok(packErr.error, 'active pack/ruleset update should be rejected');
  });

  await t.test('17) DELETE tax_source rejected', async () => {
    const { error } = await supabaseAdmin.from('tax_sources').delete().eq('id', sourceA);
    assert.ok(error, 'tax_sources delete should be rejected');
    assert.match(errText(error), /Hard delete is forbidden/i);
  });

  await t.test('18) DELETE tax_rule rejected', async () => {
    const { error } = await supabaseAdmin.from('tax_rules').delete().eq('id', ruleUs);
    assert.ok(error, 'tax_rules delete should be rejected');
    assert.match(errText(error), /Hard delete is forbidden/i);
  });

  await t.test('19) DELETE tax_rule_version rejected', async () => {
    const { error } = await supabaseAdmin.from('tax_rule_versions').delete().eq('id', versionDraft);
    assert.ok(error, 'tax_rule_versions delete should be rejected');
    assert.match(errText(error), /Hard delete is forbidden/i);
  });

  await t.test('20) No tenant RLS policy exposes the tables', async (st) => {
    assert.doesNotMatch(migrationSql, /^\s*create policy\b/im);
    assert.match(migrationSql, /revoke all on table public\.tax_sources from anon, authenticated/);

    const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
    const url = process.env.SUPABASE_URL?.trim();
    if (!anonKey || !url) {
      st.skip('SUPABASE_ANON_KEY not configured; anon RLS denial not proven');
      return;
    }
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    for (const table of ['tax_sources', 'tax_rules', 'tax_rule_versions'] as const) {
      const { error } = await anon.from(table).select('id').limit(1);
      assert.ok(error, `${table} must not be readable with anon key`);
    }
  });

  await t.test('21) Same-day overlap rejected; next-day adjacent accepted', async () => {
    const ruleId = randomUUID();
    const { error: ruleErr } = await supabaseAdmin.from('tax_rules').insert({
      id: ruleId,
      country_code: 'IL',
      rule_code: `${marker}_overlap`,
      title: 'Overlap rule',
      rule_kind: 'legal_rule',
      status: 'draft',
    });
    assert.ifError(ruleErr);

    const v1Id = randomUUID();
    const sameDayId = randomUUID();
    const nextDayId = randomUUID();
    assert.ifError(
      (
        await insertDraftVersion(supabaseAdmin, {
          id: v1Id,
          tax_rule_id: ruleId,
          country_code: 'IL',
          country_pack_id: packIl,
          country_pack_ruleset_id: rulesetIl,
          version_no: 1,
          effective_from: '2026-01-01',
          effective_to: '2026-12-31',
          payload_json: k1Payload(),
          payload_checksum: 'fixture-not-canonical',
        })
      ).error,
    );
    assert.ifError((await activateVersion(supabaseAdmin, v1Id)).error);

    assert.ifError(
      (
        await insertDraftVersion(supabaseAdmin, {
          id: sameDayId,
          tax_rule_id: ruleId,
          country_code: 'IL',
          country_pack_id: packIl,
          country_pack_ruleset_id: rulesetIl,
          version_no: 2,
          effective_from: '2026-12-31',
          effective_to: '2027-06-01',
          payload_json: k1Payload(),
          payload_checksum: 'fixture-not-canonical',
        })
      ).error,
    );
    const sameDay = await activateVersion(supabaseAdmin, sameDayId);
    assert.ok(sameDay.error, 'same-day overlap must be rejected');

    assert.ifError(
      (
        await insertDraftVersion(supabaseAdmin, {
          id: nextDayId,
          tax_rule_id: ruleId,
          country_code: 'IL',
          country_pack_id: packIl,
          country_pack_ruleset_id: rulesetIl,
          version_no: 3,
          effective_from: '2027-01-01',
          effective_to: '2027-12-31',
          payload_json: k1Payload(),
          payload_checksum: 'fixture-not-canonical',
        })
      ).error,
    );
    assert.ifError((await activateVersion(supabaseAdmin, nextDayId)).error);
  });

  await t.test('22) TRUNCATE blocked on all three tables', async (st) => {
    const dbUrl =
      process.env.DATABASE_URL?.trim() ||
      process.env.SUPABASE_DB_URL?.trim() ||
      process.env.DIRECT_URL?.trim();
    if (!dbUrl) {
      st.skip('DATABASE_URL / SUPABASE_DB_URL not configured; TRUNCATE not proven live');
      return;
    }
    const pg = await import('pg');
    const ClientCtor = (pg as { Client?: typeof import('pg').Client; default?: { Client?: typeof import('pg').Client } }).Client
      ?? (pg as { default?: { Client?: typeof import('pg').Client } }).default?.Client;
    if (!ClientCtor) {
      st.skip('pg.Client unavailable; TRUNCATE not proven live');
      return;
    }
    const client = new ClientCtor({ connectionString: dbUrl });
    await client.connect();
    try {
      for (const table of ['tax_sources', 'tax_rules', 'tax_rule_versions']) {
        let failed = false;
        try {
          await client.query(`truncate table public.${table}`);
        } catch (error) {
          failed = true;
          assert.match(String(error), /Hard delete is forbidden/i);
        }
        assert.ok(failed, `TRUNCATE ${table} must be blocked`);
      }
    } finally {
      await client.end();
    }
  });

  await t.test('23) Status reactivation and return-to-draft rejected', async () => {
    const ruleId = randomUUID();
    const vActive = randomUUID();
    const vRetired = randomUUID();
    const { error: ruleErr } = await supabaseAdmin.from('tax_rules').insert({
      id: ruleId,
      country_code: 'IL',
      rule_code: `${marker}_lifecycle`,
      title: 'Lifecycle rule',
      rule_kind: 'legal_rule',
      status: 'draft',
    });
    assert.ifError(ruleErr);

    const insActive = await insertDraftVersion(supabaseAdmin, {
      id: vActive,
      tax_rule_id: ruleId,
      country_code: 'IL',
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      version_no: 1,
      effective_from: '2020-01-01',
      effective_to: '2020-12-31',
      payload_json: k1Payload(),
      payload_checksum: 'fixture-not-canonical',
    });
    assert.ifError(insActive.error);
    assert.ifError((await activateVersion(supabaseAdmin, vActive)).error);

    const toDraft = await supabaseAdmin.from('tax_rule_versions').update({ status: 'draft' }).eq('id', vActive);
    assert.ok(toDraft.error, 'active → draft must be rejected');
    assert.match(errText(toDraft.error), /status transition/i);

    const toSuperseded = await supabaseAdmin
      .from('tax_rule_versions')
      .update({ status: 'superseded' })
      .eq('id', vActive);
    assert.ifError(toSuperseded.error);

    const supersededToActive = await supabaseAdmin
      .from('tax_rule_versions')
      .update({ status: 'active' })
      .eq('id', vActive);
    assert.ok(supersededToActive.error, 'superseded → active must be rejected');
    assert.match(errText(supersededToActive.error), /status transition/i);

    const insRetired = await insertDraftVersion(supabaseAdmin, {
      id: vRetired,
      tax_rule_id: ruleId,
      country_code: 'IL',
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      version_no: 2,
      effective_from: '2021-01-01',
      payload_json: k1Payload(),
      payload_checksum: 'fixture-not-canonical',
    });
    assert.ifError(insRetired.error);
    assert.ifError((await retireVersion(supabaseAdmin, vRetired)).error);

    const retiredToActive = await supabaseAdmin
      .from('tax_rule_versions')
      .update({ status: 'active' })
      .eq('id', vRetired);
    assert.ok(retiredToActive.error, 'retired → active must be rejected');
    assert.match(errText(retiredToActive.error), /status transition/i);
  });

  await t.test('24) effective_to close-out and freeze rules', async () => {
    const ruleId = randomUUID();
    const vOpen = randomUUID();
    const vRetired = randomUUID();
    const { error: ruleErr } = await supabaseAdmin.from('tax_rules').insert({
      id: ruleId,
      country_code: 'IL',
      rule_code: `${marker}_effto`,
      title: 'Effective-to rule',
      rule_kind: 'legal_rule',
      status: 'draft',
    });
    assert.ifError(ruleErr);

    const insOpen = await insertDraftVersion(supabaseAdmin, {
      id: vOpen,
      tax_rule_id: ruleId,
      country_code: 'IL',
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      version_no: 1,
      effective_from: '2020-01-01',
      effective_to: null,
      payload_json: k1Payload(),
      payload_checksum: 'fixture-not-canonical',
    });
    assert.ifError(insOpen.error);
    assert.ifError((await activateVersion(supabaseAdmin, vOpen)).error);

    const close = await supabaseAdmin
      .from('tax_rule_versions')
      .update({ effective_to: '2020-12-31' })
      .eq('id', vOpen);
    assert.ifError(close.error);

    const earlier = await supabaseAdmin
      .from('tax_rule_versions')
      .update({ effective_to: '2020-06-01' })
      .eq('id', vOpen);
    assert.ifError(earlier.error);

    const later = await supabaseAdmin
      .from('tax_rule_versions')
      .update({ effective_to: '2020-09-01' })
      .eq('id', vOpen);
    assert.ok(later.error, 'active close date → later date must be rejected');
    assert.match(errText(later.error), /cannot be extended/i);

    const clear = await supabaseAdmin
      .from('tax_rule_versions')
      .update({ effective_to: null })
      .eq('id', vOpen);
    assert.ok(clear.error, 'active date → NULL must be rejected');
    assert.match(errText(clear.error), /cannot be cleared/i);

    const supersede = await supabaseAdmin
      .from('tax_rule_versions')
      .update({ status: 'superseded' })
      .eq('id', vOpen);
    assert.ifError(supersede.error);

    const supersededMut = await supabaseAdmin
      .from('tax_rule_versions')
      .update({ effective_to: '2020-01-15' })
      .eq('id', vOpen);
    assert.ok(supersededMut.error, 'superseded effective_to change must be rejected');
    assert.match(errText(supersededMut.error), /frozen after supersession\/retirement/i);

    const insRetired = await insertDraftVersion(supabaseAdmin, {
      id: vRetired,
      tax_rule_id: ruleId,
      country_code: 'IL',
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      version_no: 2,
      effective_from: '2021-01-01',
      effective_to: '2021-12-31',
      payload_json: k1Payload(),
      payload_checksum: 'fixture-not-canonical',
    });
    assert.ifError(insRetired.error);
    assert.ifError((await retireVersion(supabaseAdmin, vRetired)).error);

    const retiredMut = await supabaseAdmin
      .from('tax_rule_versions')
      .update({ effective_to: '2021-06-01' })
      .eq('id', vRetired);
    assert.ok(retiredMut.error, 'retired effective_to change must be rejected');
    assert.match(errText(retiredMut.error), /frozen after supersession\/retirement/i);
  });

  await t.test('25) Self-supersession and A→B / B→A / 3-node cycles rejected', async () => {
    const ruleId = randomUUID();
    const a = randomUUID();
    const b = randomUUID();
    const c = randomUUID();
    const { error: ruleErr } = await supabaseAdmin.from('tax_rules').insert({
      id: ruleId,
      country_code: 'IL',
      rule_code: `${marker}_cycle`,
      title: 'Cycle rule',
      rule_kind: 'legal_rule',
      status: 'draft',
    });
    assert.ifError(ruleErr);

    const insA = await supabaseAdmin.from('tax_rule_versions').insert({
      id: a,
      tax_rule_id: ruleId,
      country_code: 'IL',
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      version_no: 1,
      status: 'draft',
      effective_from: '2020-01-01',
      payload_json: k1Payload(),
      payload_checksum: 'fixture-not-canonical',
    });
    assert.ifError(insA.error);

    const selfSupersedes = await supabaseAdmin
      .from('tax_rule_versions')
      .update({ supersedes_version_id: a })
      .eq('id', a);
    assert.ok(selfSupersedes.error, 'self supersedes must be rejected');

    const selfSupersededBy = await supabaseAdmin
      .from('tax_rule_versions')
      .update({ superseded_by_version_id: a })
      .eq('id', a);
    assert.ok(selfSupersededBy.error, 'self superseded_by must be rejected');

    const insB = await supabaseAdmin.from('tax_rule_versions').insert({
      id: b,
      tax_rule_id: ruleId,
      country_code: 'IL',
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      version_no: 2,
      status: 'draft',
      effective_from: '2021-01-01',
      supersedes_version_id: a,
      payload_json: k1Payload(),
      payload_checksum: 'fixture-not-canonical',
    });
    assert.ifError(insB.error);

    const twoCycle = await supabaseAdmin
      .from('tax_rule_versions')
      .update({ supersedes_version_id: b })
      .eq('id', a);
    assert.ok(twoCycle.error, 'A→B and B→A must be rejected');
    assert.match(errText(twoCycle.error), /Circular tax rule supersession/i);

    const insC = await supabaseAdmin.from('tax_rule_versions').insert({
      id: c,
      tax_rule_id: ruleId,
      country_code: 'IL',
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      version_no: 3,
      status: 'draft',
      effective_from: '2022-01-01',
      supersedes_version_id: b,
      payload_json: k1Payload(),
      payload_checksum: 'fixture-not-canonical',
    });
    assert.ifError(insC.error);

    const threeCycle = await supabaseAdmin
      .from('tax_rule_versions')
      .update({ supersedes_version_id: c })
      .eq('id', a);
    assert.ok(threeCycle.error, '3-node cycle must be rejected');
    assert.match(errText(threeCycle.error), /Circular tax rule supersession/i);
  });

  await t.test('26) created_at and source country_code are immutable', async () => {
    const stamped = '2000-01-01T00:00:00.000Z';
    const srcMut = await supabaseAdmin.from('tax_sources').update({ created_at: stamped }).eq('id', sourceA);
    assert.ok(srcMut.error, 'tax_sources.created_at must be immutable');
    assert.match(errText(srcMut.error), /created_at is immutable/i);

    const srcCountry = await supabaseAdmin.from('tax_sources').update({ country_code: 'US' }).eq('id', sourceA);
    assert.ok(srcCountry.error, 'tax_sources.country_code must be immutable');
    assert.match(errText(srcCountry.error), /country_code is immutable/i);

    const ruleMut = await supabaseAdmin.from('tax_rules').update({ created_at: stamped }).eq('id', ruleIl);
    assert.ok(ruleMut.error, 'tax_rules.created_at must be immutable');
    assert.match(errText(ruleMut.error), /created_at is immutable/i);

    const verMut = await supabaseAdmin.from('tax_rule_versions').update({ created_at: stamped }).eq('id', version1);
    assert.ok(verMut.error, 'tax_rule_versions.created_at must be immutable');
    assert.match(errText(verMut.error), /created_at is immutable/i);
  });

  await t.test('27) INSERT allowed only as draft', async () => {
    const ruleId = randomUUID();
    assert.ifError(
      (
        await supabaseAdmin.from('tax_rules').insert({
          id: ruleId,
          country_code: 'IL',
          rule_code: `${marker}_insert_status`,
          title: 'Insert status rule',
          rule_kind: 'legal_rule',
          status: 'draft',
        })
      ).error,
    );

    const base = {
      tax_rule_id: ruleId,
      country_code: 'IL',
      country_pack_id: packIl,
      country_pack_ruleset_id: rulesetIl,
      version_no: 1,
      effective_from: '2020-01-01',
      payload_json: k1Payload(),
      payload_checksum: 'fixture-not-canonical',
    };

    const draftOk = await supabaseAdmin.from('tax_rule_versions').insert({
      id: randomUUID(),
      ...base,
      status: 'draft',
    });
    assert.ifError(draftOk.error);

    for (const status of ['active', 'superseded', 'retired'] as const) {
      const rejected = await supabaseAdmin.from('tax_rule_versions').insert({
        id: randomUUID(),
        ...base,
        version_no: 2,
        status,
      });
      assert.ok(rejected.error, `INSERT ${status} must be rejected`);
      assert.match(errText(rejected.error), /must be inserted as draft/i);
    }
  });
});

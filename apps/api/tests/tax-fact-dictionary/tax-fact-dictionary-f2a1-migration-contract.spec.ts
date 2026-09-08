import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const migrationRel = 'supabase/migrations/613_tax_fact_dictionary_foundation.sql';
const sql = readFileSync(join(repoRoot, migrationRel), 'utf8');

const TABLES = [
  'tax_fact_definitions',
  'tax_fact_definition_versions',
  'tax_fact_enum_options',
  'tax_fact_presentations',
] as const;

const FROZEN_MIGRATIONS = [
  'supabase/migrations/600_tax_knowledge_core_foundation.sql',
  'supabase/migrations/601_tax_knowledge_provenance_links.sql',
  'supabase/migrations/602_tax_knowledge_publication_guard.sql',
  'supabase/migrations/603_tax_knowledge_rule_relationships.sql',
  'supabase/migrations/604_tax_knowledge_relationship_publication_guard.sql',
  'supabase/migrations/605_tax_knowledge_atomic_supersession.sql',
  'supabase/migrations/606_tax_knowledge_service_role_dml.sql',
  'supabase/migrations/607_tax_knowledge_legal_links_unresolved.sql',
  'supabase/migrations/608_tax_calculation_engine_foundation.sql',
  'supabase/migrations/609_tax_calculation_engine_privilege_hardening.sql',
  'supabase/migrations/610_tax_calculation_engine_runtime_dependency_privileges.sql',
  'supabase/migrations/611_country_pack_legal_value_versions_privilege_hardening.sql',
  'supabase/migrations/612_tax_strategy_engine_foundation.sql',
] as const;

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const after = sql.indexOf('create or replace function public.', start + 1);
  const end = after >= 0 ? after : sql.length;
  return sql.slice(start, end);
}

function tableBlock(table: string, nextTable?: string): string {
  const start = sql.indexOf(`create table if not exists public.${table}`);
  assert.ok(start >= 0, `${table} must exist`);
  const end = nextTable
    ? sql.indexOf(`create table if not exists public.${nextTable}`)
    : sql.indexOf('-- 5) RLS + privilege hardening');
  assert.ok(end > start, `${table} block must be bounded`);
  return sql.slice(start, end);
}

function gitDiff(rel: string): string {
  return execSync(`git diff -- ${rel}`, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

test('TAX-F2A1 1: migration is exactly 613 and creates the four Fact Dictionary tables', () => {
  assert.equal(existsSync(join(repoRoot, migrationRel)), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/613_tax_strategy_engine_foundation.sql')), false);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/613_tax_advisory_case_foundation.sql')), false);
  for (const table of TABLES) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.equal((sql.match(/create table if not exists public\.tax_fact_/g) ?? []).length, 4);
});

test('TAX-F2A1 2: no org/client/case columns and no Tax Advisory/K3/K4/Strategy tables', () => {
  assert.doesNotMatch(sql, /organization_id\s+(uuid|text)/i);
  assert.doesNotMatch(sql, /client_id\s+(uuid|text)/i);
  assert.doesNotMatch(sql, /case_id\s+(uuid|text)/i);
  assert.doesNotMatch(sql, /create table if not exists public\.tax_advisory/);
  assert.doesNotMatch(sql, /create table if not exists public\.business_setup/);
  assert.doesNotMatch(sql, /create table if not exists public\.tax_rule/);
  assert.doesNotMatch(sql, /create table if not exists public\.tax_calculation/);
  assert.doesNotMatch(sql, /create table if not exists public\.tax_strateg/);
  assert.doesNotMatch(sql, /create table if not exists public\.country_legal_values/);
});

test('TAX-F2A1 3: global uniqueness handles NULL; country uniqueness is per country', () => {
  assert.match(sql, /uq_tax_fact_definitions_global_fact_key/);
  assert.match(sql, /on public\.tax_fact_definitions \(fact_key\)\s+where country_code is null/i);
  assert.match(sql, /uq_tax_fact_definitions_country_fact_key/);
  assert.match(
    sql,
    /on public\.tax_fact_definitions \(country_code, fact_key\)\s+where country_code is not null/i,
  );
  assert.match(sql, /ordinary UNIQUE\(country_code, fact_key\) would allow duplicate globals/);
  const namespace = functionBody('tax_fact_definitions_guard_key_namespace');
  assert.match(namespace, /global fact_key must not collide with a country-scoped fact_key/);
  assert.match(namespace, /country-scoped fact_key must not collide with a global fact_key/);
});

test('TAX-F2A1 3b: namespace guard locks fact_key before the cross-kind SELECT', () => {
  const namespace = functionBody('tax_fact_definitions_guard_key_namespace');
  const lockAt = namespace.indexOf('pg_advisory_xact_lock(613, hashtext(new.fact_key))');
  const globalCheckAt = namespace.indexOf('global fact_key must not collide with a country-scoped fact_key');
  const countryCheckAt = namespace.indexOf('country-scoped fact_key must not collide with a global fact_key');
  assert.ok(lockAt >= 0, 'transaction advisory lock must exist');
  assert.ok(globalCheckAt > lockAt, 'global-vs-country SELECT must run after the lock');
  assert.ok(countryCheckAt > lockAt, 'country-vs-global SELECT must run after the lock');
  assert.match(namespace, /hashtext\(new\.fact_key\)/);
  assert.doesNotMatch(namespace, /pg_advisory_lock\(/);
  assert.doesNotMatch(sql, /create unique index[^;]*on public\.tax_fact_definitions \(fact_key\)\s*;/i);
  assert.match(sql, /uq_tax_fact_definitions_global_fact_key/);
  assert.match(sql, /uq_tax_fact_definitions_country_fact_key/);
  assert.match(sql, /Same fact_key in two countries remains legal/);
});

test('TAX-F2A1 4/5: snake_case enforcement and evaluation_as_of reserved', () => {
  const identity = tableBlock('tax_fact_definitions', 'tax_fact_definition_versions');
  assert.match(identity, /check \(public\.tax_fact_key_is_snake_case\(fact_key\)\)/);
  assert.match(identity, /check \(fact_key <> 'evaluation_as_of'\)/);
  const keyFn = functionBody('tax_fact_key_is_snake_case');
  assert.match(keyFn, /\^\[a-z\]\[a-z0-9\]\*\(_\[a-z0-9\]\+\)\*\$/);
  assert.match(sql, /evaluation_as_of is reserved/);
});

test('TAX-F2A1 6: allowed value types are exactly the K4 set', () => {
  const versions = tableBlock('tax_fact_definition_versions', 'tax_fact_enum_options');
  const typeCheckStart = versions.indexOf('value_type text not null check (');
  const typeCheckEnd = versions.indexOf('),', typeCheckStart);
  const typeCheck = versions.slice(typeCheckStart, typeCheckEnd);
  assert.match(typeCheck, /value_type text not null check \(/);
  for (const valueType of [
    'boolean',
    'integer',
    'decimal',
    'money',
    'percentage',
    'date',
    'enum',
    'string',
  ]) {
    assert.match(typeCheck, new RegExp(`'${valueType}'`));
  }
  assert.doesNotMatch(typeCheck, /string_list|enum_list/);
  assert.doesNotMatch(typeCheck, /'json'/);
  assert.match(sql, /No string_list, enum_list, or json in v1/);
});

test('TAX-F2A1 7: identity and versions insert draft only; monotonic version_no', () => {
  assert.match(sql, /tax_fact_definitions must be inserted as draft/);
  assert.match(sql, /tax_fact_definition_versions must be inserted as draft/);
  assert.match(sql, /check \(version_no >= 1\)/);
  assert.match(sql, /uq_tax_fact_definition_versions_def_no/);
  assert.match(sql, /version_no must be monotonic per definition/);
});

test('TAX-F2A1 8: semantic payload frozen after publication; checksum stored not hashed', () => {
  const immut = functionBody('tax_fact_definition_versions_protect_immutability');
  assert.match(immut, /semantic fields are immutable after leaving draft/);
  assert.match(immut, /old\.value_type is distinct from new\.value_type/);
  assert.match(immut, /old\.unit_code is distinct from new\.unit_code/);
  assert.match(immut, /old\.currency_policy is distinct from new\.currency_policy/);
  assert.match(immut, /old\.validation_json is distinct from new\.validation_json/);
  assert.match(immut, /old\.definition_checksum is distinct from new\.definition_checksum/);
  assert.match(immut, /old\.effective_from is distinct from new\.effective_from/);
  assert.match(sql, /definition_checksum text not null/);
  assert.match(sql, /SQL stores\/freezes it and does not compute or digest it/);
  assert.doesNotMatch(sql, /digest\s*\(|encode\s*\(\s*digest|sha256\s*\(/i);
  assert.doesNotMatch(sql, /create or replace function public\.canonicalTaxFact/i);
});

test('TAX-F2A1 9: presentation is excluded from semantic checksum and stays editable', () => {
  const versions = tableBlock('tax_fact_definition_versions', 'tax_fact_enum_options');
  assert.doesNotMatch(versions, /\blabel\b|\bprofessional_question\b|\blocale\b|\baliases\b/);
  assert.match(sql, /Excluded from definition_checksum/);
  assert.match(sql, /Presentation\/i18n is excluded/);
  assert.match(sql, /Editable without a new definition version/);
  const presentations = tableBlock('tax_fact_presentations');
  assert.doesNotMatch(presentations, /tax_fact_presentations_forbid_delete/);
  assert.match(presentations, /tax_fact_presentations_forbid_truncate/);
  assert.match(presentations, /professional_question text not null/);
  assert.match(presentations, /client_question text null/);
  assert.match(presentations, /help_text text null/);
  assert.match(presentations, /aliases jsonb not null default '\[\]'::jsonb/);
  assert.match(presentations, /enum_option_labels jsonb not null default '\{\}'::jsonb/);
  assert.match(sql, /do not need a fifth table/);
});

test('TAX-F2A1 10: enum options only on enum versions; frozen after parent publication', () => {
  const enumTable = tableBlock('tax_fact_enum_options', 'tax_fact_presentations');
  assert.match(enumTable, /check \(public\.tax_fact_key_is_snake_case\(code\)\)/);
  assert.match(sql, /uq_tax_fact_enum_options_version_code/);
  assert.match(sql, /tax_fact_enum_options are only valid on value_type = enum versions/);
  const draftGuard = functionBody('tax_fact_enum_options_requires_parent_draft');
  assert.match(draftGuard, /if tg_op = 'DELETE' then/);
  assert.match(draftGuard, /tax_fact_enum_options are immutable after the parent version leaves draft/);
  assert.doesNotMatch(enumTable, /tax_fact_enum_options_forbid_delete/);
  assert.match(sql, /Labels\/translations live on presentations, not here/);
});

test('TAX-F2A1 11: GiST no overlapping active windows; effective_to close-out is narrow-only', () => {
  assert.match(sql, /tax_fact_definition_versions_no_active_overlap/);
  assert.match(sql, /exclude using gist/);
  assert.match(sql, /daterange\(effective_from, coalesce\(effective_to, 'infinity'::date\), '\[\]'\) with &&/);
  assert.match(sql, /where \(status = 'active'\)/);
  const immut = functionBody('tax_fact_definition_versions_protect_immutability');
  assert.match(immut, /effective_to cannot be cleared after close-out/);
  assert.match(immut, /effective_to cannot be extended after leaving draft/);
  assert.match(immut, /effective_to is frozen after retirement/);
});

test('TAX-F2A1 12: lifecycle transitions guarded; no retired→active; no identity supersession', () => {
  const identity = functionBody('tax_fact_definitions_protect_identity');
  assert.match(identity, /old\.status = 'draft' and new\.status in \('active', 'retired'\)/);
  assert.match(identity, /old\.status = 'active' and new\.status = 'retired'/);
  assert.doesNotMatch(identity, /old\.status = 'retired' and new\.status = 'active'/);
  assert.match(identity, /fact_key is immutable/);
  assert.match(identity, /country_code is immutable/);
  const versions = functionBody('tax_fact_definition_versions_protect_immutability');
  assert.match(versions, /old\.status = 'draft' and new\.status in \('active', 'retired'\)/);
  assert.match(versions, /old\.status = 'active' and new\.status = 'retired'/);
  assert.doesNotMatch(versions, /old\.status = 'retired' and new\.status = 'active'/);
  assert.doesNotMatch(sql, /supersedes_version_id|superseded_by_version_id/);
  assert.match(sql, /No identity-level supersession/);
});

test('TAX-F2A1 13: FORCE RLS, no policies, public/anon/authenticated revoked, exact service_role', () => {
  assert.doesNotMatch(sql, /grant\s+all\b/i);
  assert.doesNotMatch(sql, /grant\s+truncate\b/i);
  assert.doesNotMatch(sql, /create policy/i);
  for (const table of TABLES) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(sql, new RegExp(`alter table public\\.${table} force row level security;`));
    assert.match(
      sql,
      new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated, service_role;`),
    );
  }
  assert.match(
    sql,
    /grant select, insert, update, delete on table[\s\S]*tax_fact_definitions[\s\S]*tax_fact_presentations[\s\S]*to service_role;/,
  );
  assert.doesNotMatch(sql, /grant[^;]*\bto\s+anon\b/i);
  assert.doesNotMatch(sql, /grant[^;]*\bto\s+authenticated\b/i);
});

test('TAX-F2A1 14: no TRUNCATE; identities/versions never deleted; draft enum DELETE allowed', () => {
  assert.match(sql, /tax_fact_definitions_forbid_delete/);
  assert.match(sql, /tax_fact_definition_versions_forbid_delete/);
  assert.match(sql, /tax_fact_definitions_forbid_truncate/);
  assert.match(sql, /tax_fact_definition_versions_forbid_truncate/);
  assert.match(sql, /tax_fact_enum_options_forbid_truncate/);
  assert.match(sql, /tax_fact_presentations_forbid_truncate/);
  assert.match(sql, /Hard delete is forbidden for tax fact dictionary table/);
  assert.match(sql, /TRUNCATE is forbidden for tax fact dictionary table/);
  assert.match(sql, /before insert or update or delete on public\.tax_fact_enum_options/);
});

test('TAX-F2A1 15: migrations 600–612 untouched; 613 does not alter them or integrate engines', () => {
  for (const file of FROZEN_MIGRATIONS) {
    assert.equal(existsSync(join(repoRoot, file)), true, `${file} must exist`);
    assert.equal(gitDiff(file), '', `${file} must remain unchanged`);
  }
  assert.doesNotMatch(sql, /alter table public\.tax_rules/);
  assert.doesNotMatch(sql, /alter table public\.tax_rule_versions/);
  assert.doesNotMatch(sql, /alter table public\.tax_calculation/);
  assert.doesNotMatch(sql, /alter table public\.tax_strateg/);
  assert.doesNotMatch(sql, /evaluate_tax_rules|evaluateTaxRules|evaluateAppliesIf/);
  assert.doesNotMatch(sql, /calculate_tax|evaluateTaxCalculation|runCalculateTax/);
  assert.doesNotMatch(sql, /evaluateTaxStrategies|create_tax_strategy/);
  assert.doesNotMatch(sql, /owner_legal_control_panel_aggregate/);
  assert.doesNotMatch(sql, /latest_version|resolveLatest|resolve_latest/i);
});

test('TAX-F2A1 16: locale normalized; identity country FK; money currency_policy only', () => {
  const presentations = tableBlock('tax_fact_presentations');
  assert.match(presentations, /locale = lower\(locale\) and locale ~ '\^\[a-z\]\{2\}\(-\[a-z\]\{2\}\)\?\$'/);
  assert.match(sql, /new\.locale := lower\(btrim\(new\.locale\)\)/);
  assert.match(sql, /country_code char\(2\) null references public\.countries\(code\) on delete restrict/);
  const currency = functionBody('tax_fact_currency_policy_is_canonical');
  assert.match(currency, /p_value_type is distinct from 'money' then p is null/);
  assert.match(currency, /p \? 'required'/);
  assert.match(sql, /Non-money facts must store currency_policy NULL/);
});

test('TAX-F2A1 17: publication requires active identity and enum options; no K3/K4 call', () => {
  const publication = functionBody('tax_fact_definition_versions_guard_publication');
  assert.match(publication, /cannot activate unless the fact identity is active/);
  assert.match(publication, /cannot activate an enum without at least one enum option/);
  assert.match(publication, /cannot activate a non-enum version that has enum options/);
  assert.match(publication, /Does not hash checksums\. Does not call K3\/K4\/Strategy/);
  assert.doesNotMatch(publication, /evaluate_tax_rules|calculate_tax|tax_strategies/);
});

test('TAX-F2A1 18: Tax Brain 613 remains foundation; later files are not 613 edits', () => {
  const taxBrain = readdirSync(join(repoRoot, 'supabase/migrations'))
    .filter((name) => /^\d{3}_.+\.sql$/.test(name) && Number(name.slice(0, 3)) >= 600 && Number(name.slice(0, 3)) <= 699)
    .sort();
  assert.ok(taxBrain.includes('612_tax_strategy_engine_foundation.sql'));
  assert.ok(taxBrain.includes('613_tax_fact_dictionary_foundation.sql'));
  const after613 = taxBrain.filter((name) => Number(name.slice(0, 3)) > 613);
  assert.equal(
    after613.filter((name) => name.includes('613_tax_fact_dictionary_foundation')).length,
    0,
  );
  const changedTracked = execSync('git diff --name-only -- supabase/migrations', {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((name) => !name.includes('614_tax_fact_dictionary_atomic_activation.sql'));
  assert.deepEqual(changedTracked, [], 'tracked Tax Brain migrations 600–613 must not be edited');
});

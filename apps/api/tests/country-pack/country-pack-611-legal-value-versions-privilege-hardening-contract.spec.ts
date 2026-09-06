import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const migration086Rel = 'supabase/migrations/086_country_pack_foundation_schema.sql';
const migration163Rel = 'supabase/migrations/163_country_pack_service_role_dml.sql';
const migration608Rel = 'supabase/migrations/608_tax_calculation_engine_foundation.sql';
const migration609Rel = 'supabase/migrations/609_tax_calculation_engine_privilege_hardening.sql';
const migration610Rel = 'supabase/migrations/610_tax_calculation_engine_runtime_dependency_privileges.sql';
const migration611Rel = 'supabase/migrations/611_country_pack_legal_value_versions_privilege_hardening.sql';

const sql086 = readFileSync(join(repoRoot, migration086Rel), 'utf8');
const sql163 = readFileSync(join(repoRoot, migration163Rel), 'utf8');
const sql608 = readFileSync(join(repoRoot, migration608Rel), 'utf8');
const sql609 = readFileSync(join(repoRoot, migration609Rel), 'utf8');
const sql610 = readFileSync(join(repoRoot, migration610Rel), 'utf8');
const sql611Raw = readFileSync(join(repoRoot, migration611Rel), 'utf8');
const sql611 = sql611Raw.replace(/--[^\n]*/g, '');

const OTHER_TABLES = [
  'public.countries',
  'public.country_packs',
  'public.country_pack_rulesets',
  'public.country_legal_values',
  'public.tax_calculation_definitions',
  'public.tax_calculation_runs',
];

test('CP 611: migration exists; 086, 163, 608, 609, 610 remain separate files', () => {
  assert.equal(existsSync(join(repoRoot, migration611Rel)), true);
  assert.equal(existsSync(join(repoRoot, migration086Rel)), true);
  assert.equal(existsSync(join(repoRoot, migration163Rel)), true);
  assert.equal(existsSync(join(repoRoot, migration608Rel)), true);
  assert.equal(existsSync(join(repoRoot, migration609Rel)), true);
  assert.equal(existsSync(join(repoRoot, migration610Rel)), true);
  assert.match(sql086, /create table if not exists public\.country_legal_value_versions/);
  assert.match(sql163, /Does not grant tenant roles, change RLS, or touch country_legal_value_versions/);
  assert.match(sql610, /grant select on table public\.country_legal_value_versions to service_role;/);
  assert.doesNotMatch(sql086, /revoke all on table public\.country_legal_value_versions/);
  assert.doesNotMatch(sql163, /revoke all on table public\.country_legal_value_versions/);
  assert.doesNotMatch(sql608, /revoke all on table public\.country_legal_value_versions/);
  assert.doesNotMatch(sql609, /revoke all on table public\.country_legal_value_versions/);
  assert.doesNotMatch(sql610, /revoke all on table public\.country_legal_value_versions/);
  assert.doesNotMatch(sql610, /grant select, insert, update on table public\.country_legal_value_versions/);
});

test('CP 611: touches only country_legal_value_versions; REVOKE ALL then exact SELECT/INSERT/UPDATE', () => {
  assert.match(
    sql611,
    /revoke all on table public\.country_legal_value_versions\s+from public, anon, authenticated, service_role;/,
  );
  assert.match(
    sql611,
    /grant select, insert, update on table public\.country_legal_value_versions\s+to service_role;/,
  );
  assert.equal((sql611.match(/revoke all on table/gi) ?? []).length, 1);
  assert.equal((sql611.match(/grant\s+/gi) ?? []).length, 1);
  for (const table of OTHER_TABLES) {
    assert.doesNotMatch(sql611, new RegExp(table.replace(/\./g, '\\.')));
  }
});

test('CP 611: no DELETE/TRUNCATE/REFERENCES/TRIGGER grants and no public/anon/authenticated grants', () => {
  assert.doesNotMatch(sql611, /grant\s+delete\b/i);
  assert.doesNotMatch(sql611, /grant\s+truncate\b/i);
  assert.doesNotMatch(sql611, /grant\s+references\b/i);
  assert.doesNotMatch(sql611, /grant\s+trigger\b/i);
  assert.doesNotMatch(sql611, /grant\s+all\b/i);
  assert.doesNotMatch(sql611, /\bto\s+anon\b/i);
  assert.doesNotMatch(sql611, /\bto\s+authenticated\b/i);
  assert.doesNotMatch(sql611, /\bto\s+public\b/i);
});

test('CP 611: no RLS, policy, owner, function, or default-privilege changes', () => {
  assert.doesNotMatch(sql611, /row level security/i);
  assert.doesNotMatch(sql611, /create\s+policy/i);
  assert.doesNotMatch(sql611, /drop\s+policy/i);
  assert.doesNotMatch(sql611, /owner to/i);
  assert.doesNotMatch(sql611, /create\s+or\s+replace\s+function/i);
  assert.doesNotMatch(sql611, /drop\s+function/i);
  assert.doesNotMatch(sql611, /alter\s+function/i);
  assert.doesNotMatch(sql611, /alter\s+default\s+privileges/i);
  assert.doesNotMatch(sql611, /create\s+table/i);
  assert.doesNotMatch(sql611, /alter\s+table/i);
  assert.doesNotMatch(sql611, /create\s+trigger/i);
});

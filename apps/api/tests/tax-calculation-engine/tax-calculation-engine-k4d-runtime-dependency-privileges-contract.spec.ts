import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const migration608Rel = 'supabase/migrations/608_tax_calculation_engine_foundation.sql';
const migration609Rel = 'supabase/migrations/609_tax_calculation_engine_privilege_hardening.sql';
const migration610Rel = 'supabase/migrations/610_tax_calculation_engine_runtime_dependency_privileges.sql';
const sql608 = readFileSync(join(repoRoot, migration608Rel), 'utf8');
const sql609 = readFileSync(join(repoRoot, migration609Rel), 'utf8');
const sql610Raw = readFileSync(join(repoRoot, migration610Rel), 'utf8');
const sql610 = sql610Raw.replace(/--[^\n]*/g, '');

const DUPLICATE_163_606_607 = [
  'public.countries',
  'public.country_packs',
  'public.country_pack_rulesets',
  'public.country_legal_values',
  'public.tax_sources',
  'public.tax_rules',
  'public.tax_rule_versions',
  'public.tax_rule_version_sources',
  'public.tax_rule_version_legal_values',
  'public.tax_rule_relationships',
  'public.tax_rule_unresolved_legal_references',
] as const;

test('TAX-K4D 610: migration exists; 608 and 609 remain separate untouched files', () => {
  assert.equal(existsSync(join(repoRoot, migration610Rel)), true);
  assert.equal(existsSync(join(repoRoot, migration608Rel)), true);
  assert.equal(existsSync(join(repoRoot, migration609Rel)), true);
  assert.match(sql608, /create table if not exists public\.tax_calculation_definitions/);
  assert.match(sql608, /create or replace function public\.tax_calculation_persist_run\(/);
  assert.match(sql609, /revoke all on table public\.tax_calculation_definitions from public, anon, authenticated, service_role;/);
  assert.doesNotMatch(sql608, /grant select on table public\.country_legal_value_versions/);
  assert.doesNotMatch(sql609, /grant select on table public\.country_legal_value_versions/);
});

test('TAX-K4D 610: SELECT only on country_legal_value_versions to service_role', () => {
  assert.match(sql610, /grant select on table public\.country_legal_value_versions to service_role;/);
  assert.equal((sql610.match(/grant\s+/gi) ?? []).length, 1);
  assert.doesNotMatch(sql610, /grant\s+insert\b/i);
  assert.doesNotMatch(sql610, /grant\s+update\b/i);
  assert.doesNotMatch(sql610, /grant\s+delete\b/i);
  assert.doesNotMatch(sql610, /grant\s+truncate\b/i);
  assert.doesNotMatch(sql610, /grant\s+references\b/i);
  assert.doesNotMatch(sql610, /grant\s+trigger\b/i);
  assert.doesNotMatch(sql610, /grant\s+all\b/i);
  assert.doesNotMatch(sql610, /grant\s+execute\b/i);
  assert.doesNotMatch(sql610, /\bto\s+anon\b/i);
  assert.doesNotMatch(sql610, /\bto\s+authenticated\b/i);
  assert.doesNotMatch(sql610, /\bto\s+public\b/i);
});

test('TAX-K4D 610: no RLS, policy, owner, function, or default-privilege changes', () => {
  assert.doesNotMatch(sql610, /row level security/i);
  assert.doesNotMatch(sql610, /create\s+policy/i);
  assert.doesNotMatch(sql610, /drop\s+policy/i);
  assert.doesNotMatch(sql610, /owner to/i);
  assert.doesNotMatch(sql610, /create\s+or\s+replace\s+function/i);
  assert.doesNotMatch(sql610, /drop\s+function/i);
  assert.doesNotMatch(sql610, /alter\s+function/i);
  assert.doesNotMatch(sql610, /alter\s+default\s+privileges/i);
  assert.doesNotMatch(sql610, /create\s+table/i);
  assert.doesNotMatch(sql610, /alter\s+table/i);
  assert.doesNotMatch(sql610, /create\s+trigger/i);
});

test('TAX-K4D 610: does not duplicate 163 / 606 / 607 grants', () => {
  for (const table of DUPLICATE_163_606_607) {
    assert.doesNotMatch(sql610, new RegExp(table.replace(/\./g, '\\.')));
  }
});

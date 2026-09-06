import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const migration608Rel = 'supabase/migrations/608_tax_calculation_engine_foundation.sql';
const migration609Rel = 'supabase/migrations/609_tax_calculation_engine_privilege_hardening.sql';
const sql608 = readFileSync(join(repoRoot, migration608Rel), 'utf8');
const sql609Raw = readFileSync(join(repoRoot, migration609Rel), 'utf8');
const sql609 = sql609Raw.replace(/--[^\n]*/g, '');

const TABLES = [
  'tax_calculation_definitions',
  'tax_calculation_definition_versions',
  'tax_calculation_definition_rule_pins',
  'tax_calculation_definition_legal_value_requirements',
  'tax_calculation_runs',
  'tax_calculation_run_rule_pins',
  'tax_calculation_run_legal_value_pins',
  'tax_calculation_run_basis_pins',
] as const;

const DEFINITION_TABLES = TABLES.slice(0, 4);
const RUN_TABLES = TABLES.slice(4);

const REVOKE_FROM = 'from public, anon, authenticated, service_role;';
const RPC_SIG = 'public.tax_calculation_persist_run(jsonb, jsonb, jsonb, jsonb)';

test('TAX-K4D 609: migration exists and 608 remains a separate untouched foundation file', () => {
  assert.equal(existsSync(join(repoRoot, migration609Rel)), true);
  assert.equal(existsSync(join(repoRoot, migration608Rel)), true);
  assert.equal(
    existsSync(join(repoRoot, 'supabase/migrations/609_tax_calculation_engine_foundation.sql')),
    false,
  );
  assert.match(sql608, /create table if not exists public\.tax_calculation_definitions/);
  assert.match(sql608, /create or replace function public\.tax_calculation_persist_run\(/);
  assert.doesNotMatch(sql609, /create table/i);
  assert.doesNotMatch(sql609, /create or replace function/i);
  assert.doesNotMatch(sql609, /drop table/i);
  assert.doesNotMatch(sql609, /drop function/i);
});

test('TAX-K4D 609: all 8 tables REVOKE ALL from public, anon, authenticated, service_role', () => {
  for (const table of TABLES) {
    assert.match(
      sql609,
      new RegExp(
        `revoke all on table public\\.${table} ${REVOKE_FROM.replace(/,/g, ',\\s*')}`,
      ),
    );
  }
  assert.equal((sql609.match(/revoke all on table public\.tax_calculation_/g) ?? []).length, 8);
});

test('TAX-K4D 609: exact definition and run GRANTs; no extra table privileges', () => {
  assert.match(
    sql609,
    /grant select, insert, update, delete on table[\s\S]*tax_calculation_definitions[\s\S]*tax_calculation_definition_legal_value_requirements[\s\S]*to service_role;/,
  );
  assert.match(
    sql609,
    /grant select, insert on table[\s\S]*tax_calculation_runs[\s\S]*tax_calculation_run_basis_pins[\s\S]*to service_role;/,
  );
  for (const table of DEFINITION_TABLES) {
    assert.match(sql609, new RegExp(`public\\.${table}`));
  }
  for (const table of RUN_TABLES) {
    assert.match(sql609, new RegExp(`public\\.${table}`));
  }
  const runGrant = sql609.slice(sql609.indexOf('grant select, insert on table'));
  assert.doesNotMatch(runGrant, /grant select, insert, update/);
  assert.doesNotMatch(runGrant, /grant select, insert, delete/);
});

test('TAX-K4D 609: no GRANT ALL / TRUNCATE / REFERENCES / TRIGGER and no platform privilege rewrite', () => {
  assert.doesNotMatch(sql609, /grant\s+all\b/i);
  assert.doesNotMatch(sql609, /grant\s+truncate\b/i);
  assert.doesNotMatch(sql609, /grant\s+references\b/i);
  assert.doesNotMatch(sql609, /grant\s+trigger\b/i);
  assert.doesNotMatch(sql609, /alter\s+default\s+privileges/i);
  assert.doesNotMatch(sql609, /create\s+policy/i);
  assert.doesNotMatch(sql609, /row level security/i);
  assert.doesNotMatch(sql609, /force row level security/i);
  assert.doesNotMatch(sql609, /enable row level security/i);
  assert.doesNotMatch(sql609, /disable row level security/i);
  assert.doesNotMatch(sql609, /owner to/i);
  assert.doesNotMatch(sql609, /alter\s+table/i);
  assert.doesNotMatch(sql609, /alter\s+function/i);
  assert.doesNotMatch(sql609, /create\s+trigger/i);
  assert.doesNotMatch(sql609, /insert\s+into/i);
  assert.doesNotMatch(sql609, /update\s+public\./i);
  assert.doesNotMatch(sql609, /delete\s+from/i);
});

test('TAX-K4D 609: persist RPC signature, revoke public/anon/authenticated, grant service_role EXECUTE', () => {
  assert.match(
    sql609,
    new RegExp(`revoke all on function ${RPC_SIG.replace(/[()]/g, '\\$&')} from public`),
  );
  assert.match(
    sql609,
    new RegExp(
      `revoke all on function ${RPC_SIG.replace(/[()]/g, '\\$&')} from anon, authenticated`,
    ),
  );
  assert.match(
    sql609,
    new RegExp(`grant execute on function ${RPC_SIG.replace(/[()]/g, '\\$&')} to service_role`),
  );
  assert.doesNotMatch(sql609, /grant execute[^;]*\bto\s+anon\b/i);
  assert.doesNotMatch(sql609, /grant execute[^;]*\bto\s+authenticated\b/i);
  assert.doesNotMatch(sql609, /grant execute[^;]*tax_calculation_persist_run[^;]*\bto\s+public\b/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const migrationRel = 'supabase/migrations/608_tax_calculation_engine_foundation.sql';
const sql = readFileSync(join(repoRoot, migrationRel), 'utf8');

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

function persistBody(): string {
  const start = sql.indexOf('create or replace function public.tax_calculation_persist_run');
  const end = sql.indexOf('comment on function public.tax_calculation_persist_run');
  assert.ok(start >= 0 && end > start, 'persist function block must exist');
  return sql.slice(start, end);
}

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
    : sql.indexOf('-- 9) Atomic persist RPC');
  assert.ok(end > start, `${table} block must be bounded`);
  return sql.slice(start, end);
}

test('TAX-K4D 1/2: migration number/name and exact table families', () => {
  assert.equal(existsSync(join(repoRoot, migrationRel)), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/609_tax_calculation_engine_foundation.sql')), false);
  for (const table of TABLES) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.equal((sql.match(/create table if not exists public\.tax_calculation_/g) ?? []).length, 8);
  assert.doesNotMatch(sql, /tax_calculation_definition_basis/);
  assert.doesNotMatch(sql, /tax_calculation_run_steps/);
});

test('TAX-K4D 3/4/5/12/16: no tenant, category, rule-pin role, or case fields', () => {
  assert.doesNotMatch(sql, /organization_id\s+(uuid|text)/i);
  assert.doesNotMatch(sql, /client_id\s+(uuid|text)/i);
  assert.doesNotMatch(sql, /case_id\s+(uuid|text)/i);
  assert.doesNotMatch(sql, /\bcategory\s+text\b/);
  assert.doesNotMatch(sql, /role\s+text\s+not null check\s*\(\s*role in \('primary'/);
  assert.doesNotMatch(sql, /'primary'\s*\|\s*'supporting'|primary \| supporting/);
});

test('TAX-K4D 8-13: grants, FORCE RLS, no policies, run tables insert-only', () => {
  assert.doesNotMatch(sql, /grant\s+all\b/i);
  assert.doesNotMatch(sql, /grant\s+truncate\b/i);
  assert.doesNotMatch(sql, /create policy/i);
  for (const table of TABLES) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(sql, new RegExp(`alter table public\\.${table} force row level security;`));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated;`));
  }
  assert.match(
    sql,
    /grant select, insert, update, delete on table[\s\S]*tax_calculation_definitions[\s\S]*tax_calculation_definition_legal_value_requirements[\s\S]*to service_role;/,
  );
  assert.match(
    sql,
    /grant select, insert on table[\s\S]*tax_calculation_runs[\s\S]*tax_calculation_run_basis_pins[\s\S]*to service_role;/,
  );
  const runGrant = sql.slice(sql.indexOf('grant select, insert on table'));
  assert.doesNotMatch(runGrant, /grant select, insert, update/);
  assert.doesNotMatch(runGrant, /grant select, insert, delete/);
});

test('TAX-K4D 14-18: definition lifecycle, GiST, no universal rule-pin count', () => {
  assert.match(sql, /tax_calculation_definition_versions must be inserted as draft/);
  assert.match(sql, /tax_calculation_definition_child_requires_parent_draft/);
  assert.match(sql, /semantic fields are immutable after leaving draft/);
  assert.match(sql, /tax_calculation_definition_versions_no_active_overlap/);
  assert.match(sql, /exclude using gist/);
  assert.match(sql, /daterange\(effective_from, coalesce\(effective_to, 'infinity'::date\), '\[\]'\) with &&/);
  assert.match(sql, /where \(status = 'active'\)/);
  assert.match(sql, /if rule pins exist, each referenced tax_rule_version must be active/);
  assert.match(sql, /Does not require any rule pin/);
  assert.doesNotMatch(sql, /cannot activate without at least one/);
  assert.doesNotMatch(
    sql,
    /tax_calculation_definition_rule_pins[\s\S]{0,200}count\(\*\)\s*>=\s*1/,
  );
});

test('TAX-K4D 19-21: same-country and legal-value version binding', () => {
  assert.match(sql, /tax_calculation_definition_rule_pins_rule_version_country_fk/);
  assert.match(sql, /tax_calculation_definition_legal_reqs_legal_value_country_fk/);
  assert.match(sql, /Cross-country tax calculation rule pin is forbidden/);
  assert.match(sql, /Cross-country tax calculation legal-value requirement is forbidden/);
  assert.match(sql, /value_key must match country_legal_values\.value_key/);
  assert.match(
    sql,
    /legal_value_version_id must belong to legal_value_id/,
  );
  assert.match(sql, /references public\.country_legal_value_versions \(id\)/);
});

test('TAX-K4D 22: run immutability triggers and published-only insert', () => {
  assert.match(sql, /tax_calculation_runs may persist only published definition versions/);
  for (const table of [
    'tax_calculation_runs',
    'tax_calculation_run_rule_pins',
    'tax_calculation_run_legal_value_pins',
    'tax_calculation_run_basis_pins',
  ]) {
    assert.match(sql, new RegExp(`${table}_forbid_update`));
    assert.match(sql, new RegExp(`${table}_forbid_delete`));
    assert.match(sql, new RegExp(`${table}_forbid_truncate`));
  }
  assert.match(sql, /UPDATE is forbidden for immutable tax calculation table/);
});

test('TAX-K4D 23-31: persist RPC invoker, privileges, atomic inserts, no bypass', () => {
  const body = persistBody();
  assert.match(sql, /create or replace function public\.tax_calculation_persist_run\(/);
  assert.match(body, /security invoker/i);
  assert.doesNotMatch(body, /security definer/i);
  assert.match(body, /set search_path = pg_catalog, public/);
  assert.match(
    sql,
    /revoke all on function public\.tax_calculation_persist_run\(jsonb, jsonb, jsonb, jsonb\) from public/,
  );
  assert.match(
    sql,
    /revoke all on function public\.tax_calculation_persist_run\(jsonb, jsonb, jsonb, jsonb\) from anon, authenticated/,
  );
  assert.match(
    sql,
    /grant execute on function public\.tax_calculation_persist_run\(jsonb, jsonb, jsonb, jsonb\) to service_role/,
  );
  assert.doesNotMatch(sql, /grant execute[^;]*\bto\s+anon\b/i);
  assert.doesNotMatch(sql, /grant execute[^;]*\bto\s+authenticated\b/i);
  assert.doesNotMatch(sql, /grant execute[^;]*tax_calculation_persist_run[^;]*\bto\s+public\b/i);
  assert.doesNotMatch(sql, /set_config\s*\(/);
  assert.doesNotMatch(sql, /current_setting\s*\(/);
  assert.doesNotMatch(sql, /current_user is distinct from session_user/);
  assert.doesNotMatch(sql, /latest_version|resolveLatest|resolve_latest/i);
  assert.doesNotMatch(sql, /evaluate_tax_rules|evaluateTaxRules|evaluateAppliesIf/);
  assert.doesNotMatch(sql, /digest\s*\(|encode\s*\(\s*digest|sha256\s*\(/i);
  assert.match(body, /insert into public\.tax_calculation_runs/);
  assert.match(body, /insert into public\.tax_calculation_run_rule_pins/);
  assert.match(body, /insert into public\.tax_calculation_run_legal_value_pins/);
  assert.match(body, /insert into public\.tax_calculation_run_basis_pins/);
  assert.match(body, /any exception rolls back the run and all child pins/);
  assert.match(body, /Does not evaluate expressions, resolve latest versions, call TRE, or compute checksums/);
});

test('TAX-K4D 32-34: legal snapshot shape and checksum storage without SQL hashing', () => {
  assert.match(sql, /type text not null check \(/);
  assert.match(sql, /'money'/);
  assert.match(sql, /'decimal'/);
  assert.match(sql, /'percentage'/);
  assert.match(sql, /'integer'/);
  assert.match(sql, /'boolean'/);
  assert.match(sql, /'date'/);
  assert.match(sql, /'enum'/);
  assert.match(sql, /'string'/);
  assert.match(sql, /value jsonb not null/);
  assert.match(sql, /currency text null/);
  assert.match(sql, /type = 'money' and currency is not null/);
  assert.match(sql, /snapshot_checksum text not null/);
  assert.doesNotMatch(sql, /source_checksum\s+text/);
  assert.match(sql, /expression_checksum text not null/);
  assert.match(sql, /definition_checksum text not null/);
  assert.match(sql, /SQL stores\/freezes it and does not compute it/);
  assert.match(sql, /SQL does not hash ASTs/);
  assert.doesNotMatch(sql, /create or replace function public\.canonicalTaxCalculationDefinitionChecksum/i);
});

test('TAX-K4D identity has no lifecycle status; versions own draft/active/retired', () => {
  const definitionsCreate = sql.slice(
    sql.indexOf('create table if not exists public.tax_calculation_definitions'),
    sql.indexOf('create table if not exists public.tax_calculation_definition_versions'),
  );
  assert.doesNotMatch(definitionsCreate, /status text not null/);
  assert.doesNotMatch(definitionsCreate, /retired_at/);
  assert.match(sql, /status text not null check \(status in \('draft', 'active', 'retired'\)\)/);
  assert.match(sql, /No lifecycle status/);
});

test('TAX-K4D draft child DELETE is structurally allowed; published child DELETE is rejected', () => {
  const draftGuard = functionBody('tax_calculation_definition_child_requires_parent_draft');
  assert.match(
    sql,
    /before insert or update or delete on public\.tax_calculation_definition_rule_pins/,
  );
  assert.match(
    sql,
    /before insert or update or delete on public\.tax_calculation_definition_legal_value_requirements/,
  );
  assert.match(draftGuard, /if tg_op = 'DELETE' then/);
  assert.match(draftGuard, /if old_status is distinct from 'draft' then/);
  assert.match(draftGuard, /return old;/);
  assert.match(
    draftGuard,
    /Tax calculation definition children are immutable after the parent version leaves draft/,
  );

  const rulePins = tableBlock(
    'tax_calculation_definition_rule_pins',
    'tax_calculation_definition_legal_value_requirements',
  );
  const legalReqs = tableBlock(
    'tax_calculation_definition_legal_value_requirements',
    'tax_calculation_runs',
  );
  assert.doesNotMatch(rulePins, /tax_calculation_definition_rule_pins_forbid_delete/);
  assert.doesNotMatch(legalReqs, /tax_calculation_definition_legal_reqs_forbid_delete/);
  assert.doesNotMatch(rulePins, /execute function public\.tax_calculation_forbid_delete\(\)/);
  assert.doesNotMatch(legalReqs, /execute function public\.tax_calculation_forbid_delete\(\)/);
});

test('TAX-K4D run child DELETE is always forbidden', () => {
  for (const table of [
    'tax_calculation_run_rule_pins',
    'tax_calculation_run_legal_value_pins',
    'tax_calculation_run_basis_pins',
  ]) {
    assert.match(sql, new RegExp(`${table}_forbid_delete`));
    assert.match(
      sql,
      new RegExp(
        `${table}_forbid_delete[\\s\\S]{0,180}before delete on public\\.${table}[\\s\\S]{0,80}execute function public\\.tax_calculation_forbid_delete\\(\\)`,
      ),
    );
  }
  const forbidDelete = functionBody('tax_calculation_forbid_delete');
  assert.match(forbidDelete, /Hard delete is forbidden for tax calculation table/);
  assert.doesNotMatch(forbidDelete, /status.*draft/);
});

test('TAX-K4D persist RPC is atomic INVOKER with no swallow, upsert, or caller run id', () => {
  const body = persistBody();
  assert.match(body, /security invoker/i);
  assert.doesNotMatch(body, /security definer/i);
  assert.match(body, /set search_path = pg_catalog, public/);
  assert.doesNotMatch(body, /exception when/i);
  assert.doesNotMatch(body, /on conflict/i);
  assert.doesNotMatch(body, /execute\s+'/i);
  assert.doesNotMatch(body, /execute\s+format/i);
  assert.doesNotMatch(body, /set_config\s*\(/);
  assert.doesNotMatch(body, /current_setting\s*\(/);
  assert.doesNotMatch(body, /latest_version|resolveLatest|resolve_latest/i);
  assert.doesNotMatch(body, /evaluate_tax_rules|evaluateTaxRules|evaluateAppliesIf|evaluateTaxCalculation/);
  assert.doesNotMatch(body, /digest\s*\(|encode\s*\(\s*digest|sha256\s*\(/i);
  assert.match(body, /does not accept a client-supplied id/);
  assert.match(body, /gen_random_uuid\(\)/);
  assert.match(body, /returning id into v_run_id/);
  assert.match(body, /tax_calculation_run_id',\s*v_run_id/);
  assert.match(body, /v_version\.expression_json/);
  assert.match(body, /v_version\.default_rounding_json/);
  assert.match(body, /v_version\.definition_checksum/);
  assert.match(body, /v_version\.expression_checksum/);
  assert.match(body, /v_version\.engine_dialect/);
  assert.match(body, /v_version\.engine_dialect_version/);
  assert.match(body, /is missing a declared definition rule pin/);
  assert.match(body, /does not accept undeclared rule pins/);
  assert.match(body, /does not accept undeclared legal-value identities/);
  assert.match(body, /calculated run is missing a required legal-value pin/);
  assert.match(body, /v_status = 'calculated'/);
});

test('TAX-K4D run definition/version binding and published snapshot equality', () => {
  assert.match(sql, /tax_calculation_runs_version_definition_fk/);
  assert.match(
    sql,
    /foreign key \(calculation_definition_version_id, calculation_definition_id\)[\s\S]{0,80}references public\.tax_calculation_definition_versions \(id, tax_calculation_definition_id\)/,
  );
  assert.match(sql, /uq_tax_calculation_definition_versions_id_definition/);
  const insertGuard = functionBody('tax_calculation_runs_guard_insert');
  assert.match(insertGuard, /definition id must match the pinned version/);
  assert.match(insertGuard, /expression_json must match the published version/);
  assert.match(insertGuard, /default_rounding_json must match the published version/);
  assert.match(insertGuard, /definition_checksum must match the published version/);
  assert.match(insertGuard, /expression_checksum must match the published version/);
  assert.match(insertGuard, /engine dialect must match the published version/);
  assert.match(insertGuard, /may persist only published definition versions/);
});

test('TAX-K4D run-time rule pins do not require tax_rule_version status=active', () => {
  const runChild = functionBody('tax_calculation_run_child_guard');
  const persist = persistBody();
  const insertGuard = functionBody('tax_calculation_runs_guard_insert');
  assert.match(runChild, /payload_checksum must match the pinned tax_rule_version/);
  assert.doesNotMatch(runChild, /rv\.status|status is distinct from 'active'|status = 'active'/);
  assert.doesNotMatch(persist, /tax_rule_versions[\s\S]{0,120}status/);
  assert.doesNotMatch(insertGuard, /tax_rule_versions[\s\S]{0,120}status/);
  assert.match(
    functionBody('tax_calculation_definition_versions_guard_publication'),
    /cannot activate while a rule pin points at a non-active tax_rule_version/,
  );
});

test('TAX-K4D legal-value pin type/currency/identity constraints', () => {
  const pins = tableBlock('tax_calculation_run_legal_value_pins', 'tax_calculation_run_basis_pins');
  assert.match(pins, /type in \([\s\S]*'money'[\s\S]*'string'/);
  assert.match(pins, /type = 'boolean' and jsonb_typeof\(value\) = 'boolean'/);
  assert.match(pins, /type <> 'boolean' and jsonb_typeof\(value\) = 'string'/);
  assert.match(pins, /type = 'money' and currency is not null/);
  assert.match(pins, /type <> 'money' and currency is null/);
  assert.match(pins, /uq_tax_calculation_run_legal_value_pins_identity/);
  assert.match(
    functionBody('tax_calculation_run_child_guard'),
    /legal_value_version_id must belong to legal_value_id/,
  );
  assert.match(
    functionBody('tax_calculation_run_child_guard'),
    /value_key must match country_legal_values\.value_key/,
  );
});

test('TAX-K4D basis pins require calculation_basis on resolved and unresolved rows', () => {
  const basis = tableBlock('tax_calculation_run_basis_pins');
  assert.match(basis, /kind = 'resolved'/);
  assert.match(basis, /tax_rule_relationship_id is not null/);
  assert.match(basis, /from_tax_rule_version_id is not null/);
  assert.match(basis, /to_tax_rule_version_id is not null/);
  assert.match(basis, /unresolved_legal_reference_id is null/);
  assert.match(basis, /kind = 'unresolved'/);
  assert.match(basis, /relationship_intent = 'calculation_basis'/);
  assert.match(basis, /from_tax_rule_version_id is null/);
  assert.match(basis, /to_tax_rule_version_id is null/);
  const guard = functionBody('tax_calculation_run_child_guard');
  assert.match(guard, /resolved relationship_type must be calculation_basis/);
  assert.match(guard, /unresolved relationship_intent must be calculation_basis/);
});

test('TAX-K4D lifecycle transitions and activation freeze', () => {
  const immut = functionBody('tax_calculation_definition_versions_protect_immutability');
  assert.match(immut, /old\.status = 'draft' and new\.status in \('active', 'retired'\)/);
  assert.match(immut, /old\.status = 'active' and new\.status = 'retired'/);
  assert.match(immut, /Invalid tax_calculation_definition_versions status transition/);
  assert.match(immut, /semantic fields are immutable after leaving draft/);
  assert.match(immut, /old\.expression_json is distinct from new\.expression_json/);
  assert.match(immut, /old\.expression_checksum is distinct from new\.expression_checksum/);
  assert.match(immut, /old\.definition_checksum is distinct from new\.definition_checksum/);
  assert.match(immut, /old\.engine_dialect is distinct from new\.engine_dialect/);
  assert.match(immut, /old\.default_rounding_json is distinct from new\.default_rounding_json/);
  assert.match(immut, /old\.effective_from is distinct from new\.effective_from/);
  assert.match(immut, /effective_to cannot be extended after leaving draft/);
  assert.match(immut, /effective_to is frozen after retirement/);
  assert.doesNotMatch(immut, /old\.status = 'active' and new\.status = 'draft'/);
  assert.doesNotMatch(immut, /old\.status = 'retired' and new\.status = 'active'/);
  assert.doesNotMatch(immut, /old\.status = 'retired' and new\.status = 'draft'/);
});

test('TAX-K4D run result shape matches K4C calculated/blocked contract', () => {
  const runs = tableBlock('tax_calculation_runs', 'tax_calculation_run_rule_pins');
  assert.match(runs, /status in \('calculated', 'blocked'\)/);
  assert.match(
    runs,
    /status = 'calculated' and result_json is not null and jsonb_typeof\(result_json\) = 'object'/,
  );
  assert.match(runs, /status = 'blocked' and result_json is null/);
  assert.match(runs, /jsonb_typeof\(facts_json\) = 'object'/);
  assert.match(runs, /jsonb_typeof\(expression_json\) = 'object'/);
  assert.match(runs, /jsonb_typeof\(blocking_json\) = 'array'/);
  assert.match(runs, /jsonb_typeof\(missing_inputs_json\) = 'array'/);
  assert.match(runs, /jsonb_typeof\(trace_json\) = 'array'/);
});

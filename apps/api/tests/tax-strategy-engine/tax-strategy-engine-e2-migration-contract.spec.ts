import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const migrationRel = 'supabase/migrations/612_tax_strategy_engine_foundation.sql';
const sql = readFileSync(join(repoRoot, migrationRel), 'utf8');

const TABLES = [
  'tax_strategies',
  'tax_strategy_exclusive_groups',
  'tax_strategy_versions',
  'tax_strategy_version_rule_pins',
  'tax_strategy_version_calculation_pins',
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
    : sql.indexOf('-- 6) Atomic supersession RPC');
  assert.ok(end > start, `${table} block must be bounded`);
  return sql.slice(start, end);
}

function supersedeBody(): string {
  const start = sql.indexOf(
    'create or replace function public.tax_strategy_engine_supersede_tax_strategy_version',
  );
  const end = sql.indexOf(
    'comment on function public.tax_strategy_engine_supersede_tax_strategy_version',
  );
  assert.ok(start >= 0 && end > start, 'supersede function block must exist');
  return sql.slice(start, end);
}

test('TAX-E2 1: migration is exactly 612 and creates the five E2 tables', () => {
  assert.equal(existsSync(join(repoRoot, migrationRel)), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/613_tax_strategy_engine_foundation.sql')), false);
  for (const table of TABLES) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.equal((sql.match(/create table if not exists public\.tax_strateg/g) ?? []).length, 5);
});

test('TAX-E2 2: identity has no lifecycle status and no professional title/description', () => {
  const identityCreate = sql.slice(
    sql.indexOf('create table if not exists public.tax_strategies'),
    sql.indexOf('comment on table public.tax_strategies'),
  );
  assert.doesNotMatch(identityCreate, /status text not null/);
  assert.doesNotMatch(identityCreate, /\btitle\s+text/);
  assert.doesNotMatch(identityCreate, /\bdescription\b/);
  assert.doesNotMatch(identityCreate, /retired_at/);
  assert.match(identityCreate, /admin_label text null/);
  assert.match(identityCreate, /owner_note text null/);
  assert.match(sql, /No lifecycle status/);
  assert.match(sql, /No professional title or description/);
  assert.match(
    sql,
    /Optional Owner-only administrative catalog nickname\. Never the canonical professional strategy name/,
  );
});

test('TAX-E2 3: version title is the sole canonical professional name', () => {
  const versions = tableBlock('tax_strategy_versions', 'tax_strategy_version_rule_pins');
  assert.match(versions, /title text not null/);
  assert.match(versions, /check \(btrim\(title\) <> ''\)/);
  assert.match(sql, /Sole canonical professional strategy name/);
  assert.match(sql, /Identity admin_label is never this name/);
});

test('TAX-E2 4: version lifecycle is draft/active/retired; insert draft only', () => {
  const versions = tableBlock('tax_strategy_versions', 'tax_strategy_version_rule_pins');
  assert.match(versions, /status text not null check \(status in \('draft', 'active', 'retired'\)\)/);
  assert.doesNotMatch(versions, /'superseded'/);
  assert.match(sql, /tax_strategy_versions must be inserted as draft/);
  const immut = functionBody('tax_strategy_versions_protect_immutability');
  assert.match(immut, /old\.status = 'draft' and new\.status in \('active', 'retired'\)/);
  assert.match(immut, /old\.status = 'active' and new\.status = 'retired'/);
  assert.doesNotMatch(immut, /old\.status = 'active' and new\.status = 'draft'/);
  assert.doesNotMatch(immut, /old\.status = 'retired' and new\.status = 'active'/);
  assert.doesNotMatch(immut, /old\.status = 'retired' and new\.status = 'draft'/);
});

test('TAX-E2 5: monotonic version_no and unique identity keys', () => {
  assert.match(sql, /check \(version_no >= 1\)/);
  assert.match(sql, /uq_tax_strategy_versions_strategy_no/);
  assert.match(sql, /uq_tax_strategies_country_code/);
  assert.match(sql, /uq_tax_strategies_id_country/);
  assert.match(sql, /uq_tax_strategy_versions_id_country/);
  assert.match(sql, /uq_tax_strategy_versions_id_strategy/);
  assert.match(sql, /version_no must be monotonic per strategy/);
});

test('TAX-E2 6: GiST no overlapping active windows; no as_of/latest resolver', () => {
  assert.match(sql, /tax_strategy_versions_no_active_overlap/);
  assert.match(sql, /exclude using gist/);
  assert.match(sql, /daterange\(effective_from, coalesce\(effective_to, 'infinity'::date\), '\[\]'\) with &&/);
  assert.match(sql, /where \(status = 'active'\)/);
  assert.doesNotMatch(sql, /latest_version|resolveLatest|resolve_latest|as_of_resolver/i);
});

test('TAX-E2 7: checksum is stored content-only; SQL does not hash; windows excluded', () => {
  assert.match(sql, /strategy_checksum text not null/);
  assert.match(sql, /check \(btrim\(strategy_checksum\) <> ''\)/);
  assert.match(sql, /SQL stores\/freezes it and does not compute or digest it/);
  assert.match(sql, /Excludes effective_from, effective_to/);
  assert.doesNotMatch(sql, /digest\s*\(|encode\s*\(\s*digest|sha256\s*\(/i);
  assert.doesNotMatch(sql, /create or replace function public\.canonicalTaxStrategy/i);
  assert.doesNotMatch(sql, /window_checksum/);
});

test('TAX-E2 8: authored fields freeze after draft; effective_to close-out is narrow-only', () => {
  const immut = functionBody('tax_strategy_versions_protect_immutability');
  assert.match(immut, /authored fields are immutable after leaving draft/);
  assert.match(immut, /old\.title is distinct from new\.title/);
  assert.match(immut, /old\.authored_metadata_json is distinct from new\.authored_metadata_json/);
  assert.match(immut, /old\.requires_professional_judgment is distinct from new\.requires_professional_judgment/);
  assert.match(immut, /old\.exclusive_group_id is distinct from new\.exclusive_group_id/);
  assert.match(immut, /old\.strategy_checksum is distinct from new\.strategy_checksum/);
  assert.match(immut, /old\.effective_from is distinct from new\.effective_from/);
  assert.match(immut, /effective_to cannot be cleared after close-out/);
  assert.match(immut, /effective_to cannot be extended after leaving draft/);
  assert.match(immut, /effective_to is frozen after retirement/);
});

test('TAX-E2 9: same-country composite FKs for identity, pins, and exclusive groups', () => {
  assert.match(sql, /tax_strategy_versions_strategy_country_fk/);
  assert.match(sql, /tax_strategy_versions_exclusive_group_country_fk/);
  assert.match(sql, /tax_strategy_version_rule_pins_rule_version_country_fk/);
  assert.match(sql, /tax_strategy_version_calculation_pins_calc_version_country_fk/);
  assert.match(sql, /references public\.tax_rule_versions \(id, country_code\)/);
  assert.match(sql, /references public\.tax_calculation_definition_versions \(id, country_code\)/);
  assert.match(sql, /references public\.tax_strategy_exclusive_groups \(id, country_code\)/);
  assert.match(sql, /on delete restrict/);
  assert.match(sql, /Cross-country tax strategy version binding is forbidden/);
  assert.match(sql, /Cross-country tax strategy exclusive group binding is forbidden/);
  assert.match(sql, /Cross-country tax strategy rule pin is forbidden/);
  assert.match(sql, /Cross-country tax strategy calculation pin is forbidden/);
});

test('TAX-E2 10: rule pins are required|prohibited only; exact version; unique pair', () => {
  const pinCreate = sql.slice(
    sql.indexOf('create table if not exists public.tax_strategy_version_rule_pins'),
    sql.indexOf('comment on table public.tax_strategy_version_rule_pins'),
  );
  assert.match(pinCreate, /pin_role text not null check \(pin_role in \('required', 'prohibited'\)\)/);
  assert.match(pinCreate, /tax_rule_version_id uuid not null/);
  assert.doesNotMatch(pinCreate, /payload_json|payload_checksum|provenance/);
  assert.match(sql, /uq_tax_strategy_version_rule_pins_pair/);
  assert.doesNotMatch(pinCreate, /alternative_to/);
  assert.match(sql, /Never inferred from tax_rule_relationship alternative_to/);
});

test('TAX-E2 11: no universal >=1 required rule; calculation pins optional; no AST copy', () => {
  assert.match(sql, /Does not require any rule pin/);
  assert.match(sql, /Does not require any calculation pin/);
  assert.doesNotMatch(sql, /cannot activate without at least one/);
  assert.doesNotMatch(sql, /count\(\*\)\s*>=\s*1/);
  const calcCreate = sql.slice(
    sql.indexOf('create table if not exists public.tax_strategy_version_calculation_pins'),
    sql.indexOf('create or replace function public.tax_strategy_version_child_guard_country'),
  );
  assert.match(calcCreate, /calculation_definition_version_id uuid not null/);
  assert.doesNotMatch(calcCreate, /expression_json|expression_checksum|engine_dialect|default_rounding/);
  assert.doesNotMatch(sql, /create table if not exists public\.tax_calculation_runs/);
});

test('TAX-E2 12: activation rejects contradictory tax_rule identities and non-active pins', () => {
  const publication = functionBody('tax_strategy_versions_guard_publication');
  assert.match(publication, /cannot activate while a rule pin points at a non-active tax_rule_version/);
  assert.match(
    publication,
    /cannot activate while a calculation pin points at a non-active tax_calculation_definition_version/,
  );
  assert.match(publication, /cannot activate with required and prohibited pins on the same tax_rule/);
  assert.match(publication, /required_rv\.tax_rule_id = prohibited_rv\.tax_rule_id/);
  assert.match(publication, /cannot activate without a non-blank title/);
  assert.match(publication, /cannot activate without a strategy_checksum/);
  assert.doesNotMatch(publication, /tax_rule_version_sources|evaluate_tax_rules|evaluateTaxCalculation/);
});

test('TAX-E2 13: exclusive group is explicit, version-scoped, country-safe', () => {
  const groups = tableBlock('tax_strategy_exclusive_groups', 'tax_strategy_versions');
  assert.doesNotMatch(groups, /status text not null/);
  assert.match(groups, /uq_tax_strategy_exclusive_groups_country_code/);
  assert.match(groups, /uq_tax_strategy_exclusive_groups_id_country/);
  const versions = tableBlock('tax_strategy_versions', 'tax_strategy_version_rule_pins');
  assert.match(versions, /exclusive_group_id uuid null/);
  assert.match(sql, /Never inferred from tax_rule_relationship alternative_to/);
  assert.match(sql, /Membership is version-scoped/);
});

test('TAX-E2 14: draft child DELETE allowed; published child DELETE rejected; identities never deleted', () => {
  const draftGuard = functionBody('tax_strategy_version_child_requires_parent_draft');
  assert.match(sql, /before insert or update or delete on public\.tax_strategy_version_rule_pins/);
  assert.match(sql, /before insert or update or delete on public\.tax_strategy_version_calculation_pins/);
  assert.match(draftGuard, /if tg_op = 'DELETE' then/);
  assert.match(draftGuard, /if old_status is distinct from 'draft' then/);
  assert.match(draftGuard, /Tax strategy version children are immutable after the parent version leaves draft/);
  const rulePins = tableBlock('tax_strategy_version_rule_pins', 'tax_strategy_version_calculation_pins');
  const calcPins = tableBlock('tax_strategy_version_calculation_pins');
  assert.doesNotMatch(rulePins, /tax_strategy_version_rule_pins_forbid_delete/);
  assert.doesNotMatch(calcPins, /tax_strategy_version_calculation_pins_forbid_delete/);
  assert.match(sql, /tax_strategies_forbid_delete/);
  assert.match(sql, /tax_strategy_versions_forbid_delete/);
  assert.match(sql, /tax_strategy_exclusive_groups_forbid_delete/);
});

test('TAX-E2 15: FORCE RLS, no policies, no GRANT ALL/TRUNCATE, exact service_role grants', () => {
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
    /grant select, insert, update, delete on table[\s\S]*tax_strategies[\s\S]*tax_strategy_version_calculation_pins[\s\S]*to service_role;/,
  );
  assert.doesNotMatch(sql, /grant[^;]*\bto\s+anon\b/i);
  assert.doesNotMatch(sql, /grant[^;]*\bto\s+authenticated\b/i);
});

test('TAX-E2 16: no tenant/org/client/case fields and no parallel truth tables', () => {
  assert.doesNotMatch(sql, /organization_id\s+(uuid|text)/i);
  assert.doesNotMatch(sql, /client_id\s+(uuid|text)/i);
  assert.doesNotMatch(sql, /case_id\s+(uuid|text)/i);
  assert.doesNotMatch(sql, /create table if not exists public\.tax_strategy_evaluations/);
  assert.doesNotMatch(sql, /create table if not exists public\.tax_strategy_runs/);
  assert.doesNotMatch(sql, /create table if not exists public\.tax_strategy_version_sources/);
  assert.doesNotMatch(sql, /availability_status|ai_proposal/);
  assert.doesNotMatch(sql, /work_engine|accounting_base/);
});

test('TAX-E2 17: no hardcoded IL strategy logic', () => {
  assert.doesNotMatch(sql, /default\s+'IL'/i);
  assert.doesNotMatch(sql, /country_code\s*=\s*'IL'/);
  assert.doesNotMatch(sql, /נקודות|מע״מ|מס הכנסה/);
});

test('TAX-E2 18: supersede RPC is atomic, exact ids, no latest, service_role only', () => {
  const body = supersedeBody();
  assert.match(sql, /create or replace function public\.tax_strategy_engine_supersede_tax_strategy_version\(/);
  assert.match(body, /security definer/i);
  assert.match(body, /set search_path = pg_catalog, public/);
  assert.match(body, /p_new_tax_strategy_version_id uuid/);
  assert.match(body, /p_old_tax_strategy_version_id uuid/);
  assert.match(body, /order by id\s+for update/i);
  assert.match(body, /requires the NEW version to be draft/);
  assert.match(body, /requires the OLD version to be active/);
  assert.match(body, /same tax_strategy/);
  assert.match(body, /same country/);
  assert.match(body, /supersedes_version_id must be empty or exactly the OLD version/);
  assert.match(body, /status = 'retired'/);
  assert.match(body, /superseded_by_version_id = v_new\.id/);
  assert.match(body, /supersedes_version_id = v_old\.id/);
  const oldUpdate = body.indexOf("status = 'retired'");
  const newUpdate = body.lastIndexOf("status = 'active'");
  assert.ok(oldUpdate >= 0 && newUpdate > oldUpdate, 'OLD must leave active before NEW activates');
  assert.match(body, /Does not auto-write effective_to/);
  assert.doesNotMatch(body, /disable trigger/i);
  assert.doesNotMatch(body, /session_replication_role/i);
  assert.doesNotMatch(body, /order by version_no/i);
  assert.doesNotMatch(body, /latest_version|resolveLatest|resolve_latest/i);
  assert.doesNotMatch(body, /effective_to\s*=/);
  assert.match(
    sql,
    /revoke all on function public\.tax_strategy_engine_supersede_tax_strategy_version\(uuid, uuid\) from public/,
  );
  assert.match(
    sql,
    /revoke all on function public\.tax_strategy_engine_supersede_tax_strategy_version\(uuid, uuid\) from anon, authenticated/,
  );
  assert.match(
    sql,
    /grant execute on function public\.tax_strategy_engine_supersede_tax_strategy_version\(uuid, uuid\) to service_role/,
  );
  assert.doesNotMatch(sql, /grant execute[^;]*tax_strategy_engine_supersede[^;]*\bto\s+anon\b/i);
  assert.doesNotMatch(sql, /grant execute[^;]*tax_strategy_engine_supersede[^;]*\bto\s+authenticated\b/i);
});

test('TAX-E2 19: authored metadata is a closed canonical object', () => {
  const meta = functionBody('tax_strategy_authored_metadata_is_canonical');
  assert.match(sql, /tax_strategy_authored_metadata_is_canonical/);
  assert.match(meta, /'explanation'/);
  assert.match(meta, /'benefits'/);
  assert.match(meta, /'risks'/);
  assert.match(meta, /'constraints'/);
  assert.match(meta, /'costs_tradeoffs'/);
  assert.match(meta, /'category'/);
  assert.match(meta, /'domain'/);
  assert.match(meta, /'tags'/);
  assert.doesNotMatch(meta, /'status'/);
  assert.doesNotMatch(meta, /'findings'/);
  assert.doesNotMatch(meta, /'evaluation_checksum'/);
});

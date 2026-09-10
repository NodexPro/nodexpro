import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const migrationRel = 'supabase/migrations/615_tax_advisory_case_foundation.sql';
const sql = readFileSync(join(repoRoot, migrationRel), 'utf8');

const FROZEN = [
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
  'supabase/migrations/613_tax_fact_dictionary_foundation.sql',
  'supabase/migrations/614_tax_fact_dictionary_atomic_activation.sql',
] as const;

function gitDiff(rel: string): string {
  return execSync(`git diff -- ${rel}`, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

test('TAX-F2B1 migration 615 exists and 600-614 are unchanged', () => {
  assert.equal(existsSync(join(repoRoot, migrationRel)), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/615_tax_fact_dictionary_atomic_activation.sql')), false);
  for (const file of FROZEN) {
    assert.equal(gitDiff(file), '', `${file} must remain unchanged`);
  }
});

test('TAX-F2B1 creates only the two F2B1 tables', () => {
  assert.match(sql, /create table if not exists public\.tax_advisory_cases/);
  assert.match(sql, /create table if not exists public\.tax_advisory_case_facts/);
  assert.equal((sql.match(/create table if not exists public\.tax_advisory_/g) ?? []).length, 2);
  assert.doesNotMatch(sql, /tax_advisory_scenarios/);
  assert.doesNotMatch(sql, /tax_advisory_evaluation_snapshots/);
  assert.doesNotMatch(sql, /professional_owner_user_id/);
  assert.doesNotMatch(sql, /facts_completeness|unanswered_required_fact_keys/);
  assert.doesNotMatch(sql, /tax_calculation_runs/);
  assert.doesNotMatch(sql, /work_items/);
});

test('TAX-F2B1 case constraints: workflow, lifecycle, immutable country, one open case', () => {
  assert.match(sql, /check \(workflow_type = 'business_setup'\)/);
  assert.match(sql, /check \(lifecycle_state in \('draft', 'archived'\)\)/);
  assert.match(sql, /uq_tax_advisory_cases_one_open/);
  assert.match(
    sql,
    /on public\.tax_advisory_cases \(organization_id, client_id, workflow_type\)\s+where lifecycle_state is distinct from 'archived'/,
  );
  assert.match(sql, /tax_advisory_cases identity and country_code are immutable/);
  assert.match(sql, /old\.country_code is distinct from new\.country_code/);
  assert.match(sql, /tax_advisory_cases must be inserted as draft/);
  assert.match(sql, /Hard delete is forbidden for tax_advisory_cases/);
  assert.match(sql, /tax_advisory_cases.client_id must belong to organization_id/);
});

test('TAX-F2B1 facts pin FD versions and forbid null answers / scenarios', () => {
  assert.match(sql, /unique \(case_id, fact_definition_id\)/);
  assert.match(sql, /tax_advisory_case_facts_case_ownership_fk/);
  assert.match(sql, /jsonb_typeof\(value_json\) is distinct from 'null'/);
  assert.doesNotMatch(sql, /scenario_id\s+uuid/);
  assert.doesNotMatch(sql, /presentation_id|tax_fact_presentation_id/);
  assert.match(sql, /tax_advisory_case_facts can only be written on a draft case/);
});

test('TAX-F2B1 RLS, grants, no anon mutation, no authenticated DML', () => {
  assert.match(sql, /alter table public\.tax_advisory_cases enable row level security/);
  assert.match(sql, /alter table public\.tax_advisory_cases force row level security/);
  assert.match(sql, /alter table public\.tax_advisory_case_facts enable row level security/);
  assert.match(sql, /alter table public\.tax_advisory_case_facts force row level security/);
  assert.match(sql, /revoke all on table public\.tax_advisory_cases from public, anon, authenticated, service_role/);
  assert.match(sql, /revoke all on table public\.tax_advisory_case_facts from public, anon, authenticated, service_role/);
  assert.match(
    sql,
    /grant select, insert, update, delete on table[\s\S]*tax_advisory_cases[\s\S]*tax_advisory_case_facts[\s\S]*to service_role/,
  );
  assert.match(sql, /grant select on table[\s\S]*tax_advisory_cases[\s\S]*to authenticated/);
  assert.doesNotMatch(sql, /for insert to authenticated/);
  assert.doesNotMatch(sql, /for update to authenticated/);
  assert.doesNotMatch(sql, /for delete to authenticated/);
  assert.match(sql, /tax_advisory_cases_select_org_member/);
  assert.match(sql, /organizations_for_current_auth_user\(\)/);
  assert.doesNotMatch(sql, /grant[\s\S]*to anon/);
  assert.doesNotMatch(sql, /grant all/i);
});

test('TAX-F2B1 module and RBAC seed', () => {
  assert.match(sql, /'tax-advisory'/);
  assert.match(sql, /tax_advisory\.view/);
  assert.match(sql, /tax_advisory\.edit/);
  assert.match(sql, /insert into public\.role_permissions \(role_id, permission_id\)/);
  assert.match(sql, /p\.code = 'tax_advisory\.view'/);
  assert.match(sql, /p\.code = 'tax_advisory\.edit'/);
  assert.match(sql, /r\.code in \('owner', 'admin', 'admin_manager', 'staff', 'member', 'viewer'\)/);
  assert.match(sql, /r\.code in \('owner', 'admin', 'admin_manager', 'staff', 'member'\)/);
  assert.match(sql, /to_regclass\('public\.rbac_role_permissions'\)/);
  assert.match(sql, /\('viewer', 'tax_advisory\.view'\)/);
  assert.doesNotMatch(sql, /\('viewer', 'tax_advisory\.edit'\)/);
  const modulesInsert = sql.slice(sql.indexOf('insert into public.modules'), sql.indexOf('on conflict (code) do update set'));
  assert.match(
    modulesInsert,
    /insert into public\.modules \(\s*id,\s*code,\s*name,\s*description,\s*scope_type,\s*is_active,\s*is_sellable,\s*default_visibility\s*\)/,
  );
  assert.doesNotMatch(modulesInsert, /\bversion\b/);
  assert.doesNotMatch(modulesInsert, /nav_label|schema_version|migration_version|is_system/);
  assert.match(sql, /insert into public\.permissions \(id, code, name, domain\)/);
  assert.match(sql, /insert into public\.rbac_role_permissions \(role_code, permission_code\)/);
});

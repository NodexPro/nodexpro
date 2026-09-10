import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const migrationRel = 'supabase/migrations/616_tax_advisory_runtime_core_privileges.sql';
const sqlRaw = readFileSync(join(repoRoot, migrationRel), 'utf8');
const sql = sqlRaw.replace(/--[^\n]*/g, '');

const FROZEN_600_615 = [
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
  'supabase/migrations/615_tax_advisory_case_foundation.sql',
] as const;

const FORBIDDEN_TABLES = [
  'public.organizations',
  'public.organization_memberships',
  'public.rbac_role_permissions',
  'public.organization_module_subscriptions',
  'public.organization_trials',
  'public.module_plans',
  'public.file_assets',
  'public.countries',
  'public.country_packs',
  'public.country_pack_rulesets',
  'public.country_legal_values',
] as const;

function gitDiff(rel: string): string {
  return execSync(`git diff -- ${rel}`, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function normalizeSql(input: string): string {
  return input.replace(/\s+/g, ' ').trim().toLowerCase();
}

function grantStatements(input: string): string[] {
  return [...input.matchAll(/grant\s+[\s\S]*?;/gi)].map((match) => normalizeSql(match[0]));
}

const grants = grantStatements(sql);

test('TAX-F2B1 616: file exists; 600-615 remain separate and unchanged in this turn', () => {
  assert.equal(existsSync(join(repoRoot, migrationRel)), true);
  assert.equal(
    readdirSync(join(repoRoot, 'supabase/migrations')).includes('616_tax_advisory_runtime_core_privileges.sql'),
    true,
  );
  for (const file of FROZEN_600_615) {
    assert.equal(existsSync(join(repoRoot, file)), true, `${file} must still exist`);
    assert.equal(gitDiff(file), '', `${file} must remain unchanged`);
  }
});

test('TAX-F2B1 616: exact approved service_role grants only', () => {
  assert.deepEqual(grants, [
    'grant select on table public.clients to service_role;',
    'grant select, insert, update on table public.users to service_role;',
    'grant select on table public.organization_country_settings to service_role;',
    'grant insert on table public.audit_log to service_role;',
    'grant select on table public.modules, public.organization_modules, public.organization_users, public.roles, public.permissions, public.role_permissions to service_role;',
  ]);
});

test('TAX-F2B1 616: least privilege — no DELETE, TRUNCATE, GRANT ALL, or extra roles', () => {
  assert.equal(grants.length, 5);
  assert.doesNotMatch(sql, /grant\s+all\b/i);
  assert.doesNotMatch(sql, /grant\s+delete\b/i);
  assert.doesNotMatch(sql, /\bdelete\b/i);
  assert.doesNotMatch(sql, /grant\s+truncate\b/i);
  assert.doesNotMatch(sql, /\btruncate\b/i);
  assert.doesNotMatch(sql, /grant\s+references\b/i);
  assert.doesNotMatch(sql, /grant\s+trigger\b/i);
  assert.doesNotMatch(sql, /grant\s+execute\b/i);
  assert.doesNotMatch(sql, /\bto\s+anon\b/i);
  assert.doesNotMatch(sql, /\bto\s+authenticated\b/i);
  assert.doesNotMatch(sql, /\bto\s+public\b/i);
  assert.doesNotMatch(sql, /\bfrom\s+public\b/i);
});

test('TAX-F2B1 616: object-level rights match the approved matrix', () => {
  const clients = grants.filter((g) => g.includes('public.clients'));
  const users = grants.filter((g) => g.includes('public.users'));
  const countrySettings = grants.filter((g) => g.includes('public.organization_country_settings'));
  const audit = grants.filter((g) => g.includes('public.audit_log'));
  const authModule = grants.filter((g) => g.includes('public.modules'));

  assert.equal(clients.length, 1);
  assert.match(clients[0]!, /^grant select on table public\.clients to service_role;$/);
  assert.doesNotMatch(clients[0]!, /insert|update|delete/);

  assert.equal(users.length, 1);
  assert.match(users[0]!, /^grant select, insert, update on table public\.users to service_role;$/);
  assert.doesNotMatch(users[0]!, /delete/);

  assert.equal(countrySettings.length, 1);
  assert.match(countrySettings[0]!, /^grant select on table public\.organization_country_settings to service_role;$/);
  assert.doesNotMatch(countrySettings[0]!, /insert|update|delete/);

  assert.equal(audit.length, 1);
  assert.match(audit[0]!, /^grant insert on table public\.audit_log to service_role;$/);
  assert.doesNotMatch(audit[0]!, /select|update|delete/);

  assert.equal(authModule.length, 1);
  assert.match(authModule[0]!, /^grant select on table /);
  assert.doesNotMatch(authModule[0]!, /insert|update|delete/);
  for (const table of [
    'public.modules',
    'public.organization_modules',
    'public.organization_users',
    'public.roles',
    'public.permissions',
    'public.role_permissions',
  ]) {
    assert.match(authModule[0]!, new RegExp(table.replace(/\./g, '\\.')));
  }
});

test('TAX-F2B1 616: no schema/RLS mutation and no conditional grants', () => {
  assert.doesNotMatch(sql, /row level security/i);
  assert.doesNotMatch(sql, /create\s+policy/i);
  assert.doesNotMatch(sql, /drop\s+policy/i);
  assert.doesNotMatch(sql, /owner to/i);
  assert.doesNotMatch(sql, /create\s+or\s+replace\s+function/i);
  assert.doesNotMatch(sql, /drop\s+function/i);
  assert.doesNotMatch(sql, /alter\s+function/i);
  assert.doesNotMatch(sql, /alter\s+default\s+privileges/i);
  assert.doesNotMatch(sql, /create\s+table/i);
  assert.doesNotMatch(sql, /alter\s+table/i);
  assert.doesNotMatch(sql, /create\s+trigger/i);
  assert.doesNotMatch(sql, /drop\s+table/i);
  assert.doesNotMatch(sql, /to_regclass\s*\(/i);
  assert.doesNotMatch(sql, /if\s+not\s+exists/i);
});

test('TAX-F2B1 616: does not grant organizations or duplicate Tax Brain / Country Pack tables', () => {
  assert.doesNotMatch(sql, /public\.organizations\b/);
  for (const table of FORBIDDEN_TABLES) {
    assert.doesNotMatch(sql, new RegExp(table.replace(/\./g, '\\.') + '\\b'));
  }
  assert.doesNotMatch(sql, /tax_fact_/);
  assert.doesNotMatch(sql, /tax_advisory_/);
});

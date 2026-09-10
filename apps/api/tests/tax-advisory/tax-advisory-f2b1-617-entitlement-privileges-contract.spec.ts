import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const migrationRel = 'supabase/migrations/617_tax_advisory_entitlement_runtime_privileges.sql';
const sqlRaw = readFileSync(join(repoRoot, migrationRel), 'utf8');
const sql = sqlRaw.replace(/--[^\n]*/g, '');

const FROZEN_600_616 = [
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
  'supabase/migrations/616_tax_advisory_runtime_core_privileges.sql',
] as const;

const FORBIDDEN_TABLES = [
  'public.organizations',
  'public.organization_legal_identities',
  'public.module_plans',
  'public.module_plan_limits',
  'public.clients',
  'public.users',
  'public.audit_log',
  'public.modules',
  'public.organization_modules',
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

test('TAX-F2B1 617: file exists; 600-616 remain separate and unchanged in this turn', () => {
  assert.equal(existsSync(join(repoRoot, migrationRel)), true);
  assert.equal(
    readdirSync(join(repoRoot, 'supabase/migrations')).includes(
      '617_tax_advisory_entitlement_runtime_privileges.sql',
    ),
    true,
  );
  for (const file of FROZEN_600_616) {
    assert.equal(existsSync(join(repoRoot, file)), true, `${file} must still exist`);
    assert.equal(gitDiff(file), '', `${file} must remain unchanged`);
  }
});

test('TAX-F2B1 617: exact approved service_role SELECT grants only', () => {
  assert.deepEqual(grants, [
    'grant select on table public.organization_module_subscriptions to service_role;',
    'grant select on table public.organization_trials to service_role;',
  ]);
});

test('TAX-F2B1 617: least privilege — no DELETE, TRUNCATE, GRANT ALL, or extra roles', () => {
  assert.equal(grants.length, 2);
  assert.doesNotMatch(sql, /grant\s+all\b/i);
  assert.doesNotMatch(sql, /grant\s+insert\b/i);
  assert.doesNotMatch(sql, /grant\s+update\b/i);
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

test('TAX-F2B1 617: no schema/RLS mutation and no forbidden objects', () => {
  assert.doesNotMatch(sql, /row level security/i);
  assert.doesNotMatch(sql, /create\s+policy/i);
  assert.doesNotMatch(sql, /drop\s+policy/i);
  assert.doesNotMatch(sql, /owner to/i);
  assert.doesNotMatch(sql, /create\s+or\s+replace\s+function/i);
  assert.doesNotMatch(sql, /alter\s+default\s+privileges/i);
  assert.doesNotMatch(sql, /create\s+table/i);
  assert.doesNotMatch(sql, /alter\s+table/i);
  assert.doesNotMatch(sql, /create\s+trigger/i);
  assert.doesNotMatch(sql, /to_regclass\s*\(/i);
  for (const table of FORBIDDEN_TABLES) {
    assert.doesNotMatch(sql, new RegExp(table.replace(/\./g, '\\.') + '\\b'));
  }
  assert.doesNotMatch(sql, /tax_fact_/);
  assert.doesNotMatch(sql, /tax_advisory_/);
});

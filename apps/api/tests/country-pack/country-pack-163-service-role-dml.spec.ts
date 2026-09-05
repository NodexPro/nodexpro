import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const migrationRel = 'supabase/migrations/163_country_pack_service_role_dml.sql';
const sql163 = readFileSync(join(repoRoot, migrationRel), 'utf8');
const sqlBody = sql163.replace(/--[^\n]*/g, '');

const GRANTED = {
  countries: ['select', 'insert', 'update'],
  country_packs: ['select', 'insert'],
  country_pack_rulesets: ['select', 'insert'],
  country_legal_values: ['select', 'insert'],
} as const;

const FROZEN_MIGRATIONS = [
  'supabase/migrations/001_core_schema.sql',
  'supabase/migrations/002_rls_core.sql',
  'supabase/migrations/086_country_pack_foundation_schema.sql',
  'supabase/migrations/600_tax_knowledge_core_foundation.sql',
  'supabase/migrations/601_tax_knowledge_provenance_links.sql',
  'supabase/migrations/602_tax_knowledge_publication_guard.sql',
  'supabase/migrations/603_tax_knowledge_rule_relationships.sql',
  'supabase/migrations/604_tax_knowledge_relationship_publication_guard.sql',
  'supabase/migrations/605_tax_knowledge_atomic_supersession.sql',
  'supabase/migrations/606_tax_knowledge_service_role_dml.sql',
] as const;

function grantStatements(): string[] {
  return [...sqlBody.matchAll(/grant\b[^;]*;/gi)].map((m) => m[0].replace(/\s+/g, ' ').trim());
}

test('163 contract: only four Country Pack tables granted to service_role', () => {
  assert.equal(existsSync(join(repoRoot, migrationRel)), true);
  assert.equal(
    readdirSync(join(repoRoot, 'supabase/migrations')).includes('163_country_pack_service_role_dml.sql'),
    true,
  );
  assert.equal(
    readdirSync(join(repoRoot, 'supabase/migrations')).some((name) => name.startsWith('607_')),
    false,
    'must not be Tax Brain 607',
  );

  const grants = grantStatements();
  assert.equal(grants.length, 4);

  for (const grant of grants) {
    assert.match(grant, /to service_role;$/i);
    assert.doesNotMatch(grant, /\bdelete\b/i);
    assert.doesNotMatch(grant, /\btruncate\b/i);
    assert.doesNotMatch(grant, /\ball tables in schema\b/i);
    assert.doesNotMatch(grant, /\bto\s+anon\b/i);
    assert.doesNotMatch(grant, /\bto\s+authenticated\b/i);
    assert.doesNotMatch(grant, /^grant\s+all\b/i);
  }

  assert.match(
    sqlBody,
    /grant select,\s*insert,\s*update on table public\.countries to service_role/i,
  );
  assert.match(sqlBody, /grant select,\s*insert on table public\.country_packs to service_role/i);
  assert.match(
    sqlBody,
    /grant select,\s*insert on table public\.country_pack_rulesets to service_role/i,
  );
  assert.match(
    sqlBody,
    /grant select,\s*insert on table public\.country_legal_values to service_role/i,
  );

  const named = grants.flatMap((g) => [...g.matchAll(/public\.([a-z_]+)/gi)].map((m) => m[1]));
  assert.deepEqual([...new Set(named)].sort(), Object.keys(GRANTED).sort());
  assert.ok(!named.includes('country_legal_value_versions'));
});

test('163 contract: privilege shape, no RLS change, frozen migrations untouched', () => {
  assert.doesNotMatch(sqlBody, /grant\s+all\b/i);
  assert.doesNotMatch(sqlBody, /\bdelete\b/i);
  assert.doesNotMatch(sqlBody, /\btruncate\b/i);
  assert.doesNotMatch(sqlBody, /on all tables in schema/i);
  assert.doesNotMatch(sqlBody, /\bto\s+anon\b/i);
  assert.doesNotMatch(sqlBody, /\bto\s+authenticated\b/i);
  assert.doesNotMatch(sqlBody, /country_legal_value_versions/i);
  assert.doesNotMatch(sqlBody, /create\s+policy/i);
  assert.doesNotMatch(sqlBody, /drop\s+policy/i);
  assert.doesNotMatch(sqlBody, /row level security/i);
  assert.doesNotMatch(sqlBody, /create\s+or\s+replace\s+function/i);
  assert.doesNotMatch(sqlBody, /alter table/i);

  assert.doesNotMatch(sqlBody, /grant select,\s*insert,\s*update on table public\.country_packs/i);
  assert.doesNotMatch(
    sqlBody,
    /grant select,\s*insert,\s*update on table public\.country_pack_rulesets/i,
  );
  assert.doesNotMatch(
    sqlBody,
    /grant select,\s*insert,\s*update on table public\.country_legal_values/i,
  );

  for (const file of FROZEN_MIGRATIONS) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(diff.trim(), '', `${file} must remain unchanged`);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const migrationRel = 'supabase/migrations/606_tax_knowledge_service_role_dml.sql';
const sql606 = readFileSync(join(repoRoot, migrationRel), 'utf8');
const sqlBody = sql606.replace(/--[^\n]*/g, '');

const TABLES = [
  'tax_sources',
  'tax_rules',
  'tax_rule_versions',
  'tax_rule_version_sources',
  'tax_rule_version_legal_values',
  'tax_rule_relationships',
] as const;

const FROZEN_MIGRATIONS = [
  'supabase/migrations/600_tax_knowledge_core_foundation.sql',
  'supabase/migrations/601_tax_knowledge_provenance_links.sql',
  'supabase/migrations/602_tax_knowledge_publication_guard.sql',
  'supabase/migrations/603_tax_knowledge_rule_relationships.sql',
  'supabase/migrations/604_tax_knowledge_relationship_publication_guard.sql',
  'supabase/migrations/605_tax_knowledge_atomic_supersession.sql',
] as const;

const RPC = 'tax_knowledge_supersede_tax_rule_version(uuid, uuid)';

test('TAX-K3A contract: 606 exists and grants service_role DML only', () => {
  assert.equal(existsSync(join(repoRoot, migrationRel)), true, '606 migration file must exist');

  const sixHundreds = readdirSync(join(repoRoot, 'supabase/migrations'))
    .filter((name) => /^60[6-9]_/.test(name) || /^6[1-9]\d_/.test(name));
  assert.deepEqual(sixHundreds, [
    '606_tax_knowledge_service_role_dml.sql',
    '607_tax_knowledge_legal_links_unresolved.sql',
  ]);

  assert.match(sqlBody, /grant select,\s*insert,\s*update,\s*delete on table/i);
  assert.match(sqlBody, /to service_role/);
  for (const table of TABLES) {
    assert.match(sqlBody, new RegExp(`public\\.${table}\\b`));
  }

  assert.doesNotMatch(sqlBody, /grant\s+all\b/i);
  assert.doesNotMatch(sqlBody, /^\s*grant\b[^;]*\btruncate\b/im);
  assert.doesNotMatch(sqlBody, /grant\b[^;]*\bto\s+anon\b/i);
  assert.doesNotMatch(sqlBody, /grant\b[^;]*\bto\s+authenticated\b/i);
});

test('TAX-K3A contract: anon/authenticated remain revoked and RPC is service_role-only', () => {
  for (const table of TABLES) {
    assert.match(
      sqlBody,
      new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, 'i'),
    );
  }

  const rpcPattern = RPC.replace(/[()]/g, '\\$&');
  assert.match(sqlBody, new RegExp(`grant execute on function public\\.${rpcPattern} to service_role`, 'i'));
  assert.match(sqlBody, new RegExp(`revoke all on function public\\.${rpcPattern} from public`, 'i'));
  assert.match(
    sqlBody,
    new RegExp(`revoke all on function public\\.${rpcPattern} from anon, authenticated`, 'i'),
  );
  assert.doesNotMatch(sqlBody, /grant execute[^;]*\bto\s+anon\b/i);
  assert.doesNotMatch(sqlBody, /grant execute[^;]*\bto\s+authenticated\b/i);
  assert.doesNotMatch(sqlBody, /grant execute[^;]*\bto\s+public\b/i);
});

test('TAX-K3A contract: 606 is privileges-only and 600–605 stay frozen', () => {
  assert.doesNotMatch(sqlBody, /create\s+or\s+replace\s+function/i);
  assert.doesNotMatch(sqlBody, /create\s+policy/i);
  assert.doesNotMatch(sqlBody, /disable\s+row\s+level\s+security/i);
  assert.doesNotMatch(sqlBody, /drop\s+trigger/i);
  assert.doesNotMatch(sqlBody, /grant\b[^;]*\bon\s+sequence\b/i);
  assert.doesNotMatch(sqlBody, /country_packs|country_legal_values|organization_id/i);

  for (const file of FROZEN_MIGRATIONS) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(diff.trim(), '', `${file} must remain unchanged`);
  }
});

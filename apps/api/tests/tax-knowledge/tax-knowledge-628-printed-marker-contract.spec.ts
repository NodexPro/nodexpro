import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

const migrationRel = 'supabase/migrations/628_legal_identifier_printed_marker.sql';
const frozen = [
  'supabase/migrations/620_owner_country_legal_access.sql',
  'supabase/migrations/621_country_localization.sql',
  'supabase/migrations/622_tax_legal_library_foundation.sql',
  'supabase/migrations/623_legal_value_version_authorities.sql',
  'supabase/migrations/624_knowledge_trainer_ingestion_foundation.sql',
  'supabase/migrations/625_knowledge_trainer_page_layout_evidence.sql',
  'supabase/migrations/626_exact_legal_identifiers.sql',
  'supabase/migrations/627_legal_ingestion_structure_runs.sql',
];

test('TAX-628 is additive printed_marker only and does not write canonical law', () => {
  assert.equal(existsSync(join(repoRoot, migrationRel)), true);
  const sql = readRepo(migrationRel);
  for (const table of ['legal_ingestion_candidates', 'tax_legal_nodes']) {
    assert.match(sql, new RegExp(`alter table public\\.${table}`));
    assert.match(sql, new RegExp(`public\\.${table}[\\s\\S]*printed_marker text null`));
  }
  assert.match(sql, /Not part of identity/);
  assert.match(sql, /Does not insert canonical law/);
  assert.doesNotMatch(sql, /insert into public\.tax_legal_nodes/i);
  assert.doesNotMatch(sql, /insert into public\.legal_ingestion_candidates/i);
  assert.doesNotMatch(sql, /update public\.tax_legal_nodes/i);
  assert.doesNotMatch(sql, /accept_legal_structure_candidate/);
  assert.doesNotMatch(sql, /status = 'active'/);
  assert.doesNotMatch(sql, /legal_ingestion_activate_structure_run/);
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /alter table public\.legal_ingestion_structure_runs/);
});

test('TAX-628 leaves 620–627 files in place and does not rewrite them', () => {
  for (const rel of frozen) {
    assert.equal(existsSync(join(repoRoot, rel)), true, rel);
    if (!rel.endsWith('628_legal_identifier_printed_marker.sql')) {
      assert.doesNotMatch(readRepo(rel), /printed_marker/);
    }
  }
});

test('TAX-628 accept copies printed_marker into create_tax_legal_node', () => {
  const commands = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
  assert.match(commands, /identifierPayloadForCanonicalCreate/);
  assert.match(commands, /printed_marker: candidate\.printed_marker/);
  const create = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts');
  assert.match(create, /printed_marker/);
  const persist = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-structure.service.ts');
  assert.match(persist, /legal_ingestion_activate_structure_run/);
  assert.doesNotMatch(persist, /from\('legal_ingestion_candidates'\)\.delete/);
  assert.doesNotMatch(commands, /accept_all|bulk_accept|auto_accept/i);
  assert.doesNotMatch(commands, /activate_tax_legal_node/);
});

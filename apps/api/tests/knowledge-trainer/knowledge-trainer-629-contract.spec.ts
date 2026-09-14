import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const sqlRel = 'supabase/migrations/629_legal_ingestion_source_evidence.sql';

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-629 is additive trainer evidence only and does not take canonical ownership', () => {
  assert.equal(existsSync(join(repoRoot, sqlRel)), true);
  const sql = readRepo(sqlRel);
  assert.match(sql, /Do not apply to production/);
  assert.match(sql, /jgxezhjctrgfbmmkqqhn/);
  assert.match(sql, /source_page/);
  assert.match(sql, /source_item_start/);
  assert.match(sql, /source_item_end/);
  assert.match(sql, /create table if not exists public\.legal_ingestion_source_notes/);
  assert.match(sql, /create table if not exists public\.legal_ingestion_source_note_anchors/);
  assert.match(sql, /legal_ingestion source evidence is immutable/);
  assert.match(sql, /not relationship_intent/);
  assert.doesNotMatch(sql, /alter table public\.tax_domains/);
  assert.doesNotMatch(sql, /alter table public\.tax_sources/);
  assert.doesNotMatch(sql, /alter table public\.tax_legal_nodes/);
  assert.doesNotMatch(sql, /alter table public\.tax_rules/);
  assert.doesNotMatch(sql, /alter table public\.tax_rule_relationships/);
  assert.doesNotMatch(sql, /alter table public\.tax_rule_unresolved_legal_references/);
  assert.doesNotMatch(sql, /alter table public\.country_legal_values/);
  assert.doesNotMatch(sql, /alter table public\.tax_fact_definitions/);
  assert.doesNotMatch(sql, /drop table public\.tax_/i);
  assert.doesNotMatch(sql, /activate_tax_legal_node/);
  assert.doesNotMatch(sql, /insert into public\.tax_legal_nodes/);
  assert.doesNotMatch(sql, /relationship_intent in/);
});

test('TAX-629 leaves 620-628 filenames untouched', () => {
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/620_owner_country_legal_access.sql')), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/621_country_localization.sql')), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/622_tax_legal_library_foundation.sql')), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/623_legal_value_version_authorities.sql')), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/624_knowledge_trainer_ingestion_foundation.sql')), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/625_knowledge_trainer_page_layout_evidence.sql')), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/626_exact_legal_identifiers.sql')), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/627_legal_ingestion_structure_runs.sql')), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/628_legal_identifier_printed_marker.sql')), true);
});

test('TAX-629 persist writes source spans and notes without rebuilding via PATCH or canonical writes', () => {
  const persist = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-structure.service.ts');
  const commands = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
  const read = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-read.service.ts');
  const types = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
  assert.match(persist, /source_page/);
  assert.match(persist, /legal_ingestion_source_notes/);
  assert.match(persist, /detectSourceNotesFromLayout/);
  assert.match(persist, /unresolvedAnchors/);
  assert.doesNotMatch(persist, /from\('legal_ingestion_candidates'\)\.delete/);
  assert.doesNotMatch(persist, /from\('tax_legal_nodes'\)\s*\.insert/);
  assert.match(commands, /Original source span evidence is immutable/);
  assert.match(commands, /SOURCE_SPAN_IMMUTABLE_FIELDS/);
  assert.doesNotMatch(commands, /accept_all|bulk_accept|auto_accept/i);
  assert.doesNotMatch(commands, /activate_tax_legal_node/);
  assert.match(read, /source_notes/);
  assert.match(read, /unresolved_source_note_anchors/);
  assert.match(types, /legal_ingestion_source_notes/);
  assert.match(types, /SOURCE_NOTE_CLASSIFICATIONS/);
});

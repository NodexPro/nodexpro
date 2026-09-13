import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const sqlRel = 'supabase/migrations/627_legal_ingestion_structure_runs.sql';

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-627 is additive trainer staging only and does not take canonical ownership', () => {
  assert.equal(existsSync(join(repoRoot, sqlRel)), true);
  const sql = readRepo(sqlRel);
  assert.match(sql, /Do not apply to production/);
  assert.match(sql, /jgxezhjctrgfbmmkqqhn/);
  assert.match(sql, /create table if not exists public\.legal_ingestion_structure_runs/);
  assert.match(sql, /status in \('building', 'ready', 'failed', 'superseded', 'cancelled'\)/);
  assert.match(sql, /active_structure_run_id/);
  assert.match(sql, /structure_run_id/);
  assert.match(sql, /legal_ingestion_activate_structure_run/);
  assert.match(sql, /legal_ingestion_fail_structure_run/);
  assert.match(sql, /legacy_incomplete_or_mismatched_count/);
  assert.match(sql, /uq_legal_ingestion_structure_runs_one_building/);
  assert.match(sql, /uq_legal_ingestion_structure_runs_one_ready/);
  assert.match(sql, /Does not write tax_legal_nodes/);
  assert.doesNotMatch(sql, /alter table public\.tax_domains/);
  assert.doesNotMatch(sql, /alter table public\.tax_sources/);
  assert.doesNotMatch(sql, /alter table public\.tax_legal_nodes/);
  assert.doesNotMatch(sql, /alter table public\.tax_rules/);
  assert.doesNotMatch(sql, /alter table public\.country_legal_values/);
  assert.doesNotMatch(sql, /alter table public\.tax_fact_definitions/);
  assert.doesNotMatch(sql, /drop table public\.tax_/i);
  assert.doesNotMatch(sql, /activate_tax_legal_node/);
  assert.doesNotMatch(sql, /insert into public\.tax_legal_nodes/);
});

test('TAX-627 leaves 620-626 filenames untouched', () => {
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/620_owner_country_legal_access.sql')), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/621_country_localization.sql')), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/622_tax_legal_library_foundation.sql')), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/623_legal_value_version_authorities.sql')), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/624_knowledge_trainer_ingestion_foundation.sql')), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/625_knowledge_trainer_page_layout_evidence.sql')), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/626_exact_legal_identifiers.sql')), true);
});

test('Persist no longer deletes the active set and requires bulk insert + RPC cutover', () => {
  const persist = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-structure.service.ts');
  const read = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-read.service.ts');
  const commands = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
  assert.match(persist, /legal_ingestion_activate_structure_run/);
  assert.match(persist, /legal_ingestion_fail_structure_run/);
  assert.match(persist, /chunkInOrder/);
  assert.match(persist, /assignDraftIds/);
  assert.match(persist, /fetchAllPaged/);
  assert.doesNotMatch(persist, /from\('legal_ingestion_candidates'\)\.delete/);
  assert.doesNotMatch(persist, /from\('tax_legal_nodes'\)\s*\.insert/);
  assert.doesNotMatch(persist, /from\('tax_legal_nodes'\)\s*\.delete/);
  assert.match(read, /structure_run_id/);
  assert.match(read, /active_structure_run_id/);
  assert.match(read, /fetchAllPaged/);
  assert.match(commands, /assertCandidateOnActiveRun/);
  assert.match(commands, /LEGAL_TRAINING_STRUCTURE_RUN_ACTIVATED/);
  assert.doesNotMatch(commands, /accept_all|bulk_accept|auto_accept/i);
  assert.doesNotMatch(commands, /activate_tax_legal_node/);
});

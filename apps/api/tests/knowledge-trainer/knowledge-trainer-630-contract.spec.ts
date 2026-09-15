import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const sqlRel = 'supabase/migrations/630_legal_ingestion_legal_text_drafts.sql';

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-630 is additive Trainer Layer B and does not take canonical ownership', () => {
  assert.equal(existsSync(join(repoRoot, sqlRel)), true);
  const sql = readRepo(sqlRel);
  assert.match(sql, /Do not apply to production/);
  assert.match(sql, /jgxezhjctrgfbmmkqqhn/);
  assert.match(sql, /create table if not exists public\.legal_ingestion_legal_text_drafts/);
  assert.match(sql, /Owner-editable legal-text draft \(Layer B\)/);
  assert.doesNotMatch(sql, /alter table public\.tax_domains/);
  assert.doesNotMatch(sql, /alter table public\.tax_sources/);
  assert.doesNotMatch(sql, /alter table public\.tax_legal_nodes/);
  assert.doesNotMatch(sql, /alter table public\.tax_rules/);
  assert.doesNotMatch(sql, /alter table public\.tax_rule_versions/);
  assert.doesNotMatch(sql, /alter table public\.tax_rule_relationships/);
  assert.doesNotMatch(sql, /alter table public\.country_legal_values/);
  assert.doesNotMatch(sql, /alter table public\.tax_fact_definitions/);
  assert.doesNotMatch(sql, /drop table public\.tax_/i);
  assert.doesNotMatch(sql, /insert into public\.tax_legal_nodes/);
  assert.doesNotMatch(sql, /insert into public\.tax_rules/);
  assert.doesNotMatch(sql, /activate_tax_legal_node/);
  assert.doesNotMatch(sql, /accepted_tax_legal_node_id/);
  assert.doesNotMatch(sql, /status in \('draft', 'active', 'retired'\)/);
});

test('TAX-630 leaves 620-629 filenames untouched', () => {
  for (const rel of [
    'supabase/migrations/620_owner_country_legal_access.sql',
    'supabase/migrations/621_country_localization.sql',
    'supabase/migrations/622_tax_legal_library_foundation.sql',
    'supabase/migrations/623_legal_value_version_authorities.sql',
    'supabase/migrations/624_knowledge_trainer_ingestion_foundation.sql',
    'supabase/migrations/625_knowledge_trainer_page_layout_evidence.sql',
    'supabase/migrations/626_exact_legal_identifiers.sql',
    'supabase/migrations/627_legal_ingestion_structure_runs.sql',
    'supabase/migrations/628_legal_identifier_printed_marker.sql',
    'supabase/migrations/629_legal_ingestion_source_evidence.sql',
  ]) {
    assert.equal(existsSync(join(repoRoot, rel)), true);
  }
});

test('Draft table is separate from tax_legal_nodes and detector candidates', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /create table if not exists public\.legal_ingestion_legal_text_drafts/);
  assert.doesNotMatch(sql, /alter table public\.tax_legal_nodes/);
  assert.doesNotMatch(sql, /alter table public\.legal_ingestion_candidates/);
  assert.match(sql, /Not canonical law\. Not detector candidates/);
  assert.match(sql, /parent_draft_id uuid null/);
  assert.match(sql, /legal_ingestion_legal_text_drafts_parent_same_document_fk/);
  assert.match(sql, /foreign key \(parent_draft_id, document_id\)/);
  assert.match(sql, /references public\.legal_ingestion_legal_text_drafts \(id, document_id\)/);
  assert.match(sql, /Not parent_candidate_id/);
  assert.doesNotMatch(sql, /parent_candidate_id uuid/);
});

test('original_source_text exists and original evidence cannot be overwritten', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /original_source_text text not null default ''/);
  assert.match(sql, /draft_legal_text text not null default ''/);
  assert.match(sql, /legal_ingestion_legal_text_drafts_original_immutable/);
  assert.match(sql, /original source evidence is immutable/);
  assert.match(sql, /structure_run_id is provenance and cannot be rebound/);
  assert.match(sql, /source_candidate_id is provenance and cannot be rebound/);
  assert.match(sql, /original_source_page_start/);
  assert.match(sql, /original_source_page_end/);
  assert.match(sql, /original_source_item_start/);
  assert.match(sql, /original_source_item_end/);
  assert.match(sql, /original_source_line_start/);
  assert.match(sql, /original_source_line_end/);
  assert.match(sql, /original_source_bbox/);
  assert.match(sql, /owner_source_page_start/);
  assert.match(sql, /Does not overwrite original_source_\*/);
  assert.doesNotMatch(sql, /before update or delete on public\.legal_ingestion_legal_text_drafts/);
});

test('structure_run and source_candidate are provenance and cannot cascade-delete drafts', () => {
  const sql = readRepo(sqlRel);
  assert.match(
    sql,
    /structure_run_id uuid null references public\.legal_ingestion_structure_runs\(id\) on delete set null/,
  );
  assert.match(
    sql,
    /source_candidate_id uuid null references public\.legal_ingestion_candidates\(id\) on delete set null/,
  );
  assert.match(sql, /PROVENANCE only/);
  assert.match(sql, /Not Draft identity/);
  assert.doesNotMatch(sql, /structure_runs\(id\) on delete cascade/i);
  assert.doesNotMatch(sql, /legal_ingestion_candidates\(id\) on delete cascade/i);
  assert.doesNotMatch(sql, /unique \(structure_run_id, source_candidate_id\)/);
});

test('identifier model reuses 626/628 semantics and keeps 3(ט1) distinct from 3(ט)(1)', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /source_display_identifier/);
  assert.match(sql, /normalized_machine_identifier/);
  assert.match(sql, /identifier_base_number/);
  assert.match(sql, /identifier_letter_suffix/);
  assert.match(sql, /identifier_nested_components jsonb not null default '\[\]'::jsonb/);
  assert.match(sql, /printed_marker text null/);
  assert.match(sql, /legal_identifier_nested_components_valid/);
  assert.match(sql, /3\(ט1\) vs 3\(ט\)\(1\)/);
  assert.doesNotMatch(sql, /node_number/);
  assert.doesNotMatch(sql, /unique index[\s\S]{0,200}normalized_machine_identifier/);
  assert.doesNotMatch(sql, /unique \([^)]*source_display_identifier/);
  assert.match(sql, /Identifier uniqueness is parent-aware and deferred to named commands/);
});

test('TAX-630 does not duplicate 629 notes, store PDF bytes, or grant worker ownership', () => {
  const sql = readRepo(sqlRel);
  const types = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
  const worker = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-worker.runtime.ts');
  const persist = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-structure.service.ts');
  const pdfSource = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-pdf-source.ts');

  assert.doesNotMatch(sql, /create table if not exists public\.legal_ingestion_source_notes/);
  assert.doesNotMatch(sql, /create table if not exists public\.legal_ingestion_source_note_anchors/);
  assert.doesNotMatch(sql, /insert into public\.legal_ingestion_source_notes/);
  assert.match(sql, /Does not copy 629 source notes/);
  assert.doesNotMatch(sql, /bytea|pdf_bytes|file_base64|storage_key/);
  assert.match(sql, /Does not store PDF bytes/);
  assert.match(sql, /revoke all on table public\.legal_ingestion_legal_text_drafts from anon, authenticated, public/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /force row level security/);
  assert.match(sql, /Worker\/detector must not write this table/);

  assert.doesNotMatch(types, /legal_ingestion_legal_text_drafts/);
  assert.match(types, /WORKER_ALLOWED_TABLES = \[[\s\S]*legal_ingestion_source_note_anchors/);
  assert.doesNotMatch(
    types,
    /WORKER_ALLOWED_TABLES = \[[\s\S]*legal_ingestion_legal_text_drafts/,
  );
  assert.doesNotMatch(worker, /legal_ingestion_legal_text_drafts/);
  assert.doesNotMatch(persist, /legal_ingestion_legal_text_drafts/);
  assert.match(pdfSource, /createWorkerPdfSourceCache/);
});

test('parent guard and review/boundary statuses are draft-layer only', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /text_boundary_status text not null/);
  assert.match(sql, /review_status text not null/);
  assert.match(sql, /text_boundary_status in \('certain', 'uncertain', 'owner_defined'\)/);
  assert.match(sql, /review_status in \('draft', 'needs_review', 'ready'\)/);
  assert.match(sql, /legal_ingestion_legal_text_drafts_guard_parent/);
  assert.match(sql, /parent_draft_id must belong to the same country/);
  assert.match(sql, /parent_draft_id must belong to the same document/);
  assert.match(sql, /cannot create a cycle/);
  assert.match(sql, /legal_ingestion_legal_text_drafts_guard_scope/);
  assert.match(sql, /Empty string means incomplete\/OCR-missing evidence/);
  assert.match(sql, /Not canonical activation or publication/);
  assert.doesNotMatch(sql, /review_status in \('draft', 'needs_review', 'ready', 'accepted'\)/);
});

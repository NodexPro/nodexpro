import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const sqlRel = 'supabase/migrations/635_legal_ingestion_owner_manual_drafts.sql';
const sql630Rel = 'supabase/migrations/630_legal_ingestion_legal_text_drafts.sql';
const sql632Rel = 'supabase/migrations/632_legal_ingestion_draft_subtree_source.sql';

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-635 is additive Trainer Layer B and does not take canonical ownership', () => {
  assert.equal(existsSync(join(repoRoot, sqlRel)), true);
  const sql = readRepo(sqlRel);
  assert.match(sql, /Do not apply to production/);
  assert.match(sql, /jgxezhjctrgfbmmkqqhn/);
  assert.match(sql, /ADDITIVE ONLY/);
  assert.match(sql, /Does not drop, rewrite, or edit migrations 620–632/);
  assert.doesNotMatch(sql, /alter table public\.tax_domains/);
  assert.doesNotMatch(sql, /alter table public\.tax_sources/);
  assert.doesNotMatch(sql, /alter table public\.tax_legal_nodes/);
  assert.doesNotMatch(sql, /alter table public\.tax_rules/);
  assert.doesNotMatch(sql, /alter table public\.tax_rule_versions/);
  assert.doesNotMatch(sql, /alter table public\.tax_rule_relationships/);
  assert.doesNotMatch(sql, /alter table public\.country_legal_values/);
  assert.doesNotMatch(sql, /alter table public\.tax_fact_definitions/);
  assert.doesNotMatch(sql, /alter table public\.legal_ingestion_candidates/);
  assert.doesNotMatch(sql, /insert into public\.tax_legal_nodes/);
  assert.doesNotMatch(sql, /insert into public\.tax_rules/);
  assert.doesNotMatch(sql, /insert into public\.legal_ingestion_candidates/);
  assert.doesNotMatch(sql, /activate_tax_legal_node/);
  assert.doesNotMatch(sql, /accepted_tax_legal_node_id/);
});

test('TAX-635 leaves 620-632 filenames untouched and does not rewrite existing Draft rows', () => {
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
    sql630Rel,
    sql632Rel,
  ]) {
    assert.equal(existsSync(join(repoRoot, rel)), true);
  }
  const sql = readRepo(sqlRel);
  assert.doesNotMatch(sql, /update public\.legal_ingestion_legal_text_drafts/i);
  assert.doesNotMatch(sql, /insert into public\.legal_ingestion_legal_text_drafts/i);
  assert.doesNotMatch(sql, /insert into public\.legal_ingestion_owner_completeness/i);
  assert.doesNotMatch(sql, /set draft_legal_text/i);
  assert.doesNotMatch(sql, /set review_status/i);
  assert.doesNotMatch(sql, /set original_source_text/i);
  assert.doesNotMatch(sql, /set source_candidate_id/i);
  assert.doesNotMatch(sql, /set creation_origin/i);
  assert.doesNotMatch(sql, /drop column/i);
  assert.doesNotMatch(sql, /drop table public\.legal_ingestion_legal_text_drafts/i);
});

test('creation_origin is durable detector|owner_manual and survives provenance SET NULL', () => {
  const sql = readRepo(sqlRel);
  const sql630 = readRepo(sql630Rel);
  assert.match(sql, /add column if not exists creation_origin text not null default 'detector'/);
  assert.match(sql, /creation_origin in \('detector', 'owner_manual'\)/);
  assert.match(sql, /Existing legal_ingestion_legal_text_drafts rows remain creation_origin = detector/);
  assert.match(sql, /creation_origin is durable and cannot be changed/);
  assert.match(sql, /including when source_candidate_id becomes NULL/);
  assert.match(sql, /creation_origin <> 'owner_manual' or source_candidate_id is null/);
  assert.match(sql, /Survives source_candidate_id ON DELETE SET NULL/);
  assert.match(
    sql630,
    /source_candidate_id uuid null references public\.legal_ingestion_candidates\(id\) on delete set null/,
  );
  assert.doesNotMatch(sql, /review_status in \('draft', 'needs_review', 'ready', 'owner_manual'\)/);
  assert.doesNotMatch(sql, /review_status in \('draft', 'needs_review', 'ready', 'complete'\)/);
});

test('owner_sort_key is nullable and never rewrites detector candidate.sort_order', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /add column if not exists owner_sort_key numeric null/);
  assert.match(sql, /NULL = detector candidate\.sort_order remains authoritative/);
  assert.match(sql, /between-neighbors numeric/);
  assert.match(sql, /Never modifies legal_ingestion_candidates\.sort_order/);
  assert.match(sql, /Never rewrite candidate\.sort_order/);
  assert.doesNotMatch(sql, /alter table public\.legal_ingestion_candidates/);
  assert.doesNotMatch(sql, /set sort_order/i);
  assert.doesNotMatch(sql, /update public\.legal_ingestion_candidates/i);
});

test('completeness is Layer B document/branch confirmation and does not overload review_status', () => {
  const sql = readRepo(sqlRel);
  const sql630 = readRepo(sql630Rel);
  assert.match(sql, /create table if not exists public\.legal_ingestion_owner_completeness/);
  assert.match(sql, /Layer B Owner confirmation/);
  assert.match(sql, /document_id uuid not null/);
  assert.match(sql, /branch_draft_id uuid null/);
  assert.match(sql, /NULL = whole-document completeness confirmation/);
  assert.match(sql, /Non-null = that Owner Draft subtree only/);
  assert.match(sql, /confirmed_by uuid not null/);
  assert.match(sql, /confirmed_at timestamptz not null default now\(\)/);
  assert.match(sql, /uq_legal_ingestion_owner_completeness_document/);
  assert.match(sql, /where branch_draft_id is null/);
  assert.match(sql, /uq_legal_ingestion_owner_completeness_branch/);
  assert.match(sql, /where branch_draft_id is not null/);
  assert.match(sql, /foreign key \(document_id, country_code\)/);
  assert.match(sql, /references public\.legal_ingestion_documents \(id, country_code\)/);
  assert.match(sql, /legal_ingestion_owner_completeness_branch_same_document_fk/);
  assert.match(sql, /foreign key \(branch_draft_id, document_id\)/);
  assert.match(sql, /references public\.legal_ingestion_legal_text_drafts \(id, document_id\)/);
  assert.match(sql, /legal_ingestion_owner_completeness_branch_same_country_fk/);
  assert.match(sql, /owner completeness country_code must match the document/);
  assert.match(sql, /branch_draft_id must belong to the same document/);
  assert.match(sql, /branch_draft_id must belong to the same country/);
  assert.match(sql, /Not review_status/);
  assert.match(sql630, /review_status in \('draft', 'needs_review', 'ready'\)/);
  assert.doesNotMatch(sql, /drop constraint if exists legal_ingestion_legal_text_drafts_review_status/);
  assert.doesNotMatch(sql, /add column if not exists review_status/);
  assert.doesNotMatch(sql, /alter table public\.legal_ingestion_documents[\s\S]{0,120}add column/);
});

test('TAX-635 RLS matches TAX-630 service_role-only Trainer tables', () => {
  const sql = readRepo(sqlRel);
  const sql630 = readRepo(sql630Rel);
  assert.match(sql, /alter table public\.legal_ingestion_owner_completeness enable row level security/);
  assert.match(sql, /alter table public\.legal_ingestion_owner_completeness force row level security/);
  assert.match(sql, /revoke all on table public\.legal_ingestion_owner_completeness from anon, authenticated, public/);
  assert.match(sql, /grant select, insert, update, delete on table public\.legal_ingestion_owner_completeness to service_role/);
  assert.match(sql630, /revoke all on table public\.legal_ingestion_legal_text_drafts from anon, authenticated, public/);
  assert.match(sql630, /grant select, insert, update, delete on table public\.legal_ingestion_legal_text_drafts to service_role/);
});

test('TAX-635 stores no PDF/blob and does not grant worker or canonical ownership', () => {
  const sql = readRepo(sqlRel);
  const types = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
  const worker = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-worker.runtime.ts');
  const persist = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-structure.service.ts');

  assert.doesNotMatch(sql, /bytea|pdf_bytes|file_base64|storage_key/);
  assert.match(sql, /Does not store PDF bytes/);
  assert.match(sql, /Does not grant worker\/detector ownership/);
  assert.doesNotMatch(
    types,
    /WORKER_ALLOWED_TABLES = \[[\s\S]*legal_ingestion_legal_text_drafts/,
  );
  assert.doesNotMatch(
    types,
    /WORKER_ALLOWED_TABLES = \[[\s\S]*legal_ingestion_owner_completeness/,
  );
  assert.doesNotMatch(worker, /legal_ingestion_owner_completeness/);
  assert.doesNotMatch(worker, /creation_origin/);
  assert.doesNotMatch(persist, /legal_ingestion_owner_completeness/);
  assert.doesNotMatch(persist, /legal_ingestion_legal_text_drafts/);
});

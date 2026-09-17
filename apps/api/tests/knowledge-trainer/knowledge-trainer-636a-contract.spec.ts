import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const sqlRel = 'supabase/migrations/636_legal_ingestion_tax_knowledge_proposals.sql';
const sql635Rel = 'supabase/migrations/635_legal_ingestion_owner_manual_drafts.sql';
const sql630Rel = 'supabase/migrations/630_legal_ingestion_legal_text_drafts.sql';

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-636A is additive Layer B2 and does not take canonical ownership', () => {
  assert.equal(existsSync(join(repoRoot, sqlRel)), true);
  const sql = readRepo(sqlRel);
  assert.match(sql, /TAX-636A/);
  assert.match(sql, /Do not apply to production/);
  assert.match(sql, /jgxezhjctrgfbmmkqqhn/);
  assert.match(sql, /ADDITIVE ONLY/);
  assert.match(sql, /Does not drop, rewrite, or edit migrations 620–635/);
  assert.match(sql, /create table if not exists public\.legal_ingestion_tax_knowledge_proposals/);
  assert.match(sql, /Layer B2 proposed structured Tax Knowledge/);
  assert.match(sql, /This is NOT a second canonical knowledge graph/);
  assert.match(sql, /Not tax_rules, not tax_rule_versions, not tax_legal_nodes/);
  assert.doesNotMatch(sql, /alter table public\.tax_domains/);
  assert.doesNotMatch(sql, /alter table public\.tax_sources/);
  assert.doesNotMatch(sql, /alter table public\.tax_legal_nodes/);
  assert.doesNotMatch(sql, /alter table public\.tax_rules/);
  assert.doesNotMatch(sql, /alter table public\.tax_rule_versions/);
  assert.doesNotMatch(sql, /alter table public\.tax_rule_relationships/);
  assert.doesNotMatch(sql, /alter table public\.country_legal_values/);
  assert.doesNotMatch(sql, /alter table public\.tax_fact_definitions/);
  assert.doesNotMatch(sql, /alter table public\.legal_ingestion_legal_text_drafts/);
  assert.doesNotMatch(sql, /alter table public\.legal_ingestion_candidates/);
  assert.doesNotMatch(sql, /alter table public\.legal_ingestion_owner_completeness/);
});

test('TAX-636A leaves 620-635 filenames untouched and writes no Owner Draft or candidate rows', () => {
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
    'supabase/migrations/632_legal_ingestion_draft_subtree_source.sql',
    sql635Rel,
  ]) {
    assert.equal(existsSync(join(repoRoot, rel)), true);
  }
  const sql = readRepo(sqlRel);
  assert.doesNotMatch(sql, /insert into public\.legal_ingestion_legal_text_drafts/i);
  assert.doesNotMatch(sql, /update public\.legal_ingestion_legal_text_drafts/i);
  assert.doesNotMatch(sql, /delete from public\.legal_ingestion_legal_text_drafts/i);
  assert.doesNotMatch(sql, /insert into public\.legal_ingestion_candidates/i);
  assert.doesNotMatch(sql, /update public\.legal_ingestion_candidates/i);
  assert.doesNotMatch(sql, /set review_status/i);
  assert.doesNotMatch(sql, /set draft_legal_text/i);
  assert.doesNotMatch(sql, /drop table public\.legal_ingestion_legal_text_drafts/i);
  assert.doesNotMatch(sql, /drop column/i);
});

test('proposal requires Owner Draft provenance and country/document/source integrity', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /legal_text_draft_id uuid not null/);
  assert.match(sql, /REQUIRED Layer B Owner Draft pin/);
  assert.match(sql, /A proposal cannot exist without this provenance/);
  assert.match(sql, /country_code char\(2\) not null/);
  assert.match(sql, /document_id uuid not null/);
  assert.match(sql, /tax_source_id uuid not null/);
  assert.match(
    sql,
    /structure_run_id uuid null references public\.legal_ingestion_structure_runs\(id\) on delete set null/,
  );
  assert.match(sql, /legal_ingestion_tax_knowledge_proposals_draft_country_fk/);
  assert.match(sql, /foreign key \(legal_text_draft_id, country_code\)/);
  assert.match(sql, /references public\.legal_ingestion_legal_text_drafts \(id, country_code\)/);
  assert.match(sql, /legal_ingestion_tax_knowledge_proposals_draft_document_fk/);
  assert.match(sql, /foreign key \(legal_text_draft_id, document_id\)/);
  assert.match(sql, /references public\.legal_ingestion_legal_text_drafts \(id, document_id\)/);
  assert.match(sql, /foreign key \(document_id, country_code\)/);
  assert.match(sql, /references public\.legal_ingestion_documents \(id, country_code\)/);
  assert.match(sql, /foreign key \(tax_source_id, country_code\)/);
  assert.match(sql, /references public\.tax_sources \(id, country_code\)/);
  assert.match(sql, /proposal country_code must match the Owner Draft/);
  assert.match(sql, /proposal document_id must match the Owner Draft/);
  assert.match(sql, /proposal tax_source_id must match the Owner Draft/);
  assert.match(sql, /structure_run_id provenance must match proposal country, document, and tax source/);
  assert.match(sql, /proposal Owner Draft \/ country \/ document \/ tax_source provenance is immutable/);
  assert.doesNotMatch(sql, /legal_text_draft_id uuid null/);
  assert.doesNotMatch(sql, /structure_runs\(id\) on delete cascade/i);
});

test('proposal lifecycle cannot represent canonical active and insert is proposed only', () => {
  const sql = readRepo(sqlRel);
  assert.match(
    sql,
    /status in \(\s*'proposed',\s*'needs_review',\s*'owner_approved',\s*'rejected',\s*'published_to_canonical_draft'\s*\)/,
  );
  assert.match(sql, /Never active\. Never canonical active/);
  assert.match(sql, /owner_approved is not Tax Brain activation/);
  assert.match(sql, /published_to_canonical_draft is a proposal workflow status only/);
  assert.match(sql, /must be inserted as proposed/);
  assert.match(sql, /Invalid proposal status transition/);
  assert.match(sql, /proposal may be published_to_canonical_draft only from owner_approved/);
  assert.match(sql, /rejected\/published proposal status is frozen/);
  assert.doesNotMatch(sql, /status in \('draft', 'active', 'retired'\)/);
  assert.doesNotMatch(sql, /status in \('draft', 'active', 'superseded', 'retired'\)/);
  assert.doesNotMatch(sql, /'canonical_active'/);
  assert.doesNotMatch(sql, /'published_active'/);
  assert.doesNotMatch(sql, /check \(status in \([^)]*'active'/);
});

test('creation_origin is durable ai_proposal|owner_corrected and is not inferred from FKs', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /creation_origin in \('ai_proposal', 'owner_corrected'\)/);
  assert.match(sql, /Not inferred from nullable FKs/);
  assert.match(sql, /creation_origin is durable and cannot be changed/);
  assert.doesNotMatch(sql, /creation_origin in \('detector', 'owner_manual'\)/);
  assert.doesNotMatch(sql, /creation_origin text not null default/);
});

test('revision model retains history and does not overwrite an old proposal', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /revision_no integer not null/);
  assert.match(sql, /uq_legal_ingestion_tax_knowledge_proposals_draft_revision/);
  assert.match(sql, /legal_text_draft_id, revision_no/);
  assert.match(sql, /must be monotonic per legal_text_draft_id/);
  assert.match(sql, /Same draft may have many revisions/);
  assert.match(sql, /re-analysis \/ Owner correction INSERTs a new row/);
  assert.match(sql, /proposal_json is immutable after insert; create a new revision/);
  assert.match(sql, /rejected\/published rows cannot be silently overwritten/);
  assert.match(sql, /Hard delete is forbidden for legal_ingestion_tax_knowledge_proposals/);
  assert.match(sql, /legal_ingestion_tax_knowledge_proposals_forbid_delete/);
  assert.match(sql, /legal_ingestion_tax_knowledge_proposals_forbid_truncate/);
  assert.match(sql, /supersedes_proposal_id uuid null/);
  assert.match(sql, /legal_ingestion_tax_knowledge_proposals_supersedes_same_draft_fk/);
  assert.match(sql, /Not a parallel canonical version system/);
  assert.doesNotMatch(sql, /create unique index if not exists uq_legal_ingestion_tax_knowledge_proposals_draft_only/);
  assert.doesNotMatch(
    sql,
    /create unique index if not exists uq_legal_ingestion_tax_knowledge_proposals_one_draft\s+on public\.legal_ingestion_tax_knowledge_proposals \(legal_text_draft_id\)/,
  );
});

test('proposal_json stores structured semantics and does not replace Layer B prose', () => {
  const sql = readRepo(sqlRel);
  const sql630 = readRepo(sql630Rel);
  assert.match(sql, /proposal_json jsonb not null/);
  assert.match(sql, /jsonb_typeof\(proposal_json\) = 'object'/);
  assert.match(sql, /Does not replace Layer B draft_legal_text/);
  assert.match(sql, /Structured proposed Tax Knowledge semantics/);
  assert.doesNotMatch(sql, /draft_legal_text text/);
  assert.doesNotMatch(sql, /original_source_text text/);
  assert.match(sql630, /draft_legal_text text not null default ''/);
});

test('publication trace stays null until a future Owner command and cannot activate canonical law', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /published_tax_rule_id uuid null/);
  assert.match(sql, /published_tax_rule_version_id uuid null/);
  assert.match(sql, /published_tax_legal_node_id uuid null/);
  assert.match(sql, /NULL until that command/);
  assert.match(sql, /Migration must not populate/);
  assert.match(sql, /publication trace must remain null until a future Owner publish-to-canonical-draft command/);
  assert.match(sql, /publication trace can only pin a draft canonical rule version, never active/);
  assert.match(sql, /publication trace can only pin a draft canonical legal node, never active/);
  assert.match(sql, /This function does not INSERT canonical objects/);
  assert.match(sql, /No migration trigger may create tax_rules \/ tax_rule_versions \/ tax_legal_nodes/);
  assert.doesNotMatch(sql, /insert into public\.tax_legal_nodes/i);
  assert.doesNotMatch(sql, /insert into public\.tax_rules/i);
  assert.doesNotMatch(sql, /insert into public\.tax_rule_versions/i);
  assert.doesNotMatch(sql, /insert into public\.tax_sources/i);
  assert.doesNotMatch(sql, /update public\.tax_rule_versions/i);
  assert.doesNotMatch(sql, /update public\.tax_legal_nodes/i);
  assert.doesNotMatch(sql, /activate_tax_legal_node/);
  assert.doesNotMatch(sql, /activate_tax_rule_version/);
  assert.doesNotMatch(sql, /status = 'active'/);
});

test('TAX-636A RLS is service_role-only and does not grant worker or anon writes', () => {
  const sql = readRepo(sqlRel);
  const types = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
  const worker = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-worker.runtime.ts');
  const persist = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-structure.service.ts');

  assert.match(sql, /alter table public\.legal_ingestion_tax_knowledge_proposals enable row level security/);
  assert.match(sql, /alter table public\.legal_ingestion_tax_knowledge_proposals force row level security/);
  assert.match(
    sql,
    /revoke all on table public\.legal_ingestion_tax_knowledge_proposals from anon, authenticated, public/,
  );
  assert.match(
    sql,
    /grant select, insert, update on table public\.legal_ingestion_tax_knowledge_proposals to service_role/,
  );
  assert.doesNotMatch(
    sql,
    /grant select, insert, update, delete on table public\.legal_ingestion_tax_knowledge_proposals to service_role/,
  );
  assert.doesNotMatch(sql, /grant all on table public\.legal_ingestion_tax_knowledge_proposals/);
  assert.match(sql, /Does not grant worker\/detector ownership/);
  assert.doesNotMatch(sql, /bytea|pdf_bytes|file_base64|storage_key/);
  assert.doesNotMatch(
    types,
    /WORKER_ALLOWED_TABLES = \[[\s\S]*legal_ingestion_tax_knowledge_proposals/,
  );
  assert.doesNotMatch(worker, /legal_ingestion_tax_knowledge_proposals/);
  assert.doesNotMatch(persist, /legal_ingestion_tax_knowledge_proposals/);
});

test('TAX-636A SQL does not implement commands, UI, AI, F2B/F2C, or activation', () => {
  const sql = readRepo(sqlRel);
  const knowledgeCommands = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge.types.ts');

  assert.match(sql, /Does not implement commands, UI, AI\/LLM, prompts, F2B\/F2C, or activation/);
  assert.doesNotMatch(sql, /create_tax_knowledge_proposal/);
  assert.doesNotMatch(sql, /publish_tax_knowledge_proposal/);
  assert.doesNotMatch(knowledgeCommands, /activate_tax_legal_node/);
  assert.doesNotMatch(sql, /openai|anthropic|prompt_template/i);
  assert.doesNotMatch(sql, /tax_advisory_scenarios/);
  assert.doesNotMatch(sql, /create table if not exists public\.tax_advisory/);
});

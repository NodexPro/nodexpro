import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const sqlRel = 'supabase/migrations/640_legal_ingestion_ai_generation_metadata.sql';
const sql636Rel = 'supabase/migrations/636_legal_ingestion_tax_knowledge_proposals.sql';

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-640A is additive B2 metadata only and does not take canonical ownership', () => {
  assert.equal(existsSync(join(repoRoot, sqlRel)), true);
  const sql = readRepo(sqlRel);
  const sql636 = readRepo(sql636Rel);

  assert.match(sql, /TAX-640A/);
  assert.match(sql, /Do not apply to production/);
  assert.match(sql, /Do not apply in this ticket/);
  assert.match(sql, /jgxezhjctrgfbmmkqqhn/);
  assert.match(sql, /ADDITIVE ONLY/);
  assert.match(sql, /Does not drop, rewrite, or edit migrations 620–636/);
  assert.match(sql, /add column if not exists generation_metadata_json jsonb null/);
  assert.match(sql, /Does not alter proposal_json/);
  assert.match(sql, /proposal_json remains pure tax_knowledge_proposal_v1/);
  assert.doesNotMatch(sql636, /generation_metadata_json/);
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
  assert.doesNotMatch(sql, /alter column proposal_json/);
  assert.doesNotMatch(sql, /drop column/);
});

test('TAX-640A does not rewrite history, fabricate metadata, or write legal/canonical rows', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /Does not fabricate generation metadata for historical rows/);
  assert.match(sql, /legal_ingestion_tax_knowledge_proposals total rows = 0/);
  assert.match(sql, /creation_origin = ai_proposal rows = 0/);
  assert.match(sql, /Therefore NOT-NULL-by-origin is safe/);
  assert.match(
    sql,
    /TAX-640A STOP: % existing ai_proposal row\(s\) have NULL generation_metadata_json/,
  );
  assert.match(sql, /Do not fabricate historical metadata/);
  assert.match(sql, /Do not weaken NOT-NULL-by-origin/);
  assert.doesNotMatch(sql, /update public\.legal_ingestion_tax_knowledge_proposals/i);
  assert.doesNotMatch(sql, /insert into public\.legal_ingestion_tax_knowledge_proposals/i);
  assert.doesNotMatch(sql, /insert into public\.legal_ingestion_legal_text_drafts/i);
  assert.doesNotMatch(sql, /update public\.legal_ingestion_legal_text_drafts/i);
  assert.doesNotMatch(sql, /insert into public\.legal_ingestion_candidates/i);
  assert.doesNotMatch(sql, /insert into public\.tax_legal_nodes/i);
  assert.doesNotMatch(sql, /insert into public\.tax_rules/i);
  assert.doesNotMatch(sql, /insert into public\.tax_rule_versions/i);
  assert.doesNotMatch(sql, /update public\.tax_rule_versions/i);
  assert.doesNotMatch(sql, /set proposal_json/i);
  assert.doesNotMatch(sql, /set generation_metadata_json/i);
  assert.doesNotMatch(sql, /activate_tax_legal_node/);
  assert.doesNotMatch(sql, /activate_tax_rule_version/);
});

test('generation_metadata_json is outside proposal_json and follows origin nullability', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /OUTSIDE proposal_json/);
  assert.match(sql, /NULL for owner_corrected/);
  assert.match(sql, /REQUIRED for ai_proposal/);
  assert.match(sql, /legal_ingestion_tkp_generation_metadata_obj/);
  assert.match(sql, /jsonb_typeof\(generation_metadata_json\) = 'object'/);
  assert.match(sql, /legal_ingestion_tkp_generation_metadata_origin/);
  assert.match(
    sql,
    /creation_origin = 'ai_proposal'\s+and generation_metadata_json is not null/,
  );
  assert.match(
    sql,
    /creation_origin = 'owner_corrected'\s+and generation_metadata_json is null/,
  );
  assert.match(sql, /owner_corrected generation_metadata_json must be null/);
});

test('TAX-640A closed AI metadata contract forbids secrets, prompts, completions, and legal text', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /legal_ingestion_tkp_generation_metadata_contract/);
  assert.match(sql, /'schema_version'/);
  assert.match(sql, /'provider'/);
  assert.match(sql, /'model'/);
  assert.match(sql, /'prompt_contract_version'/);
  assert.match(sql, /'output_contract'/);
  assert.match(sql, /'output_schema_version'/);
  assert.match(sql, /'generated_at'/);
  assert.match(sql, /'input_context_digest'/);
  assert.match(sql, /prompt_contract_version' = 'tax_knowledge_proposal_extract_v1'/);
  assert.match(sql, /output_contract' = 'tax_knowledge_proposal_v1'/);
  assert.match(sql, /generation_metadata_json->'schema_version' = '1'::jsonb/);
  assert.match(sql, /generation_metadata_json->'output_schema_version' = '1'::jsonb/);
  assert.match(sql, /btrim\(generation_metadata_json->>'model'\) is distinct from 'latest'/);
  assert.match(sql, /input_context_digest' ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(sql, /legal_ingestion_tkp_assert_generation_metadata/);
  assert.match(sql, /contains a key outside the closed contract/);
  for (const key of [
    'api_key',
    'secret',
    'prompt',
    'raw_prompt',
    'completion',
    'raw_completion',
    'legal_text',
    'draft_legal_text',
    'amount',
    'rate',
    'statutory_amount',
  ]) {
    assert.match(sql, new RegExp(`'${key}'`));
  }
  assert.match(sql, /NEVER store API key, secrets, raw prompt, raw completion, raw legal text/);
});

test('TAX-640A freezes generation_metadata_json without weakening TAX-636 history protection', () => {
  const sql = readRepo(sqlRel);
  const sql636 = readRepo(sql636Rel);
  assert.match(sql, /generation_metadata_json is immutable after insert; create a new revision/);
  assert.match(sql, /proposal_json is immutable after insert; create a new revision/);
  assert.match(sql, /proposal created_at is immutable/);
  assert.match(sql, /proposal created_by is immutable/);
  assert.match(sql, /proposal Owner Draft \/ country \/ document \/ tax_source provenance is immutable/);
  assert.match(sql, /creation_origin is durable and cannot be changed/);
  assert.match(sql, /proposal revision_no is immutable/);
  assert.match(sql, /supersedes_proposal_id is immutable after insert/);
  assert.match(sql, /structure_run_id is provenance and cannot be rebound/);
  assert.match(sql, /rejected\/published proposal status is frozen/);
  assert.match(sql, /proposal may be published_to_canonical_draft only from owner_approved/);
  assert.match(sql, /Invalid proposal status transition/);
  assert.match(sql, /rejected proposal publication trace is frozen/);
  assert.match(sql, /published_tax_rule_id cannot be changed once set/);
  assert.match(sql, /publication trace must remain null until published_to_canonical_draft/);
  assert.match(sql, /legal_ingestion_tax_knowledge_proposals must be inserted as proposed/);
  assert.match(sql, /publication trace must remain null until a future Owner publish-to-canonical-draft command/);
  assert.match(sql636, /proposal_json is immutable after insert; create a new revision/);
  assert.match(sql636, /rejected\/published rows cannot be silently overwritten/);
});

test('TAX-640A SQL does not implement gateway, AI calls, commands, UI, F2B/F2C, or activation', () => {
  const sql = readRepo(sqlRel);
  const types = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
  const service = readRepo(
    'apps/api/src/domains/knowledge-trainer/knowledge-trainer-tax-knowledge-proposal.service.ts',
  );
  const worker = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-worker.runtime.ts');

  assert.match(sql, /Does not implement AI gateway, provider SDK, env secrets, prompts, commands, or UI/);
  assert.doesNotMatch(sql, /openai|anthropic|gemini|prompt_template/i);
  assert.doesNotMatch(sql, /OPENAI_API_KEY|TAX_KNOWLEDGE_AI_/);
  assert.doesNotMatch(sql, /generate_tax_knowledge_proposal/);
  assert.doesNotMatch(sql, /create_tax_knowledge_proposal/);
  assert.doesNotMatch(sql, /publish_tax_knowledge_proposal/);
  assert.doesNotMatch(sql, /tax_advisory_scenarios/);
  assert.doesNotMatch(types, /generate_tax_knowledge_proposal/);
  assert.doesNotMatch(service, /openai|anthropic|prompt_template/i);
  assert.doesNotMatch(service, /generation_metadata_json/);
  assert.doesNotMatch(worker, /generation_metadata_json/);
  assert.doesNotMatch(worker, /openai|anthropic|gemini/i);
});

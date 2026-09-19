import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

const MIGRATION = 'supabase/migrations/643_legal_ingestion_proposal_canonical_draft_publication.sql';

test('TAX-648C adds publication map + atomic draft RPC without Owner publish command or UI', () => {
  assert.equal(existsSync(join(repoRoot, MIGRATION)), true);
  const sql = readRepo(MIGRATION);
  const commands = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
  const proposal = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-tax-knowledge-proposal.service.ts');
  const audit = readRepo('apps/api/src/shared/audit-events.ts');
  const ownerView = readRepo('apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-owner-view.pure.ts');
  const view = readRepo('apps/web/src/pages/owner-tax-knowledge-proposal-view.tsx');

  assert.match(sql, /legal_ingestion_tax_knowledge_proposal_publications/);
  assert.match(sql, /local_kind in \('legal_node', 'rule', 'rule_version'\)/);
  assert.match(sql, /uq_legal_ingestion_proposal_publications_local/);
  assert.match(sql, /legal_ingestion_proposal_publications_proposal_country_fk/);
  assert.match(sql, /legal_ingestion_apply_tax_knowledge_proposal_canonical_draft_publication/);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = public/);
  assert.match(sql, /grant execute on function public\.legal_ingestion_apply_tax_knowledge_proposal_canonical_draft_publication\(uuid, uuid, jsonb\) to service_role/);
  assert.match(sql, /revoke all on function public\.legal_ingestion_apply_tax_knowledge_proposal_canonical_draft_publication/);
  assert.doesNotMatch(sql, /grant execute[^\n]+legal_ingestion_apply_tax_knowledge_proposal_canonical_draft_publication[^\n]+to (anon|authenticated|public)/i);
  assert.match(sql, /status = 'published_to_canonical_draft'/);
  assert.match(sql, /legal_training_tax_knowledge_proposal_published_to_canonical_draft/);
  assert.match(sql, /insert into public\.tax_legal_nodes/);
  assert.match(sql, /insert into public\.tax_rules/);
  assert.match(sql, /insert into public\.tax_rule_versions/);
  assert.match(sql, /insert into public\.tax_rule_legal_nodes/);
  assert.match(sql, /insert into public\.tax_rule_version_sources/);
  assert.match(sql, /insert into public\.tax_rule_version_legal_values/);
  assert.match(sql, /insert into public\.tax_rule_relationships/);
  assert.match(sql, /insert into public\.tax_rule_unresolved_legal_references/);
  assert.match(sql, /,\s*'draft'/);
  assert.match(sql, /TAX-648C does not publish K4 calculations/);
  assert.match(sql, /publication will not create Country Legal Values/);
  assert.match(sql, /uq_tax_rule_legal_nodes_pair/);
  assert.match(sql, /uq_tax_rule_version_sources_citation/);
  assert.match(sql, /uq_tax_rule_version_legal_values_pair/);
  assert.match(sql, /uq_tax_rule_relationships_edge/);
  assert.match(sql, /uq_tax_rule_unresolved_identity/);
  assert.doesNotMatch(sql, /activate_tax_rule_version/);
  assert.doesNotMatch(sql, /legal_knowledge\.activate/);
  assert.doesNotMatch(sql, /tax_calculation_/);
  assert.doesNotMatch(sql, /insert into public\.tax_fact_definitions/);
  assert.doesNotMatch(sql, /insert into public\.country_legal_values/);
  assert.doesNotMatch(sql, /publish_tax_knowledge_proposal_to_canonical_draft/);

  assert.match(audit, /LEGAL_TRAINING_TAX_KNOWLEDGE_PROPOSAL_PUBLISHED_TO_CANONICAL_DRAFT/);
  assert.match(audit, /legal_training_tax_knowledge_proposal_published_to_canonical_draft/);
  assert.doesNotMatch(ownerView, /publish_tax_knowledge_proposal/);
  assert.doesNotMatch(view, /publish_tax_knowledge_proposal/);
  assert.doesNotMatch(sql, /publish_tax_knowledge_proposal_to_canonical_draft/);
  assert.doesNotMatch(commands, /legal_ingestion_apply_tax_knowledge_proposal_canonical_draft_publication/);
  assert.doesNotMatch(proposal, /legal_ingestion_apply_tax_knowledge_proposal_canonical_draft_publication/);
});

test('TAX-648C keeps singular published_* pins; 644 is rename-only after NAMEDATALEN truncation', () => {
  const sql636 = readRepo('supabase/migrations/636_legal_ingestion_tax_knowledge_proposals.sql');
  const sql643 = readRepo(MIGRATION);
  assert.match(sql636, /published_tax_rule_id/);
  assert.match(sql636, /published_tax_rule_version_id/);
  assert.match(sql636, /published_tax_legal_node_id/);
  assert.match(sql643, /published_tax_rule_id = v_first_rule/);
  assert.match(sql643, /published_tax_rule_version_id = v_first_version/);
  assert.match(sql643, /published_tax_legal_node_id = v_first_node/);
  assert.match(sql643, /already_published/);
  assert.match(sql643, /for update/);

  const migrationsDir = join(repoRoot, 'supabase/migrations');
  const taxBrain = readdirSync(migrationsDir)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name) && Number(name.slice(0, 3)) >= 600 && Number(name.slice(0, 3)) <= 699)
    .sort();
  assert.ok(taxBrain.includes('643_legal_ingestion_proposal_canonical_draft_publication.sql'));
  assert.ok(taxBrain.includes('644_legal_ingestion_rename_proposal_canonical_draft_rpc.sql'));
  assert.equal(
    taxBrain.filter((name) => Number(name.slice(0, 3)) > 644).length,
    0,
    'TAX-648C1 must use the next unused 6xx after 643; later Tax Brain migrations must not exist yet',
  );
});

test('TAX-648C1 renames the truncated 643 RPC without recreating its body', () => {
  const sql644 = readRepo('supabase/migrations/644_legal_ingestion_rename_proposal_canonical_draft_rpc.sql');
  const live = readRepo('apps/api/tests/knowledge-trainer/knowledge-trainer-648c-publication-foundation.spec.ts');
  assert.match(sql644, /alter function public\.legal_ingestion_apply_tax_knowledge_proposal_canonical_draft_pu\(uuid, uuid, jsonb\)/);
  assert.match(sql644, /rename to legal_ingestion_apply_tk_proposal_canonical_draft/);
  assert.ok('legal_ingestion_apply_tk_proposal_canonical_draft'.length <= 63);
  assert.doesNotMatch(sql644, /create or replace function/i);
  assert.doesNotMatch(sql644, /insert into public\.tax_legal_nodes/);
  assert.doesNotMatch(sql644, /insert into public\.tax_rules/);
  assert.doesNotMatch(sql644, /activate_tax_rule_version/);
  assert.match(sql644, /revoke all on function public\.legal_ingestion_apply_tk_proposal_canonical_draft\(uuid, uuid, jsonb\) from public/);
  assert.match(sql644, /revoke all on function public\.legal_ingestion_apply_tk_proposal_canonical_draft\(uuid, uuid, jsonb\) from anon, authenticated/);
  assert.match(sql644, /grant execute on function public\.legal_ingestion_apply_tk_proposal_canonical_draft\(uuid, uuid, jsonb\) to service_role/);
  assert.doesNotMatch(sql644, /grant execute[^\n]+to (anon|authenticated|public)/i);
  assert.match(live, /legal_ingestion_apply_tk_proposal_canonical_draft/);
  assert.doesNotMatch(live, /legal_ingestion_apply_tax_knowledge_proposal_canonical_draft_publication/);
  assert.doesNotMatch(live, /legal_ingestion_apply_tax_knowledge_proposal_canonical_draft_pu['"]/);
});

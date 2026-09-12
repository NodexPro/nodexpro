import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isKnowledgeTrainerCommand } from '../../src/domains/knowledge-trainer/knowledge-trainer.types.js';
import { isTaxKnowledgeCommand } from '../../src/domains/tax-knowledge/tax-knowledge.types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const sqlRel = 'supabase/migrations/624_knowledge_trainer_ingestion_foundation.sql';

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-624 is additive and does not take ownership of canonical legal tables', () => {
  assert.equal(existsSync(join(repoRoot, sqlRel)), true);
  const sql = readRepo(sqlRel);
  assert.match(sql, /create table if not exists public\.legal_ingestion_documents/);
  assert.match(sql, /create table if not exists public\.legal_ingestion_jobs/);
  assert.match(sql, /create table if not exists public\.legal_ingestion_pages/);
  assert.match(sql, /create table if not exists public\.legal_ingestion_candidates/);
  assert.match(sql, /owner-legal-materials/);
  assert.match(sql, /public = false/);
  assert.match(sql, /malware_scan_status/);
  assert.match(sql, /not_implemented/);
  assert.match(sql, /legal_ingestion_claim_page/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /input_type in \('pdf', 'image', 'text'\)/);
  assert.match(sql, /candidate_kind in \('structure', 'rule', 'legal_value', 'reference', 'fact'\)/);
  assert.doesNotMatch(sql, /alter table public\.tax_domains/);
  assert.doesNotMatch(sql, /alter table public\.tax_sources/);
  assert.doesNotMatch(sql, /alter table public\.tax_legal_nodes/);
  assert.doesNotMatch(sql, /alter table public\.tax_rules/);
  assert.doesNotMatch(sql, /alter table public\.country_legal_values/);
  assert.doesNotMatch(sql, /alter table public\.tax_fact_definitions/);
  assert.doesNotMatch(sql, /drop table public\.tax_/i);
});

test('TAX-624 previous Legal Library migrations remain present and unchanged in filename', () => {
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/620_owner_country_legal_access.sql')), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/621_country_localization.sql')), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/622_tax_legal_library_foundation.sql')), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/623_legal_value_version_authorities.sql')), true);
});

test('Trainer commands are a separate family and do not replace create_tax_legal_node', () => {
  assert.equal(isKnowledgeTrainerCommand('accept_legal_structure_candidate'), true);
  assert.equal(isKnowledgeTrainerCommand('create_tax_legal_node'), false);
  assert.equal(isTaxKnowledgeCommand('create_tax_legal_node'), true);
  assert.equal(isTaxKnowledgeCommand('accept_legal_structure_candidate'), false);
});

test('Accept reuses canonical Legal Library command; worker never writes canonical law', () => {
  const commands = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
  const worker = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-worker.runtime.ts');
  assert.match(commands, /executeTaxKnowledgeCommand\(ctx, 'create_tax_legal_node'/);
  assert.match(commands, /\.eq\('status', 'draft'\)/);
  assert.doesNotMatch(commands, /activate_tax_legal_node/);
  assert.doesNotMatch(worker, /from\('tax_legal_nodes'\)\s*\.insert/);
  assert.doesNotMatch(worker, /activate_/);
  assert.match(worker, /workerMustNotWriteCanonicalLaw/);
  assert.doesNotMatch(worker, /openai|anthropic|gemini/i);
});

test('Dedicated worker package exists and leases pages', () => {
  assert.equal(existsSync(join(repoRoot, 'apps/knowledge-trainer-worker/package.json')), true);
  assert.equal(existsSync(join(repoRoot, 'apps/knowledge-trainer-worker/src/index.ts')), true);
  const workerPkg = readRepo('apps/knowledge-trainer-worker/package.json');
  assert.match(workerPkg, /@zentax\/knowledge-trainer-worker/);
  const sql = readRepo(sqlRel);
  assert.match(sql, /lease_owner/);
  assert.match(sql, /lease_expires_at/);
});

test('Owner UI keeps manual authoring beside Upload material', () => {
  const panel = readRepo('apps/web/src/pages/owner-legal-library-panel.tsx');
  assert.match(panel, /Add Tax Domain/);
  assert.match(panel, /Add Legal Source/);
  assert.match(panel, /Add Structure Item/);
  assert.match(panel, /Upload material/);
  assert.match(panel, /OwnerKnowledgeTrainerPanel/);
  const trainerUi = readRepo('apps/web/src/pages/owner-knowledge-trainer-panel.tsx');
  assert.match(trainerUi, /Photos — .*Coming next/);
  assert.match(trainerUi, /Text — .*Coming next/);
  assert.match(trainerUi, /Accept Draft/);
  assert.match(trainerUi, /Reject/);
  assert.match(trainerUi, /Edit Draft/);
  assert.doesNotMatch(trainerUi, /openai|anthropic|gemini/i);
});

test('Professional users stay on the existing Owner legal workspace gate', () => {
  const routes = readRepo('apps/api/src/routes/owner-knowledge-trainer.routes.ts');
  assert.match(routes, /OWNER_LEGAL_ACCESS_REQUIRED/);
  assert.match(routes, /legal-training\/upload/);
  assert.doesNotMatch(readRepo('apps/api/src/routes/owner-country-pack.routes.ts'), /legal-training\/upload/);
});

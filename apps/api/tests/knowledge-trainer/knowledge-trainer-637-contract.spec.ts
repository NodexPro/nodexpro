import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capabilityRequiredForOwnerCommand } from '../../src/domains/owner-country-legal-access/owner-country-legal-access.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-637 named proposal commands refresh the Owner aggregate and do not PATCH canonical law', () => {
  const types = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
  const commands = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
  const service = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-tax-knowledge-proposal.service.ts');
  const access = readRepo('apps/api/src/domains/owner-country-legal-access/owner-country-legal-access.pure.ts');
  const resolve = readRepo('apps/api/src/domains/owner-country-legal-access/owner-country-legal-access-country-resolve.service.ts');
  const audit = readRepo('apps/api/src/shared/audit-events.ts');

  assert.match(types, /'create_tax_knowledge_proposal'/);
  assert.match(types, /'set_tax_knowledge_proposal_review_status'/);
  assert.match(types, /'create_corrected_tax_knowledge_proposal'/);
  assert.match(commands, /case 'create_tax_knowledge_proposal':/);
  assert.match(commands, /case 'set_tax_knowledge_proposal_review_status':/);
  assert.match(commands, /case 'create_corrected_tax_knowledge_proposal':/);
  assert.match(commands, /handleTaxKnowledgeProposalCommand/);
  assert.match(commands, /result\.proposal_id/);
  assert.match(commands, /refreshed: await refreshed\(/);
  assert.doesNotMatch(commands, /method:\s*['"]PATCH['"]/);
  assert.doesNotMatch(types, /activate_tax_legal_node/);

  assert.equal(capabilityRequiredForOwnerCommand('create_tax_knowledge_proposal'), 'legal_knowledge.draft_create');
  assert.equal(capabilityRequiredForOwnerCommand('set_tax_knowledge_proposal_review_status'), 'legal_knowledge.review');
  assert.equal(capabilityRequiredForOwnerCommand('create_corrected_tax_knowledge_proposal'), 'legal_knowledge.draft_edit');
  assert.match(access, /create_tax_knowledge_proposal/);
  assert.match(access, /set_tax_knowledge_proposal_review_status/);
  assert.match(access, /create_corrected_tax_knowledge_proposal/);
  assert.match(resolve, /create_tax_knowledge_proposal/);
  assert.match(resolve, /legal_ingestion_tax_knowledge_proposals/);
  assert.match(audit, /LEGAL_TRAINING_TAX_KNOWLEDGE_PROPOSAL_CREATED/);
  assert.match(audit, /LEGAL_TRAINING_TAX_KNOWLEDGE_PROPOSAL_REVIEW_STATUS_SET/);
  assert.match(audit, /LEGAL_TRAINING_TAX_KNOWLEDGE_PROPOSAL_CORRECTED/);

  assert.match(service, /assertNoTrustedProvenance/);
  assert.match(service, /is resolved by the backend and cannot be supplied/);
  assert.match(service, /TAX_KNOWLEDGE_PROPOSAL_TRUSTED_PROVENANCE_FIELDS/);
  assert.match(service, /REVISION_INSERT_ATTEMPTS/);
  assert.match(service, /nextRevisionNo/);
  assert.match(service, /isProposalRevisionConflictError/);
  assert.match(service, /status: 'proposed'/);
  assert.match(service, /creation_origin: 'owner_corrected'/);
  assert.match(service, /supersedes_proposal_id: sourceId/);
  assert.match(service, /supersedes_proposal_id must belong to the same Owner Draft/);
  assert.match(service, /proposal_json cannot be mutated in place/);
  assert.match(service, /canSetTaxKnowledgeProposalReviewStatus/);
  assert.match(service, /published_to_canonical_draft is not available/);
  assert.doesNotMatch(service, /from\('tax_legal_nodes'\)/);
  assert.doesNotMatch(service, /from\('tax_rules'\)/);
  assert.doesNotMatch(service, /from\('tax_rule_versions'\)/);
  assert.doesNotMatch(service, /\.update\([\s\S]{0,80}proposal_json/);
  assert.doesNotMatch(service, /downloadOwnerLegalMaterial/);
  assert.doesNotMatch(service, /runKnowledgeTrainerWorkerTick/);
  assert.doesNotMatch(service, /persistStructureCandidatesForJob/);
  assert.doesNotMatch(service, /openai|anthropic|prompt_template/i);
  assert.doesNotMatch(service, /activate_tax_rule_version/);
  assert.doesNotMatch(service, /from\('legal_ingestion_legal_text_drafts'\)[\s\S]{0,120}\.update\(/);
  assert.doesNotMatch(service, /from\('legal_ingestion_candidates'\)/);
});

test('TAX-637 aggregate is selected-draft bounded and owns latest/history without stuffing proposal_json on every node', () => {
  const read = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-read.service.ts');
  const types = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
  const panel = readRepo('apps/api/src/domains/country-pack/country-pack-read-models.service.ts');
  assert.match(read, /loadTaxKnowledgeProposalsForSelectedDraft/);
  assert.match(read, /\.eq\('legal_text_draft_id', draftId\)/);
  assert.match(read, /PROPOSAL_HISTORY_SELECT/);
  assert.match(read, /pickSelectedTaxKnowledgeProposal/);
  assert.match(read, /tax_knowledge_proposals/);
  assert.match(read, /create_tax_knowledge_proposal/);
  assert.doesNotMatch(read, /PROPOSAL_HISTORY_SELECT, proposal_json/);
  assert.match(read, /select\(`\$\{PROPOSAL_HISTORY_SELECT\}, proposal_json`\)/);
  assert.match(read, /\.eq\('id', selectedMeta\.id\)/);
  assert.match(types, /KnowledgeTrainerTaxKnowledgeProposalSliceDto/);
  assert.match(types, /proposal_json: Record<string, unknown>/);
  assert.match(panel, /maskActionsForCapabilities\(\s*trainerSlice\.allowed_actions/);
  assert.doesNotMatch(read, /from\('legal_ingestion_tax_knowledge_proposals'\)[\s\S]{0,200}\.eq\('document_id'/);
  assert.doesNotMatch(read, /openai|anthropic/i);
});

test('TAX-637 does not add publication, activation, worker, F2B/F2C, or a new migration', () => {
  const service = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-tax-knowledge-proposal.service.ts');
  const commands = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
  const types = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
  const worker = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-worker.runtime.ts');
  const persist = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-structure.service.ts');
  assert.match(service, /published_to_canonical_draft is not available/);
  assert.doesNotMatch(service, /activate_tax_legal_node/);
  assert.doesNotMatch(worker, /legal_ingestion_tax_knowledge_proposals/);
  assert.doesNotMatch(persist, /legal_ingestion_tax_knowledge_proposals/);
  assert.doesNotMatch(
    types,
    /WORKER_ALLOWED_TABLES = \[[\s\S]*legal_ingestion_tax_knowledge_proposals/,
  );
  assert.doesNotMatch(service, /tax_advisory_cases/);
  assert.doesNotMatch(commands, /runKnowledgeTrainerWorkerTick/);
});

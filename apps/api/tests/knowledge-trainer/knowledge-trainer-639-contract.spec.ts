import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-639 create/correct validate tax_knowledge_proposal_v1 before INSERT and do not write canonical law', () => {
  const service = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-tax-knowledge-proposal.service.ts');
  const catalog = readRepo('apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-v1-catalog.service.ts');
  const pure = readRepo('apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-v1.pure.ts');
  const types = readRepo('apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-v1.types.ts');

  assert.match(types, /TAX_KNOWLEDGE_PROPOSAL_CONTRACT = 'tax_knowledge_proposal_v1'/);
  assert.match(types, /TAX_KNOWLEDGE_PROPOSAL_SCHEMA_VERSION = 1/);
  assert.match(pure, /parseAndValidatePredicate/);
  assert.match(pure, /parseLegalIdentifier/);
  assert.match(pure, /parseActivationCritical/);
  assert.match(pure, /RESERVED_FACT_KEY/);
  assert.match(pure, /TAX_KNOWLEDGE_PROPOSAL_RELATIONSHIP_TYPES/);
  assert.match(catalog, /tax_fact_definitions/);
  assert.match(catalog, /country_legal_values/);
  assert.match(service, /validateProposalJsonForDraft/);
  assert.match(service, /throwIfProposalContractInvalid/);
  assert.match(service, /TAX_KNOWLEDGE_PROPOSAL_INVALID/);
  assert.match(service, /canOwnerApproveTaxKnowledgeProposal/);
  assert.match(service, /TAX_KNOWLEDGE_PROPOSAL_NOT_APPROVABLE/);
  assert.match(service, /owner_approved requires a valid tax_knowledge_proposal_v1/);
  assert.doesNotMatch(service, /from\('tax_legal_nodes'\)/);
  assert.doesNotMatch(service, /from\('tax_rules'\)/);
  assert.doesNotMatch(service, /from\('tax_rule_versions'\)/);
  assert.doesNotMatch(service, /activate_tax_rule_version/);
  assert.doesNotMatch(service, /publish_tax_knowledge_proposal/);
  assert.doesNotMatch(service, /openai|anthropic|prompt_template/i);
  assert.doesNotMatch(pure, /openai|anthropic|prompt_template/i);
});

test('TAX-639 owner_approved is gated on deterministic validation and aggregate exposes a backend-owned summary', () => {
  const service = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-tax-knowledge-proposal.service.ts');
  const read = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-read.service.ts');
  const dto = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
  const createIdx = service.indexOf('export async function createTaxKnowledgeProposal');
  const insertIdx = service.indexOf('insertProposalSnapshot', createIdx);
  const validateIdx = service.indexOf('validateProposalJsonForDraft', createIdx);
  assert.ok(createIdx >= 0 && validateIdx > createIdx && validateIdx < insertIdx);
  const correctIdx = service.indexOf('export async function createCorrectedTaxKnowledgeProposal');
  const correctInsert = service.indexOf('insertProposalSnapshot', correctIdx);
  const correctValidate = service.indexOf('validateProposalJsonForDraft', correctIdx);
  assert.ok(correctIdx >= 0 && correctValidate > correctIdx && correctValidate < correctInsert);
  assert.match(read, /summarizeTaxKnowledgeProposalValidation/);
  assert.match(read, /owner_approved/);
  assert.match(dto, /validation: TaxKnowledgeProposalV1ValidationSummary \| null/);
  assert.doesNotMatch(read, /from\('legal_ingestion_tax_knowledge_proposals'\)[\s\S]{0,200}\.eq\('document_id'/);
});

test('TAX-639 does not add a migration, publication command, activation, worker, UI, or F2B/F2C', () => {
  const service = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-tax-knowledge-proposal.service.ts');
  const types = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
  const commands = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
  const worker = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-worker.runtime.ts');
  assert.doesNotMatch(types, /publish_tax_knowledge_proposal/);
  assert.doesNotMatch(commands, /publish_tax_knowledge_proposal/);
  assert.doesNotMatch(service, /activate_tax_legal_node/);
  assert.doesNotMatch(worker, /tax_knowledge_proposal_v1/);
  assert.doesNotMatch(service, /downloadOwnerLegalMaterial/);
  assert.doesNotMatch(service, /runKnowledgeTrainerWorkerTick/);
  assert.doesNotMatch(service, /persistStructureCandidatesForJob/);
  assert.doesNotMatch(service, /from\('legal_ingestion_legal_text_drafts'\)[\s\S]{0,160}\.update\(/);
  assert.doesNotMatch(service, /from\('legal_ingestion_candidates'\)/);
});

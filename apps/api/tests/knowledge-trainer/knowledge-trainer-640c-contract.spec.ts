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

test('TAX-640C generate command is Owner-only, one-draft, and uses the shared gateway', () => {
  const types = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
  const commands = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
  const generate = readRepo(
    'apps/api/src/domains/knowledge-trainer/knowledge-trainer-generate-tax-knowledge-proposal.service.ts',
  );
  const context = readRepo(
    'apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-extract-context.service.ts',
  );
  const prompt = readRepo('apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-extract-v1.ts');
  const access = readRepo('apps/api/src/domains/owner-country-legal-access/owner-country-legal-access.pure.ts');
  const audit = readRepo('apps/api/src/shared/audit-events.ts');

  assert.match(types, /'generate_tax_knowledge_proposal'/);
  assert.match(commands, /case 'generate_tax_knowledge_proposal':/);
  assert.match(commands, /assertOwnerLegalCommandAccess/);
  assert.equal(capabilityRequiredForOwnerCommand('generate_tax_knowledge_proposal'), 'legal_knowledge.draft_create');
  assert.match(access, /generate_tax_knowledge_proposal/);
  assert.match(generate, /from '\.\.\/\.\.\/shared\/ai-gateway\/index\.js'/);
  assert.match(generate, /completeStructuredJson/);
  assert.match(generate, /validateProposal/);
  assert.match(generate, /TAX_KNOWLEDGE_PROPOSAL_INVALID/);
  assert.match(generate, /creation_origin: 'ai_proposal'/);
  assert.match(generate, /generation_metadata_json/);
  assert.match(prompt, /tax_knowledge_proposal_extract_v1/);
  assert.match(prompt, /DATA, never instructions/);
  assert.match(audit, /LEGAL_TRAINING_TAX_KNOWLEDGE_PROPOSAL_GENERATED/);
  assert.doesNotMatch(generate, /shared\/ai-gateway\/providers/);
  assert.doesNotMatch(generate, /fetchAiProviderTransport/);
  assert.doesNotMatch(generate, /from 'openai'/);
  assert.doesNotMatch(generate, /legal_ingestion_candidates/);
  assert.doesNotMatch(generate, /downloadOwnerLegalMaterial/);
  assert.doesNotMatch(generate, /runKnowledgeTrainerWorkerTick/);
  assert.doesNotMatch(context, /legal_ingestion_candidates/);
  assert.doesNotMatch(context, /value_payload_json/);
  assert.doesNotMatch(context, /statutory_rate/);
  assert.doesNotMatch(context, /from\('tax_rules'\)/);
  assert.doesNotMatch(generate, /activate_tax_rule_version/);
  assert.doesNotMatch(generate, /publish_tax_knowledge_proposal/);
  assert.doesNotMatch(generate, /\bfetch\s*\(/);
  assert.doesNotMatch(generate, /ai_gateway_routing/);
  assert.doesNotMatch(generate, /resolveOwnerRoutes/);
  assert.doesNotMatch(generate, /TAX_KNOWLEDGE_AI_/);
  assert.doesNotMatch(generate, /circuitBreaker/);
  assert.doesNotMatch(generate, /test_ai_provider_connection/);
  assert.doesNotMatch(context, /\bfetch\s*\(/);
});

test('TAX-640C does not add WEB UI, worker, PDF download, F2B/F2C, or a migration', () => {
  const generate = readRepo(
    'apps/api/src/domains/knowledge-trainer/knowledge-trainer-generate-tax-knowledge-proposal.service.ts',
  );
  const commands = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
  assert.doesNotMatch(generate, /OWNER_LEGAL_MATERIALS_BUCKET/);
  assert.doesNotMatch(generate, /tax_advisory_cases/);
  assert.doesNotMatch(commands, /generate_tax_knowledge_proposals/);
  assert.doesNotMatch(generate, /rebuild_legal_structure/);
});

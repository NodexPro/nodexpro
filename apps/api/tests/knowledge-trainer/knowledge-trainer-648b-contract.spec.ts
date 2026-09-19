import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  capabilityRequiredForOwnerCommand,
  evaluateOwnerLegalCommandAccess,
} from '../../src/domains/owner-country-legal-access/owner-country-legal-access.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

const COMMAND = 'publish_tax_knowledge_proposal_to_canonical_draft';
const RPC = 'legal_ingestion_apply_tk_proposal_canonical_draft';

test('TAX-648B registers the named publish command with draft_create and a single RPC write', () => {
  const types = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
  const commands = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
  const service = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-tax-knowledge-proposal.service.ts');
  const plan = readRepo('apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-canonical-draft-plan.pure.ts');
  const read = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-read.service.ts');
  const access = readRepo('apps/api/src/domains/owner-country-legal-access/owner-country-legal-access.pure.ts');
  const resolve = readRepo(
    'apps/api/src/domains/owner-country-legal-access/owner-country-legal-access-country-resolve.service.ts',
  );
  const ownerView = readRepo('apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-owner-view.pure.ts');
  const view = readRepo('apps/web/src/pages/owner-tax-knowledge-proposal-view.tsx');
  const validator = readRepo('apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-v1.pure.ts');

  assert.match(types, /'publish_tax_knowledge_proposal_to_canonical_draft'/);
  assert.match(commands, /case 'publish_tax_knowledge_proposal_to_canonical_draft':/);
  assert.match(commands, /publishTaxKnowledgeProposalToCanonicalDraft/);
  assert.match(commands, /handleTaxKnowledgeProposalCommand/);
  assert.match(commands, /refreshed: await refreshed\(/);
  assert.equal((commands.match(/case 'publish_tax_knowledge_proposal_to_canonical_draft':/g) ?? []).length, 1);
  assert.equal(capabilityRequiredForOwnerCommand(COMMAND), 'legal_knowledge.draft_create');
  assert.notEqual(capabilityRequiredForOwnerCommand(COMMAND), 'legal_knowledge.activate');
  assert.match(access, /publish_tax_knowledge_proposal_to_canonical_draft/);
  assert.match(resolve, /publish_tax_knowledge_proposal_to_canonical_draft/);
  assert.deepEqual(
    evaluateOwnerLegalCommandAccess(
      { kind: 'country_legal_maintainer', capabilitiesByCountry: { IL: ['legal_knowledge.view', 'legal_knowledge.draft_create'] } },
      COMMAND,
      'IL',
    ),
    { ok: true },
  );
  assert.equal(
    evaluateOwnerLegalCommandAccess(
      { kind: 'country_legal_maintainer', capabilitiesByCountry: { IL: ['legal_knowledge.view', 'legal_knowledge.activate'] } },
      COMMAND,
      'IL',
    ).ok,
    false,
  );

  assert.match(service, /validateProposalJsonForDraft/);
  assert.match(service, /publication_eligible/);
  assert.match(service, /TAX_KNOWLEDGE_PROPOSAL_NOT_APPROVED/);
  assert.match(service, /TAX_KNOWLEDGE_PROPOSAL_NOT_PUBLISHABLE/);
  assert.match(service, /resolveOwnerLegalValueRulesetContextForCountry/);
  assert.match(service, /generateLegalMachineCode/);
  assert.match(service, /buildTaxKnowledgeProposalCanonicalDraftPlan/);
  assert.match(service, /TAX_KNOWLEDGE_PROPOSAL_CANONICAL_DRAFT_RPC/);
  assert.match(plan, /taxRulePayloadChecksum/);
  assert.match(plan, /parseLegalIdentifier/);
  assert.match(plan, /topologicalProposalLegalNodes/);
  assert.equal((service.match(/\.rpc\(TAX_KNOWLEDGE_PROPOSAL_CANONICAL_DRAFT_RPC/g) ?? []).length, 2);
  assert.doesNotMatch(service, /from\('tax_legal_nodes'\)\s*\.insert/);
  assert.doesNotMatch(service, /from\('tax_rules'\)/);
  assert.doesNotMatch(service, /from\('tax_rule_versions'\)/);
  assert.doesNotMatch(service, /from\('tax_fact_definitions'\)/);
  assert.doesNotMatch(service, /from\('country_legal_values'\)/);
  assert.doesNotMatch(service, /from\('tax_calculation_definitions'\)/);
  assert.doesNotMatch(service, /activate_tax_rule_version/);
  assert.doesNotMatch(service, /legal_knowledge\.activate/);
  assert.doesNotMatch(plan, /tax_calculation_/);
  assert.match(service, /accepts tax_knowledge_proposal_id only/);
  assert.match(read, /publish_tax_knowledge_proposal_to_canonical_draft/);
  assert.match(read, /publicationEligible: validationSummary\.publication_eligible/);
  assert.doesNotMatch(ownerView, /publish_tax_knowledge_proposal/);
  assert.doesNotMatch(view, /publish_tax_knowledge_proposal/);
  assert.doesNotMatch(view, />Publish</);
  assert.doesNotMatch(validator, /publish_tax_knowledge_proposal/);
  assert.doesNotMatch(validator, /legal_ingestion_apply_tk_proposal_canonical_draft/);
});

test('TAX-648B keeps TAX-639, B2 immutability, and no WEB publish button', () => {
  const service = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-tax-knowledge-proposal.service.ts');
  const commands = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
  const owner = readRepo('apps/web/src/pages/PlatformOwnerLegalControl.tsx');
  assert.match(service, /published_to_canonical_draft is not available/);
  assert.doesNotMatch(service, /\.update\([\s\S]{0,80}proposal_json/);
  assert.doesNotMatch(service, /from\('legal_ingestion_legal_text_drafts'\)[\s\S]{0,160}\.update\(/);
  assert.doesNotMatch(commands, /method:\s*['"]PATCH['"]/);
  assert.doesNotMatch(owner, /publish_tax_knowledge_proposal_to_canonical_draft/);
  assert.match(service, /TAX_KNOWLEDGE_PROPOSAL_CANONICAL_DRAFT_RPC/);
});

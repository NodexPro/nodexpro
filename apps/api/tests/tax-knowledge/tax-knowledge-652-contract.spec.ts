import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capabilityRequiredForOwnerCommand } from '../../src/domains/owner-country-legal-access/owner-country-legal-access.pure.js';
import { TAX_KNOWLEDGE_COMMANDS } from '../../src/domains/tax-knowledge/tax-knowledge.types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-652 reuses tax_domains, tax_sources, unresolved refs, and existing trainer commands', () => {
  const migration = readRepo('supabase/migrations/652_tax_regulation_registry_owner_catalog.sql');
  const commands = readRepo('apps/api/src/domains/tax-knowledge/tax-regulation-registry-commands.service.ts');
  const types = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge.types.ts');
  const nav = readRepo('apps/api/src/domains/owner-country-legal-access/owner-country-legal-access.pure.ts');
  const resolve = readRepo('apps/api/src/domains/owner-country-legal-access/owner-country-legal-access-country-resolve.service.ts');
  const countryPack = readRepo('apps/api/src/domains/country-pack/country-pack-read-models.service.ts');
  const trainerRead = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-read.service.ts');
  assert.match(migration, /owner_catalog_number/);
  assert.match(migration, /legal_ingestion_draft_legal_references/);
  assert.match(migration, /uq_tax_sources_domain_owner_catalog/);
  assert.doesNotMatch(migration, /regulation_id/);
  assert.match(types, /ensure_regulation_registry_entry/);
  assert.match(types, /record_legal_text_draft_regulation_reference/);
  assert.ok(TAX_KNOWLEDGE_COMMANDS.includes('ensure_regulation_registry_entry'));
  assert.ok(TAX_KNOWLEDGE_COMMANDS.includes('record_legal_text_draft_regulation_reference'));
  assert.match(commands, /findOrCreateRegulationRegistryEntry/);
  assert.match(commands, /recordTaxKnowledgeProposalExternalReference/);
  assert.match(commands, /layer_a_unchanged: true/);
  assert.match(commands, /layer_b_rewritten: false/);
  assert.match(commands, /confirmation_state/);
  assert.match(commands, /ai_suggested/);
  assert.match(commands, /owner_confirmed/);
  assert.match(commands, /owner_legal_control_panel_aggregate/);
  assert.doesNotMatch(commands, /draft_legal_text:/);
  assert.doesNotMatch(commands, /original_source_text:/);
  assert.match(nav, /regulations-orders/);
  assert.match(nav, /Regulations & Orders/);
  assert.doesNotMatch(nav, /תקנות וצווים/);
  assert.match(resolve, /ensure_regulation_registry_entry/);
  assert.match(resolve, /record_legal_text_draft_regulation_reference/);
  assert.match(countryPack, /regulations_orders_registry/);
  assert.match(trainerRead, /regulation_references/);
  assert.equal(capabilityRequiredForOwnerCommand('ensure_regulation_registry_entry'), 'legal_sources.manage');
  assert.equal(capabilityRequiredForOwnerCommand('record_legal_text_draft_regulation_reference'), 'legal_knowledge.draft_edit');
});

test('TAX-652 Layer B pin is not a second canonical relationship system', () => {
  const migration = readRepo('supabase/migrations/652_tax_regulation_registry_owner_catalog.sql');
  const commands = readRepo('apps/api/src/domains/tax-knowledge/tax-regulation-registry-commands.service.ts');
  const read = readRepo('apps/api/src/domains/tax-knowledge/tax-regulation-registry-read.service.ts');
  assert.match(migration, /Resolution stays on tax_rule_unresolved_legal_references/);
  assert.match(commands, /tax_rule_unresolved_legal_references|recordTaxKnowledgeProposalExternalReference/);
  assert.match(read, /tax_rule_unresolved_legal_references/);
  assert.match(read, /resolved_relationship_id/);
  assert.doesNotMatch(commands, /from_tax_rule_version_id/);
});

test('TAX-652 AI cannot silently confirm an invented external reference', () => {
  const commands = readRepo('apps/api/src/domains/tax-knowledge/tax-regulation-registry-commands.service.ts');
  assert.match(commands, /creationOrigin === 'ai_suggestion' && payload.owner_confirmed !== true/);
  assert.match(commands, /confirmationState === 'owner_confirmed'/);
  assert.doesNotMatch(commands, /owner_confirmed !== false/);
});

test('TAX-652 does not publish or activate canonical law and does not weaken TAX-639', () => {
  const commands = readRepo('apps/api/src/domains/tax-knowledge/tax-regulation-registry-commands.service.ts');
  const validator = readRepo('apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-v1.pure.ts');
  const thisFile = readRepo('apps/api/tests/tax-knowledge/tax-knowledge-652-contract.spec.ts');
  const pure = readRepo('apps/api/tests/tax-knowledge/tax-knowledge-652-regulation-registry.pure.spec.ts');
  assert.doesNotMatch(commands, /publish_tax_knowledge_proposal_to_canonical_draft/);
  assert.doesNotMatch(commands, /activate_tax_rule_version/);
  assert.doesNotMatch(thisFile, /publish_tax_knowledge_proposal_to_canonical_draft\(/);
  assert.doesNotMatch(pure, /activate_tax_rule_version\(/);
  assert.match(validator, /export function validateTaxKnowledgeProposalV1/);
  assert.match(validator, /publication_eligible/);
});

test('TAX-652 regulation provisions reuse existing Proposal, approval, and versioning commands', () => {
  const types = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge.types.ts');
  const trainerTypes = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
  assert.match(trainerTypes, /generate_tax_knowledge_proposal/);
  assert.match(trainerTypes, /set_tax_knowledge_proposal_review_status/);
  assert.match(types, /supersede_tax_rule_version/);
  assert.match(types, /create_tax_rule_version/);
  assert.doesNotMatch(types, /approve_regulation_proposal/);
  assert.doesNotMatch(types, /create_regulation_proposal/);
});

test('TAX-652 command returns the refreshed Owner Legal Control aggregate', () => {
  const commands = readRepo('apps/api/src/domains/tax-knowledge/tax-regulation-registry-commands.service.ts');
  const panel = readRepo('apps/web/src/pages/PlatformOwnerLegalControl.tsx');
  assert.match(commands, /aggregate_key: 'owner_legal_control_panel_aggregate'/);
  assert.match(panel, /record_legal_text_draft_regulation_reference/);
  assert.match(panel, /ensure_regulation_registry_entry/);
  assert.doesNotMatch(panel, /tax_knowledge_trainer_legal_text_draft_id',\s*trainerDraftQuery/);
});

test('TAX-652 system labels are English and Owner catalog language is stored as entered', () => {
  const nav = readRepo('apps/api/src/domains/owner-country-legal-access/owner-country-legal-access.pure.ts');
  const read = readRepo('apps/api/src/domains/tax-knowledge/tax-regulation-registry-read.service.ts');
  const pure = readRepo('apps/api/src/domains/tax-knowledge/tax-regulation-registry.pure.ts');
  const commands = readRepo('apps/api/src/domains/tax-knowledge/tax-regulation-registry-commands.service.ts');
  assert.match(nav, /label: 'Regulations & Orders'/);
  assert.match(read, /title: 'Regulations & Orders'/);
  assert.match(read, /title: String\(domain.title\)/);
  assert.match(read, /regulationReferenceLabel/);
  assert.match(pure, /export function regulationReferenceLabel/);
  assert.match(commands, /create_tax_domain|findOrCreateRegulationRegistryEntry/);
  assert.doesNotMatch(read, /dir=|text_direction|rtl/);
  assert.doesNotMatch(commands, /dir=|text_direction|translate/);
  assert.doesNotMatch(pure, /toHebrew|toEnglish|i18n/);
});


import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capabilityRequiredForOwnerCommand } from '../../src/domains/owner-country-legal-access/owner-country-legal-access.pure.js';
import {
  invalidateTrainerDocumentGraphCache,
  readTrainerDocumentGraphCache,
  trainerDocumentGraphCacheKey,
  writeTrainerDocumentGraphCache,
} from '../../src/domains/knowledge-trainer/knowledge-trainer-document-graph-cache.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-651 section switch is a named command, not a hidden GET', () => {
  const types = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
  const commands = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
  const panel = readRepo('apps/web/src/pages/PlatformOwnerLegalControl.tsx');
  const pagination = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-pagination.ts');
  assert.match(types, /'select_legal_text_draft'/);
  assert.match(types, /'record_tax_knowledge_proposal_external_reference'/);
  assert.match(commands, /case 'select_legal_text_draft':/);
  assert.match(commands, /LEGAL_TRAINING_LEGAL_TEXT_DRAFT_SELECTED/);
  assert.match(commands, /invalidateTrainerDocumentGraphCache/);
  assert.equal(capabilityRequiredForOwnerCommand('select_legal_text_draft'), 'legal_knowledge.view');
  assert.equal(
    capabilityRequiredForOwnerCommand('record_tax_knowledge_proposal_external_reference'),
    'legal_knowledge.draft_edit',
  );
  assert.match(panel, /select_legal_text_draft/);
  assert.doesNotMatch(panel, /tax_knowledge_trainer_legal_text_draft_id',\s*trainerDraftQuery/);
  assert.match(pagination, /TRAINER_FETCH_PAGE_SIZE = 2000/);
});

test('TAX-651 save updates only draft_legal_text, never original_source_text', () => {
  const service = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-legal-text-draft.service.ts');
  const start = service.indexOf('export async function updateLegalTextDraftText');
  const end = service.indexOf('export async function updateLegalTextDraftIdentity');
  const fn = service.slice(start, end);
  assert.match(fn, /draft_legal_text: payload\.draft_legal_text/);
  assert.doesNotMatch(fn, /original_source_text/);
});

test('TAX-651 generate stamps Layer B identity/kind and does not invent insufficient_evidence', () => {
  const generate = readRepo(
    'apps/api/src/domains/knowledge-trainer/knowledge-trainer-generate-tax-knowledge-proposal.service.ts',
  );
  const normalize = readRepo(
    'apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-extract-normalize.pure.ts',
  );
  const prompt = readRepo('apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-extract-v1.ts');
  const validator = readRepo('apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-v1.pure.ts');
  const plan = readRepo(
    'apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-canonical-draft-plan.pure.ts',
  );
  assert.match(generate, /draftIdentity:/);
  assert.match(generate, /kind_label: draft\.kind_label/);
  assert.match(generate, /loadKindCatalog/);
  assert.match(generate, /from\('tax_legal_node_kinds'\)/);
  assert.match(normalize, /stampDraftOwnedLegalNodeIdentity/);
  assert.doesNotMatch(normalize, /code: 'insufficient_evidence'/);
  assert.match(prompt, /Set effective_from to null and add uncertainties\[] with code=insufficient_evidence/);
  assert.match(validator, /honestUnresolvedDate/);
  assert.match(validator, /row\.code === 'insufficient_evidence'/);
  assert.match(validator, /export function canOwnerApproveTaxKnowledgeProposal/);
  assert.match(validator, /return result\.valid_schema === true;/);
  assert.match(plan, /Canonical publish requires a sourced effective_from/);
  assert.doesNotMatch(plan, /toISOString\(\)\.slice\(0, 10\)/);
  assert.match(generate, /supersedes_proposal_id: latest\?\.id \?\? null/);
  assert.doesNotMatch(generate, /TAX_KNOWLEDGE_PROPOSAL_ALREADY_EXISTS/);
});

test('TAX-651 re-analyze and section-switch reuse existing commands and caches', () => {
  const generate = readRepo(
    'apps/api/src/domains/knowledge-trainer/knowledge-trainer-generate-tax-knowledge-proposal.service.ts',
  );
  const ownerView = readRepo(
    'apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-owner-view.pure.ts',
  );
  const read = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-read.service.ts');
  const plan = readRepo(
    'apps/api/src/domains/knowledge-trainer/tax-knowledge-proposal-canonical-draft-plan.pure.ts',
  );
  const view = readRepo('apps/web/src/pages/owner-tax-knowledge-proposal-view.tsx');
  const panel = readRepo('apps/web/src/pages/PlatformOwnerLegalControl.tsx');
  assert.match(generate, /loadLatestProposal/);
  assert.match(generate, /creation_origin: 'ai_proposal'/);
  assert.match(generate, /draftLegalText: String\(draft\.draft_legal_text/);
  assert.doesNotMatch(generate, /TAX_KNOWLEDGE_PROPOSAL_ALREADY_EXISTS/);
  assert.doesNotMatch(generate, /from\('tax_rules'\)/);
  assert.doesNotMatch(generate, /activate_tax_rule_version/);
  assert.match(ownerView, /presentation: input.hasProposal \? 'reanalyze' : 'generate'/);
  assert.match(read, /cachedTree && Array.isArray\(cachedTree.frontier\)/);
  assert.match(read, /cachedTree && Array.isArray\(cachedTree.search_index\)/);
  assert.match(plan, /row.cited_law_name = asTrimmed\(detail.cited_law_name\)/);
  assert.match(view, /loc.reanalyze_label/);
  assert.match(view, /sanitizeOwnerTax639ValidationErrors/);
  assert.doesNotMatch(view, /fetch\(/);
  assert.match(panel, /shouldApplyTrainerDraftSelectionResponse/);
});

test('TAX-651 document graph cache is keyed and TTL-bounded', () => {
  invalidateTrainerDocumentGraphCache();
  const key = trainerDocumentGraphCacheKey('doc', 'job', 'run');
  writeTrainerDocumentGraphCache(key, { pages: [{ page_no: 1 }], candidates: [{ id: 'c1' }] });
  const hit = readTrainerDocumentGraphCache(key);
  assert.equal(hit?.candidates[0]?.id, 'c1');
  invalidateTrainerDocumentGraphCache('doc');
  assert.equal(readTrainerDocumentGraphCache(key), null);
});

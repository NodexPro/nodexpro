import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capabilityRequiredForOwnerCommand } from '../../src/domains/owner-country-legal-access/owner-country-legal-access.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-634 named prepare command is parent-first, idempotent, and returns refreshed aggregate', () => {
  const types = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
  const commands = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
  const service = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-legal-text-draft.service.ts');
  const access = readRepo('apps/api/src/domains/owner-country-legal-access/owner-country-legal-access.pure.ts');
  const resolve = readRepo('apps/api/src/domains/owner-country-legal-access/owner-country-legal-access-country-resolve.service.ts');
  const read = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-read.service.ts');
  const prepareStart = service.indexOf('export async function prepareLegalTextDraftsForStructure');
  const prepareEnd = service.indexOf('export async function createManualLegalTextDraft');
  const prepareFn = service.slice(prepareStart, prepareEnd > prepareStart ? prepareEnd : undefined);

  assert.match(types, /'prepare_legal_text_drafts_for_structure'/);
  assert.match(commands, /case 'prepare_legal_text_drafts_for_structure':/);
  assert.match(commands, /created_count: result.created_count/);
  assert.match(commands, /refreshed: await refreshed\(/);
  assert.match(prepareFn, /parentFirstMissingCandidates/);
  assert.match(prepareFn, /captureExclusiveSourceBody/);
  assert.match(prepareFn, /resolveAllHeadingCursors/);
  assert.match(prepareFn, /PREPARE_TIME_BUDGET_MS/);
  assert.match(prepareFn, /review_status: reviewStatus/);
  assert.match(prepareFn, /boundary_status === 'uncertain' \? 'needs_review'/);
  assert.doesNotMatch(prepareFn, /\.update\(/);
  assert.doesNotMatch(prepareFn, /downloadOwnerLegalMaterial/);
  assert.doesNotMatch(prepareFn, /storage\.from\(/);
  assert.doesNotMatch(prepareFn, /persistStructureCandidatesForJob/);
  assert.doesNotMatch(prepareFn, /runKnowledgeTrainerWorkerTick/);
  assert.doesNotMatch(prepareFn, /from\('tax_legal_nodes'\)/);
  assert.doesNotMatch(prepareFn, /accept_legal_structure_candidate/);
  assert.doesNotMatch(prepareFn, /activate_tax_legal_node/);
  assert.equal(capabilityRequiredForOwnerCommand('prepare_legal_text_drafts_for_structure'), 'legal_knowledge.draft_create');
  assert.match(access, /prepare_legal_text_drafts_for_structure/);
  assert.match(resolve, /prepare_legal_text_drafts_for_structure/);
  assert.match(read, /legal_text_review_tree/);
  assert.match(read, /buildLegalTextReviewNodes/);
  assert.match(read, /prepare_legal_text_drafts_for_structure/);
  assert.match(readRepo('apps/api/src/shared/audit-events.ts'), /LEGAL_TRAINING_LEGAL_TEXT_DRAFTS_PREPARED/);
});

test('TAX-634 does not add a migration, worker, rebuild, or canonical write', () => {
  const service = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-legal-text-draft.service.ts');
  const commands = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/634_owner_legal_draft_workspace.sql')), false);
  assert.doesNotMatch(service, /from\('tax_legal_nodes'\)\s*\.insert/);
  assert.doesNotMatch(service, /from\('tax_rules'\)/);
  assert.doesNotMatch(commands, /runKnowledgeTrainerWorkerTick/);
  assert.doesNotMatch(service, /persistStructureCandidatesForJob/);
});

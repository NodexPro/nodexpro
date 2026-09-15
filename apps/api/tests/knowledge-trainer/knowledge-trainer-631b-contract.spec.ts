import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLegalIdentifier } from '../../src/domains/tax-knowledge/legal-identifier.pure.js';
import { findDraftIdentityConflict } from '../../src/domains/knowledge-trainer/knowledge-trainer-legal-text-draft.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

const draftPure = () => readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-legal-text-draft.pure.ts');
const draftService = () => readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-legal-text-draft.service.ts');
const persist = () => readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-structure.service.ts');
const worker = () => readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-worker.runtime.ts');
const commands = () => readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
const webPanel = () => readRepo('apps/web/src/pages/owner-knowledge-trainer-panel.tsx');

test('TAX-631B never invents page_start item 0 as a legal-text boundary', () => {
  const pure = draftPure();
  assert.match(pure, /Never invents page_start \+ item 0/);
  assert.match(pure, /persistedStartCursor/);
  assert.match(pure, /nextNonDescendantBoundaryCandidate/);
  assert.match(pure, /resolveAllHeadingCursors/);
  assert.match(pure, /export function candidateStartCursor[\s\S]{0,120}persistedStartCursor/);
  assert.doesNotMatch(
    pure,
    /if \(candidate\.page_start != null && candidate\.page_start > 0\) \{\s*return \{ page: candidate\.page_start, item: 0/,
  );
  assert.doesNotMatch(pure, /return ordered\[index \+ 1\]/);
});

test('TAX-631B create path stores own text for draft and does not download Storage PDF', () => {
  const service = draftService();
  assert.match(service, /printed_marker, title/);
  assert.match(service, /kind_label, source_display_identifier, normalized_machine_identifier, printed_marker, title/);
  assert.match(service, /captureExclusiveSourceBody/);
  assert.match(service, /original_source_text: captured\.text/);
  assert.match(service, /draft_legal_text: captured\.text/);
  assert.match(service, /original_subtree_text: captured\.subtree_text/);
  assert.doesNotMatch(service, /draft_legal_text: captured\.subtree_text/);
  assert.doesNotMatch(service, /downloadOwnerLegalMaterial/);
  assert.doesNotMatch(service, /createWorkerPdfSourceCache/);
  assert.doesNotMatch(service, /getBytes\(/);
  assert.doesNotMatch(service, /storage\.from\(/);
  assert.doesNotMatch(commands(), /downloadOwnerLegalMaterial/);
});

test('original_source_text remains immutable after create; reset cannot rewrite it', () => {
  const service = draftService();
  function fnBody(name: string, next: string): string {
    const start = service.indexOf(`export async function ${name}`);
    const end = service.indexOf(`export async function ${next}`);
    return service.slice(start, end < 0 ? undefined : end);
  }
  assert.doesNotMatch(fnBody('updateLegalTextDraftText', 'updateLegalTextDraftIdentity'), /original_source_text:/);
  assert.doesNotMatch(fnBody('resetLegalTextDraftToSource', 'setLegalTextDraftReviewStatus'), /original_source_text:/);
  assert.doesNotMatch(fnBody('setLegalTextDraftBoundary', 'resetLegalTextDraftToSource'), /original_source_text:/);
});

test('TAX-631B does not write canonical law, rebuild candidates, run worker, or touch UI/PROD migrations', () => {
  assert.doesNotMatch(draftService(), /from\('tax_legal_nodes'\)\s*\.insert/);
  assert.doesNotMatch(draftService(), /from\('tax_rules'\)/);
  assert.doesNotMatch(draftService(), /persistStructureCandidatesForJob/);
  assert.doesNotMatch(draftService(), /runKnowledgeTrainerWorkerTick/);
  assert.doesNotMatch(commands(), /runKnowledgeTrainerWorkerTick/);
  assert.doesNotMatch(persist(), /legal_ingestion_legal_text_drafts/);
  assert.doesNotMatch(worker(), /legal_ingestion_legal_text_drafts/);
  assert.doesNotMatch(webPanel(), /create_legal_text_draft_from_candidate/);
  for (const rel of [
    'supabase/migrations/620_owner_country_legal_access.sql',
    'supabase/migrations/629_legal_ingestion_source_evidence.sql',
    'supabase/migrations/630_legal_ingestion_legal_text_drafts.sql',
  ]) {
    assert.equal(existsSync(join(repoRoot, rel)), true);
  }
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/631_legal_text_draft_commands.sql')), false);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/632_legal_text_draft_own_vs_subtree.sql')), false);
});

test('3(ט1) remains distinct from 3(ט)(1) under TAX-631B boundary work', () => {
  const tet1 = parseLegalIdentifier('3(ט1)');
  const tetThen1 = parseLegalIdentifier('3(ט)(1)');
  assert.ok(tet1 && tetThen1);
  assert.notEqual(tet1.normalized_machine_identifier, tetThen1.normalized_machine_identifier);
  assert.equal(
    findDraftIdentityConflict(
      {
        id: 'a',
        parent_draft_id: 'parent',
        kind_label: 'סעיף קטן',
        normalized_machine_identifier: tet1.normalized_machine_identifier,
      },
      [
        {
          id: 'b',
          parent_draft_id: 'parent',
          kind_label: 'סעיף קטן',
          normalized_machine_identifier: tetThen1.normalized_machine_identifier,
        },
      ],
    ),
    null,
  );
});

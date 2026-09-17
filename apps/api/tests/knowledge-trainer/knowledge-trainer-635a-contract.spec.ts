import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capabilityRequiredForOwnerCommand } from '../../src/domains/owner-country-legal-access/owner-country-legal-access.pure.js';
import {
  attachStructureCompleteness,
  buildLegalTextReviewNodes,
  buildLegalTextSearchIndex,
  creationOriginFromDraft,
  placeOwnerSortKey,
} from '../../src/domains/knowledge-trainer/knowledge-trainer-legal-text-draft.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-635A named commands are aggregate-refreshing and do not PATCH or write canonical law', () => {
  const types = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
  const commands = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
  const service = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-legal-text-draft.service.ts');
  const createStart = service.indexOf('export async function createManualLegalTextDraft');
  const confirmStart = service.indexOf('export async function confirmOwnerStructureCompleteness');
  const retractStart = service.indexOf('export async function retractOwnerStructureCompleteness');
  const createFn = service.slice(createStart, confirmStart > createStart ? confirmStart : undefined);
  const confirmFn = service.slice(confirmStart, retractStart > confirmStart ? retractStart : undefined);
  const retractFn = service.slice(retractStart);

  assert.match(types, /'create_manual_legal_text_draft'/);
  assert.match(types, /'confirm_owner_structure_completeness'/);
  assert.match(types, /'retract_owner_structure_completeness'/);
  assert.match(commands, /case 'create_manual_legal_text_draft':/);
  assert.match(commands, /case 'confirm_owner_structure_completeness':/);
  assert.match(commands, /case 'retract_owner_structure_completeness':/);
  assert.match(commands, /refreshed: await refreshed\(/);
  assert.doesNotMatch(commands, /method:\s*['"]PATCH['"]/);
  assert.equal(capabilityRequiredForOwnerCommand('create_manual_legal_text_draft'), 'legal_knowledge.draft_create');
  assert.equal(capabilityRequiredForOwnerCommand('confirm_owner_structure_completeness'), 'legal_knowledge.review');
  assert.equal(capabilityRequiredForOwnerCommand('retract_owner_structure_completeness'), 'legal_knowledge.review');

  assert.match(createFn, /creation_origin: 'owner_manual'/);
  assert.match(createFn, /source_candidate_id: null/);
  assert.match(createFn, /original_source_text: ''/);
  assert.match(createFn, /draft_legal_text: draftText/);
  assert.match(createFn, /placeOwnerSortKey/);
  assert.doesNotMatch(createFn, /from\('legal_ingestion_candidates'\)[\s\S]{0,200}\.update\(/);
  assert.doesNotMatch(createFn, /from\('tax_legal_nodes'\)/);
  assert.doesNotMatch(createFn, /downloadOwnerLegalMaterial/);
  assert.doesNotMatch(createFn, /runKnowledgeTrainerWorkerTick/);
  assert.doesNotMatch(createFn, /persistStructureCandidatesForJob/);

  assert.match(confirmFn, /from\('legal_ingestion_owner_completeness'\)/);
  assert.doesNotMatch(confirmFn, /review_status/);
  assert.doesNotMatch(retractFn, /review_status/);
  assert.doesNotMatch(confirmFn, /from\('legal_ingestion_legal_text_drafts'\)[\s\S]{0,80}\.update\(/);
});

test('TAX-635A owner_sort_key places 2(5) between 2(4) and 2(6) without rewriting candidate order', () => {
  const key = placeOwnerSortKey(
    [
      { sort_key: 14, normalized_machine_identifier: '2(4)', display_identifier: '2(4)' },
      { sort_key: 16, normalized_machine_identifier: '2(6)', display_identifier: '2(6)' },
    ],
    '2(5)',
  );
  assert.equal(key, 15);
  const nodes = buildLegalTextReviewNodes(
    [
      {
        id: 'seif',
        parent_candidate_id: null,
        candidate_kind: 'structure',
        kind_label: 'סעיף',
        source_display_identifier: '2',
        sort_order: 10,
      },
      {
        id: 'c4',
        parent_candidate_id: 'seif',
        candidate_kind: 'structure',
        kind_label: 'סעיף קטן',
        source_display_identifier: '2(4)',
        sort_order: 14,
      },
      {
        id: 'c6',
        parent_candidate_id: 'seif',
        candidate_kind: 'structure',
        kind_label: 'סעיף קטן',
        source_display_identifier: '2(6)',
        sort_order: 16,
      },
    ],
    [
      {
        id: 'draft-seif',
        source_candidate_id: 'seif',
        parent_draft_id: null,
        review_status: 'needs_review',
        kind_label: 'סעיף',
        display_identifier: '2',
        printed_marker: '2',
        title: null,
        creation_origin: 'detector',
      },
      {
        id: 'manual-25',
        source_candidate_id: null,
        parent_draft_id: 'draft-seif',
        review_status: 'needs_review',
        kind_label: 'סעיף קטן',
        display_identifier: '2(5)',
        printed_marker: '(5)',
        title: null,
        creation_origin: 'owner_manual',
        owner_sort_key: 15,
      },
    ],
  );
  const children = nodes.filter((row) => row.parent_id === 'draft-seif');
  assert.deepEqual(
    children.map((row) => row.display_identifier),
    ['2(4)', '2(5)', '2(6)'],
  );
  assert.equal(children[1]?.creation_origin, 'owner_manual');
  assert.equal(children[1]?.manually_added, true);
  assert.equal(children[1]?.source_candidate_id, null);
});

test('TAX-635A detector origin survives missing source_candidate_id and completeness does not change review', () => {
  const nodes = buildLegalTextReviewNodes(
    [
      {
        id: 'root',
        parent_candidate_id: null,
        candidate_kind: 'structure',
        kind_label: 'חלק',
        source_display_identifier: 'חלק א',
        sort_order: 0,
      },
    ],
    [
      {
        id: 'orphaned-detector',
        source_candidate_id: null,
        parent_draft_id: null,
        review_status: 'ready',
        kind_label: 'סעיף',
        display_identifier: '2(2)',
        printed_marker: '(2)',
        title: null,
        creation_origin: 'detector',
        owner_sort_key: 3,
      },
      {
        id: 'manual',
        source_candidate_id: null,
        parent_draft_id: null,
        review_status: 'needs_review',
        kind_label: 'סעיף',
        display_identifier: '2(5)',
        printed_marker: null,
        title: null,
        creation_origin: 'owner_manual',
        owner_sort_key: 4,
      },
    ],
  );
  const detector = nodes.find((row) => row.id === 'orphaned-detector');
  const manual = nodes.find((row) => row.id === 'manual');
  assert.equal(creationOriginFromDraft('detector'), 'detector');
  assert.equal(detector?.creation_origin, 'detector');
  assert.equal(detector?.review_state, 'reviewed');
  assert.equal(manual?.creation_origin, 'owner_manual');
  const withCompleteness = attachStructureCompleteness(nodes, new Set(['manual']));
  assert.equal(withCompleteness.find((row) => row.id === 'manual')?.structure_completeness_confirmed, true);
  assert.equal(withCompleteness.find((row) => row.id === 'manual')?.review_state, 'needs_review');
  assert.equal(withCompleteness.find((row) => row.id === 'orphaned-detector')?.review_state, 'reviewed');
  const index = buildLegalTextSearchIndex(nodes);
  assert.equal(index.find((row) => row.search_label === '2(2)')?.node_id, 'orphaned-detector');
});

test('TAX-635A aggregate exposes collapsible tree, search index, and completeness without worker rebuild', () => {
  const read = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-read.service.ts');
  const worker = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-worker.runtime.ts');
  const persist = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-structure.service.ts');
  assert.match(read, /legal_text_search_index/);
  assert.match(read, /legal_text_completeness/);
  assert.match(read, /buildLegalTextSearchIndex/);
  assert.match(read, /attachStructureCompleteness/);
  assert.match(read, /from\('legal_ingestion_owner_completeness'\)/);
  assert.doesNotMatch(read, /method:\s*['"]PATCH['"]/);
  assert.doesNotMatch(worker, /legal_ingestion_owner_completeness/);
  assert.doesNotMatch(persist, /legal_ingestion_legal_text_drafts/);
  assert.doesNotMatch(persist, /accept_legal_structure_candidate/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachStructureReviewModel,
  buildStructureReviewTree,
  candidateMatchesReviewFilter,
  pageRangeOverlapsOcr,
} from '../../src/domains/knowledge-trainer/knowledge-trainer-review.pure.js';
import type { KnowledgeTrainerCandidateDto } from '../../src/domains/knowledge-trainer/knowledge-trainer.types.js';

const catalog = [
  { id: '1', label: 'חלק' },
  { id: '2', label: 'פרק' },
  { id: '3', label: 'סימן' },
  { id: '4', label: 'סעיף' },
  { id: '5', label: 'סעיף קטן' },
  { id: '6', label: 'תוספת' },
];

function base(
  overrides: Partial<Omit<KnowledgeTrainerCandidateDto, 'review_class' | 'review_class_label' | 'ocr_affected' | 'review_warnings' | 'display_warnings' | 'parent_label' | 'hierarchy_path' | 'hierarchy_valid'>> & { id: string },
) {
  return {
    candidate_kind: 'structure' as const,
    candidate_status: 'needs_review' as const,
    kind_label: 'סעיף',
    node_number: '1',
    title: 'הגדרות',
    parent_candidate_id: 'chelek',
    parent_tax_legal_node_id: null,
    page_start: 12,
    page_end: 12,
    excerpt: 'סעיף 1 הגדרות',
    confidence: 0.82,
    validation_warnings: [] as string[],
    matched_tax_legal_node_id: null,
    accepted_tax_legal_node_id: null,
    possible_existing_match: false,
    ...overrides,
  };
}

function classify(
  rows: ReturnType<typeof base>[],
  ocrPages: number[] = [],
) {
  return attachStructureReviewModel(rows, { catalog, ocr_pages: ocrPages });
}

test('clean containers and titled sections are high confidence, not accepted', () => {
  const model = classify([
    base({
      id: 'chelek',
      kind_label: 'חלק',
      node_number: "א'",
      title: 'פרשנות',
      parent_candidate_id: null,
      confidence: 0.9,
    }),
    base({ id: 'seif', kind_label: 'סעיף', node_number: '1', title: 'הגדרות', parent_candidate_id: 'chelek' }),
  ]);
  assert.equal(model.candidates[0].review_class, 'high_confidence');
  assert.equal(model.candidates[1].review_class, 'high_confidence');
  assert.equal(model.candidates[0].candidate_status, 'needs_review');
  assert.equal(model.candidates[0].accepted_tax_legal_node_id, null);
  assert.equal(model.review_summary.already_accepted, 0);
  assert.equal(model.structure_tree[0]?.candidate_id, 'chelek');
  assert.equal(model.structure_tree[0]?.children[0]?.candidate_id, 'seif');
  assert.equal(model.candidates[1].parent_label, "חלק א' פרשנות");
});

test('untitled sequential סעיף stays high confidence when parent and numbering are clean', () => {
  const model = classify([
    base({
      id: 'chelek',
      kind_label: 'חלק',
      node_number: "ב'",
      title: 'הטלת המס',
      parent_candidate_id: null,
      confidence: 0.9,
    }),
    base({
      id: 'seif',
      kind_label: 'סעיף',
      node_number: '12',
      title: null,
      parent_candidate_id: 'chelek',
      confidence: 0.72,
      validation_warnings: ['bare_numbered_heading'],
    }),
  ]);
  assert.equal(model.candidates[1].review_class, 'high_confidence');
});

test('סעיף קטן is needs owner review, not rejected technical', () => {
  const model = classify([
    base({
      id: 'chelek',
      kind_label: 'חלק',
      node_number: "א'",
      title: 'פרשנות',
      parent_candidate_id: null,
      confidence: 0.9,
    }),
    base({ id: 'seif', kind_label: 'סעיף', node_number: '1', title: 'הגדרות', parent_candidate_id: 'chelek' }),
    base({
      id: 'katan',
      kind_label: 'סעיף קטן',
      node_number: 'א',
      title: null,
      parent_candidate_id: 'seif',
      confidence: 0.4,
      validation_warnings: ['subsection_needs_context'],
    }),
  ]);
  assert.equal(model.candidates[2].review_class, 'needs_owner_review');
  assert.ok(model.candidates[2].review_warnings.includes('subsection_or_paragraph_needs_owner_review'));
});

test('amendment years and Go tokens are rejected technical', () => {
  const model = classify([
    base({
      id: 'year',
      kind_label: 'סעיף',
      node_number: '1984',
      title: ', תשמ"ד-',
      parent_candidate_id: null,
      excerpt: 'סעיף 1984 , תשמ"ד-',
    }),
    base({
      id: 'toc',
      kind_label: 'פרק',
      node_number: 'שני',
      title: 'המקום',
      parent_candidate_id: null,
      excerpt: 'פרק שני Go 78',
    }),
  ]);
  assert.equal(model.candidates[0].review_class, 'rejected_technical');
  assert.ok(model.candidates[0].review_warnings.includes('amendment_year_identifier'));
  assert.equal(model.candidates[1].review_class, 'rejected_technical');
});

test('global OCR stamp is ignored unless the candidate page range overlaps OCR pages', () => {
  const clean = classify(
    [
      base({
        id: 'chelek',
        kind_label: 'חלק',
        node_number: "א'",
        title: 'פרשנות',
        parent_candidate_id: null,
        confidence: 0.9,
        validation_warnings: ['ocr_pages_may_affect_hierarchy'],
      }),
    ],
    [273, 276],
  );
  assert.equal(clean.candidates[0].ocr_affected, false);
  assert.equal(clean.candidates[0].review_class, 'high_confidence');
  assert.equal(clean.candidates[0].display_warnings.includes('ocr_pages_may_affect_hierarchy'), false);

  const near = classify(
    [
      base({
        id: 'seif',
        kind_label: 'סעיף',
        node_number: '12',
        title: null,
        parent_candidate_id: null,
        page_start: 271,
        page_end: 293,
        validation_warnings: ['ocr_pages_may_affect_hierarchy', 'bare_numbered_heading'],
      }),
    ],
    [273, 276],
  );
  assert.equal(near.candidates[0].ocr_affected, true);
  assert.equal(near.candidates[0].review_class, 'needs_owner_review');
  assert.ok(near.candidates[0].review_warnings.includes('page_range_crosses_ocr'));
});

test('hierarchy uses persisted parents and catalog ranks, not a forced full chain', () => {
  const model = classify([
    base({
      id: 'chelek',
      kind_label: 'חלק',
      node_number: "ג'",
      title: 'חישוב ההכנסה',
      parent_candidate_id: null,
      confidence: 0.9,
    }),
    base({
      id: 'seif',
      kind_label: 'סעיף',
      node_number: '9',
      title: null,
      parent_candidate_id: 'chelek',
      confidence: 0.72,
    }),
    base({
      id: 'bad',
      kind_label: 'חלק',
      node_number: "ד'",
      title: 'חישוב',
      parent_candidate_id: 'seif',
      confidence: 0.9,
    }),
  ]);
  assert.equal(model.candidates[1].hierarchy_valid, true);
  assert.equal(model.candidates[1].review_class, 'high_confidence');
  assert.equal(model.candidates[2].hierarchy_valid, false);
  assert.ok(model.candidates[2].review_warnings.includes('hierarchy_rank_mismatch'));
  assert.equal(model.candidates[2].review_class, 'needs_owner_review');
});

test('review filters are backend counts and high confidence is not an accept action', () => {
  const model = classify([
    base({
      id: 'chelek',
      kind_label: 'חלק',
      node_number: "א'",
      title: 'פרשנות',
      parent_candidate_id: null,
      confidence: 0.9,
    }),
    base({
      id: 'katan',
      kind_label: 'סעיף קטן',
      node_number: 'א',
      title: null,
      parent_candidate_id: 'chelek',
      confidence: 0.4,
    }),
    base({
      id: 'year',
      kind_label: 'סעיף',
      node_number: '2016',
      title: null,
      parent_candidate_id: 'chelek',
    }),
  ]);
  const keys = model.review_filters.map((row) => row.key);
  assert.deepEqual(keys, ['all', 'high_confidence', 'needs_review', 'ocr_affected', 'rejected']);
  assert.equal(model.review_filters[0].count, 3);
  assert.equal(model.review_filters[1].count, 1);
  assert.equal(model.review_filters[2].count, 1);
  assert.equal(model.review_filters[4].count, 1);
  assert.equal(candidateMatchesReviewFilter(model.candidates[0], 'high_confidence'), true);
  assert.equal(model.candidates[0].candidate_status !== 'accepted', true);
});

test('tree preserves source order parents and pageRangeOverlapsOcr is inclusive', () => {
  const tree = buildStructureReviewTree([
    { id: 'a', parent_candidate_id: null },
    { id: 'b', parent_candidate_id: 'a' },
    { id: 'c', parent_candidate_id: 'missing' },
  ]);
  assert.equal(tree.length, 2);
  assert.equal(tree[0]?.children[0]?.candidate_id, 'b');
  assert.equal(pageRangeOverlapsOcr(271, 293, [273]), true);
  assert.equal(pageRangeOverlapsOcr(12, 16, [273]), false);
});

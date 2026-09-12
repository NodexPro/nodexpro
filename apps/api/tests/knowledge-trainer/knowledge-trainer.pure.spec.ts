import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertV1PdfUpload,
  extractStructureCandidatesFromPages,
  hasParentCycle,
  orderedPagesFromFutureInputs,
  pageHasUsableEmbeddedText,
  parseNumericIdentifier,
  sha256Hex,
  summarizeJobProgress,
  trainerInputOptions,
  validateStructureCandidates,
  workerMustNotWriteCanonicalLaw,
} from '../../src/domains/knowledge-trainer/knowledge-trainer.pure.js';
import { capabilityRequiredForOwnerCommand } from '../../src/domains/owner-country-legal-access/owner-country-legal-access.pure.js';

const catalog = [
  { id: '1', label: 'חלק' },
  { id: '2', label: 'פרק' },
  { id: '3', label: 'סימן' },
  { id: '4', label: 'סעיף' },
  { id: '5', label: 'סעיף קטן' },
  { id: '6', label: 'תוספת' },
];

test('checksum is deterministic', () => {
  assert.equal(sha256Hex(Buffer.from('same')), sha256Hex(Buffer.from('same')));
  assert.notEqual(sha256Hex(Buffer.from('same')), sha256Hex(Buffer.from('other')));
});

test('V1 accepts PDF magic and rejects other MIME/input/size', () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(16, 1)]);
  assert.deepEqual(assertV1PdfUpload({ input_type: 'pdf', mime_type: 'application/pdf', bytes: pdf }), {
    input_type: 'pdf',
    mime_type: 'application/pdf',
  });
  assert.throws(() => assertV1PdfUpload({ input_type: 'image', mime_type: 'image/jpeg', bytes: pdf }), /PDF only/);
  assert.throws(() => assertV1PdfUpload({ input_type: 'pdf', mime_type: 'image/png', bytes: pdf }), /Unsupported MIME/);
  assert.throws(
    () => assertV1PdfUpload({ input_type: 'pdf', mime_type: 'application/pdf', bytes: Buffer.from('not-pdf') }),
    /not a PDF/,
  );
});

test('textless page is needs_ocr and is not invented', () => {
  assert.equal(pageHasUsableEmbeddedText('   '), false);
  assert.equal(pageHasUsableEmbeddedText('סעיף 1'), true);
});

test('deterministic Hebrew structure uses catalog labels and document-order parents', () => {
  const drafts = extractStructureCandidatesFromPages(
    [
      { page_no: 1, text: 'חלק א פרשנות\nסעיף 14 הכנסה\nסעיף 16 ניכוי' },
      { page_no: 2, text: 'חלק ב הוראות' },
    ],
    catalog,
  );
  assert.equal(drafts.length, 4);
  assert.equal(drafts[0].kind_label, 'חלק');
  assert.equal(drafts[1].kind_label, 'סעיף');
  assert.equal(drafts[1].parent_index, 0);
  assert.equal(drafts[2].parent_index, 0);
  assert.equal(drafts[3].kind_label, 'חלק');
  assert.equal(drafts[3].parent_index, null);
});

test('sequence gap warns and does not invent the missing section', () => {
  const drafts = validateStructureCandidates(
    extractStructureCandidatesFromPages([{ page_no: 1, text: 'סעיף 14 א\nסעיף 16 ב' }], catalog),
    { country_code: 'IL', tax_source_id: 'src', existing_nodes: [] },
  );
  assert.equal(drafts.some((row) => row.node_number === '15'), false);
  assert.ok(drafts.some((row) => row.validation_warnings.includes('sequence_anomaly')));
  assert.equal(parseNumericIdentifier('16'), 16);
});

test('hierarchy cycle and duplicate sibling are review warnings, not canonical writes', () => {
  assert.equal(hasParentCycle(0, new Map([[0, 1], [1, 0]])), true);
  const dups = validateStructureCandidates(
    [
      {
        candidate_kind: 'structure',
        candidate_status: 'proposed',
        kind_label: 'סעיף',
        node_number: '1',
        title: 'A',
        parent_index: null,
        page_start: 1,
        page_end: 1,
        excerpt: 'סעיף 1 A',
        confidence: 0.5,
        validation_warnings: [],
      },
      {
        candidate_kind: 'structure',
        candidate_status: 'proposed',
        kind_label: 'סעיף',
        node_number: '1',
        title: 'B',
        parent_index: null,
        page_start: 1,
        page_end: 1,
        excerpt: 'סעיף 1 B',
        confidence: 0.5,
        validation_warnings: [],
      },
    ],
    { country_code: 'IL', tax_source_id: 'src', existing_nodes: [] },
  );
  assert.ok(dups.every((row) => row.validation_warnings.includes('duplicate_sibling_identifier')));
});

test('future photo and pasted-text batches map onto the same ordered page model', () => {
  const photos = orderedPagesFromFutureInputs({
    input_type: 'image',
    items: [{ order: 3, text: null }, { order: 1, text: null }, { order: 2, text: null }],
  });
  assert.deepEqual(photos.map((page) => page.page_no), [1, 2, 3]);
  assert.equal(photos[0].extraction_method, 'ocr');
  const pasted = orderedPagesFromFutureInputs({
    input_type: 'text',
    items: [{ order: 1, text: 'סעיף 1' }],
  });
  assert.equal(pasted[0].extraction_method, 'manual_text');
});

test('312-page progress is page-checkpointed and not one HTTP batch', () => {
  const pages = Array.from({ length: 312 }, (_, index) => ({
    status: index < 154 ? 'extracted' : index === 154 ? 'failed' : 'pending',
  }));
  const progress = summarizeJobProgress(pages);
  assert.equal(progress.extracted_page_count, 154);
  assert.equal(progress.failed_page_count, 1);
  assert.equal(progress.job_status, 'extracting');
  const afterFail = summarizeJobProgress(
    pages.map((page, index) => (index > 154 ? { status: 'extracted' } : page)),
  );
  assert.equal(afterFail.extracted_page_count, 311);
  assert.equal(afterFail.job_status, 'partially_extracted');
});

test('worker isolation forbids canonical legal tables', () => {
  assert.equal(workerMustNotWriteCanonicalLaw('tax_legal_nodes'), true);
  assert.equal(workerMustNotWriteCanonicalLaw('tax_domains'), true);
  assert.equal(workerMustNotWriteCanonicalLaw('legal_ingestion_pages'), false);
});

test('upload/accept are not activate; reject is review; edit is draft_edit', () => {
  assert.equal(capabilityRequiredForOwnerCommand('upload_legal_training_document'), 'legal_sources.manage');
  assert.equal(capabilityRequiredForOwnerCommand('accept_legal_structure_candidate'), 'legal_sources.manage');
  assert.equal(capabilityRequiredForOwnerCommand('update_legal_extraction_candidate'), 'legal_knowledge.draft_edit');
  assert.equal(capabilityRequiredForOwnerCommand('reject_legal_extraction_candidate'), 'legal_knowledge.review');
  assert.equal(capabilityRequiredForOwnerCommand('activate_tax_source'), 'legal_knowledge.activate');
  assert.notEqual(capabilityRequiredForOwnerCommand('upload_legal_training_document'), 'legal_knowledge.activate');
});

test('Photos and Text stay unavailable in V1 input options', () => {
  const options = trainerInputOptions(true);
  assert.equal(options.find((row) => row.input_type === 'pdf')?.available, true);
  assert.equal(options.find((row) => row.input_type === 'image')?.available, false);
  assert.equal(options.find((row) => row.input_type === 'text')?.available, false);
  assert.equal(options.find((row) => row.input_type === 'image')?.status_label, 'Coming next');
});

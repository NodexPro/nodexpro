import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('Knowledge Trainer V1 UI is additive and does not hide manual structure authoring', () => {
  const library = readRepo('apps/web/src/pages/owner-legal-library-panel.tsx');
  const trainer = readRepo('apps/web/src/pages/owner-knowledge-trainer-panel.tsx');
  const css = readRepo('apps/web/src/styles/nx-modal.css');
  assert.match(library, /Add Tax Domain/);
  assert.match(library, /Add Legal Source/);
  assert.match(library, /Add Structure Item/);
  assert.match(library, /Add Canonical Rule/);
  assert.match(library, /Link Existing Rule/);
  assert.match(library, /Upload material/);
  assert.match(trainer, /Upload legal material/);
  assert.match(trainer, /PDF —/);
  assert.match(trainer, /Coming next/);
  assert.match(trainer, /Original source/);
  assert.match(trainer, /Draft structure/);
  assert.match(trainer, /Rebuild structure candidates/);
  assert.match(trainer, /High confidence/);
  assert.match(trainer, /Needs review/);
  assert.match(trainer, /OCR affected/);
  assert.match(trainer, /#page=/);
  assert.match(trainer, /Search by/);
  assert.match(trainer, /Expand review/);
  assert.match(trainer, /Extract layout evidence/);
  assert.match(trainer, /Rebuild structure with layout/);
  assert.match(trainer, /Existing document reused/);
  assert.match(trainer, /item count/);
  assert.match(trainer, /layout evidence status/);
  assert.match(trainer, /CandidatePicker/);
  assert.match(trainer, /ExpandedReviewModal/);
  assert.match(trainer, /createPortal/);
  assert.match(trainer, /nx-trainer-review-overlay/);
  assert.match(trainer, /window\.document\.body\.style\.overflow = 'hidden'/);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /calc\(100vw - 32px\)/);
  assert.match(css, /calc\(100vh - 32px\)/);
  assert.doesNotMatch(css, /min-height:\s*calc\(96vh/);
  assert.match(trainer, /aria-labelledby="trainer-expand-review-title"/);
  assert.doesNotMatch(trainer, /Accept all|Bulk accept|accept_all|auto.accept|auto_activate/i);
});

test('Trainer polls only while backend aggregate says processing and does not hold commandBusy', async () => {
  const { shouldPollKnowledgeTrainerProgress } = await import('../src/pages/owner-knowledge-trainer-progress.ts');
  assert.equal(shouldPollKnowledgeTrainerProgress({ job_status: 'needs_review', layout_readiness: 'processing' }), true);
  assert.equal(shouldPollKnowledgeTrainerProgress({ job_status: 'extracting', layout_readiness: 'not_extracted' }), true);
  assert.equal(shouldPollKnowledgeTrainerProgress({ job_status: 'needs_review', layout_readiness: 'ready' }), false);
  assert.equal(shouldPollKnowledgeTrainerProgress({ job_status: 'needs_review', layout_readiness: 'partial' }), false);
  assert.equal(shouldPollKnowledgeTrainerProgress({ job_status: 'needs_review', layout_readiness: 'failed' }), false);
  const panel = readRepo('apps/web/src/pages/PlatformOwnerLegalControl.tsx');
  const trainer = readRepo('apps/web/src/pages/owner-knowledge-trainer-panel.tsx');
  assert.match(panel, /finally \{\s*setCommandBusy\(false\);/s);
  assert.match(panel, /reloadTrainerSilently/);
  assert.match(trainer, /shouldPollKnowledgeTrainerProgress/);
  assert.match(trainer, /document\.id, onReload/);
});

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
  assert.match(trainer, /CandidatePicker/);
  assert.match(trainer, /ExpandedReviewModal/);
  assert.doesNotMatch(trainer, /Accept all|Bulk accept|accept_all|auto.accept|auto_activate/i);
});

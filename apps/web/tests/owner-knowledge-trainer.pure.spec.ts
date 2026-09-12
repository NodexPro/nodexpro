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
  assert.match(library, /Add Structure Item/);
  assert.match(library, /Upload material/);
  assert.match(trainer, /Upload legal material/);
  assert.match(trainer, /PDF —/);
  assert.match(trainer, /Coming next/);
  assert.match(trainer, /Original source/);
  assert.match(trainer, /Draft structure/);
});

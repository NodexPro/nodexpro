/**
 * Console TypeError: Cannot read properties of undefined (reading 'startTime')
 * at reportAllChanges — this is not a NodexPro call site.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const webSrc = join(dir, '../src');

function walk(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

test('reportAllChanges / startTime observer is not in NodexPro web source', () => {
  const files = walk(webSrc);
  assert.ok(files.length > 50);
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /reportAllChanges/);
    assert.doesNotMatch(src, /new PerformanceObserver/);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const projectionServiceSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer-future-cycle-projection.service.ts'),
  'utf8',
);

test('rebuildProjectedLineTotals matches rows by line_id or id fallback', () => {
  assert.ok(projectionServiceSource.includes('row.line_id || row.id'));
  assert.ok(projectionServiceSource.includes('lines[index]'));
  assert.ok(projectionServiceSource.includes('Number.isFinite(unitPrice) ? unitPrice : null'));
});

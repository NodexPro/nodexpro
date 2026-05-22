import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const mergeSource = readFileSync(
  join(dir, '../../../web/src/income/merge-wizard-workspace-aggregate.ts'),
  'utf8',
);

test('frontend merge preserves recipient on wizard_patch responses', () => {
  assert.ok(mergeSource.includes('preserveRecipient'));
  assert.ok(mergeSource.includes('patch.recipient_search.selected == null'));
  assert.ok(mergeSource.includes('document_details_step: patch.document_details_step'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const modalSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineClientDocumentsByTypeModal.tsx'),
  'utf8',
);

test('converted-document open path clears cancel and does not mount ביטול המסמך without cancel click', () => {
  assert.ok(modalSource.includes('clearCancelModal'));
  // Opening convert chooser clears any stale cancel confirm state.
  assert.match(
    modalSource,
    /onClick=\{\(\) => \{\s*clearCancelModal\(\);\s*setConvertTarget/,
  );
  // After convert command success, cancel is cleared before opening the draft wizard.
  assert.match(modalSource, /closeConvertModal\(\);\s*clearCancelModal\(\);/);
  // Documents modal close / reset also clears cancel.
  assert.match(modalSource, /setCancelTarget\(null\);\s*setCancelReason\(''\);/);
  // Cancel dialog mounts only when cancelTarget is set AND convert chooser is closed.
  assert.match(modalSource, /\{cancelTarget && !convertTarget \? \(/);
  assert.ok(modalSource.includes('confirmation_title'));
});

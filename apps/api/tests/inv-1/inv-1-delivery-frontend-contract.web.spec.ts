/**
 * INV-1 Phase 10 — frontend delivery UI must remain dumb (render-only).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(dir, '../../../web/src');

const FORBIDDEN_FRONTEND_PATTERNS = [
  /resolveIncomeDocumentEmailSendEligibility/,
  /resolveIncomeDocumentDocflowSendEligibility/,
  /buildIncomeDocumentEmailDeliveryBlock/,
  /buildIncomeDocumentDocflowDeliveryBlock/,
  /incomeEmailDeliveryAttemptCountLabel/,
  /incomeDocflowDeliveryAttemptCountLabel/,
];

function readWeb(relPath: string): string {
  return readFileSync(join(webRoot, relPath), 'utf8');
}

function assertNoDeliveryTruthComputation(relPath: string, source: string): void {
  for (const pattern of FORBIDDEN_FRONTEND_PATTERNS) {
    assert.doesNotMatch(
      source,
      pattern,
      `${relPath} must render backend delivery blocks only (${pattern})`,
    );
  }
}

const DELIVERY_CELL_FILES = [
  'components/income/IncomeDocumentEmailDeliveryCell.tsx',
  'components/income/IncomeDocumentDocflowDeliveryCell.tsx',
];

for (const relPath of DELIVERY_CELL_FILES) {
  test(`gate 9 frontend: ${relPath.split('/').pop()} renders backend block fields only`, () => {
    const source = readWeb(relPath);
    assertNoDeliveryTruthComputation(relPath, source);
    assert.match(source, /block\.status_label/);
    assert.match(source, /block\.action\.enabled/);
    assert.match(source, /block\.action\.disabled_reason/);
    assert.match(source, /block\.action\.label/);
  });
}

const DELIVERY_SHELL_FILES = [
  'components/income/IncomeDocumentsTable.tsx',
  'components/work-engine/WorkEngineClientDocumentsByTypeModal.tsx',
];

for (const relPath of DELIVERY_SHELL_FILES) {
  test(`gate 9 frontend: ${relPath.split('/').pop()} delegates delivery cells without local eligibility`, () => {
    const source = readWeb(relPath);
    assertNoDeliveryTruthComputation(relPath, source);
    assert.match(source, /IncomeDocumentEmailDeliveryCell/);
    assert.match(source, /IncomeDocumentDocflowDeliveryCell/);
    assert.match(source, /email_delivery/);
    assert.match(source, /docflow_delivery/);
  });
}

const DELIVERY_MODAL_FILES = [
  'components/income/IncomeDocumentEmailHistoryModal.tsx',
  'components/income/IncomeDocumentDocflowSendModal.tsx',
];

for (const relPath of DELIVERY_MODAL_FILES) {
  test(`gate 9 frontend: ${relPath.split('/').pop()} gates send on aggregate.send_form only`, () => {
    const source = readWeb(relPath);
    assertNoDeliveryTruthComputation(relPath, source);
    assert.match(source, /aggregate\.send_form/);
    assert.match(source, /send_form\.enabled/);
    assert.doesNotMatch(source, /resolveIncomeDocument/);
  });
}

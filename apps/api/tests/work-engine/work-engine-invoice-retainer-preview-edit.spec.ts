import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveCycleDraftPreviewEditButton } from '../../../web/src/components/work-engine/work-engine-invoice-retainer-preview-edit.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));

function readWebSource(relativePath: string): string {
  return readFileSync(join(dir, '../../../web/src', relativePath), 'utf8');
}

const setupModalSource = readWebSource('components/work-engine/WorkEngineInvoiceRetainerSetupModal.tsx');
const editorModalSource = readWebSource('components/work-engine/WorkEngineRecurringCycleDraftReviewModal.tsx');
const retainerCssSource = readFileSync(
  join(dir, '../../../web/src/styles/nx-work-engine-invoice-retainer.css'),
  'utf8',
);

test('resolveCycleDraftPreviewEditButton renders enabled pencil from backend edit_action', () => {
  const model = resolveCycleDraftPreviewEditButton({
    edit_action: {
      visible: true,
      enabled: true,
      label: 'עריכה',
      disabled_reason: null,
    },
    has_on_edit_handler: true,
  });
  assert.equal(model.render, true);
  assert.equal(model.disabled, false);
  assert.equal(model.label, 'עריכה');
});

test('resolveCycleDraftPreviewEditButton disables pencil with backend reason', () => {
  const model = resolveCycleDraftPreviewEditButton({
    edit_action: {
      visible: true,
      enabled: false,
      label: 'עריכה',
      disabled_reason: 'אין הרשאת עריכה',
    },
    has_on_edit_handler: true,
  });
  assert.equal(model.render, true);
  assert.equal(model.disabled, true);
  assert.equal(model.disabled_reason, 'אין הרשאת עריכה');
});

test('resolveCycleDraftPreviewEditButton hides pencil when not visible', () => {
  const model = resolveCycleDraftPreviewEditButton({
    edit_action: {
      visible: false,
      enabled: true,
      label: 'עריכה',
      disabled_reason: null,
    },
    has_on_edit_handler: true,
  });
  assert.equal(model.render, false);
});

test('preview modal pencil is rendered from edit_action and not blocked by busy', () => {
  const previewModalSource = readWebSource('components/work-engine/WorkEngineInvoiceRetainerPreviewModal.tsx');
  assert.ok(previewModalSource.includes('resolveCycleDraftPreviewEditButton'));
  assert.ok(previewModalSource.includes('data-testid="we-cycle-draft-preview-edit"'));
  assert.ok(previewModalSource.includes('onClick={handleEditClick}'));
  assert.ok(previewModalSource.includes('disabled={editButton.disabled}'));
  assert.ok(!/className="nx-we-retainer-preview-modal__edit"[\s\S]{0,240}disabled=\{busy\}/.test(previewModalSource));
});

test('setup modal pencil opens editor without API call', () => {
  assert.ok(setupModalSource.includes('handleOpenCycleDraftEditor'));
  assert.ok(setupModalSource.includes('setCycleDraftEditorOpen(true)'));
  assert.ok(setupModalSource.includes('onEdit={handleOpenCycleDraftEditor}'));
  assert.ok(setupModalSource.includes('open={cycleDraftPreviewOpen}'));
  assert.ok(setupModalSource.includes('open={cycleDraftEditorOpen}'));
  const handlerStart = setupModalSource.indexOf('const handleOpenCycleDraftEditor');
  const handlerEnd = setupModalSource.indexOf('const handleCloseCycleDraftPreview', handlerStart);
  const handlerBlock = setupModalSource.slice(handlerStart, handlerEnd);
  assert.ok(!handlerBlock.includes('executeWorkEngineInvoiceRetainerCommand'));
  assert.ok(!handlerBlock.includes('executeIncomeCommand'));
});

test('editor stacks above preview and preview stays mounted', () => {
  assert.ok(setupModalSource.includes('stackedAbovePreview={cycleDraftPreviewOpen}'));
  assert.ok(editorModalSource.includes('nx-we-retainer-overlay--above-preview'));
  assert.ok(retainerCssSource.includes('.nx-we-retainer-overlay--above-preview'));
  assert.ok(Number(retainerCssSource.match(/nx-we-retainer-overlay--above-preview[\s\S]*?z-index:\s*(\d+)/)?.[1]) > 13100);
  assert.equal(editorModalSource.match(/function WorkEngineRecurringCycleDraftReviewModal/g)?.length, 1);
});

test('cycle draft review service exposes enabled edit_action', () => {
  const cycleReviewServiceSource = readFileSync(
    join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer-cycle-draft-review.service.ts'),
    'utf8',
  );
  assert.ok(cycleReviewServiceSource.includes('enabled: true'));
  assert.ok(cycleReviewServiceSource.includes('edit_action:'));
});

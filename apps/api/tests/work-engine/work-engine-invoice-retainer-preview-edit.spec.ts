import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveCycleDraftPreviewEditButton } from '../../../web/src/components/work-engine/work-engine-invoice-retainer-preview-edit.pure.ts';
import {
  cycleDraftViewModeAfterEditorCancel,
  cycleDraftViewModeAfterEditorSave,
  cycleDraftViewModeAfterOpenReview,
  cycleDraftViewModeAfterPencilClick,
  cycleDraftViewModeAfterPreviewClose,
  isCycleDraftEditorOpen,
  isCycleDraftPreviewOpen,
} from '../../../web/src/components/work-engine/work-engine-invoice-retainer-cycle-draft-view.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));

function readWebSource(relativePath: string): string {
  return readFileSync(join(dir, '../../../web/src', relativePath), 'utf8');
}

const setupModalSource = readWebSource('components/work-engine/WorkEngineInvoiceRetainerSetupModal.tsx');
const editorModalSource = readWebSource('components/work-engine/WorkEngineRecurringCycleDraftReviewModal.tsx');

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

test('cycle draft view mode transitions', () => {
  assert.equal(cycleDraftViewModeAfterOpenReview(), 'preview');
  assert.equal(cycleDraftViewModeAfterPencilClick(), 'editor');
  assert.equal(cycleDraftViewModeAfterEditorCancel(), 'preview');
  assert.equal(cycleDraftViewModeAfterEditorSave(), 'preview');
  assert.equal(cycleDraftViewModeAfterPreviewClose(), null);
  assert.equal(isCycleDraftPreviewOpen('preview'), true);
  assert.equal(isCycleDraftPreviewOpen('editor'), false);
  assert.equal(isCycleDraftEditorOpen('editor'), true);
  assert.equal(isCycleDraftEditorOpen('preview'), false);
});

test('preview modal pencil is rendered from edit_action and not blocked by busy', () => {
  const previewModalSource = readWebSource('components/work-engine/WorkEngineInvoiceRetainerPreviewModal.tsx');
  assert.ok(previewModalSource.includes('resolveCycleDraftPreviewEditButton'));
  assert.ok(previewModalSource.includes('data-testid="we-cycle-draft-preview-edit"'));
  assert.ok(previewModalSource.includes('onClick={handleEditClick}'));
  assert.ok(previewModalSource.includes('disabled={editButton.disabled}'));
  assert.ok(!/className="nx-we-retainer-preview-modal__edit"[\s\S]{0,240}disabled=\{busy\}/.test(previewModalSource));
});

test('setup modal pencil switches to editor mode without API call', () => {
  assert.ok(setupModalSource.includes('cycleDraftViewMode'));
  assert.ok(setupModalSource.includes("setCycleDraftViewMode('editor')"));
  assert.ok(setupModalSource.includes('onEdit={handleOpenCycleDraftEditor}'));
  assert.ok(setupModalSource.includes("open={cycleDraftViewMode === 'preview'}"));
  assert.ok(setupModalSource.includes("open={cycleDraftViewMode === 'editor'}"));
  const handlerStart = setupModalSource.indexOf('const handleOpenCycleDraftEditor');
  const handlerEnd = setupModalSource.indexOf('const handleCloseCycleDraftPreview', handlerStart);
  const handlerBlock = setupModalSource.slice(handlerStart, handlerEnd);
  assert.ok(!handlerBlock.includes('executeWorkEngineInvoiceRetainerCommand'));
  assert.ok(!handlerBlock.includes('executeIncomeCommand'));
});

test('preview modal is not mounted while editor mode is active', () => {
  assert.ok(!setupModalSource.includes('cycleDraftPreviewOpen'));
  assert.ok(!setupModalSource.includes('cycleDraftEditorOpen'));
  assert.ok(!setupModalSource.includes('stackedAbovePreview'));
  assert.ok(setupModalSource.includes("cycleDraftViewMode === 'preview'"));
  assert.ok(setupModalSource.includes("cycleDraftViewMode === 'editor'"));
});

test('editor cancel and save return to preview mode', () => {
  assert.ok(setupModalSource.includes('handleCancelCycleDraftEditor'));
  assert.ok(setupModalSource.includes("setCycleDraftViewMode('preview')"));
  assert.ok(setupModalSource.includes('handleCycleDraftEditorSaveSuccess'));
  assert.ok(setupModalSource.includes('onSaveSuccess={handleCycleDraftEditorSaveSuccess}'));
  assert.ok(setupModalSource.includes('onClose={handleCancelCycleDraftEditor}'));
  const saveHandlerStart = setupModalSource.indexOf('const handleCycleDraftEditorSaveSuccess');
  const saveHandlerEnd = setupModalSource.indexOf('const applyRetainerAggregate', saveHandlerStart);
  const saveHandlerBlock = setupModalSource.slice(saveHandlerStart, saveHandlerEnd);
  assert.ok(!saveHandlerBlock.includes('fetchWorkEngineInvoiceRetainerSetupAggregate'));
});

test('editor save uses refresh_document_preview and returns refreshed case to parent', () => {
  assert.ok(editorModalSource.includes('refresh_document_preview: true'));
  assert.ok(editorModalSource.includes('onSaveSuccess?.(nextAggregate)'));
  assert.equal(editorModalSource.match(/function WorkEngineRecurringCycleDraftReviewModal/g)?.length, 1);
});

test('cycle draft review service exposes edit_action and issue_action', () => {
  const cycleReviewServiceSource = readFileSync(
    join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer-cycle-draft-review.service.ts'),
    'utf8',
  );
  assert.ok(cycleReviewServiceSource.includes('edit_action:'));
  assert.ok(cycleReviewServiceSource.includes('issue_action:'));
});

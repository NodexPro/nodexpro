import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildIncomeDocumentAllocationNumberField,
  defaultIncomeTaxAllocationNumberPolicy,
} from '../../src/domains/income/income-document-allocation-number.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const previewStepSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineIncomePreviewStep.tsx'),
  'utf8',
);
const previewPaperSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineIncomeDocumentPreviewPaper.tsx'),
  'utf8',
);
const chromePureSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/work-engine-income-document-allocation-edit-chrome.pure.ts'),
  'utf8',
);
const previewSidebarSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineIncomeDocumentPreviewSidebar.tsx'),
  'utf8',
);
const retainerPreviewModalSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineInvoiceRetainerPreviewModal.tsx'),
  'utf8',
);
const wizardSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineIncomeDocumentWizardModal.tsx'),
  'utf8',
);
const retainerSetupSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineInvoiceRetainerSetupModal.tsx'),
  'utf8',
);
const detailsBuilderSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-details-step.builders.ts'),
  'utf8',
);
const rendererSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-branding-preview.renderer.ts'),
  'utf8',
);
const allocationPureSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-allocation-number.pure.ts'),
  'utf8',
);
const workEngineQueueCss = readFileSync(
  join(dir, '../../../web/src/styles/nx-work-engine-queue.css'),
  'utf8',
);

/** Preview-paper document rules only — excludes modal/sidebar chrome elsewhere in the file. */
function workEnginePreviewDocumentCssRules(css: string): string {
  const marker = 'Work Engine Preview — document HTML chrome only';
  const start = css.indexOf(marker);
  assert.ok(start >= 0, 'expected work engine preview chrome marker');
  const after = css.slice(start);
  const end = after.search(/\n@media\b/);
  return end >= 0 ? after.slice(0, end) : after;
}

test('work engine preview css does not override backend sectioned document layout', () => {
  const previewDocCss = workEnginePreviewDocumentCssRules(workEngineQueueCss);

  assert.doesNotMatch(previewDocCss, /\.nx-we-preview-paper__content\s+\.nx-doc\s*\{/);
  assert.doesNotMatch(previewDocCss, /\.nx-doc--sectioned/);
  assert.doesNotMatch(previewDocCss, /\.nx-doc__upper-sheet/);
  assert.doesNotMatch(previewDocCss, /\.nx-doc__sheet-section/);
  assert.doesNotMatch(previewDocCss, /\.nx-doc__branding/);
  assert.doesNotMatch(previewDocCss, /\.nx-doc__doc-identity/);
  assert.doesNotMatch(previewDocCss, /\.nx-doc__doc-title/);
  assert.doesNotMatch(previewDocCss, /\.nx-doc__doc-number-bar/);
  assert.doesNotMatch(previewDocCss, /\.nx-doc__logo-frame/);
  assert.doesNotMatch(previewDocCss, /\.nx-doc__logo-img/);
  assert.doesNotMatch(previewDocCss, /\.nx-doc__issuer/);
  assert.doesNotMatch(previewDocCss, /\.nx-doc__customer-card/);
  assert.doesNotMatch(previewDocCss, /65px/);
  assert.doesNotMatch(previewDocCss, /grid-template-areas/);
  assert.doesNotMatch(previewDocCss, /--nx-doc-logo-fit/);
  assert.doesNotMatch(previewDocCss, /width:\s*100%\s*!important/);
  assert.doesNotMatch(previewDocCss, /max-width:\s*100%\s*!important/);

  // Chrome-only presentation helpers may remain.
  assert.match(previewDocCss, /\.nx-doc__total-row--discount/);
  assert.match(previewDocCss, /\.nx-doc__grand-total strong/);
});

test('work engine queue css never reintroduces sectioned 65px upper-sheet overrides', () => {
  assert.doesNotMatch(workEngineQueueCss, /\.nx-we-preview-paper__content[^{]*\.nx-doc--sectioned/);
  assert.doesNotMatch(
    workEngineQueueCss,
    /\.nx-we-preview-paper__content[\s\S]{0,200}grid-template-rows:\s*65px/,
  );
  assert.doesNotMatch(
    workEngineQueueCss,
    /\.nx-we-preview-paper__content[\s\S]{0,200}\.nx-doc__sheet-section--1/,
  );
});

test('canonical preview_html contains no allocation edit controls', () => {
  assert.doesNotMatch(rendererSource, /allocation_number_edit_affordance/);
  assert.doesNotMatch(rendererSource, /data-income-allocation-edit/);
  assert.doesNotMatch(rendererSource, /nx-doc__meta-edit-btn/);
  assert.doesNotMatch(rendererSource, /<button[^>]*מספר הקצאה/);
  assert.doesNotMatch(allocationPureSource, /INCOME_DOCUMENT_ALLOCATION_EDIT_ATTR/);
  assert.doesNotMatch(allocationPureSource, /buildIncomeDocumentAllocationEditAffordance/);
  assert.doesNotMatch(detailsBuilderSource, /allocation_number_edit_affordance/);
  assert.match(rendererSource, /nx-doc__meta-row--allocation/);
});

test('income wizard uses application overlay chrome not document html click targets', () => {
  assert.match(previewStepSource, /WorkEngineIncomeDocumentPreviewPaper/);
  assert.match(previewPaperSource, /resolveIncomeDocumentAllocationEditChrome/);
  assert.match(previewPaperSource, /nx-we-preview-allocation-edit-btn--inline/);
  assert.match(previewPaperSource, /nx-doc__meta-label-group--injected/);
  assert.doesNotMatch(previewPaperSource, /measureIncomeDocumentAllocationEditAnchor/);
  assert.match(previewPaperSource, /WorkEngineIncomeAllocationNumberModal/);
  assert.match(
    previewPaperSource,
    /ref=\{contentRef\}[\s\S]*dangerouslySetInnerHTML=\{\{ __html: previewHtml \}\}\s*\/>/,
  );
  assert.doesNotMatch(previewPaperSource, /INCOME_DOCUMENT_ALLOCATION_EDIT_SELECTOR/);
  assert.doesNotMatch(previewPaperSource, /data-income-allocation-edit/);
  assert.doesNotMatch(previewSidebarSource, /allocation_number_field/);
  assert.doesNotMatch(previewSidebarSource, /AllocationNumberRow/);
});

test('allocation edit chrome visibility comes from backend descriptor only', () => {
  assert.match(chromePureSource, /field\?\.visible/);
  assert.match(chromePureSource, /field\.editable/);
  assert.match(chromePureSource, /field\.disabled_reason/);
  assert.match(chromePureSource, /field\.tooltip/);
  assert.doesNotMatch(chromePureSource, /tax_invoice/);
});

test('retainer preview modal uses same application overlay pattern', () => {
  assert.match(retainerPreviewModalSource, /WorkEngineIncomeDocumentPreviewPaper/);
  assert.doesNotMatch(retainerPreviewModalSource, /WorkEngineIncomeAllocationNumberMetaRow/);
  assert.doesNotMatch(retainerPreviewModalSource, /nx-we-preview-allocation-meta/);
  assert.doesNotMatch(retainerPreviewModalSource, /resolveCycleDraftPreviewAllocationButton/);
  assert.doesNotMatch(retainerPreviewModalSource, /PreviewAllocationIcon/);
  assert.doesNotMatch(retainerPreviewModalSource, /nx-we-preview-sidebar/);
});

test('retainer preview modal renders one document canvas without sidebar', () => {
  assert.doesNotMatch(retainerPreviewModalSource, /WorkEngineIncomeDocumentPreviewSidebar/);
  assert.match(retainerPreviewModalSource, /nx-we-retainer-preview-modal__canvas/);
});

test('allocation save uses named command and refreshed aggregate', () => {
  assert.match(retainerSetupSource, /handleSaveCycleDraftAllocationNumber/);
  assert.match(retainerSetupSource, /update_allocation_number/);
  assert.match(retainerSetupSource, /mergeIncomeWorkspaceWizardPatch/);
  assert.match(wizardSource, /update_allocation_number/);
  assert.match(wizardSource, /income_workspace_aggregate/);
  assert.doesNotMatch(wizardSource, /fetch\(.*allocation/i);
});

test('allocation display_value comes from backend descriptor including placeholder', () => {
  const field = buildIncomeDocumentAllocationNumberField({
    policy: defaultIncomeTaxAllocationNumberPolicy(),
    documentType: 'tax_invoice',
    value: null,
    canEdit: true,
    isIssued: false,
  });
  assert.equal(field.display_value, 'הזינו מספר הקצאה');
  assert.equal(field.editable, true);
  assert.equal(field.tooltip, 'עריכת מספר הקצאה');
});

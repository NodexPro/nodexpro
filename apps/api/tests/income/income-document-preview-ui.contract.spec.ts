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
const retainerCss = readFileSync(
  join(dir, '../../../web/src/styles/nx-work-engine-invoice-retainer.css'),
  'utf8',
);
const previewScreenPureSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/work-engine-income-document-preview-screen.pure.ts'),
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
  /* Live preview_html always mounted; screen-fit uses a separate iframe (never scales live paper). */
  assert.match(
    previewPaperSource,
    /data-testid="we-income-preview-html"[\s\S]*dangerouslySetInnerHTML=\{\{ __html: previewHtml \}\}/,
  );
  assert.match(previewPaperSource, /data-print-source="true"/);
  assert.match(previewPaperSource, /buildIncomePreviewScreenIframeSrcDoc/);
  assert.match(previewPaperSource, /we-income-preview-fit-iframe/);
  assert.match(previewPaperSource, /resolveScreenPreviewPlan/);
  assert.match(previewPaperSource, /ResizeObserver/);
  /* Scale on wrapper only; measure full canvas; iframe stays natural 794×1123. */
  assert.match(previewPaperSource, /--preview-scale/);
  assert.match(previewPaperSource, /nx-we-preview-fit-scaler/);
  assert.match(previewPaperSource, /canvas\.getBoundingClientRect\(\)/);
  assert.match(previewPaperSource, /resolveCanvasAvailableBox/);
  assert.match(previewPaperSource, /resolveScreenPreviewFitDiagnostics/);
  assert.match(previewPaperSource, /resetIframeScroll/);
  assert.match(previewPaperSource, /scrollTo\(0, 0\)/);
  assert.match(previewPaperSource, /waitForIframeAssets/);
  assert.match(previewPaperSource, /\[we-preview-inner\]/);
  assert.match(previewPaperSource, /PREVIEW_PAPER_ROOT_SELECTOR/);
  assert.match(previewPaperSource, /lockIframeViewportToContent/);
  assert.match(previewPaperSource, /width=\{PREVIEW_A4_WIDTH_PX\}/);
  assert.match(previewPaperSource, /height=\{plan\.paper_height\}/);
  assert.doesNotMatch(previewPaperSource, /viewport\.getBoundingClientRect/);
  assert.doesNotMatch(previewPaperSource, /measureIframePaperHeight/);
  assert.doesNotMatch(previewPaperSource, /paper\.style\.setProperty\(['"]transform['"]/);
  assert.doesNotMatch(previewPaperSource, /pinIncomePreviewPaymentsToSheetBottom/);
  assert.match(workEngineQueueCss, /\.nx-we-preview-canvas\s*\{[\s\S]*?width:\s*100%/);
  assert.match(workEngineQueueCss, /\.nx-we-preview-canvas\s*\{[\s\S]*?overflow:\s*auto/);
  assert.match(workEngineQueueCss, /\.nx-we-preview-paper\s*\{[\s\S]*?width:\s*794px/);
  assert.match(workEngineQueueCss, /\.nx-we-preview-paper\s*\{[\s\S]*?min-height:\s*1123px/);
  assert.match(workEngineQueueCss, /\.nx-we-preview-fit-scaler\s*\{[\s\S]*?width:\s*794px/);
  assert.match(workEngineQueueCss, /\.nx-we-preview-fit-scaler\s*\{[\s\S]*?height:\s*var\(--preview-paper-height\)/);
  assert.match(workEngineQueueCss, /\.nx-we-preview-fit-scaler\s*\{[\s\S]*?transform:\s*scale\(var\(--preview-scale\)\)/);
  assert.match(workEngineQueueCss, /\.nx-we-preview-fit-iframe\s*\{[\s\S]*?transform:\s*none\s*!important/);
  assert.match(workEngineQueueCss, /\.nx-we-preview-fit-iframe-shell\s*\{[\s\S]*?width:\s*calc\(794px \* var\(--preview-scale\)\)/);
  assert.match(workEngineQueueCss, /\.nx-we-preview-fit-iframe-shell\s*\{[\s\S]*?height:\s*calc\(var\(--preview-paper-height\) \* var\(--preview-scale\)\)/);
  assert.doesNotMatch(workEngineQueueCss, /\.nx-we-preview-fit-iframe\s*\{[^}]*transform:\s*scale/);
  assert.match(workEngineQueueCss, /@media print/);
  assert.match(workEngineQueueCss, /nx-we-preview-paper--source-parked/);
  assert.doesNotMatch(workEngineQueueCss, /nx-we-preview-paper-fit-shell/);
  /* srcDoc: A4 width, content height — payments/footer not clipped in screen preview. */
  assert.match(previewScreenPureSource, /height grows with content so payment\/footer tail is never clipped/);
  assert.match(previewScreenPureSource, /overflow:visible !important/);
  assert.match(previewScreenPureSource, /height:auto !important/);
  assert.match(previewScreenPureSource, /min-height:\$\{PREVIEW_A4_HEIGHT_PX\}px !important/);
  assert.doesNotMatch(previewScreenPureSource, /min-height: calc\(100vh/);
  assert.doesNotMatch(previewScreenPureSource, /transform:translateY\(calc\(38px/);
  assert.match(previewPaperSource, /pdf-fit-width-payments-v1/);
  assert.match(retainerCss, /\.nx-we-retainer-preview-overlay\s*\{[\s\S]*?rgba\(8, 12, 22, 0\.78\)/);
  assert.match(retainerCss, /\.nx-we-retainer-preview-modal\s*\{[\s\S]*?background:\s*transparent/);
  assert.match(retainerCss, /\.nx-we-retainer-preview-modal__canvas\.nx-we-preview-canvas--screen-fit\s*\{[\s\S]*?overflow:\s*auto/);
  assert.match(workEngineQueueCss, /\.nx-we-preview-canvas--screen-fit \.nx-we-preview-fit-viewport[\s\S]*?position:\s*relative/);

  assert.match(previewPaperSource, /resolveIncomeDocumentAllocationEditChrome/);
  assert.match(previewPaperSource, /nx-we-preview-allocation-edit-btn--inline/);
  assert.match(previewPaperSource, /nx-doc__meta-label-group--injected/);
  assert.doesNotMatch(previewPaperSource, /measureIncomeDocumentAllocationEditAnchor/);
  assert.match(previewPaperSource, /WorkEngineIncomeAllocationNumberModal/);
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

test('credit_note Eye opens ready-to-print overlay, not wizard editor preview', () => {
  const generatePreviewHandler = wizardSource.slice(
    wizardSource.indexOf('const handleGeneratePreview'),
    wizardSource.indexOf('if (!open) return null'),
  );
  assert.match(generatePreviewHandler, /flushPendingEdits/);
  assert.match(generatePreviewHandler, /cmds\.generate_preview/);
  assert.match(generatePreviewHandler, /footerActions\?\.mode === 'credit_note'/);
  assert.match(generatePreviewHandler, /setReadyToPrintPreviewOpen\(true\)/);
  assert.doesNotMatch(generatePreviewHandler, /fetch\(/);
  assert.match(wizardSource, /WorkEngineInvoiceRetainerPreviewModal/);
  assert.match(
    wizardSource,
    /s\.key === 'preview'[\s\S]*?footerActions\?\.mode === 'credit_note'[\s\S]*?footerActions\?\.mode === 'conversion'/,
  );
  assert.match(wizardSource, /nx-we-retainer-preview-overlay--above-wizard/);
  assert.match(retainerCss, /\.nx-we-retainer-preview-overlay--above-wizard\s*\{[\s\S]*?z-index:\s*14100/);
  assert.match(retainerCss, /\.nx-we-retainer-preview-overlay\s*\{[\s\S]*?z-index:\s*13100/);
  assert.match(previewStepSource, /WorkEngineIncomeDocumentPreviewSidebar/);
  assert.match(wizardSource, /WorkEngineIncomePreviewStep/);
  assert.doesNotMatch(wizardSource, /IncomeDocumentBrandingSettingsModal/);
  assert.doesNotMatch(wizardSource, /OwnerInvoiceDocumentBuilderSection/);
});

test('conversion תצוגה מקדימה opens same ready-to-print overlay above wizard', () => {
  const generatePreviewHandler = wizardSource.slice(
    wizardSource.indexOf('const handleGeneratePreview'),
    wizardSource.indexOf('if (!open) return null'),
  );
  assert.match(generatePreviewHandler, /footerActions\?\.mode === 'conversion'/);
  assert.match(generatePreviewHandler, /setReadyToPrintPreviewOpen\(true\)/);
  assert.match(generatePreviewHandler, /WorkEngineInvoiceRetainerPreviewModal|setReadyToPrintPreview\(/);
  assert.match(
    wizardSource,
    /footerActions\?\.mode === 'credit_note' \|\| footerActions\?\.mode === 'conversion'/,
  );
  assert.match(wizardSource, /conversion_source\?\.display_line/);
  assert.doesNotMatch(generatePreviewHandler, /fetch\(/);
  // Must not route conversion into the sidebar / designer preview step.
  assert.match(
    wizardSource,
    /s\.key === 'preview'[\s\S]*?mode === 'conversion'/,
  );
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

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

function readRepo(relativeFromApiTests: string): string {
  return readFileSync(join(dir, relativeFromApiTests), 'utf8');
}

const taxColumnsSource = readRepo(
  '../../src/domains/work-engine/work-engine-invoices-client-documents-by-type.read-model.service.ts',
);
const documentsModalSource = readRepo(
  '../../../web/src/components/work-engine/WorkEngineClientDocumentsByTypeModal.tsx',
);
const overrideModalSource = readRepo(
  '../../../web/src/components/work-engine/WorkEngineRecurringCycleOverrideModal.tsx',
);
const emailHistorySource = readRepo(
  '../../../web/src/components/income/IncomeDocumentEmailHistoryModal.tsx',
);
const docflowSendSource = readRepo(
  '../../../web/src/components/income/IncomeDocumentDocflowSendModal.tsx',
);
const representedEmailSource = readRepo(
  '../../../web/src/components/income/IncomeRepresentedClientEmailHistoryModal.tsx',
);
const recordPaymentSource = readRepo(
  '../../../web/src/components/income/IncomeDocumentRecordPaymentModal.tsx',
);
const allocationModalSource = readRepo(
  '../../../web/src/components/work-engine/WorkEngineIncomeAllocationNumberModal.tsx',
);
const brandingPanelSource = readRepo(
  '../../../web/src/components/income/IncomeDocumentBrandingSettingsPanel.tsx',
);
const brandingServiceSource = readRepo('../../src/domains/income/income-document-branding.service.ts');
const commandsSource = readRepo(
  '../../src/domains/work-engine/work-engine-invoice-retainer.commands.service.ts',
);

function extractTaxInvoiceColumns(src: string): string {
  const start = src.indexOf('const TAX_INVOICE_TABLE_COLUMNS = [');
  const end = src.indexOf('];', start);
  return src.slice(start, end + 2);
}

test('A/B — retainer preview Eye reuses canonical preview command without a new renderer', () => {
  assert.match(overrideModalSource, /nx-income-branding-modal__preview-eye/);
  assert.match(overrideModalSource, /aria-label=\{aggregate\.preview_action\.label\}/);
  assert.doesNotMatch(overrideModalSource, />\s*\{aggregate\.preview_action\.label\}\s*</);
  assert.match(overrideModalSource, /WorkEngineInvoiceRetainerPreviewModal/);
  assert.match(commandsSource, /previewCycleOverride/);
  assert.match(commandsSource, /document_details_step/);
});

test('C — tax invoice list keeps a single Eye from view_action', () => {
  const taxColumns = extractTaxInvoiceColumns(taxColumnsSource);
  assert.match(taxColumns, /key: 'actions'/);
  assert.doesNotMatch(taxColumns, /key: 'view'/);
  assert.match(documentsModalSource, /hasDedicatedViewColumn/);
  assert.match(documentsModalSource, /row\.view_action\?\.enabled/);
  assert.match(documentsModalSource, /nx-we-documents-modal__icon-btn nx-we-documents-modal__view/);
});

test('D/E — document number remains a view link; convert/edit/cancel stay separate', () => {
  assert.match(documentsModalSource, /nx-income-doc-number-link/);
  assert.match(documentsModalSource, /handleEditPreliminary/);
  assert.match(documentsModalSource, /convertAction/);
  assert.match(documentsModalSource, /cancelAction/);
});

test('F/G — invoice modals keep one close control in the header', () => {
  assert.match(documentsModalSource, /nx-we-documents-modal__close/);
  assert.doesNotMatch(documentsModalSource, /nx-income-wizard__footer[\s\S]*סגירה/);
  assert.doesNotMatch(overrideModalSource, /nx-we-retainer-setup__footer[\s\S]*סגירה/);
  assert.match(overrideModalSource, /nx-income-branding-modal__close/);
  assert.doesNotMatch(emailHistorySource, /nx-modal-footer[\s\S]*סגירה/);
  assert.doesNotMatch(docflowSendSource, /nx-modal-footer[\s\S]*סגירה/);
  assert.doesNotMatch(representedEmailSource, /nx-modal-footer[\s\S]*סגירה/);
  assert.doesNotMatch(recordPaymentSource, />\s*סגירה\s*</);
  assert.doesNotMatch(allocationModalSource, />\s*סגירה\s*</);
  assert.match(recordPaymentSource, /שמירה/);
  assert.match(allocationModalSource, /שמירה/);
});

test('H/I — branding studio catalog is backend-owned and still renders historical themes', () => {
  assert.match(brandingServiceSource, /getStudioColorThemePresets\(\{/);
  assert.match(brandingServiceSource, /selectedColorThemeKey: resolvedForGroup.color_theme_key/);
  assert.match(brandingPanelSource, /studio\.studio_color_theme_presets\.map/);
  assert.doesNotMatch(brandingPanelSource, /pale_peach|pastel_purple|pale_blue/);
});

test('J — retainer lifecycle commands and payment record path remain in place', () => {
  assert.match(commandsSource, /openCycleOverride/);
  assert.match(commandsSource, /saveCycleOverride/);
  assert.match(documentsModalSource, /IncomeDocumentRecordPaymentModal/);
  assert.match(taxColumnsSource, /record_payment/);
});

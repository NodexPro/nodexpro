/**
 * INC-8 — static contract checks for Work Engine Invoices tab UI.
 * Run: node scripts/check-work-engine-invoices-tab-contract.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const tabHost = path.join(repoRoot, 'apps/web/src/components/work-engine/WorkEngineTabHost.tsx');
const tableComponent = path.join(
  repoRoot,
  'apps/web/src/components/work-engine/WorkEngineModuleTabTable.tsx',
);
const workEngineApi = path.join(repoRoot, 'apps/web/src/api/work-engine.ts');

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

const page = read(tabHost);
const table = read(tableComponent);
const api = read(workEngineApi);
const wizard = read(
  path.join(repoRoot, 'apps/web/src/components/work-engine/WorkEngineIncomeDocumentWizardModal.tsx'),
);
const recipientField = read(
  path.join(repoRoot, 'apps/web/src/components/work-engine/WorkEngineRecipientSearchField.tsx'),
);
const docDetailsStep = read(
  path.join(repoRoot, 'apps/web/src/components/work-engine/WorkEngineDocumentDetailsStep.tsx'),
);

const errors = [];

if (!api.includes('fetchWorkEngineInvoicesTabAggregate')) {
  errors.push('missing fetchWorkEngineInvoicesTabAggregate');
}
if (!api.includes('aggregateInvoicesTab')) {
  errors.push('missing WORK_ENGINE.aggregateInvoicesTab endpoint');
}
if (!page.includes('fetchWorkEngineInvoicesTabAggregate')) {
  errors.push('tab host must load invoices-tab aggregate');
}
if (!page.includes('WorkEngineModuleTabTable')) {
  errors.push('tab host must render WorkEngineModuleTabTable');
}
if (!page.includes('WorkEngineIncomeDocumentWizardModal')) {
  errors.push('tab host must open Work Engine income wizard modal');
}
if (!api.includes('document_creation_entrypoint')) {
  errors.push('invoices-tab aggregate type must include document_creation_entrypoint');
}
if (!wizard.includes('nx-we-wizard-issuer-grid')) {
  errors.push('wizard must render equal-size issuer buttons from backend schema');
}
if (/1000|2000|3000|4000|61111/.test(wizard)) {
  errors.push('wizard must not hardcode IL document numbering');
}
if (/backdated|מוקדם ממסמך/.test(wizard)) {
  errors.push('wizard must not validate backdated document dates on frontend');
}

const wizardForbidden = [
  /עוסק\s*מורשה/,
  /עוסק\s*פטור/,
  /osek_murshe/,
  /osek_patur/,
  /normalizeIssuerBusinessType/,
  /mapClientOperationsBusinessType/,
  /business_type\s*===/,
  /business_type\s*==/,
  /fetchClientOperations/,
  /client-operations/,
  /client_operations/,
  /\/m\/client-operations/,
  /CLIENT_OPERATIONS/,
];
for (const re of wizardForbidden) {
  if (re.test(wizard)) {
    errors.push(`wizard forbidden pattern: ${re}`);
  }
}

if (!wizard.includes('office_client_issuer_options')) {
  errors.push('wizard must render office_client_issuer_options from aggregate');
}
if (!wizard.includes('office_client_display_labels')) {
  errors.push('wizard must use backend office_client_display_labels for prefill captions');
}
if (!wizard.includes('business_type_label')) {
  errors.push('wizard must render business_type_label from backend only');
}
if (/מזהה:/.test(wizard)) {
  errors.push('wizard must not hardcode tax_id label (use office_client_display_labels)');
}

if (!wizard.includes('WorkEngineRecipientSearchField')) {
  errors.push('wizard must use WorkEngineRecipientSearchField for recipient step');
}
if (/לקוח חד-פעמי|לקוח קיים|customer_mode/.test(wizard + recipientField)) {
  errors.push('wizard must not offer one-time vs permanent recipient choice');
}
if (!recipientField.includes('recipient_search')) {
  errors.push('recipient field must render from income_workspace_aggregate.recipient_search');
}
if (!recipientField.includes('search_recipients')) {
  errors.push('recipient field must call search_recipients command');
}
if (!recipientField.includes('commitPendingCreate')) {
  errors.push('recipient field must expose commitPendingCreate for Next step');
}
if (!wizard.includes('recipientFieldRef')) {
  errors.push('wizard must commit recipient via ref on Next (backend truth only)');
}
if (/אישור מקבל/.test(recipientField)) {
  errors.push('recipient field must not use extra confirm button; Next commits via command');
}
if (!wizard.includes('nx-we-income-wizard-modal')) {
  errors.push('wizard must use enlarged nx-we-income-wizard-modal');
}
if (!wizard.includes('recipientPending') || !wizard.includes('onPendingChange')) {
  errors.push('wizard must disable footer while recipient command is in flight');
}
if (!recipientField.includes('nx-we-recipient-search--wizard')) {
  errors.push('recipient field must use wizard workspace layout (not tiny dropdown)');
}
if (!recipientField.includes('selectInFlight')) {
  errors.push('recipient field must guard duplicate select commands via selectInFlight ref');
}
if (!recipientField.includes('skipSearchEffectRef')) {
  errors.push('recipient field must skip debounced search after programmatic query from select');
}
if (!recipientField.includes('already selected, no command')) {
  errors.push('commitPendingCreate must not re-send select when recipient already chosen');
}
if (/pending\?\.kind === 'search'/.test(recipientField) && /onPendingChange\(pending !== null\)/.test(recipientField)) {
  errors.push('search pending must not lock wizard footer');
}
if (!api.includes('recipient_search')) {
  errors.push('work-engine API types must include wizard.recipient_search');
}
if (!wizard.includes('WorkEngineDocumentDetailsStep')) {
  errors.push('wizard must use WorkEngineDocumentDetailsStep for document_details');
}
if (!wizard.includes('begin_wizard_draft')) {
  errors.push('wizard must begin draft via begin_wizard_draft command on recipient Next');
}
if (!wizard.includes('document_details_step')) {
  errors.push('wizard must pass document_details_step from income_workspace_aggregate');
}
if (/subtotal_reference|vat_reference|grand_total_reference|amount_reference\s*\*|\.reduce\(/.test(docDetailsStep)) {
  errors.push('document details UI must not calculate financial totals');
}
if (!docDetailsStep.includes('add_line')) {
  errors.push('document details must add lines via backend add_line command');
}
if (!docDetailsStep.includes('document_fields')) {
  errors.push('document details must use line_items.document_fields for currency/vat selects');
}
if (!docDetailsStep.includes('lockUi: false')) {
  errors.push('document details line edits must not lock wizard UI on each keystroke');
}
if (!docDetailsStep.includes('step.line_items.columns')) {
  errors.push('document details table must render columns from aggregate schema');
}
if (/row_number|0\.18|17%|מע״מ רגיל/.test(docDetailsStep)) {
  errors.push('document details UI must not hardcode row numbers or VAT labels');
}
if (!docDetailsStep.includes('step.header.title')) {
  errors.push('document details must render backend header.title only');
}

const invoicesPanelSource = read(tabHost);
if (
  /WorkEngineInvoicesTabPanel[\s\S]*ClientOperationsRegistryView/.test(invoicesPanelSource) ||
  /showInvoices[\s\S]*ClientOperationsRegistryView/.test(invoicesPanelSource)
) {
  errors.push('invoices tab must not embed Client Operations registry');
}
if (
  !page.includes("tabKey === 'invoices'") &&
  !page.includes('resolveWorkEngineTabKey')
) {
  errors.push('missing invoices tab routing');
}

const forbidden = [
  /const\s+COLUMNS\s*=\s*\[/,
  /client_name:\s*['"]לקוח['"]/,
  /sum_paid_reference\s*\+/,
  /rows\.reduce/,
  /fetchIncomeWorkspace/,
];
for (const re of forbidden) {
  if (re.test(page) || re.test(table)) {
    errors.push(`forbidden pattern: ${re}`);
  }
}

if (errors.length) {
  console.error(
    'Work Engine invoices tab contract check FAILED:\n' + errors.map((e) => ` - ${e}`).join('\n'),
  );
  process.exit(1);
}

console.log('Work Engine invoices tab contract check OK');

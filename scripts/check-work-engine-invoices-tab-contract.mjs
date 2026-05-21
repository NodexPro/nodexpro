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

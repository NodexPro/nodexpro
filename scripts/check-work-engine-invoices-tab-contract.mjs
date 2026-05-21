/**
 * INC-8 — static contract checks for Work Engine Invoices tab UI.
 * Run: node scripts/check-work-engine-invoices-tab-contract.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const queuePage = path.join(repoRoot, 'apps/web/src/pages/WorkEngineQueue.tsx');
const tableComponent = path.join(
  repoRoot,
  'apps/web/src/components/work-engine/WorkEngineModuleTabTable.tsx',
);
const workEngineApi = path.join(repoRoot, 'apps/web/src/api/work-engine.ts');

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

const page = read(queuePage);
const table = read(tableComponent);
const api = read(workEngineApi);

const errors = [];

if (!api.includes('fetchWorkEngineInvoicesTabAggregate')) {
  errors.push('missing fetchWorkEngineInvoicesTabAggregate');
}
if (!api.includes('aggregateInvoicesTab')) {
  errors.push('missing WORK_ENGINE.aggregateInvoicesTab endpoint');
}
if (!page.includes('fetchWorkEngineInvoicesTabAggregate')) {
  errors.push('WorkEngineQueue must load invoices-tab aggregate');
}
if (!page.includes('WorkEngineModuleTabTable')) {
  errors.push('WorkEngineQueue must render WorkEngineModuleTabTable');
}
if (page.includes('tab=invoices') === false && !page.includes("get('tab') === 'invoices'")) {
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

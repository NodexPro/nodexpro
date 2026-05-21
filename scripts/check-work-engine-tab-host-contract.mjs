/**
 * Work Engine embedded tab host — static contract checks.
 * Run: node scripts/check-work-engine-tab-host-contract.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const tabHost = path.join(repoRoot, 'apps/web/src/components/work-engine/WorkEngineTabHost.tsx');
const queuePage = path.join(repoRoot, 'apps/web/src/pages/WorkEngineQueue.tsx');
const tableComponent = path.join(
  repoRoot,
  'apps/web/src/components/work-engine/WorkEngineModuleTabTable.tsx',
);
const workEngineApi = path.join(repoRoot, 'apps/web/src/api/work-engine.ts');
const readModels = path.join(
  repoRoot,
  'apps/api/src/domains/work-engine/work-engine.read-models.service.ts',
);

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

const host = read(tabHost);
const page = read(queuePage);
const table = read(tableComponent);
const api = read(workEngineApi);
const backend = read(readModels);

const errors = [];

if (!host.includes('WorkEngineTabHost')) errors.push('missing WorkEngineTabHost');
if (!host.includes('setSearchParams')) errors.push('tab host must use setSearchParams');
if (host.includes('navigate(tab.route)')) errors.push('tab host must not navigate(tab.route)');
if (!host.includes('fetchWorkEngineInvoicesTabAggregate')) {
  errors.push('invoices tab must fetch invoices-tab aggregate');
}
if (!page.includes('WorkEngineTabHost')) errors.push('WorkEngineQueue must use WorkEngineTabHost');
if (page.includes('fetchWorkEngineInvoicesTabAggregate')) {
  errors.push('invoices fetch must live in tab host only');
}
if (page.includes("navigate(tab.route)")) errors.push('queue page must not navigate tab.route');

if (!api.includes('aggregate_route')) errors.push('AccountantWorkspaceTab missing aggregate_route type');
if (!backend.includes('aggregate_route')) errors.push('backend workspace_tabs missing aggregate_route');

const forbidden = [
  /\/m\/income/,
  /fetchIncomeWorkspace/,
  /\/income\/aggregates/,
  /const\s+COLUMNS\s*=\s*\[/,
  /sum_paid_reference\s*\+/,
  /rows\.reduce/,
];
for (const re of forbidden) {
  if (re.test(host) || re.test(page) || re.test(table)) {
    errors.push(`forbidden pattern: ${re}`);
  }
}

if (!backend.includes("key: 'invoices'") || !backend.includes('embeddedWorkEngineTabRoute')) {
  errors.push('backend invoices tab route must stay embedded');
}
if (!backend.includes("aggregate_route: '/work-engine/aggregates/queue'")) {
  errors.push('backend work tab missing aggregate_route');
}
if (backend.includes('/m/client-operations')) {
  errors.push('backend must not route clients tab to /m/client-operations');
}

if (errors.length) {
  console.error(
    'Work Engine tab host contract check FAILED:\n' + errors.map((e) => ` - ${e}`).join('\n'),
  );
  process.exit(1);
}

console.log('Work Engine tab host contract check OK');

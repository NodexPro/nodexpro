/**
 * INC-7 — static contract checks for Income web module.
 * Run: node scripts/check-income-web-contract.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const incomeApi = path.join(repoRoot, 'apps/web/src/api/income.ts');
const incomePage = path.join(repoRoot, 'apps/web/src/pages/IncomeWorkspacePage.tsx');
const endpoints = path.join(repoRoot, 'apps/web/src/api/endpoints.ts');

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

const api = read(incomeApi);
const page = read(incomePage);
const ep = read(endpoints);

const errors = [];

const allowedGets = [
  "INCOME.workspaceContextAggregate",
  "INCOME.workspaceAggregate",
  "method: 'GET'",
];

if (!api.includes('fetchIncomeWorkspaceContextAggregate')) errors.push('missing workspace-context fetch');
if (!api.includes('fetchIncomeWorkspaceAggregate')) errors.push('missing workspace fetch');
if (!api.includes('executeIncomeCommand')) errors.push('missing command executor');
if (!api.includes('downloadIncomeDocumentPdf')) errors.push('missing download helper');

if (api.match(/method:\s*['"]PATCH['"]/)) errors.push('PATCH not allowed in income api');
if (api.match(/method:\s*['"]PUT['"]/)) errors.push('PUT not allowed in income api');
if (api.match(/method:\s*['"]DELETE['"]/)) errors.push('DELETE not allowed in income api');

const forbiddenBusiness = [
  /documentType\s*===/,
  /document_type\s*===/,
  /paid\s*===/,
  /vat/i,
  /country\s*===/,
];
for (const re of forbiddenBusiness) {
  if (re.test(page)) errors.push(`forbidden pattern in IncomeWorkspacePage: ${re}`);
}

const requiredCommands = [
  'select_income_issuer_context',
  'create_income_customer',
  'create_income_item',
  'create_income_document_draft',
  'update_income_document_draft',
  'cancel_income_document_draft',
  'issue_income_document',
  'retry_income_document_accounting_posting',
  'retry_income_document_pdf_render',
];
for (const cmd of requiredCommands) {
  if (!page.includes(cmd)) errors.push(`IncomeWorkspacePage missing command wire: ${cmd}`);
}

if (!ep.includes("workspaceAggregate: '/income/aggregates/workspace'")) {
  errors.push('endpoints.ts missing INCOME.workspaceAggregate');
}

if (errors.length) {
  console.error('Income web contract check FAILED:\n' + errors.map((e) => ` - ${e}`).join('\n'));
  process.exit(1);
}

console.log('Income web contract check OK');

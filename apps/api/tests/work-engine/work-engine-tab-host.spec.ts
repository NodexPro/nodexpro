import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const readModelsSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.read-models.service.ts'),
  'utf8',
);
const tabHostSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineTabHost.tsx'),
  'utf8',
);

test('workspace_tabs seeds use embedded routes and aggregate_route', () => {
  assert.match(readModelsSource, /key: 'work'[\s\S]*aggregate_route: '\/work-engine\/aggregates\/queue'/);
  assert.match(
    readModelsSource,
    /key: 'invoices'[\s\S]*aggregate_route: '\/work-engine\/aggregates\/invoices-tab'/,
  );
  assert.match(readModelsSource, /embeddedWorkEngineTabRoute/);
  assert.doesNotMatch(readModelsSource, /route: '\/m\/client-operations'/);
  assert.doesNotMatch(readModelsSource, /route: '\/m\/income'/);
});

test('clients tab enabled with clients-tab aggregate_route', () => {
  assert.match(
    readModelsSource,
    /key: 'clients'[\s\S]*aggregate_route: '\/work-engine\/aggregates\/clients-tab'/,
  );
});

test('disabled tabs expose disabled_reason without aggregate_route', () => {
  assert.match(readModelsSource, /key: 'vat'[\s\S]*aggregate_route: null/);
  assert.match(readModelsSource, /disabled_reason: 'Coming soon'/);
});

test('tab host uses query param switching not module navigation', () => {
  assert.match(tabHostSource, /setSearchParams/);
  assert.doesNotMatch(tabHostSource, /navigate\(tab\.route\)/);
  assert.doesNotMatch(tabHostSource, /\/m\/income/);
  assert.match(tabHostSource, /fetchWorkEngineInvoicesTabAggregate/);
});

test('invoices tab host renders draft entrypoints and resumes via allowed backend action', () => {
  assert.match(tabHostSource, /draft_entrypoints/);
  assert.match(tabHostSource, /resume_income_document_draft/);
  assert.match(tabHostSource, /allowed_actions\.find/);
  assert.doesNotMatch(tabHostSource, /wizard\.income_commands\.resume_draft/);
});

test('wizard modal renders backend preview html only', () => {
  const wizardSource = readFileSync(
    join(dir, '../../../web/src/components/work-engine/WorkEngineIncomeDocumentWizardModal.tsx'),
    'utf8',
  );
  assert.match(wizardSource, /dangerouslySetInnerHTML/);
  assert.match(wizardSource, /document_preview/);
  assert.doesNotMatch(wizardSource, /<table>|subtotal|vat|grand_total/i);
});

test('document details step renders backend totals_block only', () => {
  const detailsSource = readFileSync(
    join(dir, '../../../web/src/components/work-engine/WorkEngineDocumentDetailsStep.tsx'),
    'utf8',
  );
  assert.match(detailsSource, /totals_block\.rows/);
  assert.match(detailsSource, /update_discount/);
  assert.doesNotMatch(detailsSource, /subtotal\s*\+|vat\s*\*|discountAmount/i);
});
